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

  const indexAttribute = instance.options.indexAttribute ?? "data-index";
  const index = Number.parseInt(element.getAttribute(indexAttribute) ?? "", 10);
  if (!Number.isFinite(index) || index < 0) {
    return instance.options.estimateSize(0);
  }

  const key = instance.options.getItemKey(index);
  return (
    instance.itemSizeCache.get(key) ?? instance.options.estimateSize(index)
  );
}
