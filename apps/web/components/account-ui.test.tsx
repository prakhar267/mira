// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
import { LoginForm } from "./LoginForm";
import { AdultDemoGate } from "./AdultDemoGate";
import { AuthRecovery } from "./AuthRecovery";
import { Onboarding } from "./Onboarding";
import { SupportForm } from "./SupportForm";
import { AnalyticsConsent } from "./AnalyticsConsent";
import { ServiceWorker } from "./ServiceWorker";
import { trackEvent, analyticsConsentKey } from "@/lib/analytics";
import {
  createDemoSession,
  fetchCapabilities,
  revokeDemoSession,
} from "@/lib/runtime-capabilities";

const fetcher = vi.fn<typeof fetch>();
const access = (mode = "anonymous", chat = false) => ({
  runtime: "cloudflare",
  mode,
  capabilities: { chat },
  voice: { name: "Priya", customization: true },
});
const change = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  navigation.push.mockReset();
  fetcher.mockReset().mockImplementation(async () => Response.json(access()));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("account and consent screens", () => {
  it("signs in with secure same-origin transport and navigates only after success", async () => {
    render(<LoginForm />);
    change("Email", "qa@example.test");
    change("Password", "Synthetic-password1!");
    fetcher.mockResolvedValueOnce(
      Response.json({ error: "Wrong password" }, { status: 401 }),
    );
    click(/^Log in/);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Wrong password",
    );
    expect(navigation.push).not.toHaveBeenCalled();
    fetcher.mockRejectedValueOnce("offline");
    click(/^Log in/);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Sign-in failed"),
    );
    fetcher.mockResolvedValueOnce(Response.json({ account: { id: "qa" } }));
    click(/^Log in/);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/app"));
    const init = fetcher.mock.calls.at(-1)![1]!;
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "qa@example.test",
      password: "Synthetic-password1!",
    });
  });
  it("keeps demo access blocked until both declarations are selected and the server grants access", async () => {
    const consent = vi.fn(),
      onAccess = vi.fn();
    render(
      <AdultDemoGate onConsent={consent} onAccess={onAccess}>
        <p>Demo admitted</p>
      </AdultDemoGate>,
    );
    const start = await screen.findByRole("button", { name: "Meet Mira" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    fetcher.mockResolvedValueOnce(
      Response.json({ error: "Busy" }, { status: 503 }),
    );
    fireEvent.click(start);
    expect((await screen.findByRole("alert")).textContent).toContain("Busy");
    fetcher
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json(access("demo", true)));
    fireEvent.click(start);
    expect(await screen.findByText("Demo admitted")).toBeTruthy();
    expect(consent).toHaveBeenCalledWith(true);
    expect(onAccess).toHaveBeenLastCalledWith(access("demo", true));
  });
  it("restores an eligible demo, handles discovery failure and cancels an unmounted check", async () => {
    fetcher.mockResolvedValueOnce(Response.json(access("demo", true)));
    const first = render(
      <AdultDemoGate>
        <p>Restored demo</p>
      </AdultDemoGate>,
    );
    expect(await screen.findByText("Restored demo")).toBeTruthy();
    first.unmount();
    fetcher.mockRejectedValueOnce(Error("offline"));
    const second = render(
      <AdultDemoGate>
        <p>Hidden</p>
      </AdultDemoGate>,
    );
    await screen.findByRole("button", { name: "Meet Mira" });
    for (const box of screen.getAllByRole("checkbox").slice(0, 2))
      fireEvent.click(box);
    fetcher.mockRejectedValueOnce("offline");
    click("Meet Mira");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The demo could not start",
    );
    second.unmount();
    let resolve!: (r: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const third = render(
      <AdultDemoGate>
        <p>Late response</p>
      </AdultDemoGate>,
    );
    const signal = fetcher.mock.calls.at(-1)![1]!.signal!;
    third.unmount();
    await act(async () => resolve(Response.json(access("demo", true))));
    expect(signal.aborted).toBe(true);
  });
  it.each(["forgot", "reset", "verify"] as const)(
    "submits the %s recovery flow without leaving tokens in the URL",
    async (mode) => {
      if (mode !== "forgot")
        window.history.replaceState(
          null,
          "",
          "/recovery#token=synthetic-token",
        );
      render(<AuthRecovery mode={mode} />);
      expect(window.location.hash).toBe("");
      if (mode === "forgot") change("Email", "qa@example.test");
      if (mode === "reset") {
        change("Reset token", "x".repeat(64));
        change("New password", "Synthetic-password1!");
      }
      if (mode === "verify") change(/Verification token/, "x".repeat(64));
      fetcher.mockResolvedValueOnce(
        Response.json({ error: "Try again" }, { status: 503 }),
      );
      fireEvent.submit(document.querySelector("form")!);
      expect((await screen.findByRole("alert")).textContent).toBe("Try again");
      fetcher.mockRejectedValueOnce("offline");
      fireEvent.submit(document.querySelector("form")!);
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(
          "Account email is unavailable.",
        ),
      );
      fetcher.mockResolvedValueOnce(Response.json({}));
      fireEvent.submit(document.querySelector("form")!);
      expect((await screen.findByRole("status")).textContent).toMatch(
        /queued|updated|verified/,
      );
      expect(fetcher.mock.calls.at(-1)![0]).toBe(
        `/api/account/${mode === "forgot" ? "forgot-password" : mode === "reset" ? "reset-password" : "verify-email"}`,
      );
    },
  );
  it("requests a verification link when no token exists, with safe fallback errors", async () => {
    render(<AuthRecovery mode="verify" />);
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    click("Request verification link");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "could not be completed",
    );
    fetcher.mockResolvedValueOnce(Response.json({}));
    click("Request verification link");
    await screen.findByRole("status");
    expect(fetcher.mock.calls.at(-1)![0]).toBe(
      "/api/account/request-verification",
    );
  });
  it("consumes query-string recovery tokens as well as fragment tokens", () => {
    window.history.replaceState(null, "", "/reset-password?token=from-query");
    render(<AuthRecovery mode="reset" />);
    expect(
      (screen.getByLabelText("Reset token") as HTMLInputElement).value,
    ).toBe("from-query");
    expect(window.location.search).toBe("");
  });
});

describe("onboarding choices and recoverable submission", () => {
  it("validates every step, preserves choices when navigating back, and retries a failed signup", async () => {
    const finish = vi
      .fn()
      .mockRejectedValueOnce(Error("Duplicate email"))
      .mockRejectedValueOnce("offline")
      .mockResolvedValue(undefined);
    render(<Onboarding onComplete={finish} />);
    click("Begin setup");
    click("Continue");
    expect(screen.getByRole("alert").textContent).toContain("valid email");
    change("First name", "QA");
    change("Email", "qa@example.test");
    change("Password", "Synthetic-password1!");
    click("Continue");
    click("Continue");
    expect(screen.getByRole("alert").textContent).toContain("18+");
    change("Birthday", "1990-01-01");
    fireEvent.input(screen.getByLabelText("Birthday"), {
      target: { value: "1990-01-01" },
    });
    fireEvent.click(screen.getByLabelText("I confirm I am 18 or older."));
    click("Continue");
    change("Your pronouns", "they/them");
    click("Continue");
    click("Continue");
    expect(screen.getByRole("alert").textContent).toContain("reason");
    click("Friendship");
    click("Friendship");
    click("Personal growth");
    click("Continue");
    change("Companion name", "");
    click("Continue");
    expect(screen.getByRole("alert").textContent).toContain("name");
    change("Companion name", "Asha");
    change("Companion pronouns", "they/them");
    change("Presentation", "calm and thoughtful");
    click("Continue");
    click(/Romantic partner/);
    expect(screen.getByText(/never discourages/)).toBeTruthy();
    click("Continue");
    for (const slider of screen.getAllByRole("slider"))
      fireEvent.change(slider, { target: { value: "42" } });
    click("Continue");
    click("Continue");
    expect(screen.getByRole("alert").textContent).toContain("interest");
    click("Art");
    click("Art");
    click("Music");
    click("Continue");
    click("Back");
    expect(
      screen
        .getByRole("button", { name: "Music" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    click("Continue");
    click("Meet your companion");
    expect(screen.getByRole("alert").textContent).toContain("disclosure");
    for (const checkbox of screen.getAllByRole("checkbox"))
      fireEvent.click(checkbox);
    click("Meet your companion");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Duplicate email"),
    );
    click("Meet your companion");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "could not be completed",
      ),
    );
    click("Meet your companion");
    await waitFor(() => expect(finish).toHaveBeenCalledTimes(3));
    expect(finish.mock.calls.at(-1)![0]).toMatchObject({
      name: "QA",
      pronouns: "they/them",
      companionName: "Asha",
      companionPronouns: "they/them",
      relationshipMode: "romantic",
      warmth: 42,
      interests: ["Music"],
      intentions: ["Personal growth"],
      memoryEnabled: true,
      conversationStorageEnabled: false,
      aiProcessingConsent: true,
      policyAccepted: true,
    });
  });
});

describe("support, analytics and browser registration", () => {
  it("submits support fields, preserves them on failures, and displays the received ticket", async () => {
    render(<SupportForm />);
    change("Short summary", "Synthetic issue");
    change("What happened?", "A reproducible synthetic issue");
    change("Page or feature", "Voice");
    change("Email for a reply (optional)", "qa@example.test");
    for (const failure of [
      Response.json({ error: "Unavailable" }, { status: 503 }),
      Response.json({}),
    ]) {
      fetcher.mockResolvedValueOnce(failure);
      fireEvent.submit(document.querySelector("form")!);
      await screen.findByRole("alert");
      await waitFor(() =>
        expect(
          (
            screen.getByRole("button", {
              name: /Submit report/,
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(false),
      );
    }
    fetcher.mockRejectedValueOnce("offline");
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "could not be submitted",
      ),
    );
    fetcher.mockResolvedValueOnce(Response.json({ ticketId: "MIRA-QA" }));
    fireEvent.submit(document.querySelector("form")!);
    expect((await screen.findByRole("status")).textContent).toContain(
      "MIRA-QA",
    );
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body))).toEqual({
      summary: "Synthetic issue",
      details: "A reproducible synthetic issue",
      page: "Voice",
      email: "qa@example.test",
    });
  });
  it("persists optional analytics, respects DNT, and tolerates unavailable storage/network", async () => {
    render(<AnalyticsConsent />);
    const toggle = screen.getByRole("checkbox");
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect(localStorage.getItem(analyticsConsentKey)).toBe("yes");
    trackEvent("view_home", 250);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/events",
      expect.objectContaining({
        body: JSON.stringify({ event: "view_home", durationMs: 250 }),
      }),
    );
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    fetcher.mockClear();
    trackEvent("view_home");
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { doNotTrack: "0" });
    fireEvent.click(toggle);
    trackEvent("view_home");
    expect(fetcher).not.toHaveBeenCalled();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error("blocked");
    });
    fireEvent.click(toggle);
    expect((toggle as HTMLInputElement).checked).toBe(false);
    cleanup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw Error("blocked");
    });
    render(<AnalyticsConsent />);
    expect(() => trackEvent("view_home")).not.toThrow();
  });
  it("registers a service worker only in production and only on supported browsers", () => {
    const register = vi.fn().mockResolvedValue({});
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    vi.stubEnv("NODE_ENV", "test");
    const first = render(<ServiceWorker />);
    expect(register).not.toHaveBeenCalled();
    first.unmount();
    vi.stubEnv("NODE_ENV", "production");
    const second = render(<ServiceWorker />);
    expect(register).toHaveBeenCalledWith("/sw.js");
    second.unmount();
    vi.stubGlobal("navigator", {});
    render(<ServiceWorker />);
    expect(register).toHaveBeenCalledTimes(1);
  });
  it("surfaces invalid capability responses, rejected consent and denied cookie access", async () => {
    fetcher.mockResolvedValueOnce(new Response("bad", { status: 503 }));
    await expect(fetchCapabilities()).rejects.toThrow(/checked/);
    fetcher.mockResolvedValueOnce(new Response("bad", { status: 503 }));
    await expect(createDemoSession(false)).rejects.toThrow(
      /could not be started/,
    );
    fetcher
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json(access("anonymous")));
    await expect(createDemoSession(false)).rejects.toThrow(/cookies/);
    fetcher.mockResolvedValueOnce(Response.json({}));
    await revokeDemoSession();
    expect(fetcher.mock.calls.at(-1)).toEqual([
      "/api/demo/session",
      { method: "DELETE", credentials: "same-origin" },
    ]);
  });
});
