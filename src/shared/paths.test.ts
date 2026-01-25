import { describe, expect, it } from "vitest";
import { extractRepoName, normalizeRootPath } from "./paths";

describe("extractRepoName", () => {
  it("uses the last path segment", () => {
    expect(extractRepoName("/abs/path/to/repo")).toBe("repo");
  });

  it("trims trailing slashes", () => {
    expect(extractRepoName("/abs/path/to/repo/")).toBe("repo");
  });

  it("handles windows paths", () => {
    expect(extractRepoName("C:\\work\\repo")).toBe("repo");
  });

  it("handles UNC paths", () => {
    expect(extractRepoName("\\\\wsl.localhost\\Ubuntu\\home\\me\\repo")).toBe(
      "repo",
    );
  });
});

describe("normalizeRootPath", () => {
  it("returns empty for undefined", () => {
    expect(normalizeRootPath()).toBe("");
  });
});
