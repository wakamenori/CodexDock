import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Composer } from "./Composer";

const setup = (overrides?: Partial<ComponentProps<typeof Composer>>) => {
  const props: ComponentProps<typeof Composer> = {
    inputText: "hello",
    selectedThreadId: "thread-1",
    running: false,
    activeTurnId: null,
    selectedModel: null,
    availableModels: [],
    onInputTextChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onModelChange: vi.fn(),
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
});
