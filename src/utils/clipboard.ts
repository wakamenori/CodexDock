export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (!("navigator" in globalThis)) {
    return false;
  }

  const { clipboard } = globalThis.navigator;
  if (!clipboard?.writeText) {
    return false;
  }

  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};
