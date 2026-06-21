import {
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
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
  readonly icon?: ReactNode;
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
      // Reset transient menu state on close; the menu can close from several
      // paths (outside pointer, option select, escape) so a single reset is
      // simpler than duplicating it across each close site.
      /* oxlint-disable react-doctor/no-cascading-set-state */
      setSearchQuery("");
      setMenuStyle({});
      /* oxlint-enable react-doctor/no-cascading-set-state */
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

  const updateLargeMenuPlacementRef = useRef(updateLargeMenuPlacement);
  updateLargeMenuPlacementRef.current = updateLargeMenuPlacement;

  useEffect(() => {
    if (!open || menuSize !== "large") {
      return;
    }

    const handler = () => updateLargeMenuPlacementRef.current();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [menuSize, open]);

  useEffect(() => {
    /* oxlint-disable react-doctor/no-event-handler */
    if (open && searchable) {
      searchInputRef.current?.focus();
    }
    /* oxlint-enable react-doctor/no-event-handler */
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

  const optionsList = (
    // Custom searchable dropdown backed by <button> options; a native <datalist>
    // (the rule's suggestion) can't host button rows here.
    // oxlint-disable-next-line react-doctor/prefer-tag-over-role
    <div className="settings-select-options" role="listbox" aria-label={ariaLabel}>
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
            {option.icon != null ? (
              <span className="settings-select-option-icon" aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
            <span>{option.label}</span>
          </button>
        ))
      ) : (
        <div className="settings-select-empty">No results found</div>
      )}
    </div>
  );

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
        {selectedOption?.icon != null ? (
          <span className="settings-select-icon" aria-hidden="true">
            {selectedOption.icon}
          </span>
        ) : null}
        <span className="settings-select-label">{selectedLabel}</span>
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
          {optionsList}
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
