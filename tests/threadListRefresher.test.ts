import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { AppServerManager } from "../server/appServerManager";
import type { AppServerSessionLike } from "../server/appServerSession";
import { ThreadListRefresher } from "../server/threadListRefresher";

type GatewayLike = {
  broadcastToRepo: (repoId: string, message: unknown) => void;
};

describe("ThreadListRefresher", () => {
  const logger = pino({ level: "silent" });

  it("normalizes thread lists and broadcasts updates", async () => {
    const session = {
      status: "connected",
      request: vi.fn().mockResolvedValue({
        threads: [
          { id: 12, preview: "hello", updatedAt: 1_700_000_000 },
          { threadId: "thr_2", preview: "world", createdAt: 1_700_000_000_000 },
          { preview: "skip" },
        ],
      }),
    } as unknown as AppServerSessionLike;

    const manager = {
      getSession: vi.fn().mockReturnValue(session),
    } as unknown as AppServerManager;

    const gateway: GatewayLike = { broadcastToRepo: vi.fn() };

    const refresher = new ThreadListRefresher(
      manager,
      gateway as unknown as GatewayLike,
      logger,
    );

    await refresher.refresh("repo_1");

    const expectedThreads = [
      {
        threadId: "12",
        preview: "hello",
        updatedAt: new Date(1_700_000_000 * 1000).toISOString(),
      },
      {
        threadId: "thr_2",
        preview: "world",
        updatedAt: new Date(1_700_000_000_000).toISOString(),
      },
    ];

    expect(gateway.broadcastToRepo).toHaveBeenCalledWith("repo_1", {
      type: "thread_list_updated",
      payload: { repoId: "repo_1", threads: expectedThreads },
    });
  });

  it("skips refresh when session is missing or not connected", async () => {
    const manager = {
      getSession: vi.fn().mockReturnValue(undefined),
    } as unknown as AppServerManager;

    const gateway: GatewayLike = { broadcastToRepo: vi.fn() };

    const refresher = new ThreadListRefresher(
      manager,
      gateway as unknown as GatewayLike,
      logger,
    );

    await refresher.refresh("repo_1");

    expect(gateway.broadcastToRepo).not.toHaveBeenCalled();
  });

  it("coalesces multiple schedule calls", async () => {
    vi.useFakeTimers();

    const manager = {
      getSession: vi.fn(),
    } as unknown as AppServerManager;
    const gateway: GatewayLike = { broadcastToRepo: vi.fn() };
    const refresher = new ThreadListRefresher(
      manager,
      gateway as unknown as GatewayLike,
      logger,
    );

    const refreshSpy = vi
      .spyOn(refresher, "refresh")
      .mockResolvedValue(undefined);

    refresher.schedule("repo_1", 50);
    refresher.schedule("repo_1", 50);

    await vi.runAllTimersAsync();

    expect(refreshSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
