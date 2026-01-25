import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export type RepoPathPicker = () => Promise<string | null>;

type CommandOutcome = {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
};

type PickerResult =
  | { status: "picked"; path: string }
  | { status: "cancelled" }
  | { status: "unavailable" }
  | { status: "error"; error: Error };

const runCommand = (
  command: string,
  args: string[],
): Promise<CommandOutcome> =>
  new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      resolve({
        code: null,
        stdout,
        stderr,
        error: error as NodeJS.ErrnoException,
      });
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });

const normalizePickedPath = (value: string) => value.trim();

const isWindowsPath = (value: string) => /^[A-Za-z]:[\\/]/.test(value.trim());
const isUncPath = (value: string) => /^\\\\/.test(value.trim());

const isWslEnvironment = async () => {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    const version = await readFile("/proc/version", "utf8");
    return /microsoft/i.test(version);
  } catch {
    return false;
  }
};

const pickWithPowerShell = async (command: string) => {
  const result = await runPickerCommand(command, [
    "-NoProfile",
    "-Command",
    [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
      '$dialog.Description = "Select repository";',
      "$dialog.ShowNewFolderButton = $false;",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  $dialog.SelectedPath",
      "}",
    ].join(" "),
  ]);
  return unwrapPickerResult(result, command);
};

const convertWindowsPathForWsl = async (value: string) => {
  if (!isWindowsPath(value) && !isUncPath(value)) return value;
  const outcome = await runCommand("wslpath", ["-u", value]);
  if (outcome.error) {
    if (outcome.error.code === "ENOENT") {
      throw new Error("wslpath is not available");
    }
    throw outcome.error;
  }
  if (outcome.code !== 0) {
    const message = outcome.stderr.trim() || "wslpath failed";
    throw new Error(message);
  }
  return normalizePickedPath(outcome.stdout);
};

const runPickerCommand = async (
  command: string,
  args: string[],
): Promise<PickerResult> => {
  const outcome = await runCommand(command, args);
  if (outcome.error) {
    if (outcome.error.code === "ENOENT") {
      return { status: "unavailable" };
    }
    return { status: "error", error: outcome.error };
  }
  const output = outcome.stdout.trim();
  if (outcome.code === 0) {
    if (!output) return { status: "cancelled" };
    return { status: "picked", path: normalizePickedPath(output) };
  }
  if (outcome.code === 1 && !output) return { status: "cancelled" };
  const message = outcome.stderr.trim() || `Command failed: ${command}`;
  return { status: "error", error: new Error(message) };
};

const unwrapPickerResult = (
  result: PickerResult,
  command: string,
): string | null => {
  switch (result.status) {
    case "picked":
      return result.path;
    case "cancelled":
      return null;
    case "unavailable":
      throw new Error(`${command} is not available`);
    case "error":
      throw result.error;
    default:
      return null;
  }
};

export const pickRepoPath: RepoPathPicker = async () => {
  if (await isWslEnvironment()) {
    const windowsPath = await pickWithPowerShell("powershell.exe");
    if (!windowsPath) return null;
    return convertWindowsPathForWsl(windowsPath);
  }
  switch (process.platform) {
    case "darwin": {
      const result = await runPickerCommand("osascript", [
        "-e",
        'POSIX path of (choose folder with prompt "Select repository")',
      ]);
      return unwrapPickerResult(result, "osascript");
    }
    case "win32": {
      return pickWithPowerShell("powershell");
    }
    case "linux": {
      const zenityResult = await runPickerCommand("zenity", [
        "--file-selection",
        "--directory",
        "--title=Select repository",
      ]);
      if (zenityResult.status === "unavailable") {
        const kdialogResult = await runPickerCommand("kdialog", [
          "--getexistingdirectory",
          ".",
          "--title",
          "Select repository",
        ]);
        return unwrapPickerResult(kdialogResult, "kdialog");
      }
      return unwrapPickerResult(zenityResult, "zenity");
    }
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
};
