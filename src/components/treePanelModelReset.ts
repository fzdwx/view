import type {
  FileTreePreparedInput,
  FileTreeResetOptions,
} from "@pierre/trees";
import type { useFileTree } from "@pierre/trees/react";

type FileTreeModel = ReturnType<typeof useFileTree>["model"];
type PreparedResetModel = Omit<FileTreeModel, "resetPaths"> & {
  resetPaths(paths: undefined, options: FileTreeResetOptions): void;
};

export function resetTreeModelWithPreparedInput(
  model: FileTreeModel,
  preparedInput: FileTreePreparedInput,
  initialExpandedPaths: readonly string[],
): void {
  const preparedResetModel = model as unknown as PreparedResetModel;
  preparedResetModel.resetPaths(undefined, {
    preparedInput,
    initialExpandedPaths,
  });
}
