import {
  isTerminalHyperlinkEventTarget,
  keyToTerminalInput,
  mouseButtonCode,
  mouseModifierCode,
  normalizeWheelLines,
  selectedTextWithin,
  terminalMouseEnabled,
  terminalMousePosition,
  terminalMouseSequence,
} from "./terminalInput";
import {
  terminalScrollDeltaForKey,
} from "./terminalFrameWindow";
import { shouldConfirmTerminalPaste } from "./terminalPasteProtection";
import {
  MIN_TERMINAL_ROWS,
  type TerminalCellMetrics,
  type TerminalFrame,
  type TerminalInput,
  type TerminalModes,
} from "./terminalTypes";

type RefBox<T> = {
  current: T;
};

export type TerminalScrollDirection = "up" | "down" | "bottom";

export interface TerminalScreenHandlerContext {
  readonly cellMetricsRef: RefBox<TerminalCellMetrics>;
  readonly frameRef: RefBox<TerminalFrame | null>;
  readonly modesRef: RefBox<TerminalModes>;
  readonly mouseButtonRef: RefBox<number | null>;
  readonly screenElement: HTMLElement;
  readonly scrollTerminal: (delta: number, direction: TerminalScrollDirection) => void;
  readonly sendInput: (data: TerminalInput | null) => void;
  readonly sendUserInput: (data: TerminalInput | null) => void;
  readonly wheelScrollAccumulatorRef: RefBox<number>;
}

export function attachTerminalScreenHandlers(
  context: TerminalScreenHandlerContext,
): () => void {
  const {
    cellMetricsRef,
    frameRef,
    modesRef,
    mouseButtonRef,
    screenElement,
    scrollTerminal,
    sendInput,
    sendUserInput,
    wheelScrollAccumulatorRef,
  } = context;
  let pendingWheelScrollDelta = 0;
  let wheelScrollFrame: number | null = null;
  const flushWheelScroll = () => {
    wheelScrollFrame = null;
    const delta = pendingWheelScrollDelta;
    pendingWheelScrollDelta = 0;
    if (delta === 0) {
      return;
    }
    scrollTerminal(delta, delta > 0 ? "up" : "down");
  };
  const queueWheelScroll = (delta: number) => {
    if (delta === 0) {
      return;
    }
    if (
      pendingWheelScrollDelta !== 0 &&
      Math.sign(pendingWheelScrollDelta) !== Math.sign(delta)
    ) {
      if (wheelScrollFrame != null) {
        window.cancelAnimationFrame(wheelScrollFrame);
        wheelScrollFrame = null;
      }
      flushWheelScroll();
    }
    pendingWheelScrollDelta += delta;
    if (wheelScrollFrame == null) {
      wheelScrollFrame = window.requestAnimationFrame(flushWheelScroll);
    }
  };
  const pasteText = (text: string) => {
    if (!text) {
      return;
    }
    if (
      shouldConfirmTerminalPaste(text) &&
      !window.confirm(terminalPasteConfirmMessage(text))
    ) {
      return;
    }
    const normalizedText = text.replace(/\r?\n/g, "\r");
    sendUserInput(
      modesRef.current.bracketedPaste
        ? `\x1b[200~${normalizedText}\x1b[201~`
        : normalizedText,
    );
  };
  const copySelectedText = (clipboardData?: DataTransfer | null) => {
    const selectedText = selectedTextWithin(screenElement);
    if (!selectedText) {
      return false;
    }
    clipboardData?.setData("text/plain", selectedText);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(selectedText).catch(() => undefined);
    }
    return true;
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (isTerminalHyperlinkEventTarget(event.target)) {
      return;
    }
    const key = event.key.toLowerCase();
    const usesClipboardShortcut = (event.ctrlKey || event.metaKey) && event.shiftKey;
    if (usesClipboardShortcut && key === "c") {
      event.preventDefault();
      copySelectedText();
      return;
    }
    if (usesClipboardShortcut && key === "v") {
      event.preventDefault();
      if (navigator.clipboard?.readText) {
        void navigator.clipboard.readText().then(pasteText).catch(() => undefined);
      }
      return;
    }
    const scrollDelta = terminalScrollDeltaForKey(frameRef.current, event);
    if (scrollDelta != null) {
      event.preventDefault();
      if (scrollDelta !== 0) {
        scrollTerminal(
          scrollDelta,
          event.key === "End" ? "bottom" : scrollDelta > 0 ? "up" : "down",
        );
      }
      return;
    }
    const input = keyToTerminalInput(event, modesRef.current);
    if (input == null) {
      return;
    }
    event.preventDefault();
    sendUserInput(input);
  };
  const handleCopy = (event: ClipboardEvent) => {
    if (!copySelectedText(event.clipboardData)) {
      return;
    }
    event.preventDefault();
  };
  const handlePaste = (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text/plain");
    if (!text) {
      return;
    }
    event.preventDefault();
    pasteText(text);
  };
  const handleFocus = () => {
    if (modesRef.current.focusInOut) {
      sendInput("\x1b[I");
    }
  };
  const handleBlur = () => {
    mouseButtonRef.current = null;
    if (modesRef.current.focusInOut) {
      sendInput("\x1b[O");
    }
  };
  const handleMouseDown = (event: MouseEvent) => {
    if (isTerminalHyperlinkEventTarget(event.target) || !terminalMouseEnabled(modesRef.current)) {
      return;
    }
    const button = mouseButtonCode(event.button);
    if (button == null) {
      return;
    }
    event.preventDefault();
    screenElement.focus({ preventScroll: true });
    mouseButtonRef.current = button;
    sendMouseEvent(event, button, true, context);
  };
  const handleMouseUp = (event: MouseEvent) => {
    if (isTerminalHyperlinkEventTarget(event.target) || !terminalMouseEnabled(modesRef.current)) {
      return;
    }
    const button = mouseButtonRef.current ?? mouseButtonCode(event.button);
    if (button == null) {
      return;
    }
    event.preventDefault();
    mouseButtonRef.current = null;
    sendMouseEvent(event, button, false, context);
  };
  const handleMouseMove = (event: MouseEvent) => {
    const modes = modesRef.current;
    const activeButton = mouseButtonRef.current;
    if (!terminalMouseEnabled(modes) || !(modes.mouseMotion || (modes.mouseDrag && activeButton != null))) {
      return;
    }
    event.preventDefault();
    sendMouseEvent(event, (activeButton ?? 3) + 32, true, context);
  };
  const handleWheel = (event: WheelEvent) => {
    if (terminalMouseEnabled(modesRef.current)) {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 64 : 65;
      sendMouseEvent(event, direction, true, context);
      return;
    }
    event.preventDefault();
    wheelScrollAccumulatorRef.current += -normalizeWheelLines(
      event,
      cellMetricsRef.current,
      frameRef.current?.rows ?? MIN_TERMINAL_ROWS,
    );
    const delta =
      wheelScrollAccumulatorRef.current > 0
        ? Math.floor(wheelScrollAccumulatorRef.current)
        : Math.ceil(wheelScrollAccumulatorRef.current);
    if (delta === 0) {
      return;
    }
    wheelScrollAccumulatorRef.current -= delta;
    queueWheelScroll(delta);
  };
  const handleContextMenu = (event: MouseEvent) => {
    if (terminalMouseEnabled(modesRef.current)) {
      event.preventDefault();
    }
  };

  screenElement.addEventListener("keydown", handleKeyDown);
  screenElement.addEventListener("copy", handleCopy);
  screenElement.addEventListener("paste", handlePaste);
  screenElement.addEventListener("focus", handleFocus);
  screenElement.addEventListener("blur", handleBlur);
  screenElement.addEventListener("mousedown", handleMouseDown);
  screenElement.addEventListener("mouseup", handleMouseUp);
  screenElement.addEventListener("mousemove", handleMouseMove);
  screenElement.addEventListener("wheel", handleWheel, { passive: false });
  screenElement.addEventListener("contextmenu", handleContextMenu);
  return () => {
    screenElement.removeEventListener("keydown", handleKeyDown);
    screenElement.removeEventListener("copy", handleCopy);
    screenElement.removeEventListener("paste", handlePaste);
    screenElement.removeEventListener("focus", handleFocus);
    screenElement.removeEventListener("blur", handleBlur);
    screenElement.removeEventListener("mousedown", handleMouseDown);
    screenElement.removeEventListener("mouseup", handleMouseUp);
    screenElement.removeEventListener("mousemove", handleMouseMove);
    screenElement.removeEventListener("wheel", handleWheel);
    screenElement.removeEventListener("contextmenu", handleContextMenu);
    if (wheelScrollFrame != null) {
      window.cancelAnimationFrame(wheelScrollFrame);
      wheelScrollFrame = null;
    }
    pendingWheelScrollDelta = 0;
  };
}

function terminalPasteConfirmMessage(text: string): string {
  const lineCount = text.split(/\r\n|\r|\n/).length;
  return `Paste ${lineCount} line(s), ${text.length} character(s) into the terminal?`;
}

function sendMouseEvent(
  event: MouseEvent | WheelEvent,
  code: number,
  pressed: boolean,
  context: TerminalScreenHandlerContext,
): void {
  const { col, row } = terminalMousePosition(
    event,
    context.screenElement,
    context.cellMetricsRef.current,
  );
  context.sendInput(
    terminalMouseSequence(
      context.modesRef.current,
      code + mouseModifierCode(event),
      col,
      row,
      pressed,
    ),
  );
}
