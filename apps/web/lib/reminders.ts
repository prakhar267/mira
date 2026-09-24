export interface ReminderRule {
  id: string;
  kind: "daily" | "event";
  enabled: boolean;
  timezone: string;
  time: string;
  quietStart: string;
  quietEnd: string;
  eventId?: string;
  minutesBefore: number;
}
export interface ReminderView extends ReminderRule {
  nextAt: number | null;
  status: string;
}
export interface ReminderSnapshot {
  rules: ReminderView[];
  devices: { id: string; createdAt: number }[];
  publicKey: string;
}
export interface PushDevice {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}
export const DEFAULT_REMINDER = {
  enabled: true,
  timezone: "Asia/Kolkata",
  time: "19:00",
  quietStart: "22:00",
  quietEnd: "08:00",
  minutesBefore: 30,
};
export function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
export function parseReminderRule(value: unknown): ReminderRule {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose reminder settings.");
  const raw = value as ReminderRule;
  if (
    !["daily", "event"].includes(raw.kind) ||
    typeof raw.enabled !== "boolean" ||
    !validTimezone(raw.timezone) ||
    ![raw.time, raw.quietStart, raw.quietEnd].every(
      (time) =>
        typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time),
    ) ||
    ![0, 5, 15, 30, 60, 1440].includes(raw.minutesBefore)
  )
    throw new Error("Check the reminder time, time zone and quiet hours.");
  if (
    raw.kind === "event" &&
    (typeof raw.eventId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,120}$/.test(raw.eventId))
  )
    throw new Error("Choose a saved plan.");
  return {
    id: raw.kind === "daily" ? "daily" : `event:${raw.eventId}`,
    kind: raw.kind,
    enabled: raw.enabled,
    timezone: raw.timezone,
    time: raw.time,
    quietStart: raw.quietStart,
    quietEnd: raw.quietEnd,
    minutesBefore: raw.minutesBefore,
    ...(raw.kind === "event" ? { eventId: raw.eventId } : {}),
  };
}
export function parsePushDevice(value: unknown): PushDevice {
  const raw = value as PushDevice;
  if (!raw || typeof raw.endpoint !== "string" || raw.endpoint.length > 2048)
    throw new Error("Invalid notification subscription.");
  const url = new URL(raw.endpoint);
  const allowed =
    url.hostname === "fcm.googleapis.com" ||
    url.hostname === "web.push.apple.com" ||
    /^(?:[a-z0-9-]+\.)?push\.services\.mozilla\.com$/.test(url.hostname) ||
    /^[a-z0-9.-]+\.notify\.windows\.com$/.test(url.hostname);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !allowed
  )
    throw new Error("This browser’s notification service is not supported.");
  if (
    !raw.keys ||
    !/^[A-Za-z0-9_-]{87}$/.test(raw.keys.p256dh) ||
    !/^[A-Za-z0-9_-]{22}$/.test(raw.keys.auth) ||
    atob(
      raw.keys.p256dh.replace(/-/g, "+").replace(/_/g, "/") + "=",
    ).charCodeAt(0) !== 4
  )
    throw new Error("Invalid notification encryption keys.");
  if (
    raw.expirationTime != null &&
    (!Number.isFinite(raw.expirationTime) || raw.expirationTime <= Date.now())
  )
    throw new Error(
      "Notification subscription expired. Enable this device again.",
    );
  return {
    endpoint: url.href,
    keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
    expirationTime: raw.expirationTime ?? null,
  };
}
const minutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export function inQuietHours(time: string, start: string, end: string) {
  const at = minutes(time),
    low = minutes(start),
    high = minutes(end);
  return low === high
    ? false
    : low < high
      ? at >= low && at < high
      : at >= low || at < high;
}
function localParts(at: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}
/** Scan wall-clock minutes for up to 50 hours: DST gaps skip to the first
 * available later minute that day; repeated hours fire only once per date. */
export function nextDaily(
  rule: ReminderRule,
  after: number,
  previousDate?: string,
): number {
  const desired = rule.time;
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: rule.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  let last = localParts(after, rule.timezone);
  for (
    let at = Math.floor(after / 60000) * 60000 + 60000;
    at <= after + 50 * 3600000;
    at += 60000
  ) {
    const parts = format.formatToParts(at),
      get = (type: string) => parts.find((part) => part.type === type)!.value;
    const now = {
      date: `${get("year")}-${get("month")}-${get("day")}`,
      time: `${get("hour")}:${get("minute")}`,
    };
    const crossedGap =
      last &&
      last.date === now.date &&
      last.time < desired &&
      now.time > desired;
    if (now.date !== previousDate && (now.time === desired || crossedGap)) {
      let delivery = at;
      for (
        let i = 0;
        i < 1500 &&
        inQuietHours(
          localParts(delivery, rule.timezone).time,
          rule.quietStart,
          rule.quietEnd,
        );
        i++
      )
        delivery += 60000;
      return delivery;
    }
    last = now;
  }
  throw new Error("Could not schedule that local time.");
}
export function nextEvent(
  rule: ReminderRule,
  eventAt: number,
  now: number,
): number | null {
  let at = eventAt - rule.minutesBefore * 60000;
  if (at <= now) return null;
  for (
    let i = 0;
    i < 1440 &&
    inQuietHours(
      localParts(at, rule.timezone).time,
      rule.quietStart,
      rule.quietEnd,
    );
    i++
  )
    at += 60000;
  return at <= eventAt ? at : null;
}
export function reminderLocalDate(at: number, timezone: string) {
  return localParts(at, timezone).date;
}

export function nextAllowedReminderTime(
  rule: ReminderRule,
  at: number,
): number {
  for (
    let i = 0;
    i < 1560 &&
    inQuietHours(
      localParts(at, rule.timezone).time,
      rule.quietStart,
      rule.quietEnd,
    );
    i++
  )
    at += 60000;
  return at;
}
