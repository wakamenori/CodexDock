export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const getRecord = (
  value: unknown,
  key: string,
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  const candidate = value[key];
  return isRecord(candidate) ? candidate : undefined;
};

export const getString = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) return undefined;
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
};

export const getIdString = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
};

export const getArray = (
  value: unknown,
  key: string,
): unknown[] | undefined => {
  if (!isRecord(value)) return undefined;
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : undefined;
};
