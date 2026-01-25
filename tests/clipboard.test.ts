import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "../src/utils/clipboard";

describe("copyToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", {});

    await expect(copyToClipboard("hello")).resolves.toBe(false);
  });

  it("writes text when clipboard is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("returns false when clipboard write fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("nope"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyToClipboard("hello")).resolves.toBe(false);
  });
});
