import type { FutureEventRecord, MemoryRecord, NotificationSettings, ScheduledNudgeRecord } from "@companion/shared";

function outsideQuietHours(date: Date, settings: NotificationSettings): Date {
  const [startHour = 22, startMinute = 0] = settings.quietStart.split(":").map(Number);
  const [endHour = 8, endMinute = 0] = settings.quietEnd.split(":").map(Number);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])) as Record<string, number>;
  const minutes = (parts.hour ?? 0) * 60 + (parts.minute ?? 0);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const inQuiet = start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
  if (!inQuiet) return date;
  const localDate = new Date(Date.UTC(parts.year ?? date.getUTCFullYear(), (parts.month ?? 1) - 1, parts.day ?? date.getUTCDate(), endHour, endMinute));
  if (minutes >= start) localDate.setUTCDate(localDate.getUTCDate() + 1);
  const zoneAtGuess = Object.fromEntries(formatter.formatToParts(localDate).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])) as Record<string, number>;
  const represented = Date.UTC(zoneAtGuess.year ?? 0, (zoneAtGuess.month ?? 1) - 1, zoneAtGuess.day ?? 1, zoneAtGuess.hour ?? 0, zoneAtGuess.minute ?? 0);
  return new Date(localDate.getTime() - (represented - localDate.getTime()));
}

export function generateNudge(input: { userId: string; userName: string; event?: FutureEventRecord; memories: MemoryRecord[]; settings: NotificationSettings; now?: Date }): ScheduledNudgeRecord | null {
  if (input.settings.frequency === "off") return null;
  const now = input.now ?? new Date();
  const scheduled = outsideQuietHours(new Date(now.getTime() + 60 * 60 * 1_000), input.settings);
  const memory = input.memories.find((item) => item.status === "active" && item.pinned) ?? input.memories.find((item) => item.status === "active");
  const content = input.event
    ? `How did ${input.event.description.toLowerCase()} go? No rush—I’m here if you want to talk it through.`
    : memory
      ? `Hi ${input.userName}. Want to pick up the thread about ${memory.content.replace(/^[^.]+?\s/, "").replace(/\.$/, "").toLowerCase()}?`
      : `Hi ${input.userName}. Nice to see you—want to talk or simply check in?`;
  return { id: crypto.randomUUID(), userId: input.userId, ...(input.event ? { eventId: input.event.id } : {}), content, scheduledFor: scheduled.toISOString(), status: "planned" };
}
