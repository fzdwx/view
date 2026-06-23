import type { useVirtualizer } from "@tanstack/react-virtual";

export type ListVirtualizer = ReturnType<
  typeof useVirtualizer<HTMLDivElement, HTMLDivElement>
>;
