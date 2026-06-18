import {
  type ChangeEvent as ReactChangeEvent,
  useCallback,
} from "react";

interface SettingsSliderProps {
  readonly ariaLabel: string;
  readonly max: number;
  readonly min: number;
  readonly step?: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
}

export function SettingsSlider({
  ariaLabel,
  max,
  min,
  step = 1,
  value,
  onChange,
}: SettingsSliderProps) {
  const handleInput = useCallback(
    (event: ReactChangeEvent<HTMLInputElement>) => {
      const parsed = Number(event.currentTarget.value);
      if (Number.isFinite(parsed)) {
        onChange(parsed);
      }
    },
    [onChange],
  );

  return (
    <input
      aria-label={ariaLabel}
      className="settings-slider"
      max={max}
      min={min}
      step={step}
      type="range"
      value={value}
      onChange={handleInput}
    />
  );
}
