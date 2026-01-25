export const normalizeRootPath = (value?: string): string => {
  if (!value) return "";
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
};

export const extractRepoName = (value?: string): string => {
  const normalized = normalizeRootPath(value);
  if (!normalized) return "";
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? "";
};
