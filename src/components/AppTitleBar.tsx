import appIcon from "../assets/icon.svg";
import { ProjectTreeTitle } from "./ProjectTreeTitle";
import { WindowControls } from "./WindowControls";

export function AppTitleBar({
  projectPath,
}: {
  readonly projectPath: string | null;
}) {
  return (
    <div className="app-titlebar" data-tauri-drag-region>
      {projectPath ? (
        <div className="preview-tabbar-path" data-tauri-drag-region>
          <span className="brand-mark">
            <img
              className="brand-mark-icon"
              src={appIcon}
              alt=""
              draggable={false}
            />
          </span>
          <ProjectTreeTitle path={projectPath} />
        </div>
      ) : null}
      <div className="app-titlebar-spacer" data-tauri-drag-region />
      <div className="preview-tabbar-meta" data-tauri-drag-region>
        <WindowControls />
      </div>
    </div>
  );
}
