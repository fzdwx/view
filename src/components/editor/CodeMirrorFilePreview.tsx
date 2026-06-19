import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SearchQuery, search, setSearchQuery } from "@codemirror/search";
import {
  EditorView as CodeMirrorEditorView,
  GutterMarker,
  gutter,
  keymap,
  lineNumbers,
  type Extension,
  type ViewUpdate,
} from "@uiw/react-codemirror";
import { Loader2, Search, X } from "lucide-react";
import {
  type EditorTextMatch,
  type FileBlameLine,
  type FileContent,
  replaceEditorText,
  searchEditorText,
} from "../../lib/api";
import { formatDate } from "../../lib/dateFormat";
import { hasGitConflictMarkers } from "../../lib/editorDrafts";
import {
  filterVisibleEditorGitMarkers,
  gitMarkerLabel,
  revertEditorGitMarker,
  byteOffsetToUtf16,
  utf16OffsetForLine,
} from "../../lib/editorGitMarkers";
import type {
  EditorDraft,
  EditorFindState,
  EditorGitMarker,
  FileViewMode,
} from "../../lib/editorTypes";
import { nextMatchIndexAfter } from "../../lib/editorSearch";
import { clamp, wrapIndex } from "../../lib/numeric";
import type { PreviewTarget } from "../../lib/previewTabs";
import { GitMarkerPopover } from "./GitMarkerPopover";
import { MediaViewToolbar } from "./MediaViewToolbar";
import {
  DiskConflictEditor,
  GitConflictEditor,
} from "./MergeConflictEditor";
import { CodeMirrorView } from "./CodeMirrorView";

export function CodeMirrorFilePreview({
  blameError,
  blameLines,
  blameLoading,
  draft,
  editorSessionKey,
  error,
  file,
  gitConflictStatus,
  gitMarkers,
  loading,
  saveError,
  saving,
  selectedPath,
  target,
  onChangeDraft,
  onDiscardConflict,
  onSave,
  onSetConflictDraftContent,
}: {
  blameError: string | null;
  blameLines: FileBlameLine[];
  blameLoading: boolean;
  draft: EditorDraft | null;
  editorSessionKey: string | null;
  error: string | null;
  file: FileContent | null;
  gitConflictStatus?: boolean | null;
  gitMarkers: EditorGitMarker[];
  loading: boolean;
  saveError: string | null;
  saving: boolean;
  selectedPath: string | null;
  target: PreviewTarget | null;
  onChangeDraft(content: string): void;
  onDiscardConflict(): void;
  onSave(): void;
  onSetConflictDraftContent(content: string): void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const pendingEditorSelectionRef = useRef<{ start: number; end: number } | null>(
    null,
  );
  const editorSearchRequestRef = useRef(0);
  const editorSearchTimerRef = useRef<number | null>(null);
  const editorFindStatesRef = useRef(new Map<string, EditorFindState>());
  const currentEditorSessionKeyRef = useRef<string | null>(editorSessionKey);
  const currentEditorFindStateRef = useRef<EditorFindState>({
    open: false,
    replaceOpen: false,
    query: "",
    replaceText: "",
    activeIndex: 0,
  });
  const [editorView, setEditorView] = useState<CodeMirrorEditorView | null>(null);
  const [editorFindOpen, setEditorFindOpen] = useState(false);
  const [editorReplaceOpen, setEditorReplaceOpen] = useState(false);
  const [editorFindQuery, setEditorFindQuery] = useState("");
  const [editorReplaceText, setEditorReplaceText] = useState("");
  const [editorMatches, setEditorMatches] = useState<EditorTextMatch[]>([]);
  const [editorSearchPending, setEditorSearchPending] = useState(false);
  const [activeEditorMatchIndex, setActiveEditorMatchIndex] = useState(0);
  const [activeGitMarkerId, setActiveGitMarkerId] = useState<string | null>(null);
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>("source");
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [editorScrollLeft, setEditorScrollLeft] = useState(0);
  const [editorViewportHeight, setEditorViewportHeight] = useState(0);
  const [editorViewportWidth, setEditorViewportWidth] = useState(0);
  const [editorLineHeight, setEditorLineHeight] = useState(19);
  const [activeEditorLineNumber, setActiveEditorLineNumber] = useState(1);
  const [gitPopoverLeftOffset, setGitPopoverLeftOffset] = useState(0);
  const content = draft?.content ?? file?.content ?? "";
  const conflict = draft?.conflict ?? null;
  const mediaDataUrl = file?.mediaDataUrl ?? null;
  const mediaType = file?.mediaType ?? null;
  const renderableMedia = Boolean(mediaDataUrl && mediaType?.startsWith("image/"));
  const canShowMediaSource = Boolean(file && !file.binary && !file.tooLarge);
  const lines = useMemo(
    () => (content.length > 0 ? content.split(/\r?\n/) : [""]),
    [content],
  );
  const visibleGitMarkers = useMemo(
    () => filterVisibleEditorGitMarkers(gitMarkers, content),
    [content, gitMarkers],
  );
  const activeEditorMatch =
    editorMatches.length > 0
      ? editorMatches[Math.min(activeEditorMatchIndex, editorMatches.length - 1)]
      : null;
  const activeGitMarker =
    visibleGitMarkers.find((marker) => marker.id === activeGitMarkerId) ?? null;
  const gitPopoverWidth = Math.min(430, Math.max(260, editorViewportWidth - 74));
  const gitPopoverLeft = clamp(
    44 + gitPopoverLeftOffset,
    12,
    Math.max(12, editorViewportWidth - gitPopoverWidth - 12),
  );
  currentEditorFindStateRef.current = {
    open: editorFindOpen,
    replaceOpen: editorReplaceOpen,
    query: editorFindQuery,
    replaceText: editorReplaceText,
    activeIndex: activeEditorMatchIndex,
  };

  const blameLineByLine = useMemo(
    () => new Map(blameLines.map((line) => [line.lineNumber, line])),
    [blameLines],
  );
  const blameLineNumbers = useMemo(
    () => blameLines.map((line) => line.lineNumber),
    [blameLines],
  );
  const showBlameAnnotations =
    blameLoading || blameLines.length > 0 || Boolean(blameError);
  const showGitGutter = visibleGitMarkers.length > 0;
  const activeBlameRow = useMemo<VisibleBlameRow | null>(() => {
    if (!showBlameAnnotations) {
      return null;
    }

    if (blameLoading && blameLines.length === 0) {
      return {
        lineNumber: activeEditorLineNumber,
        text: "Loading blame...",
        title: "Loading blame...",
        tone: "status",
      };
    }

    if (blameError && blameLines.length === 0) {
      return {
        lineNumber: activeEditorLineNumber,
        text: "Blame unavailable",
        title: `Blame unavailable\n${blameError}`,
        tone: "status",
      };
    }

    let blameLine = blameLineByLine.get(activeEditorLineNumber);
    if (!blameLine && blameLineNumbers.length > 0) {
      for (let index = blameLineNumbers.length - 1; index >= 0; index -= 1) {
        const candidateLineNumber = blameLineNumbers[index];
        if (candidateLineNumber <= activeEditorLineNumber) {
          blameLine = blameLineByLine.get(candidateLineNumber);
          break;
        }
      }
      blameLine ??= blameLineByLine.get(blameLineNumbers[0]);
    }
    if (!blameLine) {
      return null;
    }

    return {
      lineNumber: blameLine.lineNumber,
      text: formatBlameLineText(blameLine),
      title: formatBlameLineTitle(blameLine),
      tone: blameLine.committed ? "default" : "uncommitted",
    };
  }, [
    activeEditorLineNumber,
    blameError,
    blameLineByLine,
    blameLineNumbers,
    blameLines.length,
    blameLoading,
    showBlameAnnotations,
  ]);
  const activeBlameOverlay = useMemo(() => {
    if (!activeBlameRow || !editorView || !stageRef.current) {
      return null;
    }

    const lineNumber = Math.min(
      Math.max(1, activeBlameRow.lineNumber),
      editorView.state.doc.lines,
    );
    const line = editorView.state.doc.line(lineNumber);
    const startCoords = editorView.coordsAtPos(line.from);
    const endCoords = editorView.coordsAtPos(line.to) ?? startCoords;
    if (!startCoords || !endCoords) {
      return {
        top: 8,
        height: editorLineHeight,
        left: 132,
      };
    }

    const stageRect = stageRef.current.getBoundingClientRect();
    const left = clamp(
      endCoords.right - stageRect.left + 28,
      132,
      Math.max(132, editorViewportWidth - 238),
    );
    return {
      top: clamp(
        startCoords.top - stageRect.top,
        0,
        Math.max(0, editorViewportHeight - editorLineHeight),
      ),
      height: editorLineHeight,
      left,
    };
  }, [
    activeBlameRow,
    editorLineHeight,
    editorScrollLeft,
    editorScrollTop,
    editorView,
    editorViewportHeight,
  ]);
  const gitMarkerSegmentsByLine = useMemo(() => {
    const segments = new Map<number, GitMarkerSegment>();

    for (const marker of visibleGitMarkers) {
      const span = Math.max(1, marker.lineCount);
      for (let index = 0; index < span; index += 1) {
        const position =
          span === 1
            ? "single"
            : index === 0
              ? "start"
              : index === span - 1
                ? "end"
                : "middle";
        segments.set(marker.line + index, {
          marker,
          position,
          active: activeGitMarkerId === marker.id,
        });
      }
    }

    return segments;
  }, [activeGitMarkerId, visibleGitMarkers]);

  const syncEditorMetrics = useCallback((view: CodeMirrorEditorView | null) => {
    if (!view) {
      return;
    }

    setEditorScrollTop(view.scrollDOM.scrollTop);
    setEditorScrollLeft(view.scrollDOM.scrollLeft);
    setEditorViewportHeight(view.scrollDOM.clientHeight);
    setEditorViewportWidth(view.scrollDOM.clientWidth);
    setEditorLineHeight(view.defaultLineHeight || 19);
    setActiveEditorLineNumber(view.state.doc.lineAt(view.state.selection.main.head).number);
  }, []);

  const revealEditorPosition = useCallback(
    (from: number, to: number, focusEditor: boolean) => {
      if (!editorView) {
        return;
      }

      editorView.dispatch({
        selection: { anchor: from, head: to },
        effects: CodeMirrorEditorView.scrollIntoView(from, { y: "center" }),
      });
      if (focusEditor) {
        editorView.focus();
      }
      syncEditorMetrics(editorView);
    },
    [editorView, syncEditorMetrics],
  );

  const revealEditorMatch = useCallback(
    (match: EditorTextMatch, focusEditor: boolean) => {
      revealEditorPosition(match.start, match.end, focusEditor);
    },
    [revealEditorPosition],
  );

  const openEditorFind = useCallback(
    (replace: boolean) => {
      setEditorFindOpen(true);
      setEditorReplaceOpen(replace);

      const selection = editorView?.state.selection.main;
      if (selection && !selection.empty) {
        setEditorFindQuery(editorView.state.sliceDoc(selection.from, selection.to));
        setActiveEditorMatchIndex(0);
      }
    },
    [editorView],
  );

  const closeEditorFind = useCallback(() => {
    setEditorFindOpen(false);
    setEditorReplaceOpen(false);
    editorView?.focus();
  }, [editorView]);

  const revealGitMarker = useCallback(
    (marker: EditorGitMarker) => {
      if (!editorView) {
        return;
      }

      const line = editorView.state.doc.line(Math.max(1, marker.line));
      editorView.dispatch({
        effects: CodeMirrorEditorView.scrollIntoView(line.from, { y: "center" }),
      });
      syncEditorMetrics(editorView);
    },
    [editorView, syncEditorMetrics],
  );

  const toggleGitMarker = useCallback(
    (marker: EditorGitMarker) => {
      setActiveGitMarkerId((current) => {
        const next = current === marker.id ? null : marker.id;
        if (next !== current) {
          setGitPopoverLeftOffset(0);
        }
        return next;
      });
      revealGitMarker(marker);
    },
    [revealGitMarker],
  );

  useLayoutEffect(() => {
    const previousKey = currentEditorSessionKeyRef.current;
    if (previousKey === editorSessionKey) {
      return;
    }

    if (previousKey) {
      editorFindStatesRef.current.set(previousKey, currentEditorFindStateRef.current);
    }

    const nextState = editorSessionKey
      ? editorFindStatesRef.current.get(editorSessionKey)
      : undefined;
    currentEditorSessionKeyRef.current = editorSessionKey;
    setEditorFindOpen(nextState?.open ?? false);
    setEditorReplaceOpen(nextState?.replaceOpen ?? false);
    setEditorFindQuery(nextState?.query ?? "");
    setEditorReplaceText(nextState?.replaceText ?? "");
    setActiveEditorMatchIndex(nextState?.activeIndex ?? 0);
    setEditorMatches([]);
    setEditorSearchPending(false);
  }, [editorSessionKey]);

  useEffect(() => {
    return () => {
      if (editorSearchTimerRef.current !== null) {
        window.clearTimeout(editorSearchTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!editorView) {
      return;
    }

    const handleScroll = () => syncEditorMetrics(editorView);
    handleScroll();
    editorView.scrollDOM.addEventListener("scroll", handleScroll, {
      passive: true,
    });
    const observer = new ResizeObserver(handleScroll);
    observer.observe(editorView.scrollDOM);

    return () => {
      observer.disconnect();
      editorView.scrollDOM.removeEventListener("scroll", handleScroll);
    };
  }, [editorView, syncEditorMetrics]);

  useEffect(() => {
    if (editorFindOpen) {
      const frame = window.requestAnimationFrame(() => {
        const input = editorReplaceOpen
          ? replaceInputRef.current
          : findInputRef.current;
        input?.focus({ preventScroll: true });
        input?.select();
      });

      return () => window.cancelAnimationFrame(frame);
    }
  }, [editorFindOpen, editorReplaceOpen]);

  useEffect(() => {
    if (!editorView) {
      return;
    }

    editorView.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: editorFindOpen ? editorFindQuery.trim() : "",
          replace: editorReplaceText,
        }),
      ),
    });
  }, [editorFindOpen, editorFindQuery, editorReplaceText, editorView]);

  useEffect(() => {
    const requestId = editorSearchRequestRef.current + 1;
    editorSearchRequestRef.current = requestId;
    const query = editorFindQuery.trim();

    if (editorSearchTimerRef.current !== null) {
      window.clearTimeout(editorSearchTimerRef.current);
      editorSearchTimerRef.current = null;
    }

    if (!editorFindOpen || !query) {
      setEditorMatches([]);
      setEditorSearchPending(false);
      setActiveEditorMatchIndex(0);
      return;
    }

    setEditorSearchPending(true);
    editorSearchTimerRef.current = window.setTimeout(() => {
      editorSearchTimerRef.current = null;
      searchEditorText(content, query)
        .then((response) => {
          if (editorSearchRequestRef.current !== requestId) {
            return;
          }
          setEditorMatches(response.matches);
          setActiveEditorMatchIndex(0);
          if (response.matches[0]) {
            window.requestAnimationFrame(() => {
              if (editorSearchRequestRef.current === requestId) {
                revealEditorMatch(response.matches[0], false);
              }
            });
          }
        })
        .catch(() => {
          if (editorSearchRequestRef.current !== requestId) {
            return;
          }
          setEditorMatches([]);
          setActiveEditorMatchIndex(0);
        })
        .finally(() => {
          if (editorSearchRequestRef.current === requestId) {
            setEditorSearchPending(false);
          }
        });
    }, 220);

    return () => {
      if (editorSearchTimerRef.current !== null) {
        window.clearTimeout(editorSearchTimerRef.current);
        editorSearchTimerRef.current = null;
      }
    };
  }, [content, editorFindOpen, editorFindQuery, revealEditorMatch]);

  useEffect(() => {
    if (activeEditorMatchIndex < editorMatches.length) {
      return;
    }

    setActiveEditorMatchIndex(Math.max(0, editorMatches.length - 1));
  }, [activeEditorMatchIndex, editorMatches.length]);

  useEffect(() => {
    setActiveGitMarkerId(null);
    setGitPopoverLeftOffset(0);
  }, [file?.path]);

  useEffect(() => {
    setEditorView(null);
  }, [file?.path]);

  useEffect(() => {
    if (renderableMedia && fileViewMode === "preview") {
      setEditorView(null);
    }
  }, [fileViewMode, renderableMedia]);

  useEffect(() => {
    if (!renderableMedia) {
      setFileViewMode("source");
      return;
    }

    setFileViewMode("preview");
  }, [file?.path, renderableMedia]);

  useEffect(() => {
    if (fileViewMode === "source" && !canShowMediaSource) {
      setFileViewMode("preview");
    }
  }, [canShowMediaSource, fileViewMode]);

  useEffect(() => {
    if (!activeGitMarkerId) {
      return;
    }

    if (!visibleGitMarkers.some((marker) => marker.id === activeGitMarkerId)) {
      setActiveGitMarkerId(null);
    }
  }, [activeGitMarkerId, visibleGitMarkers]);

  useLayoutEffect(() => {
    const pendingSelection = pendingEditorSelectionRef.current;
    if (!pendingSelection || !editorView) {
      return;
    }

    pendingEditorSelectionRef.current = null;
    revealEditorPosition(pendingSelection.start, pendingSelection.end, true);
  }, [content, editorView, revealEditorPosition]);

  useLayoutEffect(() => {
    if (
      !target ||
      !file ||
      !editorView ||
      (renderableMedia && fileViewMode === "preview")
    ) {
      return;
    }

    const lineStart = utf16OffsetForLine(content, target.line);
    const matchedLine = content.split(/\r?\n/)[target.line - 1] ?? "";
    const byteToUtf16 = byteOffsetToUtf16(matchedLine, target.column);
    const cursorOffset = lineStart + byteToUtf16;

    revealEditorPosition(cursorOffset, cursorOffset, true);
  }, [
    content,
    editorView,
    file,
    fileViewMode,
    renderableMedia,
    revealEditorPosition,
    target,
  ]);

  function selectEditorMatch(index: number, focusEditor = false) {
    if (editorMatches.length === 0) {
      return;
    }

    const nextIndex = wrapIndex(index, editorMatches.length);
    const match = editorMatches[nextIndex];
    setActiveEditorMatchIndex(nextIndex);
    revealEditorMatch(match, focusEditor);
  }

  async function replaceCurrentEditorMatch() {
    if (!activeEditorMatch) {
      return;
    }

    const sourceContent = content;
    const response = await replaceEditorText(
      sourceContent,
      editorFindQuery,
      editorReplaceText,
      activeEditorMatchIndex,
      false,
    );
    if (editorView && editorView.state.doc.toString() !== sourceContent) {
      return;
    }

    pendingEditorSelectionRef.current = {
      start: response.selectionStart,
      end: response.selectionEnd,
    };
    onChangeDraft(response.content);
    setEditorMatches(response.matches);
    setActiveEditorMatchIndex(
      nextMatchIndexAfter(response.matches, response.selectionEnd),
    );
  }

  async function replaceAllEditorMatches() {
    if (editorMatches.length === 0) {
      return;
    }

    const sourceContent = content;
    const response = await replaceEditorText(
      sourceContent,
      editorFindQuery,
      editorReplaceText,
      activeEditorMatchIndex,
      true,
    );
    if (editorView && editorView.state.doc.toString() !== sourceContent) {
      return;
    }

    pendingEditorSelectionRef.current = {
      start: response.selectionStart,
      end: response.selectionEnd,
    };
    onChangeDraft(response.content);
    setEditorMatches(response.matches);
    setActiveEditorMatchIndex(0);
  }

  function revertGitMarker(marker: EditorGitMarker) {
    const nextContent = revertEditorGitMarker(content, marker);
    const selectionLine = Math.max(1, marker.newStart);
    const selectionStart = utf16OffsetForLine(nextContent, selectionLine);

    pendingEditorSelectionRef.current = {
      start: selectionStart,
      end: selectionStart,
    };
    onChangeDraft(nextContent);
    setActiveGitMarkerId(null);
  }

  function handleEditorFindKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const key = event.key.toLowerCase();
    if (key === "escape") {
      event.preventDefault();
      closeEditorFind();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "r") {
      event.preventDefault();
      setEditorReplaceOpen(true);
      window.requestAnimationFrame(() => replaceInputRef.current?.focus());
      return;
    }
    if (key === "enter") {
      event.preventDefault();
      if (event.shiftKey) {
        selectEditorMatch(activeEditorMatchIndex - 1);
      } else {
        selectEditorMatch(activeEditorMatchIndex + 1);
      }
    }
  }

  const editorExtensions = useMemo<Extension[]>(() => {
    class GitGutterMarker extends GutterMarker {
      constructor(private readonly segment: GitMarkerSegment) {
        super();
      }

      toDOM() {
        const element = document.createElement("div");
        element.className = [
          "cm-git-marker-segment",
          this.segment.marker.kind,
          this.segment.position,
          this.segment.active ? "active" : "",
        ]
          .filter(Boolean)
          .join(" ");
        element.title = `${gitMarkerLabel(this.segment.marker.kind)} at line ${this.segment.marker.line}`;
        return element;
      }
    }

    return [
      search({ top: true, caseSensitive: false }),
      keymap.of([
        {
          key: "Mod-f",
          run: () => {
            openEditorFind(false);
            return true;
          },
        },
        {
          key: "Mod-r",
          run: () => {
            openEditorFind(true);
            return true;
          },
        },
        {
          key: "F3",
          run: () => {
            selectEditorMatch(activeEditorMatchIndex + 1, true);
            return true;
          },
        },
        {
          key: "Shift-F3",
          run: () => {
            selectEditorMatch(activeEditorMatchIndex - 1, true);
            return true;
          },
        },
      ]),
      lineNumbers(),
      ...(showGitGutter
        ? [
            gutter({
              class: "cm-git-gutter",
              lineMarker(view, line) {
                const segment = gitMarkerSegmentsByLine.get(
                  view.state.doc.lineAt(line.from).number,
                );
                return segment ? new GitGutterMarker(segment) : null;
              },
              domEventHandlers: {
                mousedown(view, line, event) {
                  const segment = gitMarkerSegmentsByLine.get(
                    view.state.doc.lineAt(line.from).number,
                  );
                  if (!segment) {
                    return false;
                  }

                  event.preventDefault();
                  toggleGitMarker(segment.marker);
                  view.focus();
                  return true;
                },
              },
            }),
          ]
        : []),
    ];
  }, [
    activeEditorMatchIndex,
    gitMarkerSegmentsByLine,
    openEditorFind,
    showGitGutter,
    selectEditorMatch,
    toggleGitMarker,
  ]);

  const activeGitMarkerTop = useMemo(() => {
    if (!editorView || !activeGitMarker || !stageRef.current) {
      return 8;
    }

    const line = editorView.state.doc.line(Math.max(1, activeGitMarker.line));
    const coords = editorView.coordsAtPos(line.from);
    if (!coords) {
      return 8;
    }

    const stageRect = stageRef.current.getBoundingClientRect();
    return Math.min(
      Math.max(coords.top - stageRect.top, 8),
      Math.max(8, editorViewportHeight - 190),
    );
  }, [activeGitMarker, editorView, editorScrollTop, editorViewportHeight]);

  if (loading) {
    return (
      <div className="diff-loading">
        <Loader2 className="spin" size={18} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-title">File could not be opened</div>
        <div className="empty-copy">{error}</div>
      </div>
    );
  }

  if (!selectedPath) {
    return (
      <div className="empty-state">
        <div className="empty-title">Select a file</div>
        <div className="empty-copy">
          The project tree shows tracked and untracked files from the repository.
        </div>
      </div>
    );
  }

  if (!file) {
    return null;
  }

  if (file.tooLarge) {
    return (
      <div className="empty-state">
        <div className="empty-title">File is too large</div>
        <div className="empty-copy">
          Files larger than the preview limit are not opened here.
        </div>
      </div>
    );
  }

  if (file.binary && !renderableMedia) {
    return (
      <div className="empty-state">
        <div className="empty-title">Binary file</div>
        <div className="empty-copy">{file.path} cannot be rendered as text.</div>
      </div>
    );
  }

  if (renderableMedia && fileViewMode === "preview") {
    return (
      <section className="media-preview-shell" aria-label={file.path}>
        <MediaViewToolbar
          canShowSource={canShowMediaSource}
          mediaType={mediaType}
          mode={fileViewMode}
          path={file.path}
          onChangeMode={setFileViewMode}
        />
        <div className="media-preview-stage">
          <img className="media-preview-image" src={mediaDataUrl ?? ""} alt={file.path} />
        </div>
      </section>
    );
  }

  const gitConflict =
    !conflict &&
    (gitConflictStatus === true ||
      (gitConflictStatus == null && hasGitConflictMarkers(content)));
  if (gitConflict) {
    return (
      <GitConflictEditor
        content={content}
        file={file}
        saveError={saveError}
        saving={saving}
        onChangeDraft={onChangeDraft}
        onSave={onSave}
      />
    );
  }

  if (conflict) {
    return (
      <DiskConflictEditor
        conflict={conflict}
        content={content}
        file={file}
        saveError={saveError}
        saving={saving}
        onChangeDraft={onChangeDraft}
        onDiscardConflict={onDiscardConflict}
        onSave={onSave}
        onSetConflictDraftContent={onSetConflictDraftContent}
      />
    );
  }

  const editorShellClassName = [
    "file-editor-shell",
    "code-mirror-editor-shell",
    editorFindOpen ? "find-open" : "",
    renderableMedia ? "media-source-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={editorShellClassName} aria-label={file.path}>
      {renderableMedia ? (
        <MediaViewToolbar
          canShowSource={canShowMediaSource}
          mediaType={mediaType}
          mode={fileViewMode}
          path={file.path}
          onChangeMode={setFileViewMode}
        />
      ) : null}
      {editorFindOpen ? (
        <div className="editor-findbar" onKeyDown={handleEditorFindKeyDown}>
          <Search size={14} />
          <input
            ref={findInputRef}
            aria-label="Find in file"
            placeholder="Find"
            value={editorFindQuery}
            onChange={(event) => {
              setEditorFindQuery(event.target.value);
              setActiveEditorMatchIndex(0);
            }}
          />
          <span className="editor-find-count">
            {editorSearchPending
              ? "..."
              : editorFindQuery
                ? `${editorMatches.length === 0 ? 0 : activeEditorMatchIndex + 1}/${editorMatches.length}`
                : "0/0"}
          </span>
          <button
            type="button"
            className="ghost-button editor-find-action"
            disabled={editorMatches.length === 0}
            onClick={() => selectEditorMatch(activeEditorMatchIndex - 1)}
          >
            Prev
          </button>
          <button
            type="button"
            className="ghost-button editor-find-action"
            disabled={editorMatches.length === 0}
            onClick={() => selectEditorMatch(activeEditorMatchIndex + 1)}
          >
            Next
          </button>
          <button
            type="button"
            className="ghost-button editor-find-action"
            onClick={() => {
              setEditorReplaceOpen((open) => {
                const nextOpen = !open;
                window.requestAnimationFrame(() => {
                  (nextOpen ? replaceInputRef.current : findInputRef.current)?.focus();
                });
                return nextOpen;
              });
            }}
          >
            {editorReplaceOpen ? "Hide Replace" : "Replace"}
          </button>
          {editorReplaceOpen ? (
            <>
              <input
                ref={replaceInputRef}
                aria-label="Replace in file"
                placeholder="Replace"
                value={editorReplaceText}
                onChange={(event) => setEditorReplaceText(event.target.value)}
              />
              <button
                type="button"
                className="ghost-button editor-find-action"
                disabled={!activeEditorMatch}
                onClick={replaceCurrentEditorMatch}
              >
                Replace
              </button>
              <button
                type="button"
                className="ghost-button editor-find-action"
                disabled={editorMatches.length === 0}
                onClick={replaceAllEditorMatches}
              >
                All
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="icon-button editor-find-close"
            aria-label="Close find"
            onClick={closeEditorFind}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
      <div ref={stageRef} className="file-editor-stage code-mirror-editor-stage">
        <CodeMirrorView
          key={file.path}
          className="code-mirror-file-editor"
          path={file.path}
          value={content}
          readOnly={false}
          editable
          basicSetup={{
            drawSelection: false,
            lineNumbers: false,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            foldGutter: false,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
            searchKeymap: false,
          }}
          extensions={editorExtensions}
          onChange={onChangeDraft}
          onCreateEditor={(view) => {
            setEditorView(view);
            syncEditorMetrics(view);
          }}
          onUpdate={(update: ViewUpdate) => {
            if (
              update.docChanged ||
              update.geometryChanged ||
              update.selectionSet ||
              update.viewportChanged
            ) {
              syncEditorMetrics(update.view);
            }
          }}
        />
        {activeBlameRow && activeBlameOverlay ? (
          <div
            className={`editor-active-blame ${activeBlameRow.tone}`}
            style={
              {
                top: `${activeBlameOverlay.top}px`,
                height: `${activeBlameOverlay.height}px`,
                left: `${activeBlameOverlay.left}px`,
              } as CSSProperties
            }
            title={activeBlameRow.title}
            aria-hidden="true"
          >
            <span className="editor-active-blame-text">{activeBlameRow.text}</span>
          </div>
        ) : null}
        {visibleGitMarkers.length > 0 ? (
          <div className="editor-git-overview" aria-hidden="true">
            {visibleGitMarkers.map((marker) => (
              <span
                key={`overview-${marker.id}`}
                className={`editor-git-overview-marker ${marker.kind}`}
                style={
                  {
                    top: `${Math.max(0, ((marker.line - 1) / Math.max(1, lines.length)) * 100)}%`,
                    height: `${Math.max(3, (marker.lineCount / Math.max(1, lines.length)) * 100)}%`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        ) : null}
        {activeGitMarker ? (
          <GitMarkerPopover
            left={gitPopoverLeft}
            marker={activeGitMarker}
            top={activeGitMarkerTop}
            onClose={() => setActiveGitMarkerId(null)}
            onMoveHorizontal={(delta: number) =>
              setGitPopoverLeftOffset((current) => current + delta)
            }
            onRevert={() => revertGitMarker(activeGitMarker)}
          />
        ) : null}
      </div>
      {saveError ? <div className="editor-error">{saveError}</div> : null}
    </section>
  );
}

interface VisibleBlameRow {
  readonly lineNumber: number;
  readonly text: string;
  readonly title: string;
  readonly tone: "default" | "status" | "uncommitted";
}

interface GitMarkerSegment {
  readonly marker: EditorGitMarker;
  readonly position: "start" | "middle" | "end" | "single";
  readonly active: boolean;
}

function formatBlameLineText(line: FileBlameLine): string {
  if (!line.committed) {
    return "Working tree";
  }

  const shortHash = line.shortHash ?? "unknown";
  const author = line.author.trim() || "Unknown author";
  const summary = line.summary.trim();
  if (summary.length > 0) {
    return `${shortHash} ${author}: ${summary}`;
  }

  return `${shortHash} ${author}`;
}

function formatBlameLineTitle(line: FileBlameLine): string {
  const hashLabel = line.commitHash ?? "Working tree";
  const authorLabel = line.author.trim() || "Unknown author";
  const dateLabel =
    typeof line.authorTime === "number"
      ? formatDate(new Date(line.authorTime * 1000).toISOString())
      : "Unknown date";
  const summaryLabel =
    line.summary.trim() ||
    (line.committed ? "No commit summary" : "Uncommitted changes");

  return [hashLabel, authorLabel, dateLabel, summaryLabel].join("\n");
}
