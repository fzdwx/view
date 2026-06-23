import { Loader2 } from "lucide-react";

export function PaneLoading() {
  return (
    <div className="diff-loading">
      <Loader2 className="spin" size={18} />
    </div>
  );
}

export function PaneEmpty({
  title,
  copy,
}: {
  readonly title: string;
  readonly copy: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      <div className="empty-copy">{copy}</div>
    </div>
  );
}
