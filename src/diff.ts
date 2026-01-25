export type DiffLineType = "context" | "add" | "del" | "note";

export type DiffLine = {
  id: string;
  type: DiffLineType;
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
};

const hunkHeader = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;
const diffHeader = /^diff --git a\/(.+?) b\/(.+)$/;

export const extractDiffFileNames = (diffText: string): string[] => {
  const lines = diffText.split(/\r?\n/);
  const names: string[] = [];
  for (const text of lines) {
    const match = text.match(diffHeader);
    if (!match) continue;
    const filePath = match[2] ?? match[1];
    const fileName = filePath.split("/").pop() ?? filePath;
    if (!names.includes(fileName)) {
      names.push(fileName);
    }
  }
  return names;
};

export const parseDiffLines = (diffText: string): DiffLine[] => {
  const lines = diffText.split(/\r?\n/);
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const text = lines[idx];
    if (text === "") continue;
    if (diffHeader.test(text)) {
      oldLine = 0;
      newLine = 0;
      continue;
    }
    if (
      text.startsWith("index ") ||
      text.startsWith("--- ") ||
      text.startsWith("+++ ")
    ) {
      continue;
    }
    if (text.startsWith("@@")) {
      const match = text.match(hunkHeader);
      if (match) {
        oldLine = Number.parseInt(match[1], 10);
        newLine = Number.parseInt(match[2], 10);
      }
      continue;
    }
    const id = `${idx}-${text.slice(0, 16)}`;
    if (text.startsWith("+")) {
      result.push({
        id,
        type: "add",
        text,
        oldNumber: null,
        newNumber: newLine,
      });
      newLine += 1;
      continue;
    }
    if (text.startsWith("-")) {
      result.push({
        id,
        type: "del",
        text,
        oldNumber: oldLine,
        newNumber: null,
      });
      oldLine += 1;
      continue;
    }
    if (text.startsWith(" ")) {
      result.push({
        id,
        type: "context",
        text,
        oldNumber: oldLine,
        newNumber: newLine,
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }
    if (text.startsWith("\\")) {
      result.push({
        id,
        type: "note",
        text,
        oldNumber: null,
        newNumber: null,
      });
    }
  }
  return result;
};
