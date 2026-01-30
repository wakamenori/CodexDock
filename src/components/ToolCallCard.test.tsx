// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ToolTimelineItem } from "../types";
import { ToolCallCard } from "./ToolCallCard";

describe("ToolCallCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders web search query without JSON input label", () => {
    const item: ToolTimelineItem = {
      itemId: "tool-1",
      type: "webSearch",
      status: "completed",
      createdAt: 0,
      updatedAt: 0,
      query: "weather: Saitama, Japan",
      input: { query: "weather: Saitama, Japan" },
    };

    render(<ToolCallCard item={item} selectedRepoPath={null} />);

    expect(screen.getByText("weather: Saitama, Japan")).not.toBeNull();
    expect(screen.queryByText("input")).toBeNull();
    expect(screen.queryByText('"query"')).toBeNull();
    expect(screen.queryByText("webSearch")).toBeNull();
  });

  it("hides command execution meta labels and cwd", () => {
    const item: ToolTimelineItem = {
      itemId: "tool-2",
      type: "commandExecution",
      status: "completed",
      createdAt: 0,
      updatedAt: 0,
      command: "/bin/zsh -lc 'ls -la'",
      cwd: "/repo",
    };

    render(<ToolCallCard item={item} selectedRepoPath="/repo" />);

    expect(screen.queryByText("/bin/zsh -lc")).toBeNull();
    expect(screen.queryByText("Tool")).toBeNull();
    expect(screen.queryByText(/cwd:/i)).toBeNull();
  });

  it("strips shell wrapper with double quotes", () => {
    const item: ToolTimelineItem = {
      itemId: "tool-3",
      type: "commandExecution",
      status: "completed",
      createdAt: 0,
      updatedAt: 0,
      command: '/bin/zsh -lc "echo hello"',
    };

    render(<ToolCallCard item={item} selectedRepoPath={null} />);

    expect(screen.queryByText("/bin/zsh -lc")).toBeNull();
    expect(screen.getByText("echo hello")).not.toBeNull();
  });

  it("hides exit code when it is zero", () => {
    const item: ToolTimelineItem = {
      itemId: "tool-4",
      type: "commandExecution",
      status: "completed",
      createdAt: 0,
      updatedAt: 0,
      command: "echo ok",
      exitCode: 0,
      durationMs: 120,
    };

    render(<ToolCallCard item={item} selectedRepoPath={null} />);

    expect(screen.queryByText(/exit:/i)).toBeNull();
    expect(screen.getByText(/120ms/i)).not.toBeNull();
  });

  it("hides exit/duration line when both are missing", () => {
    const item: ToolTimelineItem = {
      itemId: "tool-8",
      type: "commandExecution",
      status: "completed",
      createdAt: 0,
      updatedAt: 0,
      command: "echo ok",
    };

    render(<ToolCallCard item={item} selectedRepoPath={null} />);

    expect(screen.queryByText(/ms/i)).toBeNull();
    expect(screen.queryByText(/exit:/i)).toBeNull();
  });

  it("renders file change status as a badge without tool labels", () => {
    const item: ToolTimelineItem = {
      itemId: "tool-5",
      type: "fileChange",
      status: "completed",
      createdAt: 0,
      updatedAt: 0,
      changes: [{ path: "README.md", diff: "--- a/README.md" }],
    };

    render(<ToolCallCard item={item} selectedRepoPath={null} />);

    expect(screen.queryByText("Tool")).toBeNull();
    expect(screen.queryByText("fileChange")).toBeNull();
    expect(screen.getByText("completed")).not.toBeNull();
  });

  it("renders completed badge color", () => {
    const item: ToolTimelineItem = {
      itemId: "tool-7",
      type: "fileChange",
      status: "completed",
      createdAt: 0,
      updatedAt: 0,
      changes: [{ path: "README.md", diff: "--- a/README.md" }],
    };

    const { container } = render(
      <ToolCallCard item={item} selectedRepoPath={null} />,
    );
    const badge = container.querySelector('[title="completed"]');
    expect(badge).not.toBeNull();
    expect(badge?.className).toContain("bg-neon-400");
  });

  it("does not render file change output stream", () => {
    const item: ToolTimelineItem = {
      itemId: "tool-6",
      type: "fileChange",
      status: "completed",
      createdAt: 0,
      updatedAt: 0,
      changes: [{ path: "README.md", diff: "--- a/README.md" }],
      outputStream: "Success. Updated the following files:",
    };

    render(<ToolCallCard item={item} selectedRepoPath={null} />);

    expect(
      screen.queryByText(/Success\. Updated the following files:/i),
    ).toBeNull();
  });
});
