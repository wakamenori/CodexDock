// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../../api";
import type { PermissionMode, Repo, ThreadSummary } from "../../../types";
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
      listModels: vi.fn(),
      getModelSettings: vi.fn(),
      getPermissionModeSettings: vi.fn(),
      updateModelSetting: vi.fn(),
      createThread: vi.fn(),
      resumeThread: vi.fn(),
      startTurn: vi.fn(),
      startReview: vi.fn(),
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

  emitOpen() {
    const listeners = this.listeners.open ?? [];
    for (const listener of listeners) {
      listener();
    }
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

const setupHook = async (
  threadsOverride?: ThreadSummary[],
  options?: {
    models?: string[];
    settings?: { storedModel: string | null; defaultModel: string | null };
    permissionMode?: PermissionMode;
  },
) => {
  const repo: Repo = {
    repoId: "repo-1",
    name: "repo",
    path: "/repo",
    lastOpenedThreadId: "thread-1",
  };
  const threads: ThreadSummary[] = threadsOverride ?? [
    { threadId: "thread-1", cwd: "/repo" },
  ];

  const models = options?.models ?? ["gpt-5.2-codex"];
  const settings = options?.settings ?? {
    storedModel: "gpt-5.2-codex",
    defaultModel: "gpt-5.2-codex",
  };
  const permissionMode = options?.permissionMode ?? "ReadOnly";

  mockedApi.listRepos.mockResolvedValue([repo]);
  mockedApi.startSession.mockResolvedValue(undefined);
  mockedApi.listThreads.mockResolvedValue(threads);
  mockedApi.listModels.mockResolvedValue(models);
  mockedApi.getModelSettings.mockResolvedValue(settings);
  mockedApi.getPermissionModeSettings.mockResolvedValue({
    defaultMode: permissionMode,
  });
  mockedApi.updateModelSetting.mockResolvedValue(settings.storedModel);
  mockedApi.resumeThread.mockResolvedValue({});
  mockedApi.updateRepo.mockResolvedValue(repo);

  const hook = renderHook(() => useConversationState());
  await waitFor(() => {
    expect(hook.result.current.selectedThreadId).toBe("thread-1");
  });
  return hook;
};

describe("useConversationState websocket subscriptions", () => {
  beforeEach(() => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes to all repos when websocket opens", async () => {
    const repos: Repo[] = [
      {
        repoId: "repo-1",
        name: "repo-1",
        path: "/repo-1",
        lastOpenedThreadId: "thread-1",
      },
      {
        repoId: "repo-2",
        name: "repo-2",
        path: "/repo-2",
        lastOpenedThreadId: "thread-2",
      },
    ];
    const threads1: ThreadSummary[] = [
      { threadId: "thread-1", cwd: "/repo-1" },
    ];
    const threads2: ThreadSummary[] = [
      { threadId: "thread-2", cwd: "/repo-2" },
    ];

    mockedApi.listRepos.mockResolvedValue(repos);
    mockedApi.startSession.mockResolvedValue(undefined);
    mockedApi.listThreads.mockImplementation(async (repoId) => {
      return repoId === "repo-1" ? threads1 : threads2;
    });
    mockedApi.listModels.mockResolvedValue(["gpt-5.2-codex"]);
    mockedApi.getModelSettings.mockResolvedValue({
      storedModel: "gpt-5.2-codex",
      defaultModel: "gpt-5.2-codex",
    });
    mockedApi.getPermissionModeSettings.mockResolvedValue({
      defaultMode: "ReadOnly",
    });
    mockedApi.resumeThread.mockResolvedValue({});
    mockedApi.updateRepo.mockResolvedValue(repos[0]);

    const hook = renderHook(() => useConversationState());
    await waitFor(() => {
      expect(hook.result.current.selectedThreadId).toBe("thread-1");
    });

    const ws = FakeWebSocket.instances[0];
    act(() => {
      ws.emitOpen();
    });

    await waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(2);
    });

    const sent = ws.send.mock.calls.map(([payload]) =>
      JSON.parse(String(payload)),
    );
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "subscribe",
          payload: { repoId: "repo-1" },
        }),
        expect.objectContaining({
          type: "subscribe",
          payload: { repoId: "repo-2" },
        }),
      ]),
    );
  });
});

describe("useConversationState model selection", () => {
  beforeEach(() => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses stored model when available", async () => {
    const hook = await setupHook(undefined, {
      models: ["gpt-5.2-codex"],
      settings: { storedModel: "gpt-5.2-codex", defaultModel: null },
    });

    await waitFor(() => {
      expect(hook.result.current.selectedModel).toBe("gpt-5.2-codex");
    });
  });

  it("falls back to default model when stored model is unavailable", async () => {
    const hook = await setupHook(undefined, {
      models: ["gpt-5.1-codex"],
      settings: {
        storedModel: "gpt-5.2-codex",
        defaultModel: "gpt-5.1-codex",
      },
    });

    await waitFor(() => {
      expect(hook.result.current.selectedModel).toBe("gpt-5.1-codex");
    });
  });

  it("falls back to the first model when stored and default are unavailable", async () => {
    const hook = await setupHook(undefined, {
      models: ["gpt-4o-mini", "gpt-4o"],
      settings: { storedModel: "gpt-5.2-codex", defaultModel: "gpt-5.1" },
    });

    await waitFor(() => {
      expect(hook.result.current.selectedModel).toBe("gpt-4o-mini");
    });
  });

  it("persists model changes immediately", async () => {
    const hook = await setupHook();
    mockedApi.updateModelSetting.mockResolvedValue("gpt-4o-mini");

    await act(async () => {
      hook.result.current.handleModelChange("gpt-4o-mini");
    });

    await waitFor(() => {
      expect(mockedApi.updateModelSetting).toHaveBeenCalledWith("gpt-4o-mini");
    });
  });
});

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

  it("optimistically updates preview for new thread", async () => {
    const hook = await setupHook([
      { threadId: "thread-1", cwd: "/repo", preview: "New thread" },
    ]);
    await act(async () => {
      hook.result.current.setInputText("Hello world");
    });

    mockedApi.startTurn.mockResolvedValue({
      turnId: "turn-1",
      status: "running",
    });

    await act(async () => {
      await hook.result.current.handleSend();
    });

    const threads = hook.result.current.repoGroups[0]?.threads ?? [];
    const preview = threads.find(
      (thread) => thread.threadId === "thread-1",
    )?.preview;
    expect(preview).toBe("Hello world");
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

  it("rolls back preview when send fails for new thread", async () => {
    const hook = await setupHook([
      { threadId: "thread-1", cwd: "/repo", preview: "New thread" },
    ]);
    await act(async () => {
      hook.result.current.setInputText("Hello world");
    });

    mockedApi.startTurn.mockRejectedValue(new Error("boom"));

    await act(async () => {
      await hook.result.current.handleSend();
    });

    const threads = hook.result.current.repoGroups[0]?.threads ?? [];
    const preview = threads.find(
      (thread) => thread.threadId === "thread-1",
    )?.preview;
    expect(preview).toBe("New thread");
  });

  it("blocks send and shows toast when no models are available", async () => {
    const hook = await setupHook(undefined, { models: [] });
    await act(async () => {
      hook.result.current.setInputText(" hello ");
    });

    await act(async () => {
      await hook.result.current.handleSend();
    });

    expect(mockedApi.startTurn).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("includes FullAccess permission options in startTurn", async () => {
    const hook = await setupHook(undefined, { permissionMode: "FullAccess" });
    mockedApi.startTurn.mockResolvedValue({
      turnId: "turn-1",
      status: "running",
    });

    await waitFor(() => {
      expect(hook.result.current.permissionMode).toBe("FullAccess");
    });

    await act(async () => {
      hook.result.current.setInputText("hello");
    });

    await act(async () => {
      await hook.result.current.handleSend();
    });

    expect(mockedApi.startTurn).toHaveBeenCalledWith(
      "repo-1",
      "thread-1",
      [{ type: "text", text: "hello" }],
      expect.objectContaining({
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
      }),
    );
  });

  it("auto-approves command execution items in FullAccess", async () => {
    const hook = await setupHook(undefined, { permissionMode: "FullAccess" });
    const ws = FakeWebSocket.instances[0];
    if (!ws) {
      throw new Error("WebSocket instance not found");
    }
    await waitFor(() => {
      expect(hook.result.current.permissionMode).toBe("FullAccess");
    });

    act(() => {
      ws.emitMessage({
        type: "app_server_notification",
        payload: {
          repoId: "repo-1",
          message: {
            method: "item/completed",
            params: {
              threadId: "thread-1",
              item: {
                id: "cmd-1",
                type: "commandExecution",
                command: ["ls"],
                cwd: "/repo",
                status: "completed",
              },
            },
          },
        },
      });
    });

    await waitFor(() => {
      const approvals = hook.result.current.messages.filter(
        (message) => message.approval?.kind === "command",
      );
      expect(approvals).toHaveLength(1);
      expect(approvals[0].approval?.outcome).toBe("approved");
    });
  });

  it("deduplicates auto-approved items", async () => {
    const hook = await setupHook(undefined, { permissionMode: "FullAccess" });
    const ws = FakeWebSocket.instances[0];
    if (!ws) {
      throw new Error("WebSocket instance not found");
    }
    await waitFor(() => {
      expect(hook.result.current.permissionMode).toBe("FullAccess");
    });

    const message = {
      type: "app_server_notification",
      payload: {
        repoId: "repo-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: {
              id: "cmd-2",
              type: "commandExecution",
              command: ["pwd"],
              cwd: "/repo",
              status: "completed",
            },
          },
        },
      },
    };

    act(() => {
      ws.emitMessage(message);
      ws.emitMessage(message);
    });

    await waitFor(() => {
      const approvals = hook.result.current.messages.filter(
        (item) => item.approval?.kind === "command",
      );
      expect(approvals).toHaveLength(1);
    });
  });

  it("includes OnRequest permission options with repo path", async () => {
    const hook = await setupHook(undefined, { permissionMode: "OnRequest" });
    mockedApi.startTurn.mockResolvedValue({
      turnId: "turn-1",
      status: "running",
    });

    await waitFor(() => {
      expect(hook.result.current.permissionMode).toBe("OnRequest");
    });

    await act(async () => {
      hook.result.current.setInputText("hello");
    });

    await act(async () => {
      await hook.result.current.handleSend();
    });

    expect(mockedApi.startTurn).toHaveBeenCalledWith(
      "repo-1",
      "thread-1",
      [{ type: "text", text: "hello" }],
      expect.objectContaining({
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: ["/repo"],
          networkAccess: true,
        },
      }),
    );
  });
});

describe("useConversationState handleReviewStart", () => {
  beforeEach(() => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts review with uncommitted changes by default", async () => {
    const hook = await setupHook();
    mockedApi.startReview.mockResolvedValue({
      turnId: "turn-1",
      status: "running",
      reviewThreadId: "thread-1",
    });

    await act(async () => {
      await hook.result.current.handleReviewStart();
    });

    expect(mockedApi.startReview).toHaveBeenCalledWith(
      "repo-1",
      "thread-1",
      { type: "uncommittedChanges" },
      "inline",
    );
    await waitFor(() => {
      expect(hook.result.current.activeTurnId).toBe("turn-1");
    });
  });

  it("shows error when review target is missing", async () => {
    const hook = await setupHook();
    act(() => {
      hook.result.current.setReviewTargetType("baseBranch");
    });

    await act(async () => {
      await hook.result.current.handleReviewStart();
    });

    expect(mockedApi.startReview).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});

describe("useConversationState handleStop", () => {
  beforeEach(() => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("cancels the active turn", async () => {
    const hook = await setupHook();
    mockedApi.startTurn.mockResolvedValue({
      turnId: "turn-1",
      status: "running",
    });

    await act(async () => {
      hook.result.current.setInputText("hello");
    });

    await act(async () => {
      await hook.result.current.handleSend();
    });

    await waitFor(() => {
      expect(hook.result.current.activeTurnId).toBe("turn-1");
    });

    await act(async () => {
      await hook.result.current.handleStop();
    });

    expect(mockedApi.cancelTurn).toHaveBeenCalledWith(
      "repo-1",
      "turn-1",
      "thread-1",
    );
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

  it("loads models on demand for an unselected repo", async () => {
    const repos: Repo[] = [
      {
        repoId: "repo-1",
        name: "repo-1",
        path: "/repo-1",
        lastOpenedThreadId: "thread-1",
      },
      {
        repoId: "repo-2",
        name: "repo-2",
        path: "/repo-2",
        lastOpenedThreadId: "thread-2",
      },
    ];
    const threads1: ThreadSummary[] = [
      { threadId: "thread-1", cwd: "/repo-1" },
    ];
    const threads2: ThreadSummary[] = [
      { threadId: "thread-2", cwd: "/repo-2" },
    ];

    mockedApi.listRepos.mockResolvedValue(repos);
    mockedApi.startSession.mockResolvedValue(undefined);
    mockedApi.listThreads.mockImplementation(async (repoId) => {
      return repoId === "repo-1" ? threads1 : threads2;
    });
    mockedApi.listModels.mockImplementation(async (repoId) => {
      return repoId === "repo-1" ? ["gpt-5.2-codex"] : ["gpt-4o-mini"];
    });
    mockedApi.getModelSettings.mockResolvedValue({
      storedModel: null,
      defaultModel: null,
    });
    mockedApi.getPermissionModeSettings.mockResolvedValue({
      defaultMode: "ReadOnly",
    });
    mockedApi.resumeThread.mockResolvedValue({});
    mockedApi.updateRepo.mockResolvedValue(repos[0]);
    mockedApi.createThread.mockResolvedValue("thread-3");

    const hook = renderHook(() => useConversationState());
    await waitFor(() => {
      expect(hook.result.current.selectedThreadId).toBe("thread-1");
    });

    await act(async () => {
      await hook.result.current.handleCreateThread("repo-2");
    });

    expect(mockedApi.listModels).toHaveBeenCalledWith("repo-2");
    expect(mockedApi.createThread).toHaveBeenCalledWith(
      "repo-2",
      "gpt-4o-mini",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});
