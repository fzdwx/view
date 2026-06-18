import {
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildLargeSelectMenuStyle,
  type SettingsSelectMenuStyle,
} from "./SettingsSelectPlacement";

export interface SettingsSelectOption {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: string;
}

interface SettingsSelectProps {
  readonly ariaLabel: string;
  readonly fallbackLabel?: string;
  readonly menuSize?: "default" | "large";
  readonly options: readonly SettingsSelectOption[];
  readonly searchable?: boolean;
  readonly searchPlaceholder?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

export function SettingsSelect({
  ariaLabel,
  fallbackLabel,
  menuSize = "default",
  options,
  searchable = false,
  searchPlaceholder = "Search",
  value,
  onChange,
}: SettingsSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<SettingsSelectMenuStyle>({});
  const [searchQuery, setSearchQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label ?? fallbackLabel ?? value;
  const visibleOptions = useMemo(
    () => filterOptions(options, searchQuery),
    [options, searchQuery],
  );
  const updateLargeMenuPlacement = useCallback(() => {
    if (menuSize !== "large" || !open || triggerRef.current === null) {
      setMenuStyle({});
      return;
    }

    setMenuStyle(buildLargeSelectMenuStyle(triggerRef.current));
  }, [menuSize, open]);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setMenuStyle({});
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (
        rootRef.current !== null &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  useLayoutEffect(() => {
    updateLargeMenuPlacement();
  }, [updateLargeMenuPlacement, visibleOptions.length]);

  useEffect(() => {
    if (!open || menuSize !== "large") {
      return;
    }

    window.addEventListener("resize", updateLargeMenuPlacement);
    window.addEventListener("scroll", updateLargeMenuPlacement, true);
    return () => {
      window.removeEventListener("resize", updateLargeMenuPlacement);
      window.removeEventListener("scroll", updateLargeMenuPlacement, true);
    };
  }, [menuSize, open, updateLargeMenuPlacement]);

  useEffect(() => {
    if (open && searchable) {
      searchInputRef.current?.focus();
    }
  }, [open, searchable]);

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function handleSearchChange(event: ReactChangeEvent<HTMLInputElement>) {
    setSearchQuery(event.currentTarget.value);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (event.key === "Enter") {
      const firstEnabledOption = visibleOptions.find((option) => !option.disabled);
      if (firstEnabledOption !== undefined) {
        event.preventDefault();
        selectOption(firstEnabledOption);
      }
    }
  }

  function selectOption(option: SettingsSelectOption) {
    if (option.disabled) {
      return;
    }
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      className={
        menuSize === "large"
          ? "settings-select settings-select-large"
          : "settings-select"
      }
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className="settings-select-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selectedLabel}</span>
        <span className="settings-select-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="settings-select-menu"
          style={menuSize === "large" ? menuStyle : undefined}
        >
          {searchable ? (
            <div className="settings-select-search">
              <input
                ref={searchInputRef}
                aria-label={`${ariaLabel} search`}
                className="settings-select-search-input"
                placeholder={searchPlaceholder}
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
          ) : null}
          <div
            className="settings-select-options"
            role="listbox"
            aria-label={ariaLabel}
          >
            {visibleOptions.length > 0 ? (
              visibleOptions.map((option) => (
                <button
                  key={`${option.value}-${option.label}`}
                  type="button"
                  className={
                    option.value === value
                      ? "settings-select-option active"
                      : "settings-select-option"
                  }
                  role="option"
                  aria-disabled={option.disabled ? true : undefined}
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  onClick={() => selectOption(option)}
                >
                  {option.label}
                </button>
              ))
            ) : (
              <div className="settings-select-empty">No fonts found</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function filterOptions(
  options: readonly SettingsSelectOption[],
  searchQuery: string,
): readonly SettingsSelectOption[] {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return options;
  }

  return options.filter((option) =>
    option.label.toLocaleLowerCase().includes(normalizedQuery),
  );
}
