import type { Virtualizer } from "@tanstack/react-virtual";
import { measureElement } from "@tanstack/react-virtual";
import { isPanelResizeInProgress } from "./panelResizeInteraction";

export function measureElementUnlessPanelResizing<
  TScrollElement extends Element | Window,
  TItemElement extends Element,
>(
  element: TItemElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<TScrollElement, TItemElement>,
): number {
  if (!isPanelResizeInProgress()) {
    return measureElement(element, entry, instance);
  }

  const index = instance.indexFromElement(element);
  const key = instance.options.getItemKey(index);
  return (
    instance.itemSizeCache.get(key) ?? instance.options.estimateSize(index)
  );
}
