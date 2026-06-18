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
  useEffect(() => {
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
  }, [items, onClear, placeholder, selectedPath]);
}
