export const normalizeRootPath = (value?: string): string => {
  if (!value) return "";
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
};
