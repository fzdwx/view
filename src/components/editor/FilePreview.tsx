import {
  type CSSProperties,
  type KeyboardEvent,
  type UIEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, Search, X } from "lucide-react";
import {
  type EditorTextMatch,
  type FileContent,
  replaceEditorText,
  searchEditorText,
} from "../../lib/api";
import { parseCssPixels } from "../../lib/cssPixels";
import { hasGitConflictMarkers } from "../../lib/editorDrafts";
import {
  filterVisibleEditorGitMarkers,
  revertEditorGitMarker,
  byteOffsetToUtf16,
  utf16OffsetForLine,
} from "../../lib/editorGitMarkers";
import {
  buildEditorSearchHighlightSegments,
  editorMatchHorizontalBounds,
  getTextareaSelection,
  measureEditorLineHeight,
  nextMatchIndexAfter,
} from "../../lib/editorSearch";
import type {
  EditorDraft,
  EditorFindState,
  EditorGitMarker,
  EditorScrollMetrics,
  FileViewMode,
} from "../../lib/editorTypes";
import { clamp, wrapIndex } from "../../lib/numeric";
import type { PreviewTarget } from "../../lib/previewTabs";
import { GitMarkerPopover } from "./GitMarkerPopover";
import { MediaViewToolbar } from "./MediaViewToolbar";
import {
  DiskConflictEditor,
  GitConflictEditor,
} from "./MergeConflictEditor";

export function FilePreview({
  draft,
  editorSessionKey,
  error,
  file,
  editorFontSize,
  editorLineHeightRatio,
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
  draft: EditorDraft | null;
  editorSessionKey: string | null;
  error: string | null;
  file: FileContent | null;
  editorFontSize: number;
  editorLineHeightRatio: number;
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
  const frameRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const targetLineRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lineNumberTextareaRef = useRef<HTMLTextAreaElement | null>(null);
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
  const pendingEditorScrollMetricsRef = useRef<EditorScrollMetrics | null>(null);
  const editorScrollFrameRef = useRef<number | null>(null);
  const activeEditorMatchCorrectionFrameRef = useRef<number | null>(null);
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
  const [editorLineHeight, setEditorLineHeight] = useState(
    editorFontSize * editorLineHeightRatio,
  );
  const [editorPaddingTop, setEditorPaddingTop] = useState(12);
  const [gitPopoverLeftOffset, setGitPopoverLeftOffset] = useState(0);
  const content = draft?.content ?? file?.content ?? "";
  const conflict = draft?.conflict ?? null;
  const mediaDataUrl = file?.mediaDataUrl ?? null;
  const mediaType = file?.mediaType ?? null;
  const renderableMedia = Boolean(mediaDataUrl && mediaType?.startsWith("image/"));
  const canShowMediaSource = Boolean(file && !file.binary && !file.tooLarge);
  const fallbackEditorLineHeight = editorFontSize * editorLineHeightRatio;
  currentEditorFindStateRef.current = {
    open: editorFindOpen,
    replaceOpen: editorReplaceOpen,
    query: editorFindQuery,
    replaceText: editorReplaceText,
    activeIndex: activeEditorMatchIndex,
  };
  const lines = useMemo(() => {
    if (!content) {
      return [];
    }

    return content.length > 0 ? content.split(/\r?\n/) : [""];
  }, [content]);
  const visibleGitMarkers = useMemo(
    () => filterVisibleEditorGitMarkers(gitMarkers, content),
    [content, gitMarkers],
  );
  const activeEditorMatch =
    editorMatches.length > 0
      ? editorMatches[Math.min(activeEditorMatchIndex, editorMatches.length - 1)]
      : null;
  const editorSearchHighlightSegments = useMemo(
    () =>
      editorFindOpen
        ? buildEditorSearchHighlightSegments(
            content,
            editorMatches,
            activeEditorMatchIndex,
          )
        : [],
    [activeEditorMatchIndex, content, editorFindOpen, editorMatches],
  );
  const activeGitMarker =
    visibleGitMarkers.find((marker) => marker.id === activeGitMarkerId) ?? null;
  const gitPopoverWidth = Math.min(430, Math.max(260, editorViewportWidth - 74));
  const gitPopoverLeft = clamp(
    44 + gitPopoverLeftOffset,
    12,
    Math.max(12, editorViewportWidth - gitPopoverWidth - 12),
  );
  const editorLineNumberText = useMemo(
    () =>
      Array.from({ length: Math.max(1, lines.length) }, (_, index) =>
        String(index + 1),
      ).join("\n"),
    [lines.length],
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
      if (editorScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(editorScrollFrameRef.current);
        editorScrollFrameRef.current = null;
      }
      if (activeEditorMatchCorrectionFrameRef.current !== null) {
        window.cancelAnimationFrame(activeEditorMatchCorrectionFrameRef.current);
        activeEditorMatchCorrectionFrameRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!target || !file) {
      return;
    }

    const frame = frameRef.current;
    const line = targetLineRef.current;
    if (!frame || !line) {
      return;
    }

    const frameRect = frame.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const nextTop =
      frame.scrollTop +
      lineRect.top -
      frameRect.top -
      (frame.clientHeight - lineRect.height) / 2;

    frame.scrollTo({
      top: Math.max(0, nextTop),
      left: frame.scrollLeft,
      behavior: "auto",
    });
  }, [content, file, target]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!target || !textarea) {
      return;
    }

    if (textarea.value !== content) {
      textarea.value = content;
    }
    const lineStart = utf16OffsetForLine(content, target.line);
    // Convert byte offset within the matched line to UTF-16 offset
    const lines = content.split(/\r?\n/);
    const matchedLine = lines[target.line - 1] ?? "";
    const byteToUtf16 = byteOffsetToUtf16(matchedLine, target.column);
    const cursorOffset = lineStart + byteToUtf16;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(cursorOffset, cursorOffset);
    scrollEditorLineIntoView(
      textarea,
      target.line,
      editorLineHeight,
      editorPaddingTop,
    );
    syncEditorScrollMetrics(textarea, true);
  }, [content, editorLineHeight, editorPaddingTop, file?.path, target]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.value === content) {
      return;
    }

    textarea.value = content;
    syncEditorScrollMetrics(textarea, true);
  }, [content, file?.path]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const updateViewportHeight = () => {
      const style = window.getComputedStyle(textarea);
      setEditorViewportHeight(textarea.clientHeight);
      setEditorViewportWidth(textarea.clientWidth);
      setEditorLineHeight(measureEditorLineHeight(style, fallbackEditorLineHeight));
      setEditorPaddingTop(parseCssPixels(style.paddingTop, 12));
      syncEditorScrollMetrics(textarea, true);
    };
    updateViewportHeight();
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [editorFontSize, fallbackEditorLineHeight, file?.path]);

  useEffect(() => {
    if (!editorFindOpen) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const input = editorReplaceOpen
        ? replaceInputRef.current
        : findInputRef.current;
      input?.focus({ preventScroll: true });
      input?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editorFindOpen, editorReplaceOpen]);

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
  }, [content, editorFindOpen, editorFindQuery, editorReplaceOpen]);

  useEffect(() => {
    if (activeEditorMatchIndex < editorMatches.length) {
      return;
    }

    setActiveEditorMatchIndex(Math.max(0, editorMatches.length - 1));
  }, [activeEditorMatchIndex, editorMatches.length]);

  useLayoutEffect(() => {
    if (!editorFindOpen || !activeEditorMatch) {
      return;
    }

    scheduleActiveEditorMatchScrollCorrection();
  }, [activeEditorMatch, editorFindOpen, editorSearchHighlightSegments]);

  useEffect(() => {
    setActiveGitMarkerId(null);
    setGitPopoverLeftOffset(0);
  }, [file?.path]);

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
    if (!pendingSelection || !textareaRef.current) {
      return;
    }

    pendingEditorSelectionRef.current = null;
    textareaRef.current.focus({ preventScroll: true });
    textareaRef.current.setSelectionRange(
      pendingSelection.start,
      pendingSelection.end,
    );
  }, [content]);

  function openEditorFind(replace: boolean) {
    setEditorFindOpen(true);
    setEditorReplaceOpen(replace);
    const selection = getTextareaSelection(textareaRef.current);
    if (selection && selection.start !== selection.end) {
      setEditorFindQuery(content.slice(selection.start, selection.end));
      setActiveEditorMatchIndex(0);
    }
  }

  function closeEditorFind() {
    setEditorFindOpen(false);
    setEditorReplaceOpen(false);
    textareaRef.current?.focus({ preventScroll: true });
  }

  function applyEditorScrollVars(metrics: EditorScrollMetrics) {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    stage.style.setProperty("--editor-scroll-top", `${metrics.top}px`);
    stage.style.setProperty("--editor-scroll-left", `${metrics.left}px`);
    if (lineNumberTextareaRef.current) {
      lineNumberTextareaRef.current.scrollTop = metrics.top;
    }
  }

  function commitEditorScrollMetrics(metrics: EditorScrollMetrics) {
    setEditorScrollTop(metrics.top);
    setEditorScrollLeft(metrics.left);
    setEditorViewportHeight(metrics.height);
    setEditorViewportWidth(metrics.width);
  }

  function syncEditorScrollMetrics(
    textarea: HTMLTextAreaElement,
    immediate: boolean,
  ) {
    const metrics: EditorScrollMetrics = {
      top: textarea.scrollTop,
      left: textarea.scrollLeft,
      height: textarea.clientHeight,
      width: textarea.clientWidth,
    };
    applyEditorScrollVars(metrics);

    if (immediate) {
      if (editorScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(editorScrollFrameRef.current);
        editorScrollFrameRef.current = null;
      }
      pendingEditorScrollMetricsRef.current = null;
      commitEditorScrollMetrics(metrics);
      return;
    }

    pendingEditorScrollMetricsRef.current = metrics;
    if (editorScrollFrameRef.current !== null) {
      return;
    }

    editorScrollFrameRef.current = window.requestAnimationFrame(() => {
      editorScrollFrameRef.current = null;
      const pendingMetrics = pendingEditorScrollMetricsRef.current;
      pendingEditorScrollMetricsRef.current = null;
      if (pendingMetrics) {
        commitEditorScrollMetrics(pendingMetrics);
      }
    });
  }

  function selectEditorMatch(index: number, focusEditor = false) {
    if (editorMatches.length === 0 || !textareaRef.current) {
      return;
    }

    const nextIndex = wrapIndex(index, editorMatches.length);
    const match = editorMatches[nextIndex];
    setActiveEditorMatchIndex(nextIndex);
    revealEditorMatch(match, focusEditor);
  }

  function revealEditorMatch(match: EditorTextMatch, focusEditor: boolean) {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.setSelectionRange(match.start, match.end);
    if (focusEditor) {
      textarea.focus({ preventScroll: true });
    }
    scrollEditorMatchIntoView(
      textarea,
      content,
      match,
      editorLineHeight,
      editorPaddingTop,
    );
    syncEditorScrollMetrics(textarea, true);
    scheduleActiveEditorMatchScrollCorrection();
  }

  function scrollEditorLineIntoView(
    textarea: HTMLTextAreaElement,
    lineNumber: number,
    lineHeight: number,
    paddingTop: number,
  ) {
    const lineTop = paddingTop + (lineNumber - 1) * lineHeight;
    const lineBottom = lineTop + lineHeight;
    const visibleTop = textarea.scrollTop;
    const visibleBottom = visibleTop + textarea.clientHeight;
    const verticalMargin = Math.min(lineHeight * 4, textarea.clientHeight / 3);

    if (
      lineTop < visibleTop + verticalMargin ||
      lineBottom > visibleBottom - verticalMargin
    ) {
      textarea.scrollTop = Math.max(
        0,
        lineTop - textarea.clientHeight / 2 + lineHeight,
      );
    }
  }

  function scrollEditorMatchIntoView(
    textarea: HTMLTextAreaElement,
    sourceContent: string,
    match: EditorTextMatch,
    lineHeight: number,
    paddingTop: number,
  ) {
    scrollEditorLineIntoView(textarea, match.lineNumber, lineHeight, paddingTop);

    const horizontalBounds = editorMatchHorizontalBounds(
      sourceContent,
      match,
      textarea,
    );
    if (!horizontalBounds) {
      return;
    }

    const visibleLeft = textarea.scrollLeft;
    const visibleRight = visibleLeft + textarea.clientWidth;
    const matchLeft = horizontalBounds.left;
    const matchRight = horizontalBounds.left + horizontalBounds.width;
    const horizontalMargin = 24;

    if (
      matchLeft < visibleLeft + horizontalMargin ||
      matchRight > visibleRight - horizontalMargin
    ) {
      textarea.scrollLeft = Math.max(
        0,
        matchLeft + horizontalBounds.width / 2 - textarea.clientWidth / 2,
      );
    }
  }

  function correctActiveEditorMatchScroll() {
    const textarea = textareaRef.current;
    const stage = stageRef.current;
    if (!textarea || !stage) {
      return;
    }

    const activeMatchElement = stage.querySelector<HTMLElement>(
      ".editor-search-match.active",
    );
    if (!activeMatchElement) {
      return;
    }

    const editorRect = textarea.getBoundingClientRect();
    const matchRect = activeMatchElement.getBoundingClientRect();
    const horizontalMargin = Math.min(96, Math.max(32, textarea.clientWidth * 0.12));
    const verticalMargin = Math.min(
      editorLineHeight * 3,
      textarea.clientHeight / 3,
    );
    let nextScrollLeft = textarea.scrollLeft;
    let nextScrollTop = textarea.scrollTop;

    if (matchRect.left < editorRect.left + horizontalMargin) {
      nextScrollLeft -= editorRect.left + horizontalMargin - matchRect.left;
    } else if (matchRect.right > editorRect.right - horizontalMargin) {
      nextScrollLeft += matchRect.right - (editorRect.right - horizontalMargin);
    }

    if (matchRect.top < editorRect.top + verticalMargin) {
      nextScrollTop -= editorRect.top + verticalMargin - matchRect.top;
    } else if (matchRect.bottom > editorRect.bottom - verticalMargin) {
      nextScrollTop += matchRect.bottom - (editorRect.bottom - verticalMargin);
    }

    const clampedLeft = clamp(
      nextScrollLeft,
      0,
      Math.max(0, textarea.scrollWidth - textarea.clientWidth),
    );
    const clampedTop = clamp(
      nextScrollTop,
      0,
      Math.max(0, textarea.scrollHeight - textarea.clientHeight),
    );

    if (
      Math.abs(clampedLeft - textarea.scrollLeft) < 1 &&
      Math.abs(clampedTop - textarea.scrollTop) < 1
    ) {
      return;
    }

    textarea.scrollLeft = clampedLeft;
    textarea.scrollTop = clampedTop;
    syncEditorScrollMetrics(textarea, true);
  }

  function scheduleActiveEditorMatchScrollCorrection() {
    if (activeEditorMatchCorrectionFrameRef.current !== null) {
      window.cancelAnimationFrame(activeEditorMatchCorrectionFrameRef.current);
    }

    activeEditorMatchCorrectionFrameRef.current = window.requestAnimationFrame(() => {
      correctActiveEditorMatchScroll();
      activeEditorMatchCorrectionFrameRef.current = window.requestAnimationFrame(() => {
        activeEditorMatchCorrectionFrameRef.current = null;
        correctActiveEditorMatchScroll();
      });
    });
  }

  async function replaceCurrentEditorMatch() {
    const textarea = textareaRef.current;
    if (!textarea || !activeEditorMatch) {
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
    if (textarea.value !== sourceContent) {
      return;
    }
    textarea.focus({ preventScroll: true });
    textarea.setRangeText(
      editorReplaceText,
      activeEditorMatch.start,
      activeEditorMatch.end,
      "select",
    );
    pendingEditorSelectionRef.current = {
      start: response.selectionStart,
      end: response.selectionEnd,
    };
    onChangeDraft(textarea.value);
    setEditorMatches(response.matches);
    setActiveEditorMatchIndex(nextMatchIndexAfter(response.matches, response.selectionEnd));
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
    const textarea = textareaRef.current;
    if (textarea) {
      if (textarea.value !== sourceContent) {
        return;
      }
      textarea.focus({ preventScroll: true });
      textarea.setRangeText(response.content, 0, textarea.value.length, "start");
      onChangeDraft(textarea.value);
    } else {
      onChangeDraft(response.content);
    }
    pendingEditorSelectionRef.current = {
      start: response.selectionStart,
      end: response.selectionEnd,
    };
    setEditorMatches(response.matches);
    setActiveEditorMatchIndex(0);
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "f") {
      event.preventDefault();
      openEditorFind(false);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "r") {
      event.preventDefault();
      openEditorFind(true);
    }
  }

  function handleEditorScroll(event: UIEvent<HTMLTextAreaElement>) {
    syncEditorScrollMetrics(event.currentTarget, false);
  }

  function revealGitMarker(marker: EditorGitMarker) {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const lineTop = editorPaddingTop + (marker.line - 1) * editorLineHeight;
    const visibleTop = textarea.scrollTop;
    const visibleBottom = visibleTop + textarea.clientHeight;
    const margin = editorLineHeight * 3;

    if (lineTop < visibleTop + margin || lineTop > visibleBottom - margin) {
      textarea.scrollTop = Math.max(
        0,
        lineTop - textarea.clientHeight / 2 + editorLineHeight,
      );
    }
    syncEditorScrollMetrics(textarea, true);
  }

  function toggleGitMarker(marker: EditorGitMarker) {
    setActiveGitMarkerId((current) => {
      const next = current === marker.id ? null : marker.id;
      if (next !== current) {
        setGitPopoverLeftOffset(0);
      }
      return next;
    });
    revealGitMarker(marker);
  }

  function revertGitMarker(marker: EditorGitMarker) {
    const nextContent = revertEditorGitMarker(content, marker);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.focus({ preventScroll: true });
      textarea.value = nextContent;
      const selectionLine = Math.max(1, marker.newStart);
      const selectionStart = utf16OffsetForLine(nextContent, selectionLine);
      textarea.setSelectionRange(selectionStart, selectionStart);
      textarea.scrollTop = editorScrollTop;
      syncEditorScrollMetrics(textarea, true);
    }
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

  const gitConflict = !conflict && hasGitConflictMarkers(content);
  if (gitConflict) {
    return (
      <GitConflictEditor
        content={content}
        file={file}
        saveError={saveError}
        saving={saving}
        textareaRef={textareaRef}
        onChangeDraft={onChangeDraft}
        onEditorKeyDown={handleEditorKeyDown}
        onEditorScroll={handleEditorScroll}
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
        textareaRef={textareaRef}
        onChangeDraft={onChangeDraft}
        onDiscardConflict={onDiscardConflict}
        onEditorKeyDown={handleEditorKeyDown}
        onEditorScroll={handleEditorScroll}
        onSave={onSave}
        onSetConflictDraftContent={onSetConflictDraftContent}
      />
    );
  }

  const editorShellClassName = [
    "file-editor-shell",
    editorFindOpen ? "find-open" : "",
    renderableMedia ? "media-source-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={editorShellClassName}
      aria-label={file.path}
    >
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
      {target ? (
        <section ref={frameRef} className="file-preview-frame target-preview" aria-hidden="true">
          <div className="file-preview-code" role="presentation">
            {lines.map((line, index) => {
              const lineNumber = index + 1;
              const active = target.line === lineNumber;

              return (
                <div
                  key={lineNumber}
                  ref={active ? targetLineRef : undefined}
                  className={active ? "file-preview-line active" : "file-preview-line"}
                >
                  <span className="file-preview-line-number">{lineNumber}</span>
                  <span className="file-preview-line-code">
                    {line.length > 0 ? line : " "}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      <div
        ref={stageRef}
        className="file-editor-stage"
        style={
          {
            "--editor-scroll-top": `${editorScrollTop}px`,
            "--editor-scroll-left": `${editorScrollLeft}px`,
            "--editor-padding-top": `${editorPaddingTop}px`,
          } as CSSProperties
        }
      >
        <textarea
          ref={lineNumberTextareaRef}
          className="editor-line-number-gutter"
          value={editorLineNumberText}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          spellCheck={false}
        />
        {editorSearchHighlightSegments.length > 0 ? (
          <div className="editor-search-highlights" aria-hidden="true">
            <pre
              className="editor-search-highlights-content"
              style={
                {
                  transform: `translate(${-editorScrollLeft}px, ${-editorScrollTop}px)`,
                } as CSSProperties
              }
            >
              {editorSearchHighlightSegments.map((segment, index) => (
                <span
                  key={`${segment.kind}-${index}`}
                  className={
                    segment.kind === "match"
                      ? "editor-search-match active"
                      : "editor-search-plain"
                  }
                >
                  {segment.text}
                </span>
              ))}
            </pre>
          </div>
        ) : null}
        {visibleGitMarkers.length > 0 ? (
          <>
            <div className="editor-git-gutter" aria-label="File changes">
              {visibleGitMarkers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  className={
                    activeGitMarkerId === marker.id
                      ? `editor-git-marker ${marker.kind} active`
                      : `editor-git-marker ${marker.kind}`
                  }
                  aria-label={`${marker.kind} change at line ${marker.line}`}
                  onClick={() => toggleGitMarker(marker)}
                  style={
                    {
                      top: `calc(var(--editor-padding-top) + ${(marker.line - 1) * editorLineHeight}px - var(--editor-scroll-top))`,
                      height: `${Math.max(1, marker.lineCount) * editorLineHeight}px`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
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
          </>
        ) : null}
        {activeGitMarker ? (
          <GitMarkerPopover
            left={gitPopoverLeft}
            marker={activeGitMarker}
            top={Math.min(
              Math.max(
                editorPaddingTop +
                  (activeGitMarker.line - 1) * editorLineHeight -
                  editorScrollTop,
                8,
              ),
              Math.max(8, editorViewportHeight - 190),
            )}
            onClose={() => setActiveGitMarkerId(null)}
            onMoveHorizontal={(delta: number) =>
              setGitPopoverLeftOffset((current) => current + delta)
            }
            onRevert={() => revertGitMarker(activeGitMarker)}
          />
        ) : null}
        <textarea
          ref={textareaRef}
          className="file-editor"
          spellCheck={false}
          wrap="off"
          defaultValue={content}
          onKeyDown={handleEditorKeyDown}
          onScroll={handleEditorScroll}
          onChange={(event) => onChangeDraft(event.target.value)}
        />
      </div>
      {saveError ? <div className="editor-error">{saveError}</div> : null}
    </section>
  );
}
