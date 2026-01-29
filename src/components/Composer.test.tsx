import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Composer } from "./Composer";

const setup = (overrides?: Partial<ComponentProps<typeof Composer>>) => {
  const props: ComponentProps<typeof Composer> = {
    inputText: "hello",
    attachedImages: [],
    reviewTargetType: "uncommittedChanges",
    reviewBaseBranch: "",
    reviewCommitSha: "",
    reviewCustomInstructions: "",
    selectedThreadId: "thread-1",
    running: false,
    activeTurnId: null,
    selectedModel: null,
    availableModels: [],
    selectedReasoningEffort: "medium",
    availableReasoningEfforts: [{ effort: "medium" }],
    permissionMode: "FullAccess",
    onInputTextChange: vi.fn(),
    onReviewTargetTypeChange: vi.fn(),
    onReviewBaseBranchChange: vi.fn(),
    onReviewCommitShaChange: vi.fn(),
    onReviewCustomInstructionsChange: vi.fn(),
    onAddImages: vi.fn(),
    onRemoveImage: vi.fn(),
    onSend: vi.fn(),
    onReviewStart: vi.fn(),
    onStop: vi.fn(),
    onModelChange: vi.fn(),
    onReasoningEffortChange: vi.fn(),
    onPermissionModeChange: vi.fn(),
    ...overrides,
  };

  render(<Composer {...props} />);
  return props;
};

describe("Composer", () => {
  afterEach(() => cleanup());

  it("sends only on Ctrl/Cmd+Enter", () => {
    const props = setup();
    const input = screen.getByRole("textbox");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(props.onSend).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(props.onSend).toHaveBeenCalledTimes(2);
  });

  it("does not send while composing", () => {
    const props = setup();
    const input = screen.getByRole("textbox");

    fireEvent.keyDown(input, {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
    });
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("shows stop button and disables it when not running", () => {
    setup({ running: false });
    const stopWhenIdle = screen.getByRole("button", { name: "Stop" });
    expect((stopWhenIdle as HTMLButtonElement).disabled).toBe(true);

    cleanup();
    setup({ running: true, activeTurnId: "turn-1" });
    const stopWhenRunning = screen.getByRole("button", { name: "Stop" });
    expect((stopWhenRunning as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables review when target details are missing", () => {
    setup({ reviewTargetType: "baseBranch", reviewBaseBranch: "" });
    const reviewButton = screen.getByRole("button", { name: "Review" });
    expect((reviewButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("starts review on click when enabled", () => {
    const props = setup();
    const reviewButton = screen.getByRole("button", { name: "Review" });
    fireEvent.click(reviewButton);
    expect(props.onReviewStart).toHaveBeenCalledTimes(1);
  });

  it("enables send when images are attached without text", () => {
    setup({
      inputText: "",
      attachedImages: [
        {
          id: "img-1",
          name: "image.png",
          previewUrl: "blob://image",
          size: 10,
          type: "image/png",
        },
      ],
    });
    const sendButton = screen.getByRole("button", { name: "Send" });
    expect((sendButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("updates reasoning effort on change", () => {
    const props = setup({
      selectedReasoningEffort: "medium",
      availableReasoningEfforts: [
        { effort: "low" },
        { effort: "medium" },
        { effort: "high" },
      ],
    });
    const effortSelect = screen.getByRole("combobox", {
      name: "Reasoning effort",
    });
    fireEvent.change(effortSelect, { target: { value: "high" } });
    expect(props.onReasoningEffortChange).toHaveBeenCalledWith("high");
  });
});
