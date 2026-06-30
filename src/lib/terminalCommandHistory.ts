import type {
  TerminalCommandPhase,
  TerminalCommandStatus,
  TerminalFrame,
  TerminalLine,
} from "./terminalTypes";

export interface TerminalCommandEvent {
  readonly id: string;
  readonly phase: TerminalCommandPhase;
  readonly exitCode: number | null;
  readonly cwd: string | null;
  readonly lineOffset: number;
  readonly text: string;
}

export interface TerminalCommandHistoryState {
  readonly activeCommand: TerminalCommandEvent | null;
  readonly commands: readonly TerminalCommandEvent[];
  readonly nextId: number;
  readonly previousPhase: TerminalCommandPhase | null;
}

export interface TerminalTextMatch {
  readonly logicalRow: number;
  readonly row: number;
  readonly column: number;
  readonly length: number;
}

const MAX_TERMINAL_COMMAND_EVENTS = 80;

const EMPTY_HISTORY: TerminalCommandHistoryState = {
  activeCommand: null,
  commands: [],
  nextId: 1,
  previousPhase: null,
};

export function terminalCommandHistoryReducer(
  state: TerminalCommandHistoryState | undefined,
  frame: TerminalFrame,
): TerminalCommandHistoryState {
  const currentState = state ?? EMPTY_HISTORY;
  const status = frame.commandStatus;
  if (!status) {
    return currentState;
  }

  if (status.phase === "running") {
    return startCommand(currentState, frame, status);
  }

  if (status.phase === "finished") {
    return finishCommand(currentState, frame, status);
  }

  if (currentState.previousPhase === status.phase) {
    return currentState;
  }
  return {
    ...currentState,
    previousPhase: status.phase,
  };
}

export function findTerminalFrameText(
  frame: TerminalFrame,
  query: string,
): readonly TerminalTextMatch[] {
  const needle = query.trim();
  if (!needle) {
    return [];
  }

  const normalizedNeedle = needle.toLocaleLowerCase();
  const matches: TerminalTextMatch[] = [];
  frame.lines.forEach((line, row) => {
    const text = terminalLineText(line);
    const normalizedText = text.toLocaleLowerCase();
    let column = normalizedText.indexOf(normalizedNeedle);
    while (column !== -1) {
      matches.push({
        logicalRow: frame.lineOffset + row,
        row,
        column,
        length: needle.length,
      });
      column = normalizedText.indexOf(normalizedNeedle, column + normalizedNeedle.length);
    }
  });
  return matches;
}

export function terminalLineText(line: TerminalLine): string {
  return line.cells.map((cell) => cell.text).join("").trimEnd();
}

function startCommand(
  state: TerminalCommandHistoryState,
  frame: TerminalFrame,
  status: TerminalCommandStatus,
): TerminalCommandHistoryState {
  if (state.activeCommand?.phase === "running") {
    return {
      ...state,
      previousPhase: status.phase,
    };
  }

  const command = {
    id: String(state.nextId),
    phase: "running",
    exitCode: null,
    cwd: frame.cwd ?? frame.oscCwd ?? null,
    lineOffset: frame.lineOffset,
    text: terminalFrameCommandText(frame),
  } satisfies TerminalCommandEvent;
  return {
    ...state,
    activeCommand: command,
    nextId: state.nextId + 1,
    previousPhase: status.phase,
  };
}

function finishCommand(
  state: TerminalCommandHistoryState,
  frame: TerminalFrame,
  status: TerminalCommandStatus,
): TerminalCommandHistoryState {
  const activeCommand =
    state.activeCommand ??
    ({
      id: String(state.nextId),
      phase: "running",
      exitCode: null,
      cwd: frame.cwd ?? frame.oscCwd ?? null,
      lineOffset: frame.lineOffset,
      text: terminalFrameCommandText(frame),
    } satisfies TerminalCommandEvent);
  const finishedCommand = {
    ...activeCommand,
    phase: "finished",
    exitCode: status.exitCode ?? null,
  } satisfies TerminalCommandEvent;
  const commands = [...state.commands, finishedCommand].slice(
    -MAX_TERMINAL_COMMAND_EVENTS,
  );

  return {
    ...state,
    activeCommand: null,
    commands,
    nextId: state.activeCommand ? state.nextId : state.nextId + 1,
    previousPhase: status.phase,
  };
}

function terminalFrameCommandText(frame: TerminalFrame): string {
  for (const line of frame.lines) {
    const text = terminalLineText(line).trim();
    if (text) {
      return text;
    }
  }
  return "(command)";
}
