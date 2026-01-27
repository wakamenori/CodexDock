import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationState } from "../modules/conversation/store/state";
import { initialConversationState } from "../modules/conversation/store/state";
import { Composer } from "./Composer";

const mockCommands = {
  sendMessage: vi.fn().mockResolvedValue(undefined),
  startReview: vi.fn().mockResolvedValue(undefined),
  stopActiveTurn: vi.fn().mockResolvedValue(undefined),
  updateModel: vi.fn().mockResolvedValue(undefined),
  updatePermissionMode: vi.fn(),
};

const mockState: ConversationState = {
  ...initialConversationState,
  focusedRepoId: "repo-1",
  focusedThreadId: "thread-1",
  activeTurnByThread: { "thread-1": "turn-1" },
  threadStatusByThread: {
    "thread-1": { processing: false, reviewing: false, unread: false },
  },
  availableModelsByRepo: { "repo-1": ["model-a"] },
  modelSettings: {
    storedModel: "model-a",
    defaultModel: "model-a",
    loaded: true,
  },
};

vi.mock("../modules/conversation/provider/useConversationCommands", () => ({
  useConversationCommands: () => mockCommands,
}));

vi.mock("../modules/conversation/provider/useConversationSelector", () => ({
  useConversationSelector: (selector: (state: ConversationState) => unknown) =>
    selector(mockState),
}));

describe("Composer", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("sends on Ctrl/Cmd+Enter", () => {
    render(<Composer />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "hello" } });

    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockCommands.sendMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(mockCommands.sendMessage).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: "hello again" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(mockCommands.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("disables stop button when idle", () => {
    render(<Composer />);
    const stop = screen.getByRole("button", { name: "Stop" });
    expect((stop as HTMLButtonElement).disabled).toBe(true);
  });

  it("starts review when review data is present", () => {
    render(<Composer />);
    const reviewButton = screen.getByRole("button", { name: "Review" });
    fireEvent.click(reviewButton);
    expect(mockCommands.startReview).toHaveBeenCalledTimes(1);
  });
});
