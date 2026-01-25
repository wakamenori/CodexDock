import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../server/errors";
import { RepoRegistry } from "../server/repoRegistry";

const expectApiErrorCode = async (
  action: () => Promise<unknown>,
  code: string,
) => {
  try {
    await action();
    throw new Error("Expected ApiError");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).payload.code).toBe(code);
  }
};

describe("RepoRegistry", () => {
  const logger = pino({ level: "silent" });
  let registry: RepoRegistry;

  beforeEach(async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "codexdock-data-"));
    registry = new RepoRegistry(dataDir, logger);
  });

  it("creates, lists, and updates entries", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "codexdock-repo-"));
    const entry = await registry.create("demo", `${repoDir}${path.sep}`);

    expect(entry.path.endsWith(path.sep)).toBe(false);

    const list = await registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.repoId).toBe(entry.repoId);

    const updated = await registry.update(entry.repoId, {
      name: "demo-2",
      lastOpenedThreadId: "thr_1",
    });
    expect(updated.name).toBe("demo-2");
    expect(updated.lastOpenedThreadId).toBe("thr_1");

    const stored = await registry.get(entry.repoId);
    expect(stored?.name).toBe("demo-2");
    expect(stored?.lastOpenedThreadId).toBe("thr_1");
  });

  it("rejects duplicate paths and invalid updates", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "codexdock-repo-"));
    const created = await registry.create("demo", repoDir);

    await expectApiErrorCode(
      () => registry.create("demo-2", repoDir),
      "conflict",
    );

    await expectApiErrorCode(
      () => registry.update(created.repoId, { path: repoDir }),
      "invalid_request",
    );
  });

  it("rejects non-directory paths and missing repos", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "codexdock-repo-"));
    const filePath = path.join(repoDir, "file.txt");
    await writeFile(filePath, "hello", "utf8");

    await expectApiErrorCode(
      () => registry.create("file", filePath),
      "unprocessable_entity",
    );

    await expectApiErrorCode(
      () => registry.remove("repo_missing"),
      "not_found",
    );
  });

});
