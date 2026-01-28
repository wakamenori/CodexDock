// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownRenderer } from "./MarkdownRenderer";

const renderMock = vi.fn().mockResolvedValue({
  svg: '<svg data-testid="mermaid-diagram"></svg>',
});
const initializeMock = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
  },
}));

describe("MarkdownRenderer", () => {
  afterEach(() => {
    cleanup();
    renderMock.mockClear();
    initializeMock.mockClear();
  });

  it("renders mermaid by default and toggles to code", async () => {
    const markdown = "```mermaid\ngraph TD; A-->B;\n```";
    const { container } = render(
      <MarkdownRenderer>{markdown}</MarkdownRenderer>,
    );

    const renderButton = screen.getByRole("button", { name: "Render" });
    const codeButton = screen.getByRole("button", { name: "Code" });

    expect(renderButton.getAttribute("aria-pressed")).toBe("true");

    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="mermaid-diagram"]'),
      ).not.toBeNull(),
    );

    expect(container.querySelector("pre")).toBeNull();

    fireEvent.click(codeButton);

    expect(codeButton.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("does not show mermaid toggle for non-mermaid blocks", () => {
    const markdown = "```ts\nconst value = 1;\n```";
    render(<MarkdownRenderer>{markdown}</MarkdownRenderer>);

    expect(screen.queryByRole("button", { name: "Render" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Code" })).toBeNull();
  });
});
