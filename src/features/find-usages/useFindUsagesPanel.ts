import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelSymbolReferenceSearch,
  searchSymbolReferences,
  type FileSearchResult,
} from "../../lib/api";
import { clamp } from "../../lib/numeric";

const findUsagesResultLimit = 200;

export type FindUsagesPanelStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "cancelled";

export interface FindUsagesRequest {
  readonly projectPath: string;
  readonly symbol: string;
  readonly currentFilePath: string;
}

export interface FindUsagesPanelState {
  readonly open: boolean;
  readonly status: FindUsagesPanelStatus;
  readonly symbol: string;
  readonly currentFilePath: string | null;
  readonly results: readonly FileSearchResult[];
  readonly activeIndex: number;
  readonly error: string | null;
}

const closedFindUsagesState: FindUsagesPanelState = {
  open: false,
  status: "idle",
  symbol: "",
  currentFilePath: null,
  results: [],
  activeIndex: 0,
  error: null,
};

export function useFindUsagesPanel() {
  const requestIdRef = useRef(0);
  const activeProjectPathRef = useRef<string | null>(null);
  const [state, setState] = useState<FindUsagesPanelState>(closedFindUsagesState);

  const cancelActiveSearch = useCallback(() => {
    requestIdRef.current += 1;
    const projectPath = activeProjectPathRef.current;
    if (projectPath) {
      void cancelSymbolReferenceSearch(projectPath);
    }
  }, []);

  const close = useCallback(() => {
    cancelActiveSearch();
    activeProjectPathRef.current = null;
    setState(closedFindUsagesState);
  }, [cancelActiveSearch]);

  const cancel = useCallback(() => {
    cancelActiveSearch();
    setState((current) =>
      current.open
        ? {
            ...current,
            status: "cancelled",
            error: null,
          }
        : current,
    );
  }, [cancelActiveSearch]);

  const open = useCallback(
    ({ projectPath, symbol, currentFilePath }: FindUsagesRequest) => {
      const normalizedSymbol = symbol.trim();
      if (!normalizedSymbol) {
        return;
      }

      cancelActiveSearch();
      activeProjectPathRef.current = projectPath;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setState({
        open: true,
        status: "loading",
        symbol: normalizedSymbol,
        currentFilePath,
        results: [],
        activeIndex: 0,
        error: null,
      });

      searchSymbolReferences(
        projectPath,
        normalizedSymbol,
        findUsagesResultLimit,
        currentFilePath,
      )
        .then((results) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          setState({
            open: true,
            status: "ready",
            symbol: normalizedSymbol,
            currentFilePath,
            results,
            activeIndex: 0,
            error: null,
          });
        })
        .catch((error: unknown) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          setState({
            open: true,
            status: "error",
            symbol: normalizedSymbol,
            currentFilePath,
            results: [],
            activeIndex: 0,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [cancelActiveSearch],
  );

  const selectIndex = useCallback((index: number) => {
    setState((current) => ({
      ...current,
      activeIndex: clamp(index, 0, Math.max(0, current.results.length - 1)),
    }));
  }, []);

  const selectNext = useCallback(() => {
    setState((current) => {
      if (current.results.length === 0) {
        return current;
      }
      return {
        ...current,
        activeIndex: (current.activeIndex + 1) % current.results.length,
      };
    });
  }, []);

  const selectPrevious = useCallback(() => {
    setState((current) => {
      if (current.results.length === 0) {
        return current;
      }
      return {
        ...current,
        activeIndex:
          (current.activeIndex - 1 + current.results.length) %
          current.results.length,
      };
    });
  }, []);

  useEffect(() => {
    return () => cancelActiveSearch();
  }, [cancelActiveSearch]);

  return useMemo(
    () => ({
      state,
      cancel,
      close,
      open,
      selectIndex,
      selectNext,
      selectPrevious,
    }),
    [
      cancel,
      close,
      open,
      selectIndex,
      selectNext,
      selectPrevious,
      state,
    ],
  );
}
