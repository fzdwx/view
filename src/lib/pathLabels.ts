export function buildRequestedFilePath(
  parentPath: string | null,
  input: string,
): string | null {
  const normalizedInput = input.trim().replaceAll("\\", "/");
  if (!normalizedInput) {
    return null;
  }

  if (normalizedInput.startsWith("/")) {
    return normalizedInput.replace(/^\/+/, "");
  }

  if (!parentPath) {
    return normalizedInput;
  }

  return `${parentPath.replace(/\/+$/, "")}/${normalizedInput}`;
}

export function fileNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function parentPathFromPath(path: string): string {
  return path.split("/").filter(Boolean).slice(0, -1).join("/");
}
