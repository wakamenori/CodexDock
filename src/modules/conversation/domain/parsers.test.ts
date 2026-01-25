import { describe, expect, it } from "vitest";

import {
  appendReasoningContent,
  appendReasoningSummary,
  buildMessagesFromResume,
  normalizeReasoningContent,
  normalizeReasoningSummary,
  normalizeRootPath,
  parseAgentMessageText,
  parseDeltaText,
  parseDiffText,
  parseFileChangeEntries,
  parseFileChangeStatus,
  parseFileChangeTurnId,
  parseItemId,
  parseItemRecord,
  parseThreadId,
  parseTurnId,
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

  it("marks non-text array as placeholder", () => {
    const item = { content: [{ kind: "image" }] };
    expect(parseUserMessageText(item)).toBe("[non-text input]");
  });

  it("reads direct text", () => {
    expect(parseAgentMessageText({ text: "ok" })).toBe("ok");
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
  });
});

describe("normalizeRootPath", () => {
  it("normalizes slashes and trims trailing", () => {
    expect(normalizeRootPath("C:\\repo///")).toBe("C:/repo");
  });
});
