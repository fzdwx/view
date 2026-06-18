import { type KeyboardEvent as ReactKeyboardEvent, useRef } from "react";

export interface SegmentedOption {
  readonly label: string;
  readonly value: string;
}

interface SettingsSegmentedProps {
  readonly ariaLabel: string;
  readonly options: readonly SegmentedOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}

export function SettingsSegmented({
  ariaLabel,
  options,
  value,
  onChange,
}: SettingsSegmentedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const currentIndex = options.findIndex((option) => option.value === value);
    if (currentIndex === -1) {
      return;
    }

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % options.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + options.length) % options.length;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      const option = options[nextIndex];
      if (option) {
        onChange(option.value);
        const buttons = containerRef.current?.querySelectorAll("button");
        buttons?.[nextIndex]?.focus();
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className="settings-segmented"
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={
              active
                ? "settings-segmented-option active"
                : "settings-segmented-option"
            }
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            onKeyDown={handleKeyDown}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
