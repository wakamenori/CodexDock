import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";

import { getString, isRecord } from "./guards.js";

const USER_INSTRUCTIONS_PREFIX = "# AGENTS.md instructions for ";
const USER_INSTRUCTIONS_OPEN_TAG_LEGACY = "<user_instructions>";
const SKILL_INSTRUCTIONS_PREFIX = "<skill";
const ENVIRONMENT_CONTEXT_OPEN_TAG = "<environment_context>";
const TURN_ABORTED_OPEN_TAG = "<turn_aborted>";
const USER_SHELL_COMMAND_OPEN = "<user_shell_command>";

type CacheEntry = {
  mtimeMs: number;
  lastMessageAt?: string;
};

const lastMessageCache = new Map<string, CacheEntry>();

const isSessionPrefixText = (text: string) => {
  const trimmed = text.trimStart().toLowerCase();
  return (
    trimmed.startsWith(ENVIRONMENT_CONTEXT_OPEN_TAG) ||
    trimmed.startsWith(TURN_ABORTED_OPEN_TAG)
  );
};

const isUserShellCommandText = (text: string) =>
  text.trimStart().toLowerCase().startsWith(USER_SHELL_COMMAND_OPEN);

const isUserInstructionsContent = (content: unknown[]) => {
  if (content.length !== 1) return false;
  const item = content[0];
  if (!isRecord(item)) return false;
  if (getString(item, "type") !== "input_text") return false;
  const text = getString(item, "text");
  if (!text) return false;
  return (
    text.startsWith(USER_INSTRUCTIONS_PREFIX) ||
    text.startsWith(USER_INSTRUCTIONS_OPEN_TAG_LEGACY)
  );
};

const isSkillInstructionsContent = (content: unknown[]) => {
  if (content.length !== 1) return false;
  const item = content[0];
  if (!isRecord(item)) return false;
  if (getString(item, "type") !== "input_text") return false;
  const text = getString(item, "text");
  return Boolean(text?.startsWith(SKILL_INSTRUCTIONS_PREFIX));
};

const shouldIgnoreUserMessage = (content: unknown[]) => {
  if (
    isUserInstructionsContent(content) ||
    isSkillInstructionsContent(content)
  ) {
    return true;
  }
  for (const entry of content) {
    if (!isRecord(entry)) continue;
    const entryType = getString(entry, "type");
    if (entryType === "input_text") {
      const text = getString(entry, "text");
      if (!text) continue;
      if (isSessionPrefixText(text) || isUserShellCommandText(text)) {
        return true;
      }
    }
    if (entryType === "output_text") {
      const text = getString(entry, "text");
      if (!text) continue;
      if (isSessionPrefixText(text)) {
        return true;
      }
    }
  }
  return false;
};

const extractMessageLine = (
  line: unknown,
): {
  timestamp: string;
  role: "user" | "assistant";
  content: unknown[];
} | null => {
  if (!isRecord(line)) return null;
  const timestamp = getString(line, "timestamp");
  if (!timestamp) return null;
  if (getString(line, "type") !== "response_item") return null;
  const payload = line.payload;
  if (!isRecord(payload)) return null;
  if (getString(payload, "type") !== "message") return null;
  const role = getString(payload, "role");
  if (role !== "user" && role !== "assistant") return null;
  const content = payload.content;
  if (!Array.isArray(content)) return null;
  return { timestamp, role, content };
};

const scanRolloutForLastMessageAt = async (
  path: string,
): Promise<string | undefined> => {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lastMessageAt: string | undefined;
  try {
    for await (const rawLine of rl) {
      const lineText = rawLine.trim();
      if (!lineText) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(lineText);
      } catch {
        continue;
      }
      const entry = extractMessageLine(parsed);
      if (!entry) continue;
      if (entry.role === "user" && shouldIgnoreUserMessage(entry.content)) {
        continue;
      }
      lastMessageAt = entry.timestamp;
    }
  } finally {
    rl.close();
  }
  return lastMessageAt;
};

export const getLastMessageAt = async (
  path?: string | null,
): Promise<string | undefined> => {
  if (!path) return undefined;
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(path);
  } catch {
    return undefined;
  }
  const cached = lastMessageCache.get(path);
  if (cached && cached.mtimeMs === stats.mtimeMs) {
    return cached.lastMessageAt;
  }
  const lastMessageAt = await scanRolloutForLastMessageAt(path);
  lastMessageCache.set(path, { mtimeMs: stats.mtimeMs, lastMessageAt });
  return lastMessageAt;
};
