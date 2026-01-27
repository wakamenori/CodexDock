import { describe, expect, it } from "vitest";

import { reduceConversation } from "./reducer";
import { initialConversationState } from "./state";

describe("reduceConversation", () => {
  it("deduplicates approvals and marks unread when background", () => {
    const base = {
      ...initialConversationState,
      focusedThreadId: "t1",
    };
    const first = reduceConversation(base, {
      type: "approval/received",
      threadId: "t2",
      request: { rpcId: 1, method: "m1", receivedAt: Date.now() },
    });
    expect(first.approvalsByThread.t2).toHaveLength(1);
    expect(first.threadStatusByThread.t2?.unread).toBe(true);
    const second = reduceConversation(first, {
      type: "approval/received",
      threadId: "t2",
      request: { rpcId: 1, method: "m1", receivedAt: Date.now() },
    });
    expect(second.approvalsByThread.t2).toHaveLength(1);
  });

  it("turn/started and turn/finished toggle processing and activeTurn", () => {
    const state = reduceConversation(initialConversationState, {
      type: "turn/started",
      threadId: "t1",
      turnId: "turn1",
    });
    expect(state.activeTurnByThread.t1).toBe("turn1");
    expect(state.threadStatusByThread.t1?.processing).toBe(true);
    const finished = reduceConversation(state, {
      type: "turn/finished",
      threadId: "t1",
      status: "completed",
    });
    expect(finished.activeTurnByThread.t1).toBeNull();
    expect(finished.threadStatusByThread.t1?.processing).toBe(false);
  });

  it("thread/focused clears unread flag", () => {
    const state = {
      ...initialConversationState,
      threadStatusByThread: {
        t1: { processing: false, reviewing: false, unread: true },
      },
    };
    const next = reduceConversation(state, {
      type: "thread/focused",
      threadId: "t1",
    });
    expect(next.threadStatusByThread.t1.unread).toBe(false);
  });
});
