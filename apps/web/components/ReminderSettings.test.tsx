// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReminderSettings } from "./ReminderSettings";
import { DEFAULT_REMINDER, type ReminderSnapshot } from "@/lib/reminders";
const fetcher = vi.fn(),
  permission = vi.fn(),
  getSubscription = vi.fn(),
  subscribe = vi.fn(),
  unsubscribe = vi.fn(),
  register = vi.fn(),
  getRegistration = vi.fn();
const endpoint = "https://fcm.googleapis.com/synthetic";
let snapshot: ReminderSnapshot;
let deviceId: string;
let worker: {
  getRegistration: typeof getRegistration;
  register: typeof register;
  ready: Promise<unknown>;
};
const registration = { pushManager: { getSubscription, subscribe } };
const subscription = () => ({
  endpoint,
  options: {},
  unsubscribe,
  toJSON: () => ({ endpoint, keys: {} }),
});
const plan = (id = "p") => ({
  id,
  userId: "u",
  companionId: "c",
  description: `Plan ${id}`,
  eventDate: new Date(Date.now() + 86400000).toISOString(),
  status: "confirmed" as const,
  createdAt: new Date().toISOString(),
});
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("isSecureContext", true);
  deviceId = Buffer.from(
    await webcrypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(endpoint),
    ),
  ).toString("base64url");
  vi.stubGlobal("Notification", {
    permission: "default",
    requestPermission: permission,
  });
  vi.stubGlobal("PushManager", class {});
  worker = { getRegistration, register, ready: Promise.resolve(registration) };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: worker,
  });
  getRegistration.mockResolvedValue(registration);
  getSubscription.mockResolvedValue(null);
  subscribe.mockResolvedValue(subscription());
  unsubscribe.mockResolvedValue(true);
  register.mockResolvedValue(registration);
  permission.mockResolvedValue("granted");
  snapshot = { publicKey: "BAAA", rules: [], devices: [] };
  fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body?.action === "subscribe")
      snapshot.devices = [{ id: deviceId, createdAt: Date.now() }];
    if (body?.action === "unsubscribe")
      snapshot.devices = snapshot.devices.filter(
        (d) => body.id && d.id !== body.id,
      );
    if (body?.action === "save")
      snapshot.rules = [
        { ...body.rule, nextAt: Date.now() + 60000, status: "scheduled" },
      ];
    if (body?.action === "delete") snapshot.rules = [];
    return Response.json(snapshot);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.useRealTimers();
});
const setup = (extra = {}) => {
  const props = {
    accountMode: true,
    events: [plan(), plan("second")],
    beforeSave: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };
  return { ...render(<ReminderSettings {...props} />), props };
};
const enable = async () => {
  await waitFor(() =>
    expect(
      screen.getByText("Enable notifications on this device"),
    ).toHaveProperty("disabled", false),
  );
  await userEvent.click(
    screen.getByText("Enable notifications on this device"),
  );
};
describe("opt-in reminders UI", () => {
  it("requires sign-in and handles unsupported browsers without asking permission", async () => {
    const view = setup({ accountMode: false });
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("/login");
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubGlobal("isSecureContext", false);
    view.rerender(<ReminderSettings {...view.props} accountMode />);
    expect(await screen.findByText(/cannot enable notifications/)).toBeTruthy();
    expect(permission).not.toHaveBeenCalled();
  });
  it("explicitly enables a device, saves/edits daily and plan schedules, deletes and disconnects", async () => {
    const view = setup();
    await screen.findByText("Choose a reminder");
    expect(permission).not.toHaveBeenCalled();
    expect(screen.getByText("Save reminder")).toHaveProperty("disabled", true);
    await enable();
    expect(await screen.findByText("This device is enabled")).toBeTruthy();
    expect(register).toHaveBeenCalledWith("/sw.js");
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    for (const [label, value] of [
      ["Check-in time", "18:15"],
      ["Time zone", "UTC"],
      ["Quiet hours start", "23:00"],
      ["Quiet hours end", "07:00"],
    ])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    await userEvent.click(screen.getByText("Save reminder"));
    expect(await screen.findByText("Reminder settings saved.")).toBeTruthy();
    expect(view.props.beforeSave).toHaveBeenCalledOnce();
    expect(snapshot.rules[0]).toMatchObject({
      time: "18:15",
      timezone: "UTC",
      quietStart: "23:00",
      quietEnd: "07:00",
    });
    await userEvent.click(screen.getByText("Edit"));
    expect(screen.getByText(/Schedule loaded above/)).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Enable this reminder"));
    expect(screen.getByLabelText("Enable this reminder")).toHaveProperty(
      "checked",
      false,
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Reminder type"),
      "event",
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Saved plan"),
      "second",
    );
    await userEvent.selectOptions(screen.getByLabelText("Remind me"), "15");
    await userEvent.click(screen.getByText("Save reminder"));
    await screen.findByText("Reminder settings saved.");
    expect(snapshot.rules[0]).toMatchObject({
      kind: "event",
      eventId: "second",
      minutesBefore: 15,
      enabled: false,
    });
    await userEvent.click(screen.getByText("Delete reminder"));
    await screen.findByText(/No reminders scheduled/);
    getSubscription.mockResolvedValue(subscription());
    await userEvent.click(screen.getByText("Turn off all reminders"));
    expect(await screen.findByText(/All devices disconnected/)).toBeTruthy();
    expect(unsubscribe).toHaveBeenCalled();
  });
  it.each(["denied", "default"])(
    "handles %s permission without registering or subscribing",
    async (value) => {
      permission.mockResolvedValue(value);
      setup();
      await enable();
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(register).not.toHaveBeenCalled();
      expect(subscribe).not.toHaveBeenCalled();
    },
  );
  it("tracks permission changes on focus and reuses an existing matching subscription", async () => {
    getSubscription.mockResolvedValue({
      ...subscription(),
      options: { applicationServerKey: Uint8Array.from([4, 0, 0]).buffer },
    });
    snapshot.devices = [{ id: deviceId, createdAt: Date.now() }];
    setup();
    await screen.findByText(/This device ·/);
    Object.assign(Notification, { permission: "granted" });
    fireEvent.focus(window);
    expect(screen.getByText("This device is enabled")).toHaveProperty(
      "disabled",
      true,
    );
    Object.assign(Notification, { permission: "default" });
    fireEvent.focus(window);
    await enable();
    expect(await screen.findByText("This device is enabled")).toBeTruthy();
    expect(subscribe).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
  });
  it("rotates stale VAPID subscriptions before enabling the current device", async () => {
    getSubscription.mockResolvedValue({
      ...subscription(),
      options: { applicationServerKey: Uint8Array.from([4, 1, 1]).buffer },
    });
    setup();
    await enable();
    await screen.findByText("This device is enabled");
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
  });
  it("bounds service worker readiness and lets the user retry", async () => {
    worker.ready = new Promise(() => {});
    setup();
    await screen.findByText("Choose a reminder");
    vi.useFakeTimers();
    fireEvent.click(screen.getByText("Enable notifications on this device"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10001);
    });
    expect(screen.getByText(/setup took too long/)).toBeTruthy();
    expect(subscribe).not.toHaveBeenCalled();
  });
  it.each([new Error("Browser unavailable"), "browser unavailable"])(
    "reports notification setup failures: %s",
    async (failure) => {
      register.mockRejectedValue(failure);
      setup();
      await enable();
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(
        screen.getByText("Enable notifications on this device"),
      ).toHaveProperty("disabled", false);
    },
  );
  it("recovers a failed initial request and a failed retry", async () => {
    fetcher
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockRejectedValueOnce(new Error("Offline"));
    setup();
    await userEvent.click(await screen.findByText("Retry"));
    expect(await screen.findByText("Offline")).toBeTruthy();
    await userEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText("Choose a reminder")).toBeTruthy();
  });
  it.each([new Error("Sync conflict"), "offline"])(
    "blocks saves when the account cannot sync: %s",
    async (failure) => {
      snapshot.devices = [{ id: "other", createdAt: Date.now() }];
      setup({ beforeSave: vi.fn().mockRejectedValue(failure) });
      await userEvent.click(await screen.findByText("Save reminder"));
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it("reports failed server writes without claiming success", async () => {
    snapshot.devices = [{ id: "other", createdAt: Date.now() }];
    setup();
    await screen.findByText("Choose a reminder");
    fetcher.mockResolvedValueOnce(
      Response.json({ error: "Too many reminders" }, { status: 429 }),
    );
    await userEvent.click(screen.getByText("Save reminder"));
    expect(await screen.findByText("Too many reminders")).toBeTruthy();
    expect(screen.queryByText("Reminder settings saved.")).toBeNull();
  });
  it("removes another device without unsubscribing this browser", async () => {
    snapshot.devices = [{ id: "other", createdAt: Date.now() }];
    setup();
    await userEvent.click(await screen.findByText("Remove device"));
    expect(await screen.findByText("Device removed.")).toBeTruthy();
    expect(unsubscribe).not.toHaveBeenCalled();
  });
  it.each([new Error("Device offline"), "offline"])(
    "reports failed disconnect requests: %s",
    async (failure) => {
      snapshot.devices = [{ id: "other", createdAt: Date.now() }];
      setup();
      await screen.findByText("Choose a reminder");
      fetcher.mockRejectedValueOnce(failure);
      await userEvent.click(screen.getByText("Turn off all reminders"));
      expect(await screen.findByRole("alert")).toBeTruthy();
    },
  );
  it("removes this device, tolerates unavailable browser registration and empty upcoming plans", async () => {
    getSubscription.mockResolvedValue(subscription());
    snapshot.devices = [{ id: deviceId, createdAt: Date.now() }];
    setup({ events: [] });
    await screen.findByText(/This device ·/);
    await userEvent.click(screen.getByText("Remove device"));
    expect(await screen.findByText("Device removed.")).toBeTruthy();
    expect(unsubscribe).toHaveBeenCalled();
    await userEvent.selectOptions(
      screen.getByLabelText("Reminder type"),
      "event",
    );
    expect(screen.getByText("Save reminder")).toHaveProperty("disabled", true);
  });
  it("displays paused/deleted plans and provider-accepted status without promising delivery", async () => {
    snapshot.rules = [
      {
        ...DEFAULT_REMINDER,
        kind: "event",
        id: "event:missing",
        eventId: "missing",
        nextAt: null,
        status: "sent",
      },
    ];
    getRegistration.mockRejectedValue(new Error("Unavailable"));
    setup({ events: [] });
    expect(await screen.findByText("No upcoming delivery")).toBeTruthy();
    expect(screen.getByText(/Last delivery accepted/)).toBeTruthy();
  });
  it("ignores a settings request completed after unmount", async () => {
    let resolve!: (r: Response) => void;
    fetcher.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    const view = setup();
    view.unmount();
    await act(async () => resolve(Response.json(snapshot)));
    expect(screen.queryByText("Choose a reminder")).toBeNull();
  });
});
