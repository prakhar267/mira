// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatMessage, JournalEntryRecord } from "@companion/shared";
import { ConversationSearch } from "./ConversationSearch";
import { WeeklyReflection } from "./WeeklyReflection";
import { VoicePicker } from "./VoicePicker";

const fetcher = vi.fn();
const createURL = vi.fn(() => "blob:synthetic"),
  revokeURL = vi.fn();
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const message = (
  id: string,
  content = "We talked about café yesterday.",
  role: "user" | "assistant" = "user",
): ChatMessage => ({
  id,
  conversationId: "c",
  role,
  content,
  status: "sent",
  createdAt: "2026-09-24T12:00:00Z",
});
const entry = (id = "j", daysAgo = 0): JournalEntryRecord => ({
  id,
  userId: "u",
  title: `Entry ${id}`,
  content: "I painted a tree.",
  mood: "calm",
  tags: [],
  reflected: false,
  createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  updatedAt: new Date().toISOString(),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetcher);
  URL.createObjectURL = createURL;
  URL.revokeObjectURL = revokeURL;
  createURL.mockReturnValue("blob:synthetic");
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("conversation search interactions", () => {
  const props = {
    messages: [message("1"), message("2", "A different response", "assistant")],
    conversationId: "c",
    accountMode: true,
    companionName: "Mira",
    onClose: vi.fn(),
  };
  const search = async () => {
    fireEvent.change(screen.getByLabelText("Search text"), {
      target: { value: "café" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
  };
  it("searches locally, opens context, returns to results and resets filters", async () => {
    render(<ConversationSearch {...props} accountMode={false} />);
    expect(screen.getByRole("button", { name: "Search" })).toHaveProperty(
      "disabled",
      true,
    );
    await search();
    expect(await screen.findByText("1 matching messages")).toBeTruthy();
    expect(document.querySelector("mark")?.textContent).toBe("café");
    await userEvent.click(screen.getByText("Read surrounding messages"));
    expect(screen.getByText("A different response")).toBeTruthy();
    await userEvent.click(screen.getByText("Back to results"));
    await userEvent.selectOptions(
      screen.getByLabelText("Conversations"),
      "current",
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Speaker"),
      "assistant",
    );
    fireEvent.change(screen.getByLabelText("Since (UTC)"), {
      target: { value: "2026-09-23" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("0 matching messages")).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends filters and cursors, appends results and reads an empty/deleted context", async () => {
    fetcher
      .mockResolvedValueOnce(
        Response.json({ messages: [message("1")], cursor: "next" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          messages: [message("2", "café response", "assistant")],
        }),
      )
      .mockResolvedValueOnce(Response.json({ messages: [] }));
    render(<ConversationSearch {...props} />);
    await userEvent.selectOptions(
      screen.getByLabelText("Conversations"),
      "current",
    );
    await userEvent.selectOptions(screen.getByLabelText("Speaker"), "user");
    fireEvent.change(screen.getByLabelText("Since (UTC)"), {
      target: { value: "2026-09-23" },
    });
    await search();
    expect(await screen.findByText("1+ matching messages")).toBeTruthy();
    expect(fetcher.mock.calls[0]?.[0]).toContain(
      "conversationId=c&role=user&from=",
    );
    await userEvent.click(screen.getByText("Load more matches"));
    expect(await screen.findByText("2 matching messages")).toBeTruthy();
    expect(fetcher.mock.calls[1]?.[0]).toContain("cursor=next");
    await userEvent.click(screen.getAllByText("Read surrounding messages")[0]!);
    expect(await screen.findByText(/conversation was deleted/)).toBeTruthy();
    expect(fetcher.mock.calls[2]?.[0]).toContain("messageId=1");
  });
  it.each([
    Response.json({ error: "Please retry later" }, { status: 503 }),
    Response.json({}, { status: 503 }),
    "network",
  ])("reports a failed search without showing success: %s", async (result) => {
    if (typeof result === "string") fetcher.mockRejectedValue(result);
    else fetcher.mockResolvedValue(result);
    render(<ConversationSearch {...props} />);
    await search();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("0 matching messages")).toBeNull();
  });
  it.each([
    Response.json({ error: "Context failed" }, { status: 503 }),
    Response.json({}, { status: 503 }),
    "offline",
  ])("reports a context failure and permits retry: %s", async (failure) => {
    fetcher.mockResolvedValueOnce(Response.json({ messages: [message("1")] }));
    if (typeof failure === "string") fetcher.mockRejectedValueOnce(failure);
    else fetcher.mockResolvedValueOnce(failure);
    fetcher.mockResolvedValueOnce(
      Response.json({
        messages: [message("1"), message("2", "Other context", "assistant")],
      }),
    );
    render(<ConversationSearch {...props} />);
    await search();
    await userEvent.click(await screen.findByText("Read surrounding messages"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await userEvent.click(screen.getByText("Read surrounding messages"));
    expect(await screen.findByText("Other context")).toBeTruthy();
  });
  it("ignores stale search and context responses after filters change or unmount", async () => {
    const pending = deferred<Response>();
    fetcher.mockReturnValueOnce(pending.promise);
    const view = render(<ConversationSearch {...props} />);
    await search();
    const signal = fetcher.mock.calls[0]?.[1].signal;
    fireEvent.change(screen.getByLabelText("Search text"), {
      target: { value: "new topic" },
    });
    expect(signal.aborted).toBe(true);
    await act(async () =>
      pending.resolve(Response.json({ messages: [message("old")] })),
    );
    expect(screen.queryByText("Read surrounding messages")).toBeNull();
    fetcher.mockResolvedValueOnce(Response.json({ messages: [message("1")] }));
    await search();
    const context = deferred<Response>();
    fetcher.mockReturnValueOnce(context.promise);
    await userEvent.click(await screen.findByText("Read surrounding messages"));
    view.unmount();
    expect(fetcher.mock.calls[2]?.[1].signal.aborted).toBe(true);
    await act(async () => context.resolve(Response.json({ messages: [] })));
  });
});
describe("selected journal reflections", () => {
  const setup = (extra = {}) => {
    const props = {
      entries: [entry()],
      saved: [],
      enabled: true,
      accountMode: true,
      beforeGenerate: vi.fn().mockResolvedValue(undefined),
      onSave: vi.fn(),
      onDelete: vi.fn(),
      ...extra,
    };
    return { ...render(<WeeklyReflection {...props} />), props };
  };
  const generate = async () => {
    await userEvent.click(screen.getByRole("checkbox", { name: /Entry j/ }));
    await userEvent.click(screen.getByText("Generate selected reflection"));
  };
  const response = () =>
    Response.json({
      entryIds: ["j"],
      language: "English",
      summary: "You made time for painting.",
    });
  it("requires selection, flushes canonical state, previews before saving and deletes saved output", async () => {
    fetcher.mockResolvedValue(response());
    const view = setup();
    expect(screen.getByText("Generate selected reflection")).toHaveProperty(
      "disabled",
      true,
    );
    await generate();
    expect(await screen.findByText("Your reflection · unsaved")).toBeTruthy();
    expect(view.props.beforeGenerate).toHaveBeenCalledOnce();
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
      entryIds: ["j"],
      language: "English",
    });
    expect(view.props.onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Save reflection"));
    expect(view.props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "You made time for painting.",
        entryIds: ["j"],
      }),
    );
    expect(screen.getByText("Reflection saved.")).toBeTruthy();
    view.rerender(
      <WeeklyReflection
        {...view.props}
        saved={[view.props.onSave.mock.calls[0]?.[0]]}
      />,
    );
    await userEvent.click(screen.getByText("Delete reflection"));
    expect(view.props.onDelete).toHaveBeenCalledWith(expect.any(String));
  });
  it("sends only selected demo fields, changes language, downloads and discards", async () => {
    fetcher.mockImplementation(async () => response());
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    setup({ accountMode: false, entries: [entry(), entry("other")] });
    await userEvent.selectOptions(
      screen.getByLabelText("Reflection language"),
      "Hinglish",
    );
    await generate();
    await screen.findByText("Your reflection · unsaved");
    const payload = JSON.parse(fetcher.mock.calls[0]?.[1].body);
    expect(payload.language).toBe("Hinglish");
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]).not.toHaveProperty("userId");
    await userEvent.click(screen.getByText("Download text"));
    expect(createURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    await waitFor(
      () => expect(revokeURL).toHaveBeenCalledWith("blob:synthetic"),
      { timeout: 1500 },
    );
    await userEvent.click(screen.getByText("Discard"));
    expect(screen.queryByText("Your reflection · unsaved")).toBeNull();
  });
  it("filters dates, clears selection, enforces count and size limits and respects disabled AI", async () => {
    const entries = [
      entry("old", 40),
      ...Array.from({ length: 15 }, (_, i) => ({
        ...entry(`j${i}`),
        content: "x".repeat(1800),
      })),
    ];
    const view = setup({ entries });
    expect(screen.queryByText("Entry old")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Entries from"), "30");
    await userEvent.selectOptions(screen.getByLabelText("Entries from"), "all");
    expect(screen.getByText("Entry old")).toBeTruthy();
    for (const checkbox of screen.getAllByRole("checkbox").slice(1, 15))
      await userEvent.click(checkbox);
    expect(screen.getAllByRole("checkbox")[15]).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByText("Generate selected reflection")).toHaveProperty(
      "disabled",
      true,
    );
    await userEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(screen.getByText("Generate selected reflection")).toHaveProperty(
      "disabled",
      false,
    );
    view.rerender(<WeeklyReflection {...view.props} enabled={false} />);
    expect(screen.getByText(/Enable AI processing/)).toBeTruthy();
    expect(screen.getByText("Generate selected reflection")).toHaveProperty(
      "disabled",
      true,
    );
    view.rerender(<WeeklyReflection {...view.props} entries={[]} />);
    expect(screen.getByText(/No entries in this period/)).toBeTruthy();
  });
  it.each([
    Response.json({ error: "Capacity reached" }, { status: 429 }),
    Response.json({}, { status: 503 }),
    "offline",
  ])("exposes generation failures and allows retry: %s", async (failure) => {
    if (typeof failure === "string") fetcher.mockRejectedValue(failure);
    else fetcher.mockResolvedValue(failure);
    setup();
    await generate();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Generate selected reflection")).toHaveProperty(
      "disabled",
      false,
    );
  });
  it("does not call inference when saving selected journals fails", async () => {
    setup({
      beforeGenerate: vi.fn().mockRejectedValue(new Error("Sync conflict")),
    });
    await generate();
    expect(await screen.findByText("Sync conflict")).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["cancel", "consent", "edit", "unmount"])(
    "discards a pending reflection on %s",
    async (change) => {
      const pending = deferred<Response>();
      fetcher.mockReturnValue(pending.promise);
      const view = setup();
      await generate();
      await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      if (change === "cancel")
        await userEvent.click(screen.getByText("Cancel"));
      if (change === "consent")
        view.rerender(<WeeklyReflection {...view.props} enabled={false} />);
      if (change === "edit")
        view.rerender(
          <WeeklyReflection
            {...view.props}
            entries={[
              { ...view.props.entries[0]!, content: "Changed journal" },
            ]}
          />,
        );
      if (change === "unmount") view.unmount();
      expect(fetcher.mock.calls[0]?.[1].signal.aborted).toBe(true);
      await act(async () => pending.resolve(response()));
      expect(screen.queryByText("Your reflection · unsaved")).toBeNull();
      expect(view.props.onSave).not.toHaveBeenCalled();
    },
  );
  it("invalidates an existing draft after source changes and caps saved reflections", async () => {
    fetcher.mockImplementation(async () => response());
    const saved = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      entryIds: ["j"],
      summary: `Saved ${i}`,
      language: "English" as const,
      createdAt: new Date().toISOString(),
    }));
    const view = setup({ saved });
    await generate();
    await screen.findByText("Your reflection · unsaved");
    expect(screen.getByText("Save reflection")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByText(/30 reflections saved/)).toBeTruthy();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await userEvent.click(
      within(document.querySelector("details")!).getByText("Download text"),
    );
    expect(createURL).toHaveBeenCalled();
    view.rerender(<WeeklyReflection {...view.props} entries={[]} />);
    expect(screen.queryByText("Your reflection · unsaved")).toBeNull();
  });
});
describe("voice library selection and playback lifecycle", () => {
  const voices = [
    { id: "Priya", name: "Priya", description: "", language: "Hindi" },
    { id: "Ashley", name: "Ashley", description: "Warm", language: "English" },
  ];
  let audios: FakeAudio[];
  class FakeAudio {
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    pause = vi.fn();
    removeAttribute = vi.fn();
    play = vi.fn().mockResolvedValue(undefined);
    constructor() {
      audios.push(this);
    }
  }
  beforeEach(() => {
    audios = [];
    vi.stubGlobal("Audio", FakeAudio);
  });
  const setup = (enabled = true) => {
    const onSelect = vi.fn();
    return {
      ...render(
        <VoicePicker
          selected="mira-natural-01"
          enabled={enabled}
          onSelect={onSelect}
        />,
      ),
      onSelect,
    };
  };
  const catalogue = () =>
    fetcher.mockResolvedValueOnce(Response.json({ voices }));
  const preview = () =>
    fetcher.mockResolvedValueOnce(
      new Response("synthetic audio", {
        headers: { "content-type": "audio/mpeg" },
      }),
    );
  it("requires consent, searches names/languages, marks default and selects a voice", async () => {
    const view = setup(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByText(/Enable AI processing/)).toBeTruthy();
    catalogue();
    view.rerender(
      <VoicePicker selected="Ashley" enabled onSelect={view.onSelect} />,
    );
    await screen.findByText("Ashley");
    fireEvent.change(screen.getByLabelText("Search voices"), {
      target: { value: "absent" },
    });
    expect(screen.getByText("No voices match that search.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search voices"), {
      target: { value: "Hindi" },
    });
    expect(screen.queryByText("Ashley")).toBeNull();
    await userEvent.click(screen.getByText("Use Priya"));
    expect(view.onSelect).toHaveBeenCalledWith("Priya");
  });
  it.each([
    Response.json({ error: "Unavailable" }, { status: 503 }),
    Response.json({}, { status: 503 }),
    "offline",
  ])("retries failed catalogues: %s", async (failure) => {
    if (typeof failure === "string") fetcher.mockRejectedValueOnce(failure);
    else fetcher.mockResolvedValueOnce(failure);
    catalogue();
    setup();
    expect(await screen.findByRole("alert")).toBeTruthy();
    await userEvent.click(screen.getByText("Retry voice library"));
    expect(await screen.findByText("Ashley")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("stops, completes, reports decode failure and releases audio on selection/unmount", async () => {
    catalogue();
    const view = setup();
    await screen.findByText("Ashley");
    preview();
    await userEvent.click(screen.getByLabelText("Preview Ashley"));
    await waitFor(() => expect(audios).toHaveLength(1));
    await userEvent.click(screen.getByLabelText("Stop Ashley"));
    expect(audios[0]?.pause).toHaveBeenCalled();
    expect(revokeURL).toHaveBeenCalled();
    preview();
    await userEvent.click(screen.getByLabelText("Preview Priya"));
    await waitFor(() => expect(audios).toHaveLength(2));
    act(() => audios[1]!.onended!());
    expect(screen.getByLabelText("Preview Priya")).toBeTruthy();
    preview();
    await userEvent.click(screen.getByLabelText("Preview Ashley"));
    await waitFor(() => expect(audios).toHaveLength(3));
    act(() => audios[2]!.onerror!());
    expect(screen.getByText(/preview could not play/)).toBeTruthy();
    preview();
    await userEvent.click(screen.getByLabelText("Preview Ashley"));
    await waitFor(() => expect(audios).toHaveLength(4));
    await userEvent.click(screen.getByText("Use Ashley"));
    expect(audios[3]?.pause).toHaveBeenCalled();
    preview();
    await userEvent.click(screen.getByLabelText("Preview Priya"));
    await waitFor(() => expect(audios).toHaveLength(5));
    view.unmount();
    expect(audios[4]?.pause).toHaveBeenCalled();
    act(() => {
      audios[4]!.onended!();
      audios[4]!.onerror!();
    });
  });
  it.each([
    Response.json({ error: "Preview failed" }, { status: 503 }),
    Response.json({}, { status: 503 }),
    "offline",
  ])("reports preview fetch failures: %s", async (failure) => {
    catalogue();
    setup();
    await screen.findByText("Ashley");
    if (typeof failure === "string") fetcher.mockRejectedValueOnce(failure);
    else fetcher.mockResolvedValueOnce(failure);
    await userEvent.click(screen.getByLabelText("Preview Ashley"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByLabelText("Preview Ashley")).toBeTruthy();
  });
  it("does not play a stale preview after consent withdrawal", async () => {
    catalogue();
    const view = setup();
    await screen.findByText("Ashley");
    const pending = deferred<Response>();
    fetcher.mockReturnValue(pending.promise);
    await userEvent.click(screen.getByLabelText("Preview Ashley"));
    view.rerender(
      <VoicePicker selected="Priya" enabled={false} onSelect={view.onSelect} />,
    );
    expect(fetcher.mock.calls[1]?.[1].signal.aborted).toBe(true);
    await act(async () => pending.resolve(new Response("audio")));
    expect(audios).toHaveLength(0);
  });
  it("aborts a pending catalogue on unmount", async () => {
    const pending = deferred<Response>();
    fetcher.mockReturnValue(pending.promise);
    const view = setup();
    view.unmount();
    expect(fetcher.mock.calls[0]?.[1].signal.aborted).toBe(true);
    await act(async () => pending.resolve(Response.json({ voices })));
  });
});
