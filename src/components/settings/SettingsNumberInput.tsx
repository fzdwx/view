import {
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useState,
} from "react";

interface SettingsNumberInputProps {
  readonly ariaLabel: string;
  readonly max: number;
  readonly min: number;
  readonly step?: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
}

export function SettingsNumberInput({
  ariaLabel,
  max,
  min,
  step,
  value,
  onChange,
}: SettingsNumberInputProps) {
  const [draft, setDraft] = useState(formatNumber(value));

  useEffect(() => {
    setDraft(formatNumber(value));
  }, [value]);

  function commitDraft() {
    const parsed = Number(draft);
    const clampedValue = Number.isFinite(parsed)
      ? clamp(parsed, min, max)
      : value;
    const nextValue = normalizeStep(clampedValue, step);
    setDraft(formatNumber(nextValue));
    if (nextValue !== value) {
      onChange(nextValue);
    }
  }

  function handleChange(event: ReactChangeEvent<HTMLInputElement>) {
    const nextDraft = event.currentTarget.value;
    setDraft(nextDraft);

    const nextValue = parseLiveValue(nextDraft, min, max, step);
    if (nextValue !== null && nextValue !== value) {
      onChange(nextValue);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      setDraft(formatNumber(value));
      event.currentTarget.blur();
    }
  }

  return (
    <input
      aria-label={ariaLabel}
      className="settings-number-input"
      inputMode={step === undefined ? "numeric" : "decimal"}
      type="text"
      value={draft}
      onBlur={commitDraft}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
    />
  );
}

function parseLiveValue(
  draft: string,
  min: number,
  max: number,
  step: number | undefined,
): number | null {
  const trimmedDraft = draft.trim();
  if (
    trimmedDraft.length === 0 ||
    trimmedDraft.endsWith(".") ||
    trimmedDraft === "+" ||
    trimmedDraft === "-"
  ) {
    return null;
  }

  const numberPattern = step === undefined ? /^\d+$/ : /^\d+(?:\.\d+)?$/;
  if (!numberPattern.test(trimmedDraft)) {
    return null;
  }

  const parsed = Number(trimmedDraft);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return normalizeStep(parsed, step);
}

function normalizeStep(value: number, step: number | undefined): number {
  if (step === undefined) {
    return Math.round(value);
  }

  const decimalPlaces = String(step).split(".")[1]?.length ?? 0;
  return Number(value.toFixed(decimalPlaces));
}

function formatNumber(value: number): string {
  return String(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
