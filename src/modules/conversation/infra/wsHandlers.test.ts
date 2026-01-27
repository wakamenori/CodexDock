import { describe, expect, it } from "vitest";

import type {
  ApprovalRequest,
  ChatMessage,
  DiffEntry,
  FileChangeEntry,
  ThreadStatusFlags,
} from "../../../types";
import { createWsEventHandlers } from "./wsHandlers";

const createStore = (selectedThreadId: string | null = "t1") => {
  const messages: Record<string, ChatMessage[]> = {};
  const diffs: Record<string, DiffEntry[]> = {};
  const fileChanges: Record<string, Record<string, FileChangeEntry>> = {};
  const approvals: Record<string, ApprovalRequest[]> = {};
  const activeTurn: Record<string, string | null> = {};
  const threadStatus: Record<string, ThreadStatusFlags> = {};

  const handlers = createWsEventHandlers({
    getSelectedThreadId: () => selectedThreadId,
    updateMessages: (threadId, updater) => {
      messages[threadId] = updater(messages[threadId] ?? []);
    },
    updateDiffs: (threadId, updater) => {
      diffs[threadId] = updater(diffs[threadId] ?? []);
    },
    updateFileChanges: (threadId, updater) => {
      fileChanges[threadId] = updater(fileChanges[threadId] ?? {});
    },
    updateApprovals: (threadId, updater) => {
      approvals[threadId] = updater(approvals[threadId] ?? []);
    },
    setActiveTurn: (threadId, turnId) => {
      activeTurn[threadId] = turnId;
    },
    updateThreadStatus: (threadId, updater) => {
      const current = threadStatus[threadId] ?? {
        processing: false,
        reviewing: false,
        unread: false,
      };
      threadStatus[threadId] = updater(current);
    },
  });

  return {
    handlers,
    snapshots: () => ({
      messages,
      diffs,
      fileChanges,
      approvals,
      activeTurn,
      threadStatus,
    }),
  };
};

describe("createWsEventHandlers", () => {
  it("applies agent delta", () => {
    const store = createStore();
    store.handlers.handleAppServerNotification("r1", {
      method: "item/agentMessage/delta",
      params: { item: { id: "i1" }, delta: { text: "hi" } },
    });
    expect(store.snapshots().messages.t1[0].text).toBe("hi");
  });

  it("applies reasoning summary delta", () => {
    const store = createStore();
    store.handlers.handleAppServerNotification("r1", {
      method: "item/reasoning/summaryTextDelta",
      params: { item: { id: "r1" }, delta: { text: "s" }, summaryIndex: 0 },
    });
    expect(store.snapshots().messages.t1[0].summary).toBe("s");
    expect(store.snapshots().messages.t1[0].summaryParts).toEqual(["s"]);
  });

  it("handles reasoning summary part added", () => {
    const store = createStore();
    store.handlers.handleAppServerNotification("r1", {
      method: "item/reasoning/summaryPartAdded",
      params: { item: { id: "r1" }, summaryIndex: 2 },
    });
    expect(store.snapshots().messages.t1[0].summaryParts).toHaveLength(3);
  });

  it("handles user item started replacing pending", () => {
    const store = createStore();
    store.snapshots().messages.t1 = [
      {
        id: "pending-1",
        role: "user",
        text: "draft",
        createdAt: Date.now(),
        pending: true,
      },
    ];
    store.handlers.handleAppServerNotification("r1", {
      method: "item/started",
      params: { item: { id: "u1", type: "userMessage", text: "draft" } },
    });
    expect(store.snapshots().messages.t1[0].itemId).toBe("u1");
    expect(store.snapshots().messages.t1[0].pending).toBe(false);
  });

  it("updates file changes", () => {
    const store = createStore();
    store.handlers.handleAppServerNotification("r1", {
      method: "item/started",
      params: {
        item: {
          id: "f1",
          type: "fileChange",
          changes: [{ path: "a", patch: "+++a" }],
          status: "pending",
        },
        turnId: "t1",
      },
    });
    expect(store.snapshots().fileChanges.t1.f1.changes[0].path).toBe("a");
  });

  it("adds approvals on request", () => {
    const store = createStore();
    store.handlers.handleAppServerRequest("r1", {
      id: 1,
      method: "item/fileChange/requestApproval",
      params: { threadId: "t1" },
    });
    expect(store.snapshots().approvals.t1).toHaveLength(1);
  });

  it("marks unread on approval request for inactive thread only", () => {
    const store = createStore("t1");
    store.handlers.handleAppServerRequest("r1", {
      id: 2,
      method: "item/fileChange/requestApproval",
      params: { threadId: "t2" },
    });
    expect(store.snapshots().threadStatus.t2.unread).toBe(true);
    store.handlers.handleAppServerRequest("r1", {
      id: 3,
      method: "item/fileChange/requestApproval",
      params: { threadId: "t1" },
    });
    expect(store.snapshots().threadStatus.t1?.unread ?? false).toBe(false);
  });

  it("uses nested thread id for approval requests", () => {
    const store = createStore("t1");
    store.handlers.handleAppServerRequest("r1", {
      id: 4,
      method: "item/commandExecution/requestApproval",
      params: { thread: { id: "t2" } },
    });
    expect(store.snapshots().approvals.t2).toHaveLength(1);
    expect(store.snapshots().threadStatus.t2.unread).toBe(true);
  });

  it("sets active turn on start and clears on completion", () => {
    const store = createStore();
    store.handlers.handleAppServerNotification("r1", {
      method: "turn/started",
      params: { turnId: "tA" },
    });
    expect(store.snapshots().activeTurn.t1).toBe("tA");
    store.handlers.handleAppServerNotification("r1", {
      method: "turn/completed",
      params: { turnId: "tA" },
    });
    expect(store.snapshots().activeTurn.t1).toBeNull();
  });

  it("tracks processing on item start and delta", () => {
    const store = createStore();
    store.handlers.handleAppServerNotification("r1", {
      method: "item/started",
      params: { item: { id: "m1", type: "agentMessage" } },
    });
    expect(store.snapshots().threadStatus.t1.processing).toBe(true);
    store.handlers.handleAppServerNotification("r1", {
      method: "item/agentMessage/delta",
      params: { item: { id: "m1" }, delta: { text: "hi" } },
    });
    expect(store.snapshots().threadStatus.t1.processing).toBe(true);
  });

  it("enters and exits review mode", () => {
    const store = createStore();
    store.handlers.handleAppServerNotification("r1", {
      method: "item/started",
      params: { item: { id: "rv1", type: "enteredReviewMode" } },
    });
    expect(store.snapshots().threadStatus.t1.reviewing).toBe(true);
    store.handlers.handleAppServerNotification("r1", {
      method: "item/completed",
      params: { item: { id: "rv2", type: "exitedReviewMode" } },
    });
    expect(store.snapshots().threadStatus.t1.reviewing).toBe(false);
  });

  it("marks unread on assistant completion for inactive thread only", () => {
    const store = createStore("t1");
    store.handlers.handleAppServerNotification("r1", {
      method: "item/completed",
      params: {
        threadId: "t2",
        item: { id: "a1", type: "assistantMessage", text: "done" },
      },
    });
    expect(store.snapshots().threadStatus.t2.unread).toBe(true);
    store.handlers.handleAppServerNotification("r1", {
      method: "item/completed",
      params: {
        threadId: "t1",
        item: { id: "a2", type: "assistantMessage", text: "done" },
      },
    });
    expect(store.snapshots().threadStatus.t1?.unread ?? false).toBe(false);
  });

  it("clears processing and reviewing on turn failure", () => {
    const store = createStore();
    store.handlers.handleAppServerNotification("r1", {
      method: "item/started",
      params: { item: { id: "rv1", type: "enteredReviewMode" } },
    });
    store.handlers.handleAppServerNotification("r1", {
      method: "turn/failed",
      params: { turnId: "tA" },
    });
    expect(store.snapshots().threadStatus.t1.processing).toBe(false);
    expect(store.snapshots().threadStatus.t1.reviewing).toBe(false);
  });
});
