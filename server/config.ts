import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import getPort from "get-port";

const DEFAULT_PORT_BASE = 8787;
const DEFAULT_PORT_ATTEMPTS = 20;
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const DEFAULT_HOST = "127.0.0.1";
const WSL_HOST = "0.0.0.0";

export type ResolvedConfig = {
  port: number;
  host: string;
  dataDir: string;
  repoFileName: string;
  defaultModel: string | null;
  staticRoot?: string;
  clientInfo: {
    name: string;
    version: string;
  };
};

export const parsePortEnv = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    throw new Error(
      `Invalid PORT: "${value}". Set a number between ${MIN_PORT} and ${MAX_PORT}, or unset it to enable automatic port selection.`,
    );
  }
  return parsed;
};

export const buildPortCandidates = (
  basePort = DEFAULT_PORT_BASE,
  attempts = DEFAULT_PORT_ATTEMPTS,
): number[] => {
  if (!Number.isInteger(basePort) || basePort < MIN_PORT) {
    throw new Error(`Invalid base port: ${basePort}`);
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`Invalid port attempts: ${attempts}`);
  }
  const lastPort = basePort + attempts - 1;
  if (lastPort > MAX_PORT) {
    throw new Error(
      `Port range overflow: ${basePort}-${lastPort} exceeds ${MAX_PORT}`,
    );
  }
  return Array.from({ length: attempts }, (_, index) => basePort + index);
};

export const resolveDataDir = ({
  env,
  cwd,
}: {
  env: NodeJS.ProcessEnv;
  cwd: string;
}): string => {
  if (env.CODEXDOCK_DATA_DIR) {
    return resolve(cwd, env.CODEXDOCK_DATA_DIR);
  }
  return resolve(cwd, "data");
};

export const resolveRepoFileName = ({
  env,
}: {
  env: NodeJS.ProcessEnv;
}): string => {
  const environment = env.NODE_ENV ?? "production";
  const isDev = environment === "development" || environment === "test";
  return isDev ? "dev.json" : "prd.json";
};

export const resolveDefaultModel = ({
  env,
}: {
  env: NodeJS.ProcessEnv;
}): string | null => {
  const raw = env.CODEXDOCK_DEFAULT_MODEL;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const detectWsl = async (): Promise<boolean> => {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    const version = await readFile("/proc/version", "utf8");
    return /microsoft/i.test(version);
  } catch {
    return false;
  }
};

export const resolveHost = async ({
  env,
  isWsl = detectWsl,
}: {
  env: NodeJS.ProcessEnv;
  isWsl?: () => Promise<boolean>;
}): Promise<string> => {
  const host = env.HOST ?? env.CODEXDOCK_HOST;
  if (host) return host;
  return (await isWsl()) ? WSL_HOST : DEFAULT_HOST;
};

export const resolvePort = async ({
  env,
  basePort = DEFAULT_PORT_BASE,
  attempts = DEFAULT_PORT_ATTEMPTS,
  getPort: getPortFn = getPort,
}: {
  env: NodeJS.ProcessEnv;
  basePort?: number;
  attempts?: number;
  getPort?: (options: { port: number[] }) => Promise<number>;
}): Promise<number> => {
  const explicit = parsePortEnv(env.PORT);
  if (explicit !== undefined) return explicit;
  const candidates = buildPortCandidates(basePort, attempts);
  const selected = await getPortFn({ port: candidates });
  if (!candidates.includes(selected)) {
    throw new Error(
      `No available port found in range ${candidates[0]}-${candidates[candidates.length - 1]}.`,
    );
  }
  return selected;
};

export const resolveConfig = async ({
  env = process.env,
  cwd = process.cwd(),
  basePort = DEFAULT_PORT_BASE,
  attempts = DEFAULT_PORT_ATTEMPTS,
  getPort: getPortFn,
}: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  basePort?: number;
  attempts?: number;
  getPort?: (options: { port: number[] }) => Promise<number>;
} = {}): Promise<ResolvedConfig> => {
  const host = await resolveHost({ env });
  const port = await resolvePort({
    env,
    basePort,
    attempts,
    getPort: getPortFn,
  });
  const dataDir = resolveDataDir({ env, cwd });
  const repoFileName = resolveRepoFileName({ env });
  const defaultModel = resolveDefaultModel({ env });
  const staticRoot =
    env.NODE_ENV === "production" ? resolve(cwd, "dist") : undefined;
  return {
    host,
    port,
    dataDir,
    repoFileName,
    defaultModel,
    staticRoot,
    clientInfo: {
      name: "CodexDock",
      version: "0.1.0",
    },
  };
};
