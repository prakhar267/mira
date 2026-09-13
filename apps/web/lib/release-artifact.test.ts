import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const script = resolve("scripts/release-artifact.mjs");
const sourceConfig = JSON.parse(await readFile(resolve("wrangler.jsonc"), "utf8")) as Record<string, unknown>;
let directory: string, artifact: string, sha: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const run = (mode: string, expected = sha) => spawnSync(process.execPath, [script, mode, artifact, expected], { cwd: directory, encoding: "utf8", env: { ...process.env, CI: "true", GITHUB_SHA: sha } });
async function config(change: Record<string, unknown>) {
  const path = join(artifact, "server/wrangler.json");
  await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")), ...change }));
}
describe("sealed production artifact promotion", () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "mira-release-unit-")); artifact = join(directory, "dist");
    await mkdir(join(artifact, "server"), { recursive: true }); await mkdir(join(artifact, "client"));
    await writeFile(join(artifact, "server/wrangler.json"), JSON.stringify({ ...sourceConfig, main: "index.js", assets: { directory: "../client", binding: "ASSETS" } }));
    await writeFile(join(artifact, "server/index.js"), "export default {fetch:()=>new Response('synthetic fixture')};");
    for (let index = 0; index < 4; index++) await writeFile(join(artifact, `client/chunk-${index}.js`), `/* sealed synthetic chunk ${index} */`);
    await writeFile(join(directory, "README.md"), "Synthetic release-test repository, not the product repository.");
    await writeFile(join(directory, ".gitignore"), "dist/\n");
    git("init", "--quiet"); git("add", "README.md", ".gitignore");
    git("-c", "user.name=Mira synthetic test", "-c", "user.email=synthetic@example.invalid", "commit", "--quiet", "-m", "Synthetic release fixture");
    sha = git("rev-parse", "HEAD");
  });
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
  it("creates and verifies a clean, exact artifact and commit", async () => {
    const created = run("create"); expect(created.status, created.stderr).toBe(0);
    const manifest = JSON.parse(await readFile(join(artifact, "mira-release-manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ schemaVersion: 1, sha, dirty: false }); expect(manifest.files).toHaveLength(6);
    const verified = run("verify"); expect(verified.status, verified.stderr).toBe(0);
  });
  it("rejects changed bytes, injected files and wrong commit identity", async () => {
    expect(run("create").status).toBe(0);
    expect(run("verify", "f".repeat(40)).status).not.toBe(0);
    await writeFile(join(artifact, "client/chunk-0.js"), "changed after testing"); expect(run("verify").status).not.toBe(0);
    await writeFile(join(artifact, "client/chunk-0.js"), "/* sealed synthetic chunk 0 */");
    await writeFile(join(artifact, "client/new.js"), "unsealed injection"); expect(run("verify").status).not.toBe(0);
  });
  it("rejects dirty tracked source in CI", async () => {
    await writeFile(join(directory, "README.md"), "Uncommitted source change");
    const result = run("create"); expect(result.status).not.toBe(0); expect(result.stderr).toContain("clean committed source");
  });
  it("cannot stamp another commit identity onto the checked-out source", () => {
    const result = run("create", "f".repeat(40)); expect(result.status).not.toBe(0); expect(result.stderr).toContain("checked-out source");
  });
  it("rejects untracked code while permitting only the expected generated audit report", async () => {
    await mkdir(join(directory, "audit/readiness-2026-09-13T00-00-00Z"), { recursive: true });
    await writeFile(join(directory, "audit/readiness-2026-09-13T00-00-00Z/dependency-audit.json"), "{}");
    await mkdir(join(directory, "audit/readiness-2026-09-13T00-00-00Z/artifact"));
    await writeFile(join(directory, "audit/readiness-2026-09-13T00-00-00Z/artifact/production-smoke.json"), "{}");
    expect(run("create").status).toBe(0);
    await writeFile(join(directory, "untracked-module.js"), "export const notCommitted=true;");
    expect(run("create").status).not.toBe(0);
  });
  for (const [name, mutation] of [
    ["synthetic variables", { vars: { ...(sourceConfig.vars as object), MIRA_LOCAL_TEST: "synthetic-only" } }],
    ["synthetic AI service", { services: [{ binding: "AI", service: "mira-synthetic", entrypoint: "MockAI" }] }],
    ["mock provider service", { services: [{ binding: "MIRA_TEST_PROVIDERS", service: "mira-synthetic" }] }],
    ["local origin", { vars: { ...(sourceConfig.vars as object), SITE_ORIGIN: "http://localhost:4397" } }],
    ["payment activation", { vars: { ...(sourceConfig.vars as object), BILLING_ENABLED: "true" } }],
    ["changed storage authority", { durable_objects: { bindings: [{ name: "MIRA_STORE", class_name: "MiraStore", script_name: "foreign-worker" }] } }],
    ["lost migration history", { migrations: [] }],
    ["changed legacy deletion source", { kv_namespaces: [] }],
    ["external entrypoint", { main: "../../outside.js" }],
    ["external assets", { assets: { directory: "../../outside" } }],
    ["wrong Worker", { name: "mira-synthetic-tests" }],
  ] as const) it(`rejects ${name} before sealing`, async () => {
    await config(mutation); expect(run("create").status).not.toBe(0);
  });
  it("does not seal local credentials or symlinks", async () => {
    await writeFile(join(artifact, ".dev.vars"), "SYNTHETIC_ONLY=true"); expect(run("create").status).not.toBe(0);
    await rm(join(artifact, ".dev.vars"));
    await symlink(join(directory, "README.md"), join(artifact, "linked-file")); expect(run("create").status).not.toBe(0);
  });
});
