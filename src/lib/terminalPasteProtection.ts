const TERMINAL_PASTE_CONFIRM_THRESHOLD = 2000;

export function shouldConfirmTerminalPaste(text: string): boolean {
  return (
    text.length > TERMINAL_PASTE_CONFIRM_THRESHOLD ||
    /\r|\n/.test(text)
  );
}
