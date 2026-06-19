import { Loader2 } from "lucide-react";

export function LoadingRows() {
  return (
    <output className="loading-rows" aria-label="Loading">
      <Loader2 className="spin" size={16} aria-hidden="true" />
    </output>
  );
}
