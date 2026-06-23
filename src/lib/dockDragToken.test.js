import { describe, expect, test } from "bun:test";
import { createDockDragTokenStore } from "./dockDragToken";

describe("dockDragToken", () => {
  test("invalidates delayed rail drag activation after clear", () => {
    const store = createDockDragTokenStore();
    const delayedDrag = store.next();

    store.cancel();

    expect(store.isCurrent(delayedDrag)).toBe(false);
  });

  test("keeps the latest rail drag activation current", () => {
    const store = createDockDragTokenStore();
    const firstDrag = store.next();
    const secondDrag = store.next();

    expect(store.isCurrent(firstDrag)).toBe(false);
    expect(store.isCurrent(secondDrag)).toBe(true);
  });
});
