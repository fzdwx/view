import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import type { SettingsSectionId } from "./types";

interface SettingsSidebarProps {
  readonly activeSection: SettingsSectionId;
  readonly onReset: () => void;
  readonly onSectionChange: (section: SettingsSectionId) => void;
}

const settingsTree: ReadonlyArray<
  | {
      readonly kind: "item";
      readonly id: SettingsSectionId;
      readonly label: string;
    }
  | {
      readonly kind: "group";
      readonly label: string;
      readonly children: ReadonlyArray<{
        readonly id: SettingsSectionId;
        readonly label: string;
      }>;
    }
> = [
  {
    kind: "group",
    label: "Application",
    children: [
      { id: "fonts", label: "Fonts" },
      { id: "shortcuts", label: "Keyboard" },
    ],
  },
];

export function SettingsSidebar({
  activeSection,
  onReset,
  onSectionChange,
}: SettingsSidebarProps) {
  return (
    <aside className="settings-sidebar" aria-label="Settings sections">
      <nav className="settings-tree">
        {settingsTree.map((entry) =>
          entry.kind === "item" ? (
            <SettingsTreeButton
              key={entry.id}
              active={activeSection === entry.id}
              depth={0}
              label={entry.label}
              onClick={() => onSectionChange(entry.id)}
            />
          ) : (
            <div key={entry.label} className="settings-tree-group">
              <div className="settings-tree-group-label">
                <ChevronDown size={13} />
                <span>{entry.label}</span>
              </div>
              {entry.children.map((child) => (
                <SettingsTreeButton
                  key={child.id}
                  active={activeSection === child.id}
                  depth={1}
                  label={child.label}
                  onClick={() => onSectionChange(child.id)}
                />
              ))}
            </div>
          ),
        )}
      </nav>

      <button
        type="button"
        className="ghost-button settings-reset"
        onClick={onReset}
      >
        <RotateCcw size={13} />
        Reset
      </button>
    </aside>
  );
}

function SettingsTreeButton({
  active,
  depth,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly depth: 0 | 1;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "settings-tree-item active" : "settings-tree-item"}
      data-depth={depth}
      onClick={onClick}
    >
      {depth === 0 ? <ChevronRight size={13} /> : <span aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}
