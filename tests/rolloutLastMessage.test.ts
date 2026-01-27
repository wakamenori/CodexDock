import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getLastMessageAt } from "../server/rolloutLastMessage";

const rolloutLine = (timestamp: string, payload: Record<string, unknown>) =>
  JSON.stringify({
    timestamp,
    type: "response_item",
    payload,
  });

const messagePayload = (role: string, content: Record<string, unknown>[]) => ({
  type: "message",
  role,
  content,
});

const inputText = (text: string) => ({ type: "input_text", text });
const outputText = (text: string) => ({ type: "output_text", text });

describe("getLastMessageAt", () => {
  it("ignores instruction and session prefix records", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "codexdock-"));
    const filePath = path.join(dir, "rollout.jsonl");

    const lines = [
      rolloutLine(
        "2025-01-01T00:00:00.000Z",
        messagePayload("user", [inputText("hello")]),
      ),
      rolloutLine(
        "2025-01-01T00:01:00.000Z",
        messagePayload("assistant", [outputText("hi")]),
      ),
      rolloutLine(
        "2025-01-01T00:02:00.000Z",
        messagePayload("user", [
          inputText(
            "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\ntext\n</INSTRUCTIONS>",
          ),
        ]),
      ),
      rolloutLine(
        "2025-01-01T00:03:00.000Z",
        messagePayload("user", [inputText("<environment_context>")]),
      ),
      rolloutLine(
        "2025-01-01T00:04:00.000Z",
        messagePayload("user", [
          inputText("<user_shell_command>echo hi</user_shell_command>"),
        ]),
      ),
    ];

    await writeFile(filePath, lines.join("\n"), "utf8");

    const lastMessageAt = await getLastMessageAt(filePath);

    expect(lastMessageAt).toBe("2025-01-01T00:01:00.000Z");
  });
});
