import type { SqlStorage, StoreEngine } from "./store-engine";
import type { DemoState } from "./state";
import {
  inQuietHours,
  nextAllowedReminderTime,
  nextDaily,
  nextEvent,
  reminderLocalDate,
  type PushDevice,
  type ReminderRule,
  type ReminderView,
} from "./reminders";

type StoredRule = ReminderRule & { eventAt?: number };

export class ReminderInputError extends Error {}
export class ReminderEngine {
  constructor(
    private sql: SqlStorage,
    private store: StoreEngine,
  ) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS reminder_devices (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,value TEXT NOT NULL,created_at INTEGER NOT NULL)",
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS reminder_device_user ON reminder_devices(user_id)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS reminder_rules (user_id TEXT,id TEXT,value TEXT NOT NULL,next_at INTEGER,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease INTEGER,version TEXT NOT NULL,PRIMARY KEY(user_id,id))",
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS reminder_due ON reminder_rules(next_at)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS reminder_receipts (user_id TEXT,rule_id TEXT,version TEXT,device_id TEXT,PRIMARY KEY(user_id,rule_id,version,device_id))",
    );
  }
  snapshot(userId: string) {
    return {
      rules: this.sql
        .exec(
          "SELECT * FROM reminder_rules WHERE user_id=? ORDER BY id",
          userId,
        )
        .toArray()
        .map(
          (row) =>
            ({
              ...JSON.parse(String(row.value)),
              nextAt: row.next_at,
              status: row.status,
            }) as ReminderView,
        ),
      devices: this.sql
        .exec(
          "SELECT id,created_at FROM reminder_devices WHERE user_id=? ORDER BY created_at",
          userId,
        )
        .toArray()
        .map((row) => ({
          id: String(row.id),
          createdAt: Number(row.created_at),
        })),
    };
  }
  subscribe(userId: string, id: string, device: PushDevice) {
    if (!this.store.get(`account:${userId}`))
      throw new ReminderInputError("Account unavailable");
    if (
      this.snapshot(userId).devices.length >= 5 &&
      !this.snapshot(userId).devices.some((item) => item.id === id)
    )
      throw new ReminderInputError(
        "Use at most five devices. Remove an old device first.",
      );
    const previousOwner = this.sql
      .exec("SELECT user_id FROM reminder_devices WHERE id=?", id)
      .toArray()[0]?.user_id;
    // A browser subscription belongs to its most recently consenting account.
    this.sql.exec(
      "INSERT INTO reminder_devices(id,user_id,value,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,value=excluded.value,created_at=excluded.created_at",
      id,
      userId,
      JSON.stringify(device),
      Date.now(),
    );
    if (previousOwner && previousOwner !== userId)
      this.unsubscribe(String(previousOwner), id);
  }
  unsubscribe(userId: string, id?: string) {
    this.sql.exec(
      "DELETE FROM reminder_devices WHERE user_id=? AND (? IS NULL OR id=?)",
      userId,
      id ?? null,
      id ?? null,
    );
    if (!this.snapshot(userId).devices.length) {
      this.sql.exec(
        "UPDATE reminder_rules SET next_at=NULL,status='paused',value=json_set(value,'$.enabled',json('false')),version=? WHERE user_id=?",
        crypto.randomUUID(),
        userId,
      );
      this.sql.exec("DELETE FROM reminder_receipts WHERE user_id=?", userId);
    }
  }
  save(userId: string, rule: ReminderRule, now = Date.now()) {
    const state = this.store.readAccountState(userId)?.state;
    if (!state) throw new ReminderInputError("Account unavailable");
    let nextAt: number | null = null;
    const event =
      rule.kind === "event"
        ? state.futureEvents.find(
            (event) =>
              event.id === rule.eventId && event.status === "confirmed",
          )
        : undefined;
    if (rule.enabled) {
      if (!this.snapshot(userId).devices.length)
        throw new ReminderInputError("Enable notifications on a device first.");
      if (rule.kind === "daily") nextAt = nextDaily(rule, now);
      else {
        if (!event)
          throw new ReminderInputError("Choose a confirmed saved plan.");
        nextAt = nextEvent(rule, Date.parse(event.eventDate), now);
        if (nextAt === null)
          throw new ReminderInputError(
            "That reminder is in the past or falls after the plan because of quiet hours. Choose another lead time or quiet hours.",
          );
      }
    }
    if (
      !this.snapshot(userId).rules.some((item) => item.id === rule.id) &&
      this.snapshot(userId).rules.length >= 101
    )
      throw new ReminderInputError("Reminder limit reached.");
    this.sql.exec(
      "DELETE FROM reminder_receipts WHERE user_id=? AND rule_id=?",
      userId,
      rule.id,
    );
    this.sql.exec(
      "INSERT INTO reminder_rules(user_id,id,value,next_at,status,attempts,version) VALUES(?,?,?,?,?,0,?) ON CONFLICT(user_id,id) DO UPDATE SET value=excluded.value,next_at=excluded.next_at,status=excluded.status,attempts=0,lease=NULL,version=excluded.version",
      userId,
      rule.id,
      JSON.stringify({
        ...rule,
        ...(event ? { eventAt: Date.parse(event.eventDate) } : {}),
      }),
      nextAt,
      rule.enabled ? "scheduled" : "paused",
      crypto.randomUUID(),
    );
  }
  delivered(userId: string, id: string, version: string, deviceId: string) {
    return Boolean(
      this.sql
        .exec(
          "SELECT device_id FROM reminder_receipts WHERE user_id=? AND rule_id=? AND version=? AND device_id=?",
          userId,
          id,
          version,
          deviceId,
        )
        .toArray().length,
    );
  }
  recordDelivered(
    userId: string,
    id: string,
    version: string,
    deviceId: string,
  ) {
    if (this.active(userId, id, version, deviceId))
      this.sql.exec(
        "INSERT OR IGNORE INTO reminder_receipts VALUES(?,?,?,?)",
        userId,
        id,
        version,
        deviceId,
      );
  }
  remove(userId: string, id: string) {
    this.sql.exec(
      "DELETE FROM reminder_receipts WHERE user_id=? AND rule_id=?",
      userId,
      id,
    );
    this.sql.exec(
      "DELETE FROM reminder_rules WHERE user_id=? AND id=?",
      userId,
      id,
    );
  }
  erase(userId: string) {
    this.sql.exec("DELETE FROM reminder_receipts WHERE user_id=?", userId);
    this.sql.exec("DELETE FROM reminder_devices WHERE user_id=?", userId);
    this.sql.exec("DELETE FROM reminder_rules WHERE user_id=?", userId);
  }
  syncEvents(userId: string, state: DemoState) {
    for (const row of this.sql
      .exec("SELECT * FROM reminder_rules WHERE user_id=?", userId)
      .toArray()) {
      const rule = JSON.parse(String(row.value)) as StoredRule;
      if (rule.kind !== "event") continue;
      const event = state.futureEvents.find(
        (event) => event.id === rule.eventId && event.status === "confirmed",
      );
      if (!event) {
        this.remove(userId, rule.id);
        continue;
      }
      if (!rule.enabled || rule.eventAt === Date.parse(event.eventDate))
        continue;
      rule.eventAt = Date.parse(event.eventDate);
      const next = nextEvent(rule, rule.eventAt, Date.now());
      this.sql.exec(
        "DELETE FROM reminder_receipts WHERE user_id=? AND rule_id=?",
        userId,
        rule.id,
      );
      this.sql.exec(
        "UPDATE reminder_rules SET value=?,next_at=?,status=?,lease=NULL,attempts=0,version=? WHERE user_id=? AND id=?",
        JSON.stringify(rule),
        next,
        next === null ? "expired" : "scheduled",
        crypto.randomUUID(),
        userId,
        rule.id,
      );
    }
  }
  nextAlarm() {
    const row = this.sql
      .exec(
        "SELECT min(CASE WHEN lease IS NOT NULL AND lease>next_at THEN lease ELSE next_at END) AS next FROM reminder_rules WHERE next_at IS NOT NULL",
      )
      .toArray()[0];
    return row?.next == null ? null : Number(row.next);
  }
  claim(now = Date.now()) {
    const rows = this.sql
      .exec(
        "SELECT * FROM reminder_rules WHERE next_at<=? AND (lease IS NULL OR lease<=?) ORDER BY next_at LIMIT 5",
        now,
        now,
      )
      .toArray();
    const jobs = [];
    for (const row of rows) {
      const userId = String(row.user_id),
        rule = JSON.parse(String(row.value)) as StoredRule;
      if (!this.store.get(`account:${userId}`)) {
        this.erase(userId);
        continue;
      }
      // Allow the scheduler's first minute for an "at the scheduled time" rule.
      if (
        now - Number(row.next_at) > 30 * 60000 ||
        (rule.kind === "event" &&
          (rule.eventAt ?? 0) + (rule.minutesBefore === 0 ? 60000 : 0) < now)
      ) {
        this.finish(userId, rule.id, String(row.version), "expired", now);
        continue;
      }
      const allowed = nextAllowedReminderTime(rule, now);
      if (allowed > now) {
        if (rule.kind === "event" && allowed > (rule.eventAt ?? 0))
          this.finish(userId, rule.id, String(row.version), "expired", now);
        else
          this.sql.exec(
            "UPDATE reminder_rules SET next_at=?,lease=NULL WHERE user_id=? AND id=?",
            allowed,
            userId,
            rule.id,
          );
        continue;
      }
      if (!this.devices(userId).length) {
        this.sql.exec(
          "UPDATE reminder_rules SET next_at=NULL,status='no-device',version=? WHERE user_id=? AND id=?",
          crypto.randomUUID(),
          userId,
          rule.id,
        );
        continue;
      }
      this.sql.exec(
        "UPDATE reminder_rules SET lease=?,attempts=attempts+1 WHERE user_id=? AND id=?",
        now + 60000,
        userId,
        rule.id,
      );
      jobs.push({
        userId,
        rule,
        version: String(row.version),
        scheduledAt: Number(row.next_at),
      });
    }
    return jobs;
  }
  devices(userId: string) {
    return this.sql
      .exec("SELECT id,value FROM reminder_devices WHERE user_id=?", userId)
      .toArray()
      .map((row) => ({
        id: String(row.id),
        device: JSON.parse(String(row.value)) as PushDevice,
      }));
  }
  active(userId: string, id: string, version: string, deviceId: string) {
    return Boolean(
      this.store.get(`account:${userId}`) &&
        this.sql
          .exec(
            "SELECT id FROM reminder_rules WHERE user_id=? AND id=? AND version=? AND next_at IS NOT NULL",
            userId,
            id,
            version,
          )
          .toArray().length &&
        this.sql
          .exec(
            "SELECT id FROM reminder_devices WHERE user_id=? AND id=?",
            userId,
            deviceId,
          )
          .toArray().length,
    );
  }
  finish(
    userId: string,
    id: string,
    version: string,
    status: "sent" | "retry" | "expired",
    now = Date.now(),
  ) {
    const row = this.sql
      .exec(
        "SELECT * FROM reminder_rules WHERE user_id=? AND id=? AND version=?",
        userId,
        id,
        version,
      )
      .toArray()[0];
    if (!row) return;
    const rule = JSON.parse(String(row.value)) as StoredRule;
    const retryAt = nextAllowedReminderTime(rule, now + 60000);
    if (
      status === "retry" &&
      Number(row.attempts) < 3 &&
      (rule.kind === "daily" || retryAt <= (rule.eventAt ?? 0))
    ) {
      this.sql.exec(
        "UPDATE reminder_rules SET lease=NULL,next_at=?,status='retrying' WHERE user_id=? AND id=?",
        retryAt,
        userId,
        id,
      );
      return;
    }
    const next =
      rule.kind === "daily" && rule.enabled
        ? nextDaily(
            rule,
            now,
            inQuietHours(rule.time, rule.quietStart, rule.quietEnd)
              ? undefined
              : reminderLocalDate(now, rule.timezone),
          )
        : null;
    this.sql.exec(
      "DELETE FROM reminder_receipts WHERE user_id=? AND rule_id=?",
      userId,
      id,
    );
    this.sql.exec(
      "UPDATE reminder_rules SET next_at=?,lease=NULL,attempts=0,status=?,version=? WHERE user_id=? AND id=?",
      next,
      status === "retry" ? "failed" : status,
      crypto.randomUUID(),
      userId,
      id,
    );
  }
}
