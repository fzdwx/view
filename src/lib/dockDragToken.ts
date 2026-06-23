export interface DockDragTokenStore {
  readonly cancel: () => number;
  readonly isCurrent: (token: number) => boolean;
  readonly next: () => number;
}

export function createDockDragTokenStore(): DockDragTokenStore {
  let currentToken = 0;
  return {
    cancel: () => {
      currentToken += 1;
      return currentToken;
    },
    isCurrent: (token) => currentToken === token,
    next: () => {
      currentToken += 1;
      return currentToken;
    },
  };
}
