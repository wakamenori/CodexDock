import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { badRequest, conflict, notFound, unprocessable } from "./errors.js";
import type { AppSettings, RepoEntry } from "./types.js";
import { hashPath, Mutex } from "./utils.js";

type RegistryState = {
  repos: RepoEntry[];
  settings: AppSettings;
};

export class RepoRegistry {
  private filePath: string;
  private mutex = new Mutex();
  private cache: RegistryState | null = null;
  private logger: Logger;

  constructor(
    dataDir: string,
    logger: Logger,
    options: { fileName?: string } = {},
  ) {
    const fileName = options.fileName ?? "repos.json";
    this.filePath = path.join(dataDir, fileName);
    this.logger = logger;
  }

  async list(): Promise<RepoEntry[]> {
    return this.mutex.runExclusive(async () => {
      const state = await this.load();
      return [...state.repos];
    });
  }

  async get(repoId: string): Promise<RepoEntry | undefined> {
    return this.mutex.runExclusive(async () => {
      const state = await this.load();
      return state.repos.find((repo) => repo.repoId === repoId);
    });
  }

  async create(name: string, inputPath: string): Promise<RepoEntry> {
    return this.mutex.runExclusive(async () => {
      const state = await this.load();
      const repos = state.repos;
      const normalizedPath = await this.normalizePath(inputPath);
      if (repos.some((repo) => repo.path === normalizedPath)) {
        throw conflict("Repository path already registered", { field: "path" });
      }
      const repoId = `repo_${hashPath(normalizedPath)}`;
      if (repos.some((repo) => repo.repoId === repoId)) {
        throw conflict("Repository id collision", { repoId });
      }
      const entry: RepoEntry = {
        repoId,
        name,
        path: normalizedPath,
      };
      const next = { ...state, repos: [...repos, entry] };
      await this.save(next);
      this.logger.info({ component: "repo_registry", repoId }, "repo_created");
      return entry;
    });
  }

  async update(repoId: string, patch: Partial<RepoEntry>): Promise<RepoEntry> {
    return this.mutex.runExclusive(async () => {
      const state = await this.load();
      const repos = state.repos;
      const index = repos.findIndex((repo) => repo.repoId === repoId);
      if (index < 0) {
        throw notFound("Repository not found", { repoId });
      }
      if (patch.path) {
        throw badRequest("Repository path cannot be changed", {
          field: "path",
        });
      }
      const updated: RepoEntry = {
        ...repos[index],
        name: patch.name ?? repos[index].name,
        lastOpenedThreadId:
          patch.lastOpenedThreadId ?? repos[index].lastOpenedThreadId,
      };
      const nextRepos = [...repos];
      nextRepos[index] = updated;
      await this.save({ ...state, repos: nextRepos });
      this.logger.info({ component: "repo_registry", repoId }, "repo_updated");
      return updated;
    });
  }

  async remove(repoId: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const state = await this.load();
      const repos = state.repos;
      const index = repos.findIndex((repo) => repo.repoId === repoId);
      if (index < 0) {
        throw notFound("Repository not found", { repoId });
      }
      const next = repos.filter((repo) => repo.repoId !== repoId);
      await this.save({ ...state, repos: next });
      this.logger.info({ component: "repo_registry", repoId }, "repo_removed");
    });
  }

  async getSettings(): Promise<AppSettings> {
    return this.mutex.runExclusive(async () => {
      const state = await this.load();
      return { ...state.settings };
    });
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.mutex.runExclusive(async () => {
      const state = await this.load();
      const nextSettings: AppSettings = { ...state.settings };
      if (Object.hasOwn(patch, "model")) {
        nextSettings.model = patch.model ?? null;
      }
      const next = { ...state, settings: nextSettings };
      await this.save(next);
      this.logger.info(
        {
          component: "repo_registry",
          model: nextSettings.model ?? null,
        },
        "settings_updated",
      );
      return { ...nextSettings };
    });
  }

  private async load(): Promise<RegistryState> {
    if (this.cache) {
      return this.cache;
    }
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as {
        repos?: RepoEntry[];
        settings?: AppSettings;
      };
      this.cache = {
        repos: parsed.repos ?? [],
        settings: parsed.settings ?? {},
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") {
        this.cache = { repos: [], settings: {} };
        await this.save(this.cache);
      } else {
        throw error;
      }
    }
    return this.cache;
  }

  private async save(state: RegistryState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify(
      { repos: state.repos, settings: state.settings },
      null,
      2,
    );
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, this.filePath);
    this.cache = { repos: state.repos, settings: state.settings };
  }

  private async normalizePath(inputPath: string): Promise<string> {
    const resolved = path.resolve(inputPath);
    await access(resolved, fsConstants.R_OK).catch(() => {
      throw unprocessable("Repository path is not accessible", {
        field: "path",
      });
    });
    const stats = await stat(resolved).catch(() => {
      throw unprocessable("Repository path does not exist", { field: "path" });
    });
    if (!stats.isDirectory()) {
      throw unprocessable("Repository path is not a directory", {
        field: "path",
      });
    }
    let realPath = resolved;
    try {
      realPath = await realpath(resolved);
    } catch {
      realPath = resolved;
    }
    return realPath.replace(/[\\/]+$/, "");
  }
}
