import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlStorage } from "./store-engine";
import { RecoveryJournal } from "./recovery-journal";
import { SuppressionAuthorityEngine, SuppressionAuthorityError } from "./suppression-authority";
import { advanceCheckpoint, genesisCheckpoint, type AppendRequest, type JournalEntry, type Writer } from "./suppression-protocol";

let directory: string;
const handles = new Set<DatabaseSync>();
const writer: Writer = { authorityId: "independent-authority", source: "synthetic-source", writerId: "writer-a", epoch: 1 };
function database(name: string, authorityId = writer.authorityId) {
  const path = join(directory, name), db = new DatabaseSync(path); handles.add(db);
  let insideTransaction = false;
  const sql: SqlStorage = { exec(query, ...values) { const result = db.prepare(query).all(...values) as Record<string, unknown>[]; return { toArray: () => result }; } };
  const transaction = <T>(work: () => T): T => {
    db.exec("BEGIN IMMEDIATE"); insideTransaction = true;
    try {
      const result = work();
      if (result instanceof Promise) throw new Error("ASYNC_INSIDE_TRANSACTION");
      db.exec("COMMIT"); return result;
    } catch (cause) { db.exec("ROLLBACK"); throw cause; }
    finally { insideTransaction = false; }
  };
  const engine = new SuppressionAuthorityEngine(sql, transaction, authorityId);
  return { path, db, sql, transaction, engine, insideTransaction: () => insideTransaction, close() { db.close(); handles.delete(db); } };
}
const entries: JournalEntry[] = [
  { sequence: 1, event: { kind: "account", userId: "deleted-user" } },
  { sequence: 2, event: { kind: "memory", userId: "kept-user", id: "forgotten-memory" } },
  { sequence: 3, event: { kind: "privacy", userId: "kept-user", revision: 8, ai: false, memory: false, history: false } },
  { sequence: 4, event: { kind: "conversation", userId: "kept-user", id: "deleted-conversation" } },
];
function count(db: ReturnType<typeof database>) { return Number(db.sql.exec("SELECT count(*) AS n FROM suppression_authority_entries").toArray()[0]!.n); }
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "mira-suppression-authority-test-")); });
afterEach(async () => { vi.restoreAllMocks(); for (const db of handles) db.close(); handles.clear(); await rm(directory, { recursive: true, force: true }); });

describe("independent suppression authority core", () => {
  it("durably binds identity and enrollment without takeover, reset or alternate epochs", async () => {
    const first = database("authority.sqlite"), genesis = await genesisCheckpoint(writer);
    expect(await first.engine.enroll(writer.source, writer.writerId)).toEqual({ ...writer, ...genesis });
    await first.engine.append({ writer, after: genesis, entries: entries.slice(0, 2) });
    const head = await first.engine.enroll(writer.source, writer.writerId);
    expect(head).toEqual({ ...writer, ...await advanceCheckpoint(writer, genesis, entries.slice(0, 2)) });
    await expect(first.engine.enroll(writer.source, "other-writer")).rejects.toThrow("SUPPRESSION_WRITER_MISMATCH");
    expect(() => new SuppressionAuthorityEngine(first.sql, first.transaction, "different-authority")).toThrow("SUPPRESSION_AUTHORITY_MISMATCH");
    first.close();
    const reopened = database("authority.sqlite");
    expect(await reopened.engine.enroll(writer.source, writer.writerId)).toEqual(head);
    await expect(reopened.engine.append({ writer: { ...writer, epoch: 2 }, after: genesis, entries: [] })).rejects.toThrow("SUPPRESSION_WRITER_MISMATCH");
    expect(count(reopened)).toBe(2);
  });

  it("accepts exact, reordered-property, prefix and overlapping retries but returns only the request-end receipt", async () => {
    const db = database("authority.sqlite"), genesis = await genesisCheckpoint(writer);
    await db.engine.enroll(writer.source, writer.writerId);
    const initial: AppendRequest = { writer, after: genesis, entries: entries.slice(0, 3) };
    const accepted = await db.engine.append(initial);
    expect(await db.engine.append(initial)).toEqual(accepted);
    // Property order is not journal identity; an event's semantic values are.
    expect(await db.engine.append({ writer, after: genesis, entries: [{ sequence: 1, event: { userId: "deleted-user", kind: "account" } }] })).toEqual({ ...writer, ...await advanceCheckpoint(writer, genesis, entries.slice(0, 1)) });
    expect(await db.engine.append({ writer, after: genesis, entries: [] })).toEqual({ ...writer, ...genesis });
    const first = await advanceCheckpoint(writer, genesis, entries.slice(0, 1));
    const overlap = await db.engine.append({ writer, after: first, entries: entries.slice(1) });
    expect(overlap).toEqual({ ...writer, ...await advanceCheckpoint(writer, genesis, entries) });
    expect(count(db)).toBe(4);
    const page = db.engine.read(writer, genesis);
    expect(page).toEqual({ entries, checkpoint: { sequence: overlap.sequence, digest: overlap.digest }, head: overlap, fenced: false, hasMore: false });
  });

  it("recovers from a lost receipt across an actual SQLite close/reopen without duplicating events", async () => {
    const db = database("authority.sqlite"), genesis = await genesisCheckpoint(writer);
    await db.engine.enroll(writer.source, writer.writerId);
    const request = { writer, after: genesis, entries };
    await db.engine.append(request); // The source never receives/persists this result.
    db.close();
    const reopened = database("authority.sqlite");
    expect(await reopened.engine.append(request)).toEqual({ ...writer, ...await advanceCheckpoint(writer, genesis, entries) });
    expect(count(reopened)).toBe(4);
  });

  it("retains a separately stored deletion journal after the source database is removed", async () => {
    const source = database("source.sqlite", "source-fixture-only"), authority = database("authority.sqlite");
    const journal = new RecoveryJournal(source.sql), genesis = await genesisCheckpoint(writer);
    source.transaction(() => { for (const entry of entries) journal.append(entry.event); });
    await authority.engine.enroll(writer.source, writer.writerId);
    const receipt = await authority.engine.append({ writer, after: genesis, entries: journal.page(0, journal.watermark()) });
    expect(source.path).not.toBe(authority.path);
    source.close(); await unlink(source.path);
    authority.close();
    const survivingAuthority = database("authority.sqlite");
    expect(survivingAuthority.engine.read(writer, genesis)).toMatchObject({ entries, head: receipt });
    expect(survivingAuthority.engine.fence(writer, "restoration-target", "fresh-challenge")).toMatchObject({ ...receipt, fenced: true });
    // This proves independent journal survival and writer revocation only. No
    // BackupEngine admission or permission to serve restored data is exercised.
  });

  it("rejects gaps, reordered sequences, conflicting events/checkpoints and wrong writers without partial mutation", async () => {
    const db = database("authority.sqlite"), genesis = await genesisCheckpoint(writer);
    await db.engine.enroll(writer.source, writer.writerId);
    await db.engine.append({ writer, after: genesis, entries: entries.slice(0, 2) });
    const before = db.engine.read(writer, genesis);
    const changed = { sequence: 2, event: { kind: "memory", userId: "kept-user", id: "different-memory" } };
    const invalid: [unknown, string][] = [
      [{ writer, after: genesis, entries: [entries[1]] }, "SUPPRESSION_SEQUENCE_GAP"],
      [{ writer, after: genesis, entries: [entries[0], entries[2], entries[1]] }, "SUPPRESSION_SEQUENCE_GAP"],
      [{ writer, after: genesis, entries: [entries[0], changed, entries[2]] }, "SUPPRESSION_ENTRY_CONFLICT"],
      [{ writer, after: { ...genesis, digest: "A".repeat(43) + "=" }, entries: [] }, "SUPPRESSION_CHECKPOINT_CONFLICT"],
      [{ writer, after: await advanceCheckpoint(writer, genesis, entries), entries: [] }, "SUPPRESSION_SEQUENCE_GAP"],
      [{ writer: { ...writer, authorityId: "other-authority" }, after: genesis, entries: [] }, "SUPPRESSION_AUTHORITY_MISMATCH"],
      [{ writer: { ...writer, source: "not-enrolled" }, after: genesis, entries: [] }, "SUPPRESSION_WRITER_UNKNOWN"],
      [{ writer: { ...writer, writerId: "other-writer" }, after: genesis, entries: [] }, "SUPPRESSION_WRITER_MISMATCH"],
      [{ writer: { ...writer, epoch: 2 }, after: genesis, entries: [] }, "SUPPRESSION_WRITER_MISMATCH"],
    ];
    for (const [request, code] of invalid) {
      await expect(db.engine.append(request)).rejects.toThrow(code);
      expect(db.engine.read(writer, genesis)).toEqual(before);
    }
    expect(count(db)).toBe(2);
  });

  it("strictly rejects malformed or content-bearing payloads before any immutable entry is stored", async () => {
    const db = database("authority.sqlite"), genesis = await genesisCheckpoint(writer);
    await db.engine.enroll(writer.source, writer.writerId);
    const base = { writer, after: genesis, entries: [] };
    const invalid = [
      null, [], {}, { ...base, password: "not-a-real-password" },
      { ...base, writer: { ...writer, token: "synthetic-token" } },
      { ...base, writer: { ...writer, epoch: 0 } },
      { ...base, writer: { ...writer, source: "x".repeat(121) } },
      { ...base, after: { ...genesis, sequence: -1 } },
      { ...base, after: { ...genesis, sequence: Number.MAX_SAFE_INTEGER + 1 } },
      { ...base, after: { ...genesis, digest: "bad" } },
      { ...base, after: { ...genesis, extra: true } },
      { ...base, entries: Array.from({ length: 129 }, (_, i) => ({ sequence: i + 1, event: entries[0]!.event })) },
      { ...base, entries: [{ sequence: 0, event: entries[0]!.event }] },
      { ...base, entries: [{ sequence: 1, event: entries[0]!.event, content: "do not store" }] },
      { ...base, entries: [{ sequence: 1, event: { ...entries[0]!.event, content: "do not store" } }] },
      { ...base, entries: [{ sequence: 1, event: { kind: "account", userId: "person@example.test" } }] },
      { ...base, entries: [{ sequence: 1, event: { kind: "unknown", userId: "synthetic-user" } }] },
      { ...base, entries: [{ sequence: 1, event: { kind: "privacy", userId: "synthetic-user", revision: 1, ai: "false", memory: false, history: false } }] },
    ];
    for (const request of invalid) await expect(db.engine.append(request)).rejects.toThrow("SUPPRESSION_INVALID");
    expect(count(db)).toBe(0);
    expect(JSON.stringify(db.sql.exec("SELECT * FROM suppression_authority_entries").toArray())).not.toContain("do not store");
    await expect(db.engine.enroll("invalid/source", "writer")).rejects.toBeInstanceOf(SuppressionAuthorityError);
    expect(() => db.engine.fence(writer, "", "challenge")).toThrow("SUPPRESSION_INVALID");
  });

  it("serializes racing exact retries and admits only one of conflicting prepared histories", async () => {
    const db = database("authority.sqlite"), genesis = await genesisCheckpoint(writer);
    await db.engine.enroll(writer.source, writer.writerId);
    const initial = { writer, after: genesis, entries: entries.slice(0, 2) };
    const [one, two] = await Promise.all([db.engine.append(initial), db.engine.append(initial)]);
    expect(one).toEqual(two); expect(count(db)).toBe(2);
    const after = { sequence: one.sequence, digest: one.digest };
    const results = await Promise.allSettled([
      db.engine.append({ writer, after, entries: [entries[2]] }),
      db.engine.append({ writer, after, entries: [{ sequence: 3, event: { kind: "account", userId: "different-event" } }] }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toEqual([expect.objectContaining({ reason: expect.objectContaining({ code: "SUPPRESSION_ENTRY_CONFLICT" }) })]);
    expect(count(db)).toBe(3);
  });

  it("rolls back a failed durable transaction instead of emitting a receipt for partially stored entries", async () => {
    const db = database("authority.sqlite"), genesis = await genesisCheckpoint(writer);
    await db.engine.enroll(writer.source, writer.writerId);
    db.sql.exec("CREATE TRIGGER synthetic_storage_failure BEFORE INSERT ON suppression_authority_entries WHEN NEW.sequence=3 BEGIN SELECT RAISE(ABORT,'SYNTHETIC_DISK_FAILURE'); END");
    await expect(db.engine.append({ writer, after: genesis, entries })).rejects.toThrow("SYNTHETIC_DISK_FAILURE");
    expect(count(db)).toBe(0);
    expect(await db.engine.enroll(writer.source, writer.writerId)).toEqual({ ...writer, ...genesis });
    db.sql.exec("DROP TRIGGER synthetic_storage_failure");
    expect(await db.engine.append({ writer, after: genesis, entries })).toEqual({ ...writer, ...await advanceCheckpoint(writer, genesis, entries) });
  });

  it("permanently fences a pinned target/challenge/head, including after process restart", async () => {
    const db = database("authority.sqlite"), genesis = await genesisCheckpoint(writer);
    await db.engine.enroll(writer.source, writer.writerId);
    const accepted = await db.engine.append({ writer, after: genesis, entries });
    const fence = db.engine.fence(writer, "target-a", "challenge-a");
    expect(fence).toEqual({ ...accepted, fenced: true, target: "target-a", challenge: "challenge-a" });
    expect(db.engine.fence(writer, "target-a", "challenge-a")).toEqual(fence);
    expect(() => db.engine.fence(writer, "target-b", "challenge-a")).toThrow("SUPPRESSION_FENCE_CONFLICT");
    expect(() => db.engine.fence(writer, "target-a", "challenge-b")).toThrow("SUPPRESSION_FENCE_CONFLICT");
    expect(() => db.engine.fence({ ...writer, epoch: 2 }, "target-a", "challenge-a")).toThrow("SUPPRESSION_WRITER_MISMATCH");
    db.close();
    const reopened = database("authority.sqlite");
    expect(reopened.engine.fence(writer, "target-a", "challenge-a")).toEqual(fence);
    for (const retry of [[], entries.slice(0, 1), entries]) await expect(reopened.engine.append({ writer, after: genesis, entries: retry })).rejects.toThrow("SUPPRESSION_WRITER_FENCED");
    await expect(reopened.engine.enroll(writer.source, writer.writerId)).rejects.toThrow("SUPPRESSION_WRITER_FENCED");
    await expect(reopened.engine.enroll(writer.source, "replacement-writer")).rejects.toThrow("SUPPRESSION_WRITER_MISMATCH");
    expect(reopened.engine.read(writer, genesis)).toMatchObject({ entries, fenced: true, head: accepted });
    expect(count(reopened)).toBe(4);
  });

  it("keeps cryptography outside transactions and rejects an append prepared before a concurrent fence", async () => {
    const db = database("authority.sqlite"), genesis = await genesisCheckpoint(writer);
    await db.engine.enroll(writer.source, writer.writerId);
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    const digestSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation((...args) => {
      expect(db.insideTransaction()).toBe(false);
      return originalDigest(...args);
    });
    const pending = db.engine.append({ writer, after: genesis, entries });
    const fenced = db.engine.fence(writer, "target", "nonce");
    await expect(pending).rejects.toThrow("SUPPRESSION_WRITER_FENCED");
    expect(digestSpy).toHaveBeenCalled(); expect(fenced.sequence).toBe(0); expect(count(db)).toBe(0);
  });

  it("pages immutable history with bounded validated checkpoints and isolates multiple sources", async () => {
    const db = database("authority.sqlite"), genesis = await genesisCheckpoint(writer);
    await db.engine.enroll(writer.source, writer.writerId);
    await db.engine.append({ writer, after: genesis, entries });
    const one = db.engine.read(writer, genesis, 2);
    expect(one).toMatchObject({ entries: entries.slice(0, 2), hasMore: true, head: { sequence: 4 } });
    expect(one.checkpoint).toEqual(await advanceCheckpoint(writer, genesis, entries.slice(0, 2)));
    const two = db.engine.read(writer, one.checkpoint, 2);
    expect(two).toMatchObject({ entries: entries.slice(2), hasMore: false });
    expect(two.checkpoint).toEqual(await advanceCheckpoint(writer, one.checkpoint, two.entries));
    expect(db.engine.read(writer, two.checkpoint, 1)).toMatchObject({ entries: [], checkpoint: two.checkpoint, hasMore: false });
    for (const limit of [0, -1, 129, 1.5, NaN, Infinity]) expect(() => db.engine.read(writer, genesis, limit)).toThrow("SUPPRESSION_PAGE_RANGE");
    expect(() => db.engine.read(writer, { ...genesis, digest: "A".repeat(43) + "=" })).toThrow("SUPPRESSION_CHECKPOINT_CONFLICT");
    expect(() => db.engine.read({ ...writer, writerId: "other-writer" }, genesis)).toThrow("SUPPRESSION_WRITER_MISMATCH");
    const otherWriter = { ...writer, source: "other-source" }, otherGenesis = await genesisCheckpoint(otherWriter);
    await db.engine.enroll(otherWriter.source, otherWriter.writerId);
    expect(db.engine.read(otherWriter, otherGenesis).entries).toEqual([]);
    await expect(db.engine.append({ writer: otherWriter, after: genesis, entries })).rejects.toThrow("SUPPRESSION_CHECKPOINT_CONFLICT");
    await db.engine.append({ writer: otherWriter, after: otherGenesis, entries: [entries[0]] });
    expect(db.engine.read(otherWriter, otherGenesis).entries).toEqual(entries.slice(0, 1));
    expect(db.engine.read(writer, genesis).entries).toEqual(entries);
  });

  it("fails closed on orphaned or missing durable metadata instead of silently resetting a journal", async () => {
    const db = database("authority.sqlite"), genesis = await genesisCheckpoint(writer);
    await db.engine.enroll(writer.source, writer.writerId);
    await db.engine.append({ writer, after: genesis, entries });
    db.sql.exec("DELETE FROM suppression_authority_writers WHERE source=?", writer.source);
    await expect(db.engine.enroll(writer.source, writer.writerId)).rejects.toThrow("SUPPRESSION_AUTHORITY_CORRUPT");
    db.sql.exec("DELETE FROM suppression_authority_identity");
    expect(() => new SuppressionAuthorityEngine(db.sql, db.transaction, writer.authorityId)).toThrow("SUPPRESSION_AUTHORITY_CORRUPT");
    expect(count(db)).toBe(4);
  });

  it("never acknowledges an old duplicate or pins a fence when the stored head no longer matches its journal", async () => {
    const db = database("authority.sqlite"), genesis = await genesisCheckpoint(writer);
    await db.engine.enroll(writer.source, writer.writerId);
    await db.engine.append({ writer, after: genesis, entries });
    db.sql.exec("UPDATE suppression_authority_writers SET head_digest=? WHERE source=?", "A".repeat(43) + "=", writer.source);
    await expect(db.engine.append({ writer, after: genesis, entries: [] })).rejects.toThrow("SUPPRESSION_AUTHORITY_CORRUPT");
    expect(() => db.engine.fence(writer, "target", "challenge")).toThrow("SUPPRESSION_AUTHORITY_CORRUPT");
    expect(() => db.engine.read(writer, genesis)).toThrow("SUPPRESSION_AUTHORITY_CORRUPT");
    expect(db.sql.exec("SELECT fenced FROM suppression_authority_writers").toArray()).toEqual([{ fenced: 0 }]);
    expect(count(db)).toBe(4);
  });
});
