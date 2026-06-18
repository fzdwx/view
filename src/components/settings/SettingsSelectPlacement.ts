import type { CSSProperties } from "react";

export type SettingsSelectMenuStyle = CSSProperties & {
  readonly "--settings-select-menu-max-height"?: string;
  readonly "--settings-select-options-max-height"?: string;
  readonly "--settings-select-search-options-max-height"?: string;
};

type MenuPlacement = "above" | "below" | "floating";

const desiredMenuHeight = 472;
const menuGap = 4;
const minimumMenuHeight = 160;
const optionMinimumHeight = 112;
const preferredVisibleHeight = 360;
const searchChromeHeight = 48;
const viewportPadding = 10;

export function buildLargeSelectMenuStyle(
  trigger: HTMLButtonElement,
): SettingsSelectMenuStyle {
  const triggerRect = trigger.getBoundingClientRect();
  const maximumMenuHeight = Math.min(
    desiredMenuHeight,
    Math.max(minimumMenuHeight, window.innerHeight - viewportPadding * 2),
  );
  const availableBelow =
    window.innerHeight - triggerRect.bottom - menuGap - viewportPadding;
  const availableAbove = triggerRect.top - menuGap - viewportPadding;
  const preferredHeight = Math.min(maximumMenuHeight, preferredVisibleHeight);
  const placement = chooseMenuPlacement(
    availableBelow,
    availableAbove,
    preferredHeight,
  );
  const menuHeight = Math.round(
    placement === "floating"
      ? maximumMenuHeight
      : Math.min(
          maximumMenuHeight,
          placement === "below" ? availableBelow : availableAbove,
        ),
  );
  const top = menuTop(triggerRect, menuHeight, placement);

  return {
    "--settings-select-menu-max-height": `${menuHeight}px`,
    "--settings-select-options-max-height": `${Math.max(
      optionMinimumHeight,
      menuHeight - 8,
    )}px`,
    "--settings-select-search-options-max-height": `${Math.max(
      optionMinimumHeight,
      menuHeight - searchChromeHeight,
    )}px`,
    left: `${menuLeft(triggerRect)}px`,
    position: "fixed",
    top: `${top}px`,
    width: `${Math.round(triggerRect.width)}px`,
  };
}

function chooseMenuPlacement(
  availableBelow: number,
  availableAbove: number,
  preferredHeight: number,
): MenuPlacement {
  if (availableBelow >= preferredHeight) {
    return "below";
  }

  if (availableAbove >= preferredHeight) {
    return "above";
  }

  return "floating";
}

function menuLeft(triggerRect: DOMRect): number {
  return Math.round(
    Math.min(
      Math.max(viewportPadding, triggerRect.left),
      Math.max(
        viewportPadding,
        window.innerWidth - triggerRect.width - viewportPadding,
      ),
    ),
  );
}

function menuTop(
  triggerRect: DOMRect,
  menuHeight: number,
  placement: MenuPlacement,
): number {
  if (placement === "below") {
    return Math.round(triggerRect.bottom + menuGap);
  }

  if (placement === "above") {
    return Math.round(
      Math.max(viewportPadding, triggerRect.top - menuGap - menuHeight),
    );
  }

  const idealFloatingTop = triggerRect.bottom + menuGap;
  const maximumTop = window.innerHeight - viewportPadding - menuHeight;
  return Math.round(
    Math.max(viewportPadding, Math.min(idealFloatingTop, maximumTop)),
  );
}
