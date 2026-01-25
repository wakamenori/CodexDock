// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../../api";
import type { Repo, ThreadSummary } from "../../../types";
import { useConversationState } from "./useConversationState";

vi.mock("../../../api", () => {
  class ApiError extends Error {
    status: number;
    details?: unknown;

    constructor(message: string, status: number, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
  }

  return {
    ApiError,
    api: {
      listRepos: vi.fn(),
      createRepo: vi.fn(),
      pickRepoPath: vi.fn(),
      updateRepo: vi.fn(),
      deleteRepo: vi.fn(),
      startSession: vi.fn(),
      stopSession: vi.fn(),
      listThreads: vi.fn(),
      createThread: vi.fn(),
      resumeThread: vi.fn(),
      startTurn: vi.fn(),
      cancelTurn: vi.fn(),
    },
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  url: string;
  private listeners: Record<string, Array<(event?: unknown) => void>> = {};
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event?: unknown) => void) {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  }

  emitMessage(data: unknown) {
    const listeners = this.listeners.message ?? [];
    const event = { data: JSON.stringify(data) };
    for (const listener of listeners) {
      listener(event);
    }
  }
}

const mockedApi = vi.mocked(api);

const setupHook = async () => {
  const repo: Repo = {
    repoId: "repo-1",
    name: "repo",
    path: "/repo",
    lastOpenedThreadId: "thread-1",
  };
  const threads: ThreadSummary[] = [{ threadId: "thread-1", cwd: "/repo" }];

  mockedApi.listRepos.mockResolvedValue([repo]);
  mockedApi.startSession.mockResolvedValue(undefined);
  mockedApi.listThreads.mockResolvedValue(threads);
  mockedApi.resumeThread.mockResolvedValue({});
  mockedApi.updateRepo.mockResolvedValue(repo);

  const hook = renderHook(() => useConversationState());
  await waitFor(() => {
    expect(hook.result.current.selectedThreadId).toBe("thread-1");
  });
  return hook;
};

describe("useConversationState handleSend", () => {
  beforeEach(() => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clears input immediately after send", async () => {
    const hook = await setupHook();
    await act(async () => {
      hook.result.current.setInputText(" hello ");
    });

    await waitFor(() => {
      expect(hook.result.current.inputText).toBe(" hello ");
    });

    let resolveStart!: (value: { turnId: string; status: string }) => void;
    const pending = new Promise<{ turnId: string; status: string }>(
      (resolve) => {
        resolveStart = resolve;
      },
    );
    mockedApi.startTurn.mockReturnValue(pending);

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = hook.result.current.handleSend();
    });

    await waitFor(() => {
      expect(hook.result.current.inputText).toBe("");
    });

    await act(async () => {
      resolveStart({ turnId: "turn-1", status: "running" });
      await sendPromise;
    });
  });

  it("restores input when send fails", async () => {
    const hook = await setupHook();
    await act(async () => {
      hook.result.current.setInputText(" hello ");
    });

    mockedApi.startTurn.mockRejectedValue(new Error("boom"));

    await act(async () => {
      await hook.result.current.handleSend();
    });

    expect(hook.result.current.inputText).toBe(" hello ");
  });
});

describe("useConversationState handleCreateThread", () => {
  beforeEach(() => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps optimistic thread when listThreads omits it", async () => {
    const hook = await setupHook();
    mockedApi.createThread.mockResolvedValue("thread-2");
    mockedApi.listThreads.mockResolvedValue([
      { threadId: "thread-1", cwd: "/repo" },
    ]);

    await act(async () => {
      await hook.result.current.handleCreateThread();
    });

    await waitFor(() => {
      const threadIds =
        hook.result.current.repoGroups[0]?.threads.map(
          (thread) => thread.threadId,
        ) ?? [];
      expect(threadIds).toContain("thread-2");
    });
  });

  it("keeps optimistic thread when thread_list_updated omits it", async () => {
    const hook = await setupHook();
    mockedApi.createThread.mockResolvedValue("thread-2");
    mockedApi.listThreads.mockResolvedValue([
      { threadId: "thread-1", cwd: "/repo" },
    ]);

    await act(async () => {
      await hook.result.current.handleCreateThread();
    });

    const ws = FakeWebSocket.instances[0];
    if (!ws) {
      throw new Error("WebSocket instance not found");
    }

    act(() => {
      ws.emitMessage({
        type: "thread_list_updated",
        payload: {
          repoId: "repo-1",
          threads: [{ threadId: "thread-1", cwd: "/repo" }],
        },
      });
    });

    await waitFor(() => {
      const threadIds =
        hook.result.current.repoGroups[0]?.threads.map(
          (thread) => thread.threadId,
        ) ?? [];
      expect(threadIds).toContain("thread-2");
    });
  });
});
