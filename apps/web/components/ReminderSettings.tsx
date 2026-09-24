"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { FutureEventRecord } from "@companion/shared";
import {
  DEFAULT_REMINDER,
  type ReminderRule,
  type ReminderSnapshot,
} from "@/lib/reminders";

async function deviceId(endpoint: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)),
  );
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
async function reminderRequest(body?: unknown): Promise<ReminderSnapshot> {
  const response = await fetch("/api/account/reminders", {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "Reminder settings could not load.");
  return data;
}
export function ReminderSettings({
  accountMode,
  events,
  beforeSave,
}: {
  accountMode: boolean;
  events: FutureEventRecord[];
  beforeSave: () => Promise<void>;
}) {
  const [openedAt] = useState(() => Date.now());
  const [snapshot, setSnapshot] = useState<ReminderSnapshot | null>(null);
  const [rule, setRule] = useState<ReminderRule>({
    ...DEFAULT_REMINDER,
    id: "daily",
    kind: "daily",
  });
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [currentDevice, setCurrentDevice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!accountMode) return;
    let active = true;
    setSupported(
      "Notification" in window &&
        "PushManager" in window &&
        "serviceWorker" in navigator &&
        window.isSecureContext,
    );
    const updatePermission = () => {
      if ("Notification" in window) setPermission(Notification.permission);
    };
    updatePermission();
    window.addEventListener("focus", updatePermission);
    setRule((current) => ({
      ...current,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));
    void reminderRequest()
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .getRegistration()
        .then(async (registration) => {
          const subscription =
            await registration?.pushManager?.getSubscription();
          if (subscription && active)
            setCurrentDevice(await deviceId(subscription.endpoint));
        })
        .catch(() => {
          /* Device opt-in can still be retried explicitly. */
        });
    return () => {
      active = false;
      window.removeEventListener("focus", updatePermission);
    };
  }, [accountMode]);
  const action = async (body: unknown) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await beforeSave();
      setSnapshot(await reminderRequest(body));
      setNotice("Reminder settings saved.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const enable = async () => {
    if (!supported || !snapshot) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // Permission is requested directly from this explicit button gesture.
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted")
        throw new Error(
          granted === "denied"
            ? "Notifications are blocked. Allow them in your browser’s site settings, then try again."
            : "Notifications were not enabled. You can choose again whenever you want.",
        );
      await navigator.serviceWorker.register("/sw.js");
      let readyTimeout: ReturnType<typeof setTimeout> | undefined;
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>(
          (_, reject) =>
            (readyTimeout = setTimeout(
              () =>
                reject(
                  new Error("Notification setup took too long. Please retry."),
                ),
              10000,
            )),
        ),
      ]).finally(() => clearTimeout(readyTimeout));
      const raw = atob(
        snapshot.publicKey
          .replaceAll("-", "+")
          .replaceAll("_", "/")
          .padEnd(Math.ceil(snapshot.publicKey.length / 4) * 4, "="),
      );
      const key = Uint8Array.from(raw, (char) => char.charCodeAt(0));
      let subscription = await ready.pushManager.getSubscription();
      if (
        subscription?.options.applicationServerKey &&
        btoa(
          String.fromCharCode(
            ...new Uint8Array(subscription.options.applicationServerKey),
          ),
        )
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, "") !== snapshot.publicKey
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await ready.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      const value = await reminderRequest({
        action: "subscribe",
        subscription: subscription.toJSON(),
      });
      setCurrentDevice(await deviceId(subscription.endpoint));
      setSnapshot(value);
      setNotice(
        "This device is enabled. Choose a time or saved plan below to schedule your first reminder.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Notifications could not be enabled.",
      );
    } finally {
      setBusy(false);
    }
  };
  const disable = async (id?: string) => {
    setBusy(true);
    setError("");
    try {
      setSnapshot(
        await reminderRequest({ action: "unsubscribe", ...(id ? { id } : {}) }),
      );
      if (!id || id === currentDevice) {
        const registration =
          "serviceWorker" in navigator
            ? await navigator.serviceWorker.getRegistration()
            : undefined;
        await (
          await registration?.pushManager?.getSubscription()
        )?.unsubscribe();
        setCurrentDevice("");
      }
      setNotice(
        id
          ? "Device removed."
          : "All devices disconnected and reminders paused.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not disable notifications.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (!accountMode)
    return (
      <section className="feature-panel">
        <h2>Reminders, on your terms</h2>
        <p>
          Sign in to schedule check-ins and saved-plan reminders across your
          devices.
        </p>
        <Link className="button button--primary" href="/login">
          Sign in
        </Link>
        <p>
          Reminders are off until you enable a device and choose a schedule.
        </p>
      </section>
    );
  const upcoming = events.filter(
    (event) =>
      event.status === "confirmed" && Date.parse(event.eventDate) > openedAt,
  );
  return (
    <section
      className="feature-panel reminder-settings"
      aria-label="Reminder settings"
    >
      <h2>Reminders, on your terms</h2>
      <p>
        Choose a daily check-in or a reminder for a saved plan. Notifications
        use a private, generic message; your journal and plan details stay
        inside Mira.
      </p>
      {!supported ? (
        <p role="status">
          This browser cannot enable notifications here. On iPhone or iPad, add
          Mira to your Home Screen, open it there, then return to Reminders.
        </p>
      ) : null}
      <div className="feature-actions">
        <button
          type="button"
          className="button button--primary"
          disabled={
            !supported ||
            busy ||
            !snapshot ||
            (snapshot.devices.some((device) => device.id === currentDevice) &&
              permission === "granted")
          }
          onClick={() => void enable()}
        >
          {snapshot?.devices.some((device) => device.id === currentDevice) &&
          permission === "granted"
            ? "This device is enabled"
            : "Enable notifications on this device"}
        </button>
        {snapshot?.devices.length ? (
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => void disable()}
          >
            Turn off all reminders
          </button>
        ) : null}
      </div>
      {permission === "denied" ? (
        <p>
          Notifications are blocked in this browser. Change your site
          notification permission to enable this device.
        </p>
      ) : null}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          {!snapshot ? (
            <button
              className="button button--ghost"
              onClick={() => {
                setError("");
                void reminderRequest()
                  .then(setSnapshot)
                  .catch((cause) => setError(cause.message));
              }}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!snapshot && !error ? <p role="status">Loading reminders…</p> : null}
      {snapshot ? (
        <>
          <form
            className="reminder-form"
            onSubmit={(event) => {
              event.preventDefault();
              void action({ action: "save", rule });
            }}
          >
            <h3>Choose a reminder</h3>
            <div className="feature-form-grid">
              <label className="field">
                Reminder type
                <select
                  value={rule.kind}
                  onChange={(event) =>
                    setRule((current) => ({
                      ...current,
                      kind: event.target.value as ReminderRule["kind"],
                      eventId: upcoming[0]?.id ?? "",
                    }))
                  }
                >
                  <option value="daily">Daily check-in</option>
                  <option value="event">Saved plan</option>
                </select>
              </label>
              {rule.kind === "daily" ? (
                <label className="field">
                  Check-in time
                  <input
                    required
                    type="time"
                    value={rule.time}
                    onChange={(event) =>
                      setRule({ ...rule, time: event.target.value })
                    }
                  />
                </label>
              ) : (
                <>
                  <label className="field">
                    Saved plan
                    <select
                      required
                      value={rule.eventId ?? ""}
                      onChange={(event) =>
                        setRule({ ...rule, eventId: event.target.value })
                      }
                    >
                      <option value="">Choose a plan</option>
                      {upcoming.map((event) => (
                        <option key={event.id} value={event.id}>
                          {event.description} ·{" "}
                          {new Date(event.eventDate).toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Remind me
                    <select
                      value={rule.minutesBefore}
                      onChange={(event) =>
                        setRule({
                          ...rule,
                          minutesBefore: Number(event.target.value),
                        })
                      }
                    >
                      {[
                        [0, "At the scheduled time"],
                        [5, "5 minutes before"],
                        [15, "15 minutes before"],
                        [30, "30 minutes before"],
                        [60, "1 hour before"],
                        [1440, "1 day before"],
                      ].map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="field">
                Time zone
                <input
                  required
                  list="reminder-timezones"
                  value={rule.timezone}
                  onChange={(event) =>
                    setRule({ ...rule, timezone: event.target.value })
                  }
                />
                <datalist id="reminder-timezones">
                  {[
                    "Asia/Kolkata",
                    "UTC",
                    "America/New_York",
                    "America/Los_Angeles",
                    "Europe/London",
                    "Europe/Berlin",
                    "Asia/Singapore",
                    "Australia/Sydney",
                  ].map((zone) => (
                    <option key={zone}>{zone}</option>
                  ))}
                </datalist>
              </label>
              <label className="field">
                Quiet hours start
                <input
                  required
                  type="time"
                  value={rule.quietStart}
                  onChange={(event) =>
                    setRule({ ...rule, quietStart: event.target.value })
                  }
                />
              </label>
              <label className="field">
                Quiet hours end
                <input
                  required
                  type="time"
                  value={rule.quietEnd}
                  onChange={(event) =>
                    setRule({ ...rule, quietEnd: event.target.value })
                  }
                />
              </label>
            </div>
            <p className="settings-note">
              Quiet-hour reminders move to the end of quiet hours. A plan
              reminder must still arrive by the plan’s time. Matching start and
              end times turn quiet hours off. Times follow the selected time
              zone, including daylight saving.
            </p>
            <label className="toggle-line">
              <span>Enable this reminder</span>
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) =>
                  setRule({ ...rule, enabled: event.target.checked })
                }
              />
            </label>
            <button
              className="button button--primary"
              type="submit"
              disabled={
                busy ||
                (rule.enabled && !snapshot.devices.length) ||
                (rule.kind === "event" && !rule.eventId)
              }
            >
              {busy ? "Saving…" : "Save reminder"}
            </button>
          </form>
          <h3>Your schedules</h3>
          {!snapshot.rules.length ? (
            <p>
              No reminders scheduled. Your first reminder is entirely your
              choice.
            </p>
          ) : (
            snapshot.rules.map((item) => (
              <article className="reminder-rule" key={item.id}>
                <div>
                  <strong>
                    {item.kind === "daily"
                      ? "Daily check-in"
                      : (events.find((event) => event.id === item.eventId)
                          ?.description ?? "Saved plan")}
                  </strong>
                  <p>
                    {item.nextAt
                      ? `Next: ${new Date(item.nextAt).toLocaleString(undefined, { timeZone: item.timezone })} · ${item.timezone}`
                      : "No upcoming delivery"}
                  </p>
                  <small>
                    {item.status === "sent"
                      ? "Last delivery accepted by the notification service"
                      : item.status}{" "}
                    · Quiet hours {item.quietStart}–{item.quietEnd}
                  </small>
                </div>
                <div className="feature-actions">
                  <button
                    type="button"
                    className="button button--ghost"
                    disabled={busy}
                    onClick={() => {
                      setRule(item);
                      setNotice("Schedule loaded above. Save after editing.");
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    disabled={busy}
                    onClick={() =>
                      void action({ action: "delete", id: item.id })
                    }
                  >
                    Delete reminder
                  </button>
                </div>
              </article>
            ))
          )}
          <h3>Connected devices</h3>
          {snapshot.devices.map((device) => (
            <div className="reminder-device" key={device.id}>
              <span>
                {device.id === currentDevice ? "This device" : "Other device"} ·
                Enabled {new Date(device.createdAt).toLocaleDateString()}
              </span>
              <button
                className="button button--ghost"
                disabled={busy}
                onClick={() => void disable(device.id)}
              >
                Remove device
              </button>
            </div>
          ))}
          <p className="settings-note">
            Notifications can be delayed by the browser, your device or
            connectivity. Reminders more than 30 minutes overdue are skipped.
            They are not suitable for urgent alerts.
          </p>
        </>
      ) : null}
    </section>
  );
}
