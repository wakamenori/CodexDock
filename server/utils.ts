import { createHash } from "node:crypto";

export class Mutex {
  private current = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.current.then(fn, fn);
    this.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

export const hashPath = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 12);

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
