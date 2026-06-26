import { useEffect, useMemo, useState } from "react";
import type { TreeFile } from "../lib/api";
import { treeFilesSignature } from "../lib/treeFileIdentity";
import {
  buildTreePanelData,
  cachedTreePanelData,
  emptyTreePanelData,
  storeTreePanelData,
  type TreePanelData,
} from "./treePanelData";

interface TreePanelDataState {
  readonly data: TreePanelData;
  readonly loading: boolean;
  readonly signature: string;
}

interface ScheduledTask {
  readonly cancel: () => void;
}

export function useTreePanelData(files: readonly TreeFile[]): TreePanelDataState {
  const signature = useMemo(() => treeFilesSignature(files), [files]);
  const cachedData = useMemo(() => cachedTreePanelData(signature), [signature]);
  const [state, setState] = useState<TreePanelDataState>(() =>
    treePanelDataStateFor(files, signature, cachedData),
  );

  useEffect(() => {
    const cached = cachedTreePanelData(signature);
    if (cached) {
      setState((current) =>
        current.signature === signature &&
        current.data === cached &&
        !current.loading
          ? current
          : { data: cached, loading: false, signature },
      );
      return;
    }

    if (files.length === 0) {
      setState((current) =>
        current.signature === signature &&
        current.data === emptyTreePanelData &&
        !current.loading
          ? current
          : { data: emptyTreePanelData, loading: false, signature },
      );
      return;
    }

    setState((current) =>
      current.signature === signature && current.loading
        ? current
        : { data: emptyTreePanelData, loading: true, signature },
    );

    let canceled = false;
    const scheduled = scheduleAfterNextPaint(() => {
      if (canceled) {
        return;
      }
      const data = buildTreePanelData(files);
      if (canceled) {
        return;
      }
      storeTreePanelData(signature, data);
      setState({ data, loading: false, signature });
    });

    return () => {
      canceled = true;
      scheduled.cancel();
    };
  }, [files, signature]);

  if (cachedData) {
    return { data: cachedData, loading: false, signature };
  }

  if (state.signature === signature) {
    return state;
  }

  return treePanelDataStateFor(files, signature, null);
}

function treePanelDataStateFor(
  files: readonly TreeFile[],
  signature: string,
  cachedData: TreePanelData | null,
): TreePanelDataState {
  if (cachedData) {
    return { data: cachedData, loading: false, signature };
  }
  return {
    data: emptyTreePanelData,
    loading: files.length > 0,
    signature,
  };
}

function scheduleAfterNextPaint(task: () => void): ScheduledTask {
  if (typeof window === "undefined") {
    task();
    return { cancel: () => undefined };
  }

  let timeoutId: number | null = null;
  let frameId: number | null = window.requestAnimationFrame(() => {
    frameId = null;
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      task();
    }, 0);
  });

  return {
    cancel: () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
  };
}
