import { useEffect } from "react";

interface PathEntry {
  readonly path: string;
}

export interface UseSelectedPathGuardOptions<T extends PathEntry> {
  readonly items: readonly T[] | undefined;
  readonly placeholder: boolean;
  readonly selectedPath: string | null;
  readonly onClear: () => void;
}

export function useSelectedPathGuard<T extends PathEntry>({
  items,
  placeholder,
  selectedPath,
  onClear,
}: UseSelectedPathGuardOptions<T>): void {
  // items arrive from outside (query results), so staleness of selectedPath
  // can't be observed from the handler that set it; this sync effect is the
  // only place that can react when the selected file leaves the list.
  useEffect(() => {
    /* oxlint-disable react-doctor/no-event-handler */
    if (placeholder || !selectedPath) {
      return;
    }

    const currentItems = items ?? [];
    if (currentItems.length === 0) {
      onClear();
      return;
    }

    const stillExists = currentItems.some((item) => item.path === selectedPath);
    if (!stillExists) {
      onClear();
    }
    /* oxlint-enable react-doctor/no-event-handler */
  }, [items, onClear, placeholder, selectedPath]);
}
