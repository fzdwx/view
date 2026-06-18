import { Loader2 } from "lucide-react";

export function LoadingRows() {
  return (
    <div className="loading-rows" role="status" aria-label="Loading">
      <Loader2 className="spin" size={16} aria-hidden="true" />
    </div>
  );
}
