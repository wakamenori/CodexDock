import { resolve } from "node:path";

const dataDir = process.env.CODEXDOCK_DATA_DIR
  ? resolve(process.env.CODEXDOCK_DATA_DIR)
  : resolve(process.cwd(), "data");

const port = Number(process.env.PORT ?? 8787);

export const config = {
  port,
  dataDir,
  clientInfo: {
    name: "CodexDock",
    version: "0.1.0",
  },
};
