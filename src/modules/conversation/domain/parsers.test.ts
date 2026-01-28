import { describe, expect, it } from "vitest";

import {
  appendReasoningContent,
  appendReasoningSummary,
  buildMessagesFromResume,
  deriveReviewingFromResume,
  normalizeReasoningContent,
  normalizeReasoningContentParts,
  normalizeReasoningSummary,
  normalizeReasoningSummaryParts,
  normalizeRootPath,
  parseAgentMessageText,
  parseDeltaText,
  parseDiffText,
  parseFileChangeEntries,
  parseFileChangeStatus,
  parseFileChangeTurnId,
  parseItemId,
  parseItemRecord,
  parseReasoningContentIndex,
  parseReasoningSummaryIndex,
  parseThreadId,
  parseTurnId,
  parseUserMessageContent,
  parseUserMessageText,
} from "./parsers";

describe("normalizeReasoning*", () => {
  it("truncates summary to 4000 chars", () => {
    const long = "a".repeat(4500);
    expect(normalizeReasoningSummary(long)).toHaveLength(4000);
  });

  it("truncates content to 20000 chars", () => {
    const long = "b".repeat(20500);
    expect(normalizeReasoningContent(long)).toHaveLength(20000);
  });

  it("appendReasoningSummary preserves truncation", () => {
    const base = "a".repeat(3999);
    expect(appendReasoningSummary(base, "b")).toHaveLength(4000);
  });

  it("appendReasoningContent preserves truncation", () => {
    const base = "a".repeat(19999);
    expect(appendReasoningContent(base, "b")).toHaveLength(20000);
  });

  it("normalizes reasoning parts within limits", () => {
    const parts = ["a".repeat(3999), "b".repeat(10)];
    const normalizedSummary = normalizeReasoningSummaryParts(parts);
    expect(normalizedSummary.join("\n\n").length).toBeLessThanOrEqual(4000);
    const contentParts = ["c".repeat(19999), "d".repeat(10)];
    const normalizedContent = normalizeReasoningContentParts(contentParts);
    expect(normalizedContent.join("\n\n").length).toBeLessThanOrEqual(20000);
  });
});

describe("parseThreadId / parseTurnId", () => {
  it("prefers top-level threadId", () => {
    expect(parseThreadId({ threadId: "t1" })).toBe("t1");
  });

  it("falls back to nested thread.id", () => {
    expect(parseThreadId({ thread: { id: "nested" } })).toBe("nested");
  });

  it("extracts turn id from turn record", () => {
    expect(parseTurnId({ turn: { id: 5 } })).toBe("5");
  });
});

describe("parseDeltaText", () => {
  it("reads delta.text", () => {
    expect(parseDeltaText({ delta: { text: "hello" } })).toBe("hello");
  });

  it("falls back to message field", () => {
    expect(parseDeltaText({ message: "hi" })).toBe("hi");
  });
});

describe("parseReasoning*Index", () => {
  it("reads summaryIndex/contentIndex", () => {
    expect(parseReasoningSummaryIndex({ summaryIndex: 2 })).toBe(2);
    expect(parseReasoningContentIndex({ contentIndex: 3 })).toBe(3);
  });
});

describe("parseItemRecord / parseItemId", () => {
  it("extracts item record and id", () => {
    const params = { item: { id: 10, type: "x" } };
    expect(parseItemRecord(params)).toEqual({ id: 10, type: "x" });
    expect(parseItemId(params, "fallback")).toBe("10");
  });

  it("uses fallback when missing", () => {
    expect(parseItemId({}, "fallback")).toBe("fallback");
  });
});

describe("parseUserMessageText / parseAgentMessageText", () => {
  it("joins array content", () => {
    const item = { content: [{ text: "a" }, { text: "b" }] };
    expect(parseUserMessageText(item)).toBe("a\nb");
  });

  it("returns empty text when content has no text", () => {
    const item = { content: [{ kind: "image" }] };
    expect(parseUserMessageText(item)).toBe("");
  });

  it("reads direct text", () => {
    expect(parseAgentMessageText({ text: "ok" })).toBe("ok");
  });
});

describe("parseUserMessageContent", () => {
  it("extracts localImage entries", () => {
    const item = {
      content: [
        { type: "localImage", path: "/tmp/uploads/a.png", name: "a.png" },
        { type: "text", text: "hi" },
      ],
    };
    const result = parseUserMessageContent(item);
    expect(result.text).toBe("hi");
    expect(result.images).toEqual([
      {
        kind: "localImage",
        name: "a.png",
        path: "/tmp/uploads/a.png",
        url: "/api/uploads/a.png",
      },
    ]);
  });

  it("extracts image urls", () => {
    const item = {
      content: [{ type: "image", url: "https://example.com/a.png" }],
    };
    const result = parseUserMessageContent(item);
    expect(result.text).toBe("");
    expect(result.images).toEqual([
      { kind: "image", url: "https://example.com/a.png" },
    ]);
  });
});

describe("parseDiffText", () => {
  it("prefers diff.patch", () => {
    expect(parseDiffText({ diff: { patch: "PATCH" } })).toBe("PATCH");
  });

  it("stringifies fallback", () => {
    expect(parseDiffText({ foo: "bar" })).toContain("foo");
  });
});

describe("parseFileChange*", () => {
  it("extracts path/kind/diff", () => {
    const item = { changes: [{ path: "a", kind: "add", patch: "+++a" }] };
    const result = parseFileChangeEntries(item);
    expect(result[0]).toEqual({ path: "a", kind: "add", diff: "+++a" });
  });

  it("reads status and turnId from params", () => {
    const item = { status: "pending", turn: { id: 3 } };
    expect(parseFileChangeStatus(item)).toBe("pending");
    expect(parseFileChangeTurnId({ turnId: "t9" }, item)).toBe("t9");
  });
});

describe("buildMessagesFromResume", () => {
  it("converts resume payload into message list", () => {
    const payload = {
      resume: {
        thread: {
          turns: [
            {
              items: [
                { id: "u1", type: "userMessage", text: "hi" },
                { id: "a1", type: "agentMessage", text: "yo" },
                { id: "r1", type: "reasoning", summary: "s", content: "c" },
              ],
            },
          ],
        },
      },
    };
    const messages = buildMessagesFromResume("t", payload);
    expect(messages.map((m) => m.role)).toEqual(["user", "agent", "reasoning"]);
    expect(messages[0].text).toBe("hi");
    expect(messages[2].summary).toBe("s");
    expect(messages[2].content).toBe("c");
    expect(messages[2].summaryParts).toEqual(["s"]);
    expect(messages[2].contentParts).toEqual(["c"]);
  });

  it("joins reasoning summary/content arrays", () => {
    const payload = {
      resume: {
        thread: {
          turns: [
            {
              items: [
                {
                  id: "r1",
                  type: "reasoning",
                  summary: ["a", "b"],
                  content: ["c", "d"],
                },
              ],
            },
          ],
        },
      },
    };
    const messages = buildMessagesFromResume("t", payload);
    expect(messages[0].summary).toBe("a\n\nb");
    expect(messages[0].content).toBe("c\n\nd");
    expect(messages[0].summaryParts).toEqual(["a", "b"]);
    expect(messages[0].contentParts).toEqual(["c", "d"]);
  });

  it("includes assistant messages even when review markers are present", () => {
    const payload = {
      resume: {
        thread: {
          turns: [
            {
              items: [
                { id: "rv1", type: "enteredReviewMode" },
                {
                  id: "a1",
                  type: "assistantMessage",
                  text: "Review complete",
                },
                {
                  id: "rv2",
                  type: "exitedReviewMode",
                  review: "Review complete",
                },
              ],
            },
          ],
        },
      },
    };
    const messages = buildMessagesFromResume("t", payload);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("Review complete");
  });
});

describe("deriveReviewingFromResume", () => {
  it("returns true when review is entered without exit", () => {
    const payload = {
      resume: {
        thread: {
          turns: [
            {
              items: [{ id: "rv1", type: "enteredReviewMode" }],
            },
          ],
        },
      },
    };
    expect(deriveReviewingFromResume(payload)).toBe(true);
  });

  it("returns false when review is exited after enter", () => {
    const payload = {
      resume: {
        thread: {
          turns: [
            {
              items: [
                { id: "rv1", type: "enteredReviewMode" },
                { id: "rv2", type: "exitedReviewMode" },
              ],
            },
          ],
        },
      },
    };
    expect(deriveReviewingFromResume(payload)).toBe(false);
  });
});

describe("normalizeRootPath", () => {
  it("normalizes slashes and trims trailing", () => {
    expect(normalizeRootPath("C:\\repo///")).toBe("C:/repo");
  });
});
