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

export function fileExtension(path: string): string {
  const fileName = fileNameFromPath(path);
  const extension = fileName.includes(".") ? fileName.split(".").pop() : null;
  return extension ? extension.slice(0, 4).toLowerCase() : "";
}
