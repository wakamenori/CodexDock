import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar";

const setup = (overrides?: Partial<ComponentProps<typeof Sidebar>>) => {
  const props: ComponentProps<typeof Sidebar> = {
    repoGroups: [
      {
        repo: { repoId: "repo-1", name: "Repo 1", path: "/repo" },
        threads: [],
        sessionStatus: "connected",
      },
    ],
    threadUiStatusByThread: {},
    selectedRepoId: "repo-1",
    running: false,
    selectedThreadId: null,
    onSelectRepo: vi.fn(),
    onAddRepo: vi.fn(),
    onCreateThread: vi.fn(),
    onSelectThread: vi.fn(),
    ...overrides,
  };

  render(<Sidebar {...props} />);
  return props;
};

describe("Sidebar", () => {
  afterEach(() => cleanup());

  it("keeps new thread enabled while running", () => {
    const props = setup({ running: true });
    const button = screen.getByRole("button", { name: "New thread" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(props.onCreateThread).toHaveBeenCalledWith("repo-1");
  });
});
