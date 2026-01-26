import { fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { Composer } from "./Composer";

const setup = (overrides?: Partial<ComponentProps<typeof Composer>>) => {
  const props: ComponentProps<typeof Composer> = {
    inputText: "hello",
    selectedThreadId: "thread-1",
    running: false,
    selectedModel: null,
    availableModels: [],
    onInputTextChange: vi.fn(),
    onSend: vi.fn(),
    onModelChange: vi.fn(),
    ...overrides,
  };

  render(<Composer {...props} />);
  return props;
};

describe("Composer", () => {
  it("sends only on Ctrl+Enter", () => {
    const props = setup();
    const input = screen.getByRole("textbox");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(props.onSend).toHaveBeenCalledTimes(1);
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
});
