import { serve } from "@hono/node-server";
import { AppServerBridge } from "./appServerBridge.js";
import { AppServerManager } from "./appServerManager.js";
import { config } from "./config.js";
import { createApp } from "./createApp.js";
import { logger } from "./logger.js";
import { RepoRegistry } from "./repoRegistry.js";
import { ThreadListRefresher } from "./threadListRefresher.js";
import { TurnStateStore } from "./turnState.js";
import { WebSocketGateway } from "./websocketGateway.js";

const registry = new RepoRegistry(config.dataDir, logger);
const manager = new AppServerManager({
  registry,
  logger,
  clientInfo: config.clientInfo,
});
const gateway = new WebSocketGateway({ logger, registry, manager });
const turnState = new TurnStateStore();
const refresher = new ThreadListRefresher(manager, gateway, logger);
const bridge = new AppServerBridge({
  manager,
  gateway,
  turnState,
  refresher,
  logger,
});

const app = createApp({ registry, manager, logger, turnState, refresher });

const server = serve({
  fetch: app.fetch,
  port: config.port,
});

gateway.attach(server as unknown as import("node:http").Server);
bridge.init();

manager
  .initAll()
  .then(() => {
    logger.info({ component: "server", port: config.port }, "server_ready");
  })
  .catch((error) => {
    logger.error({ component: "server", error }, "init_failed");
  });

const shutdown = async () => {
  logger.info({ component: "server" }, "shutdown_start");
  await manager.stopAll();
  server.close();
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
