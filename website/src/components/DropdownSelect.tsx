import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Dropdown } from "./Dropdown.js";

export interface DropdownOption<Value extends string | number> {
  value: Value;
  label: string;
  disabled?: boolean;
}

export function DropdownSelect<Value extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  title,
  className,
  triggerClassName = "",
  trigger,
  placement,
}: {
  label: string;
  value: Value;
  options: readonly DropdownOption<Value>[];
  onChange: (value: Value) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  triggerClassName?: string;
  trigger?: ReactNode;
  placement?: "top" | "bottom";
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <Dropdown
      label={label}
      role="listbox"
      placement={placement}
      className={className}
      triggerProps={{
        disabled,
        title,
        className: trigger ? triggerClassName : `dropdown-select-trigger ${triggerClassName}`,
      }}
      trigger={
        trigger ?? (
          <>
            <span className="dropdown-select-value">{selected?.label ?? value}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </>
        )
      }
    >
      {(close) =>
        options.map((option) => (
          <button
            type="button"
            role="option"
            tabIndex={-1}
            key={option.value}
            className="dropdown-item"
            aria-selected={option.value === value}
            disabled={option.disabled}
            data-value={option.value}
            onClick={() => {
              close();
              onChange(option.value);
            }}
          >
            <span>{option.label}</span>
            <span className="dropdown-check">
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </span>
          </button>
        ))
      }
    </Dropdown>
  );
}
