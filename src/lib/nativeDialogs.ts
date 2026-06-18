import type {
  ConfirmDialogOptions,
  MessageDialogOptions,
} from "@tauri-apps/plugin-dialog";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./api";

const defaultDialogTitle = "View";

export async function confirmNativeDialog(
  dialogMessage: string,
  options: ConfirmDialogOptions = {},
): Promise<boolean> {
  if (!isTauriRuntime()) {
    return window.confirm(dialogMessage);
  }

  try {
    return await confirm(dialogMessage, {
      title: defaultDialogTitle,
      ...options,
    });
  } catch (error) {
    reportNativeDialogError("confirm", error);
    return window.confirm(dialogMessage);
  }
}

export async function showNativeMessage(
  dialogMessage: string,
  options: MessageDialogOptions = {},
): Promise<void> {
  if (!isTauriRuntime()) {
    window.alert(dialogMessage);
    return;
  }

  try {
    await message(dialogMessage, {
      title: defaultDialogTitle,
      ...options,
    });
  } catch (error) {
    reportNativeDialogError("message", error);
    window.alert(dialogMessage);
  }
}

function reportNativeDialogError(action: string, error: unknown): void {
  if (error instanceof Error) {
    console.warn(`Failed to ${action} with native dialog: ${error.message}`);
    return;
  }

  console.warn(`Failed to ${action} with native dialog: ${String(error)}`);
}
