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

export const toRelativePath = (
  path: string,
  repoRoot?: string | null,
): string => {
  const normalized = path.replace(/\\/g, "/");
  const root = normalizeRootPath(repoRoot ?? "");
  if (root && normalized === root) {
    return ".";
  }
  if (root && normalized.startsWith(`${root}/`)) {
    return normalized.slice(root.length + 1);
  }
  const withoutDrive = normalized.replace(/^[A-Za-z]:/, "");
  return withoutDrive.replace(/^\/+/, "").replace(/^\.\/+/, "");
};
