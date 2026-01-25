import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../src/api";

describe("api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses repository lists", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          repos: [{ repoId: "repo_1", name: "demo", path: "/tmp" }],
        }),
        { status: 200 },
      ),
    );

    const repos = await api.listRepos();

    expect(repos).toHaveLength(1);
    expect(repos[0]?.repoId).toBe("repo_1");
  });

  it("sends JSON for createRepo and returns the created repo", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          repo: { repoId: "repo_2", name: "demo", path: "/tmp" },
        }),
        { status: 201 },
      ),
    );

    const repo = await api.createRepo("demo", "/tmp");

    expect(repo.repoId).toBe("repo_2");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/repos",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "demo", path: "/tmp" }),
      }),
    );
  });

  it("throws ApiError on non-ok responses", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "bad request", details: { field: "name" } },
        }),
        { status: 400 },
      ),
    );

    const promise = api.createRepo("demo", "/tmp");

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 400,
    });
  });

  it("returns picked path from pickRepoPath", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ path: "/tmp/repo" }), { status: 200 }),
    );

    const path = await api.pickRepoPath();

    expect(path).toBe("/tmp/repo");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/repos/pick-path",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns null from pickRepoPath on 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const path = await api.pickRepoPath();

    expect(path).toBeNull();
  });
});
