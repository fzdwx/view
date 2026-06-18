import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker-portable.js?worker";
import { useMemo, type ReactNode } from "react";

const diffThemes = {
  light: "pierre-light",
  dark: "pierre-dark",
} as const;

export function DiffRenderingProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const poolOptions = useMemo(() => {
    const hardwareConcurrency =
      typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
    const poolSize = Math.max(
      1,
      Math.min(2, Math.floor(hardwareConcurrency / 4) || 1),
    );

    return {
      poolSize,
      workerFactory: () =>
        new DiffsWorker({
          name: "view-diff-worker",
        }),
    };
  }, []);

  const highlighterOptions = useMemo(
    () => ({
      theme: diffThemes,
      preferredHighlighter: "shiki-js" as const,
    }),
    [],
  );

  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
