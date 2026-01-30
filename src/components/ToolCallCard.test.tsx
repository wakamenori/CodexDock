// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ToolTimelineItem } from "../types";
import { ToolCallCard } from "./ToolCallCard";

describe("ToolCallCard", () => {
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
});
