import type { ChatMessage } from "@companion/shared";
export interface SearchOptions {
  query: string;
  conversationId?: string;
  role?: "user" | "assistant";
  before?: string;
  from?: string;
  to?: string;
}
export const foldSearch = (value: string) =>
  value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
export function matchesSearch(message: ChatMessage, options: SearchOptions) {
  return (
    message.role !== "system" &&
    message.status !== "failed" &&
    message.status !== "sending" &&
    (!options.conversationId ||
      message.conversationId === options.conversationId) &&
    (!options.role || message.role === options.role) &&
    (!options.from || message.createdAt >= options.from) &&
    (!options.to || message.createdAt < options.to) &&
    foldSearch(message.content).includes(foldSearch(options.query))
  );
}
export function searchMessages(
  messages: ChatMessage[],
  options: SearchOptions,
) {
  const boundary = options.before
    ? (JSON.parse(options.before) as [string, string])
    : undefined;
  const result = messages
    .filter(
      (message) =>
        matchesSearch(message, options) &&
        (!boundary ||
          message.createdAt < boundary[0] ||
          (message.createdAt === boundary[0] && message.id < boundary[1])),
    )
    // Use the same binary ordering as the cursor comparison and SQLite.
    .sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.id === b.id
          ? 0
          : a.id < b.id
            ? 1
            : -1
        : a.createdAt < b.createdAt
          ? 1
          : -1,
    );
  const selected = result.slice(0, 25);
  const last = selected.at(-1);
  return {
    messages: selected,
    cursor:
      result.length > 25 && last
        ? JSON.stringify([last.createdAt, last.id])
        : undefined,
  };
}
