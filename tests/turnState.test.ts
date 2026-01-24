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
