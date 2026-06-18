export function isChangedFileStatus(status: string): boolean {
  return (
    status === "added" ||
    status === "conflict" ||
    status === "modified" ||
    status === "deleted" ||
    status === "renamed" ||
    status === "untracked"
  );
}
