import { spawn } from "node:child_process";
import type { Logger } from "pino";

type NotifyOptions = {
  title: string;
  message: string;
  logger: Logger;
};

type CommandOutcome = {
  code: number | null;
  stderr: string;
  error?: NodeJS.ErrnoException;
};

const runCommand = (command: string, args: string[]): Promise<CommandOutcome> =>
  new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      resolve({
        code: null,
        stderr,
        error: error as NodeJS.ErrnoException,
      });
    });
    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });

const escapeAppleScriptString = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const sanitizeMessage = (value: string) => value.replace(/\s+/g, " ").trim();

export const notifyOs = async ({ title, message, logger }: NotifyOptions) => {
  if (process.platform !== "darwin") return;
  const safeTitle = escapeAppleScriptString(sanitizeMessage(title));
  const safeMessage = escapeAppleScriptString(sanitizeMessage(message));
  if (!safeTitle || !safeMessage) return;
  const script = `display notification "${safeMessage}" with title "${safeTitle}"`;
  const outcome = await runCommand("osascript", ["-e", script]);
  if (outcome.error) {
    logger.warn(
      { component: "os_notification", error: outcome.error },
      "notify_failed",
    );
    return;
  }
  if (outcome.code !== 0) {
    logger.warn(
      {
        component: "os_notification",
        code: outcome.code,
        stderr: outcome.stderr.trim(),
      },
      "notify_failed",
    );
  }
};
