import path from "node:path";
import { serve } from "@hono/node-server";
import { AppServerBridge } from "./appServerBridge.js";
import { AppServerManager } from "./appServerManager.js";
import { resolveConfig } from "./config.js";
import { createApp } from "./createApp.js";
import { logger } from "./logger.js";
import { RepoRegistry } from "./repoRegistry.js";
import { ThreadListRefresher } from "./threadListRefresher.js";
import { TurnStateStore } from "./turnState.js";
import { WebSocketGateway } from "./websocketGateway.js";

const main = async () => {
  const config = await resolveConfig();
  const registry = new RepoRegistry(config.dataDir, logger, {
    fileName: config.repoFileName,
  });
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

  const app = createApp({
    registry,
    manager,
    logger,
    turnState,
    refresher,
    staticRoot: config.staticRoot,
    uploadDir: path.join(config.dataDir, "uploads"),
    defaultModel: config.defaultModel,
  });

  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  });
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  gateway.attach(server as unknown as import("node:http").Server);
  bridge.init();

  manager
    .initAll()
    .then(() => {
      logger.info(
        { component: "server", host: config.host, port: config.port },
        "server_ready",
      );
      const displayHost = config.host === "0.0.0.0" ? "localhost" : config.host;
      console.log(`Server ready: http://${displayHost}:${config.port}`);
    })
    .catch((error) => {
      logger.error({ component: "server", error }, "init_failed");
    });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ component: "server", signal }, "shutdown_start");
    try {
      await manager.stopAll();
    } catch (error) {
      logger.error({ component: "server", error }, "shutdown_stop_failed");
    }
    for (const socket of sockets) {
      socket.destroy();
    }
    const closePromise = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, 2000);
    });
    await Promise.race([closePromise, timeoutPromise]);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
};

main().catch((error) => {
  logger.error({ component: "server", error }, "startup_failed");
  process.exit(1);
});
