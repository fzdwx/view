import { useMemo, useState, type CSSProperties } from "react";
import type { FileBlameLine, FileContent } from "../../lib/api";
import { buildEditorGitMarkers } from "../../lib/editorGitMarkers";
import type { EditorDraft } from "../../lib/editorTypes";
import type { PreviewTarget } from "../../lib/previewTabs";
import { CodeMirrorFilePreview } from "./CodeMirrorFilePreview";

type PreviewScenario =
  | "text"
  | "image"
  | "git-conflict"
  | "disk-conflict"
  | "binary"
  | "too-large";

type BlameMode = "ready" | "loading" | "error" | "off";

const baseText = [
  "export function greet(name: string) {",
  "  const salutation = `Hello, ${name}!`;",
  "  const detail = formatDetail(name);",
  "  console.log(salutation);",
  "  return `${salutation} ${detail}`;",
  "}",
  "",
  "function formatDetail(name: string) {",
  '  return `Welcome back, ${name}.`;',
  "}",
  "",
].join("\n");

const gitConflictText = [
  "export function greet(name: string) {",
  "<<<<<<< HEAD",
  "  return `Hello, ${name}!`;",
  "=======",
  "  return `Hi, ${name}!`;",
  ">>>>>>> feature/greeting-tone",
  "}",
  "",
].join("\n");

const diskCurrentContent = [
  "export function greet(name: string) {",
  "  return `Hello from disk, ${name}!`;",
  "}",
  "",
].join("\n");

const diskProposedContent = [
  "export function greet(name: string) {",
  "  return `Hello from draft, ${name}!`;",
  "}",
  "",
].join("\n");

const svgSource = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320">',
  '  <defs>',
  '    <linearGradient id="sky" x1="0%" y1="0%" x2="100%" y2="100%">',
  '      <stop offset="0%" stop-color="#102038" />',
  '      <stop offset="100%" stop-color="#275a77" />',
  "    </linearGradient>",
  "  </defs>",
  '  <rect width="640" height="320" fill="url(#sky)" rx="28" />',
  '  <circle cx="146" cy="92" r="42" fill="#f3d27a" opacity="0.95" />',
  '  <path d="M0 244 C110 206 210 282 320 240 C430 198 520 268 640 232 L640 320 L0 320 Z" fill="#16384d" />',
  '  <path d="M0 268 C120 236 228 300 344 264 C454 228 538 288 640 252 L640 320 L0 320 Z" fill="#0e2434" />',
  '  <text x="42" y="272" fill="#f4f8fb" font-family="monospace" font-size="26">CodeMirror preview fixture</text>',
  "</svg>",
].join("\n");

const sampleDiff = [
  "@@ -1,10 +1,11 @@",
  " export function greet(name: string) {",
  "-  const salutation = `Hello, ${name}.`;",
  "+  const salutation = `Hello, ${name}!`;",
  "   const detail = formatDetail(name);",
  "+  console.log(salutation);",
  "   return `${salutation} ${detail}`;",
  " }",
  " ",
  " function formatDetail(name: string) {",
  "-  return `Welcome, ${name}.`;",
  "+  return `Welcome back, ${name}.`;",
  " }",
].join("\n");

const sampleBlame: FileBlameLine[] = [
  createBlameLine(1, "d34db33", "Ada Lovelace", "Add greet entrypoint", 1719820800),
  createBlameLine(2, "d34db33", "Ada Lovelace", "Add greet entrypoint", 1719820800),
  createBlameLine(3, "91f0ab2", "Grace Hopper", "Extract format helper", 1722470400),
  createBlameLine(4, "91f0ab2", "Grace Hopper", "Extract format helper", 1722470400),
  createBlameLine(5, null, "Working tree", "Uncommitted change", null, false),
  createBlameLine(6, "91f0ab2", "Grace Hopper", "Extract format helper", 1722470400),
  createBlameLine(8, "7ac91fe", "Linus Torvalds", "Add detail formatter", 1725148800),
  createBlameLine(9, "7ac91fe", "Linus Torvalds", "Add detail formatter", 1725148800),
  createBlameLine(10, "7ac91fe", "Linus Torvalds", "Add detail formatter", 1725148800),
];

const previewTarget: PreviewTarget = {
  line: 5,
  column: 11,
  requestId: 1,
};

// PreviewDebugPage is a debug surface with independent scenario/draft state;
// collapsing it into a reducer is out of scope for this cleanup.
/* oxlint-disable react-doctor/prefer-useReducer */
export function PreviewDebugPage({
  shellStyle,
}: {
  readonly shellStyle: CSSProperties;
}) {
  const [scenario, setScenario] = useState<PreviewScenario>("text");
  const [draftContent, setDraftContent] = useState(baseText);
  const [blameMode, setBlameMode] = useState<BlameMode>("ready");
  const [showGitMarkers, setShowGitMarkers] = useState(true);
  const [showTarget, setShowTarget] = useState(true);
  const [loading, setLoading] = useState(false);
  const [forceError, setForceError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveCount, setSaveCount] = useState(0);
  const gitMarkers = useMemo(
    () => (showGitMarkers ? buildEditorGitMarkers(sampleDiff) : []),
    [showGitMarkers],
  );
  const file = useMemo<FileContent | null>(() => {
    switch (scenario) {
      case "image":
        return {
          path: "fixtures/preview.svg",
          content: draftContent,
          binary: false,
          tooLarge: false,
          mediaType: "image/svg+xml",
          mediaDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(draftContent)}`,
        };
      case "git-conflict":
        return {
          path: "src/conflicts/greet.ts",
          content: draftContent,
          binary: false,
          tooLarge: false,
          mediaType: null,
          mediaDataUrl: null,
        };
      case "disk-conflict":
        return {
          path: "src/conflicts/greet.ts",
          content: diskCurrentContent,
          binary: false,
          tooLarge: false,
          mediaType: null,
          mediaDataUrl: null,
        };
      case "binary":
        return {
          path: "assets/archive.bin",
          content: "",
          binary: true,
          tooLarge: false,
          mediaType: null,
          mediaDataUrl: null,
        };
      case "too-large":
        return {
          path: "logs/huge.log",
          content: "",
          binary: false,
          tooLarge: true,
          mediaType: null,
          mediaDataUrl: null,
        };
      case "text":
      default:
        return {
          path: "src/demo/greet.ts",
          content: draftContent,
          binary: false,
          tooLarge: false,
          mediaType: null,
          mediaDataUrl: null,
        };
    }
  }, [draftContent, scenario]);
  const draft = useMemo<EditorDraft | null>(() => {
    if (!file) {
      return null;
    }

    if (scenario === "disk-conflict") {
      return {
        baseContent: diskCurrentContent,
        content: draftContent,
        conflict: {
          path: file.path,
          baseContent: diskCurrentContent,
          currentContent: diskCurrentContent,
          proposedContent: diskProposedContent,
        },
      };
    }

    return {
      baseContent:
        scenario === "git-conflict"
          ? gitConflictText
          : scenario === "image"
            ? svgSource
            : baseText,
      content: draftContent,
      conflict: null,
    };
  }, [draftContent, file, scenario]);
  const blameLines =
    blameMode === "ready" &&
    (scenario === "text" || scenario === "image" || scenario === "disk-conflict")
      ? sampleBlame
      : [];
  const blameLoading =
    blameMode === "loading" &&
    (scenario === "text" || scenario === "image" || scenario === "disk-conflict");
  const blameError =
    blameMode === "error" ? "Unable to resolve blame for this fixture." : null;
  const target =
    showTarget && scenario !== "binary" && scenario !== "too-large"
      ? previewTarget
      : null;

  function applyScenario(nextScenario: PreviewScenario) {
    setScenario(nextScenario);
    setSaveError(null);
    if (nextScenario === "image") {
      setDraftContent(svgSource);
      return;
    }
    if (nextScenario === "git-conflict") {
      setDraftContent(gitConflictText);
      return;
    }
    if (nextScenario === "disk-conflict") {
      setDraftContent(diskProposedContent);
      return;
    }
    setDraftContent(baseText);
  }

  function handleSave() {
    setSaveError(null);
    setSaveCount((count) => count + 1);
  }

  return (
    <main className="preview-debug-page" style={shellStyle}>
      <section className="preview-debug-toolbar">
        <div className="preview-debug-section">
          <strong>Preview Debug</strong>
          <span>{file?.path ?? "No file selected"}</span>
          <small>{saveCount} saves triggered</small>
        </div>
        <div className="preview-debug-section">
          {(
            [
              ["text", "Text"],
              ["image", "Image"],
              ["git-conflict", "Git conflict"],
              ["disk-conflict", "Disk conflict"],
              ["binary", "Binary"],
              ["too-large", "Too large"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={scenario === value ? "ghost-button active" : "ghost-button"}
              onClick={() => applyScenario(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="preview-debug-section">
          <label>
            <input
              type="checkbox"
              checked={showGitMarkers}
              onChange={(event) => setShowGitMarkers(event.target.checked)}
            />
            Git markers
          </label>
          <label>
            <input
              type="checkbox"
              checked={showTarget}
              onChange={(event) => setShowTarget(event.target.checked)}
            />
            Target jump
          </label>
          <label>
            <input
              type="checkbox"
              checked={loading}
              onChange={(event) => setLoading(event.target.checked)}
            />
            Loading
          </label>
          <label>
            <input
              type="checkbox"
              checked={forceError}
              onChange={(event) => setForceError(event.target.checked)}
            />
            Error
          </label>
        </div>
        <div className="preview-debug-section">
          <label>
            Blame
            <select
              value={blameMode}
              onChange={(event) => setBlameMode(event.target.value as BlameMode)}
            >
              <option value="ready">Ready</option>
              <option value="loading">Loading</option>
              <option value="error">Error</option>
              <option value="off">Off</option>
            </select>
          </label>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setSaveError("Fixture save error for preview testing.")}
          >
            Save error
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => applyScenario(scenario)}
          >
            Reset content
          </button>
        </div>
      </section>
      <section className="preview-debug-body">
        <article className="preview-debug-pane">
          <header>CodeMirror preview</header>
          <div className="preview-debug-pane-body">
            <CodeMirrorFilePreview
              activeProjectPath={null}
              blameError={blameError}
              blameLines={blameLines}
              blameLoading={blameLoading}
              draft={draft}
              editorSessionKey={`fixture-${scenario}`}
              error={forceError ? "Fixture error: file preview failed to load." : null}
              file={file}
              gitMarkers={gitMarkers}
              loading={loading}
              runTargets={[]}
              saveError={saveError}
              saving={false}
              selectedPath={file?.path ?? null}
              target={target}
              canRunGitChangeAction={false}
              onChangeDraft={setDraftContent}
              onDiscardConflict={() => applyScenario("text")}
              onDiscardGitChange={() => Promise.resolve(false)}
              onOpenReference={() => undefined}
              onRunCommand={() => undefined}
              onSave={handleSave}
              onStageGitChange={() => Promise.resolve(false)}
              onSetConflictDraftContent={setDraftContent}
              onUnstageGitChange={() => Promise.resolve(false)}
            />
          </div>
        </article>
      </section>
    </main>
  );
}
/* oxlint-enable react-doctor/prefer-useReducer */

function createBlameLine(
  lineNumber: number,
  shortHash: string | null,
  author: string,
  summary: string,
  authorTime: number | null,
  committed = true,
): FileBlameLine {
  return {
    lineNumber,
    commitHash: shortHash ? `${shortHash}cafefeed` : null,
    shortHash,
    author,
    authorTime,
    summary,
    committed,
  };
}
