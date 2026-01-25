import { toRelativePath } from "../../../shared/paths";
import { asRecord } from "../../../shared/records";
import type { FileChange } from "../../../types";

export type ApprovalOutcome = "approved" | "rejected" | "approved_failed";
export type ApprovalKind = "command" | "fileChange";

const formatCommand = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(" ");
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};

const formatParsedCmd = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  const display = record?.display;
  if (typeof display === "string") return display;
  const tokens =
    record?.tokens ??
    record?.argv ??
    record?.args ??
    record?.segments ??
    record?.parts;
  if (Array.isArray(tokens)) {
    return tokens.map((entry) => String(entry)).join(" ");
  }
  return null;
};

export const extractCommandTextFromParams = (
  params: unknown,
): string | null => {
  if (typeof params === "string") return params;
  const record = asRecord(params);
  if (!record) return null;
  return (
    formatParsedCmd(record.parsedCmd) ?? formatCommand(record.command) ?? null
  );
};

export const extractCwdFromParams = (params: unknown): string | null => {
  const record = asRecord(params);
  if (!record) return null;
  const cwd = record.cwd;
  return typeof cwd === "string" ? cwd : null;
};

export const extractCommandTextFromItem = (
  item: Record<string, unknown>,
): string | null => {
  const command =
    item.command ?? item.cmd ?? item.argv ?? item.args ?? item.tokens ?? null;
  return formatCommand(command);
};

export const extractCwdFromItem = (
  item: Record<string, unknown>,
): string | null => {
  const cwd = item.cwd;
  return typeof cwd === "string" ? cwd : null;
};

export const outcomeFromDecision = (
  decision: "accept" | "decline",
): ApprovalOutcome => (decision === "accept" ? "approved" : "rejected");

export const outcomeFromStatus = (
  status: string | null | undefined,
): ApprovalOutcome | null => {
  if (status === "completed") return "approved";
  if (status === "declined") return "rejected";
  if (status === "failed") return "approved_failed";
  return null;
};

const formatCodeBlock = (lang: string, value: string) =>
  `\`\`\`${lang}\n${value}\n\`\`\``;

export const buildApprovalMessageText = (input: {
  kind: ApprovalKind;
  outcome: ApprovalOutcome;
  commandText?: string | null;
  cwd?: string | null;
  fileChanges?: FileChange[] | null;
  repoRoot?: string | null;
}): string => {
  const kindLabel = input.kind === "command" ? "command" : "file change";
  const header =
    input.outcome === "approved"
      ? `Approved ${kindLabel}`
      : input.outcome === "rejected"
        ? `Rejected ${kindLabel}`
        : `Approved ${kindLabel} (failed)`;
  if (input.kind === "command") {
    const cwd = input.cwd ? toRelativePath(input.cwd, input.repoRoot) : "";
    const commandText = input.commandText ?? "command unavailable.";
    return [
      header,
      `cwd: ${cwd || "(unknown)"}`,
      formatCodeBlock("bash", commandText),
    ].join("\n");
  }
  const changes = input.fileChanges ?? [];
  if (changes.length === 0) {
    return [header, "diff unavailable."].join("\n");
  }
  const lines: string[] = [header];
  for (const change of changes) {
    const relativePath = toRelativePath(change.path ?? "", input.repoRoot);
    lines.push(relativePath || "(unknown file)");
    if (change.diff) {
      lines.push(formatCodeBlock("diff", change.diff));
    } else {
      lines.push("diff unavailable.");
    }
    lines.push("");
  }
  return lines.join("\n").trim();
};
