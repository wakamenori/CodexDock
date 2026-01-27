import { describe, expect, it } from "vitest";

import type {
  ApprovalRequest,
  ChatMessage,
  FileChangeEntry,
} from "../../../types";
import {
  applyAgentMessageStart,
  applyDiffUpdate,
  applyFileChangeUpdate,
  applyReasoningStart,
  applyReasoningSummaryPartAdded,
  applyUserMessageStart,
  removeApproval,
  upsertAgentDelta,
  upsertReasoningDelta,
} from "./state";

const now = 1_700_000_000_000;
const baseMsg = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "x",
  role: "user",
  text: "",
  createdAt: now,
  ...overrides,
});

describe("upsertAgentDelta", () => {
  it("appends delta to existing agent message", () => {
    const list = [baseMsg({ id: "1", role: "agent", text: "he" })];
    const updated = upsertAgentDelta(list, "1", "llo");
    expect(updated[0].text).toBe("hello");
  });

  it("creates new agent message when missing", () => {
    const updated = upsertAgentDelta([], "new", "hi");
    expect(updated[0]).toMatchObject({
      itemId: "new",
      role: "agent",
      text: "hi",
    });
  });
});

describe("upsertReasoningDelta", () => {
  it("appends summary delta", () => {
    const list = [
      baseMsg({
        id: "r",
        role: "reasoning",
        summary: "a",
        content: "",
        summaryParts: ["a"],
      }),
    ];
    const updated = upsertReasoningDelta(list, "r", "b", true, 0);
    expect(updated[0].summary).toBe("ab");
    expect(updated[0].summaryParts).toEqual(["ab"]);
  });

  it("appends content delta when no summary", () => {
    const updated = upsertReasoningDelta(
      [],
      "r2",
      "delta",
      false,
      undefined,
      0,
    );
    expect(updated[0].content).toBe("delta");
    expect(updated[0].contentParts).toEqual(["delta"]);
  });
});

describe("applyUserMessageStart", () => {
  it("replaces pending user with real itemId", () => {
    const list = [
      baseMsg({ id: "pending-1", role: "user", pending: true, text: "draft" }),
    ];
    const updated = applyUserMessageStart(list, "u1", "draft");
    expect(updated[0]).toMatchObject({ itemId: "u1", pending: false });
  });

  it("keeps existing text when incoming is empty", () => {
    const list = [
      baseMsg({
        id: "pending-1",
        role: "user",
        pending: true,
        text: "keep-me",
      }),
    ];
    const updated = applyUserMessageStart(list, "u1", "");
    expect(updated[0].text).toBe("keep-me");
  });

  it("adds new when no pending", () => {
    const updated = applyUserMessageStart([], "u2", "hello");
    expect(updated[0].id).toBe("u2");
  });
});

describe("applyAgentMessageStart", () => {
  it("updates existing agent", () => {
    const list = [baseMsg({ id: "a1", role: "agent", text: "" })];
    const updated = applyAgentMessageStart(list, "a1", "ok");
    expect(updated[0].text).toBe("ok");
  });
});

describe("applyReasoningStart", () => {
  it("creates reasoning entry with normalized summary/content", () => {
    const updated = applyReasoningStart(
      [],
      "r1",
      "s",
      "c",
      ["s1", "s2"],
      ["c1"],
    );
    expect(updated[0]).toMatchObject({
      role: "reasoning",
      summary: "s1\n\ns2",
      content: "c1",
      summaryParts: ["s1", "s2"],
      contentParts: ["c1"],
    });
  });
});

describe("applyReasoningSummaryPartAdded", () => {
  it("expands summary parts based on index", () => {
    const updated = applyReasoningSummaryPartAdded([], "r1", 1);
    expect(updated[0].summaryParts).toHaveLength(2);
  });
});

describe("applyFileChangeUpdate", () => {
  it("merges changes and keeps turn/status", () => {
    const existing: Record<string, FileChangeEntry> = {};
    const updated = applyFileChangeUpdate(existing, {
      itemId: "f1",
      turnId: "t1",
      status: "pending",
      changes: [{ path: "a", kind: "add", diff: "+++a" }],
    });
    expect(updated.f1.turnId).toBe("t1");
    expect(updated.f1.changes).toHaveLength(1);
  });
});

describe("applyDiffUpdate", () => {
  it("upserts diff by turnId", () => {
    const diffed = applyDiffUpdate([], "t1", "diff");
    expect(diffed[0]).toMatchObject({ turnId: "t1", diffText: "diff" });
  });
});

describe("removeApproval", () => {
  it("filters by rpcId", () => {
    const approvals: ApprovalRequest[] = [
      { rpcId: 1, method: "m1", receivedAt: now },
      { rpcId: 2, method: "m2", receivedAt: now },
    ];
    expect(removeApproval(approvals, 1)).toHaveLength(1);
  });
});
