import { describe, expect, it } from "vitest";

import type {
  ApprovalRequest,
  ChatMessage,
  DiffEntry,
  FileChangeEntry,
} from "../../../types";
import { createWsEventHandlers } from "./wsHandlers";

const createStore = (selectedThreadId: string | null = "t1") => {
  const messages: Record<string, ChatMessage[]> = {};
  const diffs: Record<string, DiffEntry[]> = {};
  const fileChanges: Record<string, Record<string, FileChangeEntry>> = {};
  const approvals: Record<string, ApprovalRequest[]> = {};
  const activeTurn: Record<string, string | null> = {};

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
  });

  return {
    handlers,
    snapshots: () => ({
      messages,
      diffs,
      fileChanges,
      approvals,
      activeTurn,
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
      params: { item: { id: "r1" }, delta: { text: "s" } },
    });
    expect(store.snapshots().messages.t1[0].summary).toBe("s");
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
});
