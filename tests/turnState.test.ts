import { describe, expect, it } from "vitest";
import { TurnStateStore } from "../server/turnState";

describe("TurnStateStore", () => {
  it("tracks turn status transitions from notifications", () => {
    const store = new TurnStateStore();

    store.updateFromNotification("repo_1", {
      method: "turn/started",
      params: { turn: { id: 1 } },
    });
    expect(store.get("repo_1", "1")).toBe("running");

    store.updateFromNotification("repo_1", {
      method: "turn/completed",
      params: { turn: { id: "turn_2" }, status: "interrupted" },
    });
    expect(store.get("repo_1", "turn_2")).toBe("interrupted");

    store.updateFromNotification("repo_1", {
      method: "turn/completed",
      params: { turn: { id: "turn_3" } },
    });
    expect(store.get("repo_1", "turn_3")).toBe("completed");

    store.updateFromNotification("repo_1", {
      method: "turn/failed",
      params: { turnId: "turn_4" },
    });
    expect(store.get("repo_1", "turn_4")).toBe("failed");

    store.updateFromNotification("repo_1", {
      method: "turn/error",
      params: { turnId: "turn_5" },
    });
    expect(store.get("repo_1", "turn_5")).toBe("failed");
  });

  it("tracks latest agent message per turn", () => {
    const store = new TurnStateStore();

    store.updateFromNotification("repo_1", {
      method: "item/agentMessage/delta",
      params: { turn: { id: "turn_1" }, itemId: "item_1", delta: "Hello" },
    });
    expect(store.getLastAgentMessage("repo_1", "turn_1")).toBe("Hello");

    store.updateFromNotification("repo_1", {
      method: "item/agentMessage/delta",
      params: { turnId: "turn_1", itemId: "item_1", delta: " world" },
    });
    expect(store.getLastAgentMessage("repo_1", "turn_1")).toBe("Hello world");

    store.updateFromNotification("repo_1", {
      method: "item/assistantMessage/delta",
      params: { turnId: "turn_1", itemId: "item_2", delta: "New" },
    });
    expect(store.getLastAgentMessage("repo_1", "turn_1")).toBe("New");

    store.updateFromNotification("repo_1", {
      method: "item/completed",
      params: {
        turn: { id: "turn_1" },
        item: { id: "item_2", type: "assistantMessage", text: "Final" },
      },
    });
    expect(store.getLastAgentMessage("repo_1", "turn_1")).toBe("Final");
  });

  it("ignores notifications without a turn id", () => {
    const store = new TurnStateStore();

    store.updateFromNotification("repo_1", {
      method: "turn/started",
      params: { foo: "bar" },
    });

    expect(store.get("repo_1", "missing")).toBeUndefined();
  });
});
