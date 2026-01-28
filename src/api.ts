import type {
  PermissionMode,
  Repo,
  ReviewTarget,
  ThreadSummary,
  TurnInputItem,
  TurnStartOptions,
  UploadedImage,
} from "./types";

const jsonHeaders = {
  "Content-Type": "application/json",
};

class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options);
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = data?.error?.message ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data?.error?.details);
  }
  return data as T;
}

export const api = {
  async listRepos(): Promise<Repo[]> {
    const data = await requestJson<{ repos: Repo[] }>("/api/repos");
    return data.repos;
  },
  async createRepo(name: string, path: string): Promise<Repo> {
    const data = await requestJson<{ repo: Repo }>("/api/repos", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ name, path }),
    });
    return data.repo;
  },
  async pickRepoPath(): Promise<string | null> {
    const data = await requestJson<{ path: string } | undefined>(
      "/api/repos/pick-path",
      { method: "POST" },
    );
    return data?.path ?? null;
  },
  async updateRepo(repoId: string, patch: Partial<Repo>): Promise<Repo> {
    const data = await requestJson<{ repo: Repo }>(`/api/repos/${repoId}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(patch),
    });
    return data.repo;
  },
  async deleteRepo(repoId: string): Promise<void> {
    await requestJson<void>(`/api/repos/${repoId}`, { method: "DELETE" });
  },
  async startSession(repoId: string): Promise<void> {
    await requestJson<void>(`/api/repos/${repoId}/session/start`, {
      method: "POST",
    });
  },
  async stopSession(repoId: string): Promise<void> {
    await requestJson<void>(`/api/repos/${repoId}/session/stop`, {
      method: "POST",
    });
  },
  async listThreads(repoId: string): Promise<ThreadSummary[]> {
    const data = await requestJson<{ threads: ThreadSummary[] }>(
      `/api/repos/${repoId}/threads`,
    );
    return data.threads;
  },
  async listModels(repoId: string): Promise<unknown> {
    return requestJson(`/api/repos/${repoId}/models`);
  },
  async getModelSettings(): Promise<{
    storedModel: string | null;
    defaultModel: string | null;
  }> {
    return requestJson("/api/settings/model");
  },
  async getPermissionModeSettings(): Promise<{
    defaultMode: PermissionMode | null;
  }> {
    return requestJson("/api/settings/permission-mode");
  },
  async updateModelSetting(model: string | null): Promise<string | null> {
    const data = await requestJson<{ storedModel: string | null }>(
      "/api/settings/model",
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ model }),
      },
    );
    return data.storedModel;
  },
  async createThread(repoId: string, model?: string): Promise<string> {
    const options: RequestInit = { method: "POST" };
    if (model) {
      options.headers = jsonHeaders;
      options.body = JSON.stringify({ model });
    }
    const data = await requestJson<{ thread: { threadId: string } }>(
      `/api/repos/${repoId}/threads`,
      options,
    );
    return data.thread.threadId;
  },
  async resumeThread(repoId: string, threadId: string): Promise<unknown> {
    return requestJson(`/api/repos/${repoId}/threads/${threadId}/resume`, {
      method: "POST",
    });
  },
  async startTurn(
    repoId: string,
    threadId: string,
    input: TurnInputItem[],
    options?: TurnStartOptions,
  ): Promise<{ turnId: string; status: string }> {
    const data = await requestJson<{
      turn: { turnId: string; status: string };
    }>(`/api/repos/${repoId}/turns`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ threadId, input, options }),
    });
    return data.turn;
  },
  async uploadImages(files: File[]): Promise<UploadedImage[]> {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file, file.name);
    }
    const data = await requestJson<{ uploads: UploadedImage[] }>(
      "/api/uploads",
      {
        method: "POST",
        body: formData,
      },
    );
    return data.uploads;
  },
  async startReview(
    repoId: string,
    threadId: string,
    target: ReviewTarget,
    delivery: "inline" | "detached" = "inline",
  ): Promise<{
    turnId: string;
    status: string;
    reviewThreadId: string | null;
  }> {
    const data = await requestJson<{
      turn: { turnId: string; status: string };
      reviewThreadId?: string | null;
    }>(`/api/repos/${repoId}/reviews`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ threadId, target, delivery }),
    });
    return {
      turnId: data.turn.turnId,
      status: data.turn.status,
      reviewThreadId: data.reviewThreadId ?? null,
    };
  },
  async cancelTurn(
    repoId: string,
    turnId: string,
    threadId: string,
  ): Promise<void> {
    await requestJson(`/api/repos/${repoId}/turns/${turnId}/cancel`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ threadId }),
    });
  },
};

export { ApiError };
