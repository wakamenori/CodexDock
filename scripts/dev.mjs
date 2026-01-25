import { spawn } from "node:child_process";
import process from "node:process";
import getPort from "get-port";

const SERVER_BASE_PORT = 8787;
const WEB_BASE_PORT = 5173;
const PORT_ATTEMPTS = 20;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

const parseEnvPort = (value) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    throw new Error(
      `Invalid port: "${value}". Set a number between ${MIN_PORT} and ${MAX_PORT}.`,
    );
  }
  return parsed;
};

const buildCandidates = (basePort, attempts) => {
  const lastPort = basePort + attempts - 1;
  if (lastPort > MAX_PORT) {
    throw new Error(`Port range overflow: ${basePort}-${lastPort}`);
  }
  return Array.from({ length: attempts }, (_, index) => basePort + index);
};

const selectPort = async (explicit, basePort) => {
  const parsed = parseEnvPort(explicit);
  if (parsed !== undefined) return parsed;
  const candidates = buildCandidates(basePort, PORT_ATTEMPTS);
  const selected = await getPort({ port: candidates });
  if (!candidates.includes(selected)) {
    throw new Error(
      `No available port found in range ${candidates[0]}-${candidates[candidates.length - 1]}.`,
    );
  }
  return selected;
};

const serverPort = await selectPort(process.env.PORT, SERVER_BASE_PORT);
const webPort = await selectPort(process.env.VITE_PORT, WEB_BASE_PORT);
const serverUrl =
  process.env.VITE_SERVER_URL ?? `http://localhost:${serverPort}`;

console.log(`[dev] server: ${serverUrl}`);
console.log(`[dev] web: http://localhost:${webPort}`);

const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const sharedEnv = { ...process.env, NODE_ENV: "development" };
const server = spawn(pnpmCmd, ["dev:server"], {
  stdio: "inherit",
  env: {
    ...sharedEnv,
    PORT: String(serverPort),
  },
});
const web = spawn(pnpmCmd, ["dev:web"], {
  stdio: "inherit",
  env: {
    ...sharedEnv,
    VITE_SERVER_URL: serverUrl,
    VITE_PORT: String(webPort),
  },
});

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.kill(signal);
  web.kill(signal);
};

server.on("exit", (code, signal) => {
  shutdown(signal ?? "SIGTERM");
  process.exit(code ?? 0);
});
web.on("exit", (code, signal) => {
  shutdown(signal ?? "SIGTERM");
  process.exit(code ?? 0);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
