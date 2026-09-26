import {
  createElement,
  forwardRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { initialState, type DemoState } from "../lib/state";
import type { MemoryRecord } from "@companion/shared";

type MotionProps = Record<string, unknown> & { children?: ReactNode };
const components: Record<string, ComponentType<MotionProps>> = {};
export const motionMock = {
  motion: new Proxy(components, {
    get(target, tag: string) {
      return (target[tag] ??= forwardRef<HTMLElement, MotionProps>(
        function MotionBoundary(props, ref) {
          const clean = Object.fromEntries(
            Object.entries(props).filter(
              ([key]) =>
                ![
                  "initial",
                  "animate",
                  "exit",
                  "transition",
                  "whileTap",
                  "whileHover",
                  "whileInView",
                  "viewport",
                  "layout",
                  "layoutId",
                ].includes(key),
            ),
          );
          return createElement(tag, { ...clean, ref });
        },
      ));
    },
  }),
  AnimatePresence: ({ children }: { children?: ReactNode }) => children,
};
export function dialogSupport() {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
}
export function memoryFixture(
  overrides: Partial<MemoryRecord> = {},
): MemoryRecord {
  return {
    id: "memory",
    userId: "user",
    companionId: "companion",
    type: "preference",
    content: "I like drawing",
    normalizedContent: "i like drawing",
    importance: 0.7,
    confidence: 1,
    sourceMessageIds: [],
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    retrievalCount: 0,
    status: "active",
    pinned: false,
    ...overrides,
  };
}
export function viewState(overrides: Partial<DemoState> = {}): DemoState {
  const state = structuredClone(initialState);
  return Object.assign(
    state,
    {
      onboardingComplete: true,
      firstMeetingComplete: true,
      messages: [],
      memories: [],
      moments: [],
      photos: [],
      calls: [],
      journalEntries: [],
      journalReflections: [],
      futureEvents: [],
      companionReflections: [],
      feedbackSignals: [],
      completedActivityIds: [],
      nudges: [],
    },
    overrides,
  );
}
