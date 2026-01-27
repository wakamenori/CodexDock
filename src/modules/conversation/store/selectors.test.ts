import { describe, expect, it } from "vitest";
import {
  selectFocusedModel,
  selectFocusedThreadRunning,
  selectRepoGroups,
  selectThreadUiStatusById,
} from "./selectors";
import type { ConversationState } from "./state";
import { initialConversationState } from "./state";

const baseState = (): ConversationState =>
  structuredClone(initialConversationState);

describe("selectors", () => {
  it("selectFocusedModel prefers stored then default then first available", () => {
    const state = baseState();
    state.focusedRepoId = "repo-1";
    state.availableModelsByRepo["repo-1"] = ["gpt-4", "gpt-3.5"];
    state.modelSettings = {
      storedModel: "gpt-3.5",
      defaultModel: "gpt-4",
      loaded: true,
    };
    expect(selectFocusedModel(state)).toBe("gpt-3.5");

    state.modelSettings.storedModel = "unknown";
    expect(selectFocusedModel(state)).toBe("gpt-4");

    state.modelSettings.defaultModel = null;
    expect(selectFocusedModel(state)).toBe("gpt-4");

    state.availableModelsByRepo["repo-1"] = ["gpt-mini"];
    expect(selectFocusedModel(state)).toBe("gpt-mini");
  });

  it("selectThreadUiStatusById prioritises approvals > reviewing > processing > unread > ready", () => {
    const state = baseState();
    state.threadStatusByThread = {
      a: { processing: true, reviewing: false, unread: false },
      b: { processing: false, reviewing: true, unread: false },
      c: { processing: false, reviewing: false, unread: true },
      d: { processing: false, reviewing: false, unread: false },
    };
    state.approvalsByThread = {
      b: [{ rpcId: 1, method: "m", receivedAt: Date.now() }],
    };
    const status = selectThreadUiStatusById(state);
    expect(status.a).toBe("processing");
    expect(status.b).toBe("approval");
    expect(status.c).toBe("unread");
    expect(status.d).toBe("ready");
  });

  it("selectRepoGroups filters threads by normalized path", () => {
    const state = baseState();
    state.repos = [
      { repoId: "r1", name: "one", path: "/root/a" },
      { repoId: "r2", name: "two", path: "/root/b" },
    ];
    state.threadsByRepo = {
      r1: [
        { threadId: "t1", cwd: "/root/a" },
        { threadId: "t2", cwd: "/root/other" },
      ],
    };
    const groups = selectRepoGroups(state);
    expect(groups[0].threads).toHaveLength(1);
    expect(groups[0].threads[0].threadId).toBe("t1");
  });

  it("selectFocusedThreadRunning reflects processing flag", () => {
    const state = baseState();
    state.focusedThreadId = "thread-1";
    state.threadStatusByThread["thread-1"] = {
      processing: true,
      reviewing: false,
      unread: false,
    };
    expect(selectFocusedThreadRunning(state)).toBe(true);
    state.threadStatusByThread["thread-1"].processing = false;
    expect(selectFocusedThreadRunning(state)).toBe(false);
  });
});
