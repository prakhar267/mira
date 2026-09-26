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
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { dialogSupport } from "../tests/ui-test-helpers";
import { PlanModal } from "./PlanModal";
import { OperationsDashboard } from "./OperationsDashboard";
import { AdminDashboard } from "./AdminDashboard";
import { FirstMeeting } from "./FirstMeeting";
import { companionApi } from "@/lib/api-client";
import { playCompanionSpeech } from "@/lib/speech";
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  notFound: vi.fn(() => {
    throw Error("NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw Error("REDIRECT");
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  notFound: navigation.notFound,
  redirect: navigation.redirect,
}));
vi.mock("next/link", () => ({
  default: ({
    prefetch: _prefetch,
    children,
    ...p
  }: {
    children?: ReactNode;
    prefetch?: unknown;
  }) => {
    void _prefetch;
    return <a {...p}>{children}</a>;
  },
}));
vi.mock(
  "framer-motion",
  async () => (await import("../tests/ui-test-helpers")).motionMock,
);
vi.mock("@/lib/speech", () => ({ playCompanionSpeech: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  companionApi: {
    adminMetrics: vi.fn(),
    adminProviders: vi.fn(),
    adminFlags: vi.fn(),
    updateAdminFlags: vi.fn(),
  },
}));
const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
beforeEach(() => {
  vi.clearAllMocks();
  dialogSupport();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ enabled: false })),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("optional billing UI", () => {
  const props = () => ({
    current: "free" as const,
    onSelect: vi.fn(),
    onClose: vi.fn(),
  });
  it.each(["disabled", "HTTP error", "offline"])(
    "shows free beta when billing is %s",
    async (state) => {
      if (state === "HTTP error")
        vi.mocked(fetch).mockResolvedValueOnce(
          Response.json({}, { status: 503 }),
        );
      if (state === "offline")
        vi.mocked(fetch).mockRejectedValueOnce(Error("offline"));
      const p = props();
      render(<PlanModal {...p} />);
      await act(async () => Promise.resolve());
      expect(screen.getByText("Free public beta")).toBeTruthy();
      click("Continue with Mira");
      expect(p.onClose).toHaveBeenCalled();
      expect(p.onSelect).not.toHaveBeenCalled();
    },
  );
  it("requires sign-in before checkout", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        enabled: true,
        environment: "test_mode",
        signedIn: false,
        hasSubscription: false,
        priceLabel: "Test price",
      }),
    );
    render(<PlanModal {...props()} />);
    await screen.findByText("Mira membership");
    expect(screen.getByText(/TEST checkout only/)).toBeTruthy();
    click("Sign in to continue");
    expect(navigation.push).toHaveBeenCalledWith("/login");
  });
  it.each([false, true])(
    "opens a secure %s subscription link and handles malformed/provider/network failures",
    async (hasSubscription) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        Response.json({
          enabled: true,
          environment: "live_mode",
          signedIn: true,
          hasSubscription,
          priceLabel: "Configured price",
        }),
      );
      render(<PlanModal {...props()} />);
      const label = hasSubscription
        ? "Manage subscription"
        : "Review secure checkout";
      await screen.findByRole("button", { name: label });
      for (const response of [
        Response.json({ error: "Billing unavailable" }, { status: 503 }),
        Response.json({ url: "javascript:bad" }),
        Response.json({}),
        "network",
      ]) {
        if (typeof response === "string")
          vi.mocked(fetch).mockRejectedValueOnce("offline");
        else vi.mocked(fetch).mockResolvedValueOnce(response);
        click(label);
        await screen.findByRole("alert");
        expect(
          (screen.getByRole("button", { name: label }) as HTMLButtonElement)
            .disabled,
        ).toBe(false);
      }
      const assign = vi.fn();
      const actualWindow = window;
      vi.stubGlobal(
        "window",
        new Proxy(actualWindow, {
          get(target, key) {
            return key === "location"
              ? { assign }
              : Reflect.get(target, key, target);
          },
        }),
      );
      vi.mocked(fetch).mockResolvedValueOnce(
        Response.json({ url: "https://checkout.example.test/review" }),
      );
      click(label);
      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith(
          "https://checkout.example.test/review",
        ),
      );
      expect(fetch).toHaveBeenLastCalledWith(
        `/api/billing/${hasSubscription ? "portal" : "checkout"}`,
        { method: "POST" },
      );
    },
  );
});

describe("private operations controls", () => {
  const snapshot = () => ({
    alerts: [],
    configuration: { configured: true },
    readiness: { ready: false },
    monitor: null,
    storageStats: {},
    mailOutbox: {},
    recentMetrics: [],
    tickets: [],
    metrics: [],
    nextCursor: undefined,
  });
  it("uses an in-memory operator key, paginates the inbox, updates a ticket and locks the console", async () => {
    const data = {
      ...snapshot(),
      alerts: ["Provider capacity limited"],
      tickets: [
        {
          ticketId: "t1",
          summary: "Delivery question",
          details: "Synthetic report",
          email: "qa@example.test",
          createdAt: "2026-09-26",
          status: "new",
        },
        {
          ticketId: "t2",
          summary: "Another report",
          details: "No address",
          email: null,
          createdAt: "2026-09-26",
          status: "new",
        },
      ],
      metrics: [
        {
          day: "2026-09-26",
          name: "chat",
          total: 20,
          failures: 1,
          averageLatencyMs: 120,
        },
      ],
      nextCursor: "page 2",
    };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(data));
    render(<OperationsDashboard />);
    change("Operator access key", "synthetic-operator-key");
    click("Open dashboard / Refresh");
    await screen.findByText("Delivery question");
    expect(fetch).toHaveBeenLastCalledWith("/api/admin/operations", {
      headers: { authorization: "Bearer synthetic-operator-key" },
      cache: "no-store",
    });
    expect(
      screen.getByRole("link", { name: "Reply by email" }).getAttribute("href"),
    ).toContain("qa%40example.test");
    expect(screen.getByText("No reply address supplied.")).toBeTruthy();
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json(data));
    fireEvent.change(screen.getAllByLabelText("Status")[0]!, {
      target: { value: "resolved" },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/admin/operations",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ ticketId: "t1", status: "resolved" }),
      }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(snapshot()));
    click("Next page");
    await screen.findByText("No tickets on this page.");
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/admin/operations?cursor=page%202",
      expect.anything(),
    );
    click("Lock");
    expect(
      (screen.getByLabelText("Operator access key") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.queryByText("Support inbox")).toBeNull();
  });
  it.each([Error("Offline"), "offline"])(
    "reports an operations transport failure: %s",
    async (cause) => {
      vi.mocked(fetch).mockRejectedValueOnce(cause);
      render(<OperationsDashboard />);
      change("Operator access key", "synthetic-key");
      click("Open dashboard / Refresh");
      await screen.findByText(
        cause instanceof Error ? "Offline" : "Unavailable",
      );
    },
  );
  it("shows HTTP failures and preserves a ticket after failed status changes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    );
    render(<OperationsDashboard />);
    change("Operator access key", "synthetic-key");
    click("Open dashboard / Refresh");
    await screen.findByText("Unauthorized");
    const data = {
      ...snapshot(),
      tickets: [
        {
          ticketId: "t",
          summary: "Report",
          details: "Synthetic",
          status: "new",
          email: null,
          createdAt: "now",
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(data));
    click("Open dashboard / Refresh");
    await screen.findByText("Report");
    for (const cause of [
      Response.json({ error: "Update denied" }, { status: 403 }),
      "offline",
    ]) {
      if (typeof cause === "string")
        vi.mocked(fetch).mockRejectedValueOnce(cause);
      else vi.mocked(fetch).mockResolvedValueOnce(cause);
      fireEvent.change(screen.getByLabelText("Status"), {
        target: { value: "resolved" },
      });
      await screen.findByText(
        typeof cause === "string" ? "Update failed" : "Update denied",
      );
      expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe(
        "new",
      );
    }
  });
  it.each([0, 10])(
    "displays privacy-safe API metrics for %s requests and rolls back rejected flags",
    async (requests) => {
      vi.mocked(companionApi.adminMetrics)
        .mockRejectedValueOnce(Error("denied"))
        .mockResolvedValue({
          requests,
          successfulRequests: requests / 2,
          averageLatencyMs: 20,
          estimatedCostUsd: 0.01,
        });
      vi.mocked(companionApi.adminProviders).mockResolvedValue(
        requests
          ? { chat: "provider", moderation: "local", configured: true }
          : {},
      );
      vi.mocked(companionApi.adminFlags).mockResolvedValue({
        voice: true,
        camera: false,
      });
      render(<AdminDashboard />);
      change("Admin API key", "synthetic-key");
      click("Open console");
      await screen.findByText(/admin key was rejected/);
      click("Open console");
      await screen.findByText("Admin authenticated");
      expect(
        screen.getByText(requests ? "50% successful" : "100% successful"),
      ).toBeTruthy();
      vi.mocked(companionApi.updateAdminFlags).mockRejectedValueOnce(
        Error("denied"),
      );
      fireEvent.click(screen.getAllByRole("checkbox")[0]!);
      await screen.findByText("The feature flag could not be saved.");
      expect(
        (screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked,
      ).toBe(true);
      vi.mocked(companionApi.updateAdminFlags).mockResolvedValueOnce({
        voice: false,
        camera: false,
      });
      fireEvent.click(screen.getAllByRole("checkbox")[0]!);
      await waitFor(() =>
        expect(
          (screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked,
        ).toBe(false),
      );
    },
  );
});

it("advances the first meeting and cancels speech when replaced or closed", () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  vi.mocked(playCompanionSpeech).mockReturnValue({ cancel } as never);
  const complete = vi.fn();
  const v = render(
    <FirstMeeting userName="QA" companionName="Mira" onComplete={complete} />,
  );
  expect(screen.getByRole("heading").textContent).toContain("Hi QA");
  click("Hear Mira say this");
  click("Hear Mira say this");
  expect(cancel).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(2900));
  expect(screen.getByRole("heading").textContent).toContain("Start karne");
  act(() => vi.advanceTimersByTime(2900));
  click("Say hello");
  expect(complete).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(2900));
  v.unmount();
  expect(cancel).toHaveBeenCalledTimes(2);
});

it("renders public pages and metadata while keeping private routes out of indexing", async () => {
  const [
    home,
    info,
    layout,
    manifest,
    robots,
    sitemap,
    errorPage,
    loading,
    app,
    demo,
    signup,
    login,
    forgot,
    reset,
    verify,
    admin,
  ] = await Promise.all([
    import("../app/page"),
    import("../app/[slug]/page"),
    import("../app/layout"),
    import("../app/manifest"),
    import("../app/robots"),
    import("../app/sitemap"),
    import("../app/error"),
    import("../app/loading"),
    import("../app/app/page"),
    import("../app/demo/page"),
    import("../app/signup/page"),
    import("../app/login/page"),
    import("../app/forgot-password/page"),
    import("../app/reset-password/page"),
    import("../app/verify-email/page"),
    import("../app/admin/page"),
  ]);
  render(home.default());
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
    "space to talk",
  );
  expect(
    document.querySelector('script[type="application/ld+json"]')!.textContent,
  ).toContain('"price":"0"');
  cleanup();
  for (const { slug } of info.generateStaticParams()) {
    const page = await info.default({ params: Promise.resolve({ slug }) });
    render(page);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(
      await info.generateMetadata({ params: Promise.resolve({ slug }) }),
    ).toMatchObject({ alternates: { canonical: `/${slug}` } });
    cleanup();
  }
  await expect(
    info.default({ params: Promise.resolve({ slug: "invalid" }) }),
  ).rejects.toThrow("NOT_FOUND");
  expect(
    await info.generateMetadata({
      params: Promise.resolve({ slug: "invalid" }),
    }),
  ).toEqual({});
  expect(
    renderToStaticMarkup(layout.default({ children: <p>Page content</p> })),
  ).toContain('<html lang="en"');
  expect(manifest.default().start_url).toBe("/app");
  expect(robots.default().rules).toMatchObject({
    disallow: expect.arrayContaining(["/app", "/api/"]),
  });
  expect(sitemap.default()).toHaveLength(9);
  expect(sitemap.default().every((page) => !page.url.endsWith("/app"))).toBe(
    true,
  );
  const onReset = vi.fn();
  render(errorPage.default({ error: Error("Synthetic"), reset: onReset }));
  click("Try again");
  expect(onReset).toHaveBeenCalled();
  cleanup();
  render(loading.default());
  expect(screen.getByRole("status")).toBeTruthy();
  cleanup();
  expect(app.default().props.productionAccount).toBe(true);
  expect(demo.default().props.forceDemo).toBe(true);
  expect(() => signup.default()).toThrow("REDIRECT");
  expect(navigation.redirect).toHaveBeenCalledWith("/app?onboarding=1");
  for (const page of [login, forgot, reset, verify, admin]) {
    expect(page.metadata.robots).toMatchObject({ index: false, follow: false });
    expect(page.default()).toBeTruthy();
  }
});
