import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildPortCandidates,
  parsePortEnv,
  resolveDataDir,
  resolveHost,
  resolvePort,
  resolveRepoFileName,
} from "./config.js";

describe("parsePortEnv", () => {
  it("returns undefined when PORT is not set", () => {
    expect(parsePortEnv(undefined)).toBeUndefined();
  });

  it("parses a valid PORT", () => {
    expect(parsePortEnv("3000")).toBe(3000);
  });

  it("rejects invalid PORT values", () => {
    expect(() => parsePortEnv("abc")).toThrow();
    expect(() => parsePortEnv("0")).toThrow();
    expect(() => parsePortEnv("-1")).toThrow();
  });
});

describe("buildPortCandidates", () => {
  it("creates a sequential port list", () => {
    expect(buildPortCandidates(8787, 3)).toEqual([8787, 8788, 8789]);
  });
});

describe("resolvePort", () => {
  it("uses PORT when provided", async () => {
    const getPort = vi.fn();
    const port = await resolvePort({
      env: { PORT: "5555" },
      getPort,
    });
    expect(port).toBe(5555);
    expect(getPort).not.toHaveBeenCalled();
  });

  it("selects an available port from the candidate list", async () => {
    const getPort = vi.fn().mockResolvedValue(8788);
    const port = await resolvePort({
      env: {},
      basePort: 8787,
      attempts: 3,
      getPort,
    });
    expect(getPort).toHaveBeenCalledWith({ port: [8787, 8788, 8789] });
    expect(port).toBe(8788);
  });

  it("throws when no candidate ports are available", async () => {
    const getPort = vi.fn().mockResolvedValue(9999);
    await expect(
      resolvePort({
        env: {},
        basePort: 8787,
        attempts: 2,
        getPort,
      }),
    ).rejects.toThrow();
  });
});

describe("resolveDataDir", () => {
  it("uses CODEXDOCK_DATA_DIR when provided", () => {
    const cwd = path.resolve("/tmp/project");
    const result = resolveDataDir({
      env: { CODEXDOCK_DATA_DIR: "custom/data" },
      cwd,
    });
    expect(result).toBe(path.resolve(cwd, "custom/data"));
  });

  it("uses data directory by default", () => {
    const cwd = path.resolve("/tmp/project");
    const result = resolveDataDir({ env: {}, cwd });
    expect(result).toBe(path.resolve(cwd, "data"));
  });
});

describe("resolveRepoFileName", () => {
  it("uses dev file name for development", () => {
    expect(resolveRepoFileName({ env: { NODE_ENV: "development" } })).toBe(
      "dev.json",
    );
  });

  it("uses dev file name for test", () => {
    expect(resolveRepoFileName({ env: { NODE_ENV: "test" } })).toBe("dev.json");
  });

  it("uses prod file name by default", () => {
    expect(resolveRepoFileName({ env: {} })).toBe("prd.json");
  });
});

describe("resolveHost", () => {
  it("uses HOST when provided", async () => {
    const host = await resolveHost({
      env: { HOST: "0.0.0.0" },
      isWsl: async () => false,
    });
    expect(host).toBe("0.0.0.0");
  });

  it("defaults to 127.0.0.1 outside WSL", async () => {
    const host = await resolveHost({
      env: {},
      isWsl: async () => false,
    });
    expect(host).toBe("127.0.0.1");
  });

  it("defaults to 0.0.0.0 on WSL", async () => {
    const host = await resolveHost({
      env: {},
      isWsl: async () => true,
    });
    expect(host).toBe("0.0.0.0");
  });
});
