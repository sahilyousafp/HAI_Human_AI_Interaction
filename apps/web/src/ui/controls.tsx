import type { ReactNode } from "react";

/**
 * An on/off switch (the iOS toggle). It is a button with the switch role, so a hand can press it like any other
 * control, and its label is the row it sits in.
 */
export function Switch({
  checked,
  onChange,
  label,
  testId,
  disabled = false,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  /** Accessible name, when there is no visible label pointing at it. */
  label?: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" aria-hidden="true" />
    </button>
  );
}

/** A segmented control: a few mutually exclusive choices side by side, the chosen one pressed. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  testId,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; testId?: string }>;
  onChange(value: T): void;
  label: string;
  testId?: string;
}) {
  return (
    <fieldset className="seg-control" data-testid={testId}>
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          data-testid={option.testId}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

/** A group of settings rows on one rounded card, with an optional small heading above and a note below. */
export function ListGroup({
  title,
  footer,
  children,
  testId,
}: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="list-group" data-testid={testId}>
      {title && <h3 className="list-group-title">{title}</h3>}
      <div className="list-group-rows">{children}</div>
      {footer && <p className="list-group-footer">{footer}</p>}
    </section>
  );
}

/**
 * One settings row: a label (and an optional second line) on the left, the control or value on the right. With
 * `onOpen` the whole row is a button that opens a page, with a chevron.
 */
export function ListRow({
  label,
  detail,
  control,
  onOpen,
  htmlFor,
  testId,
}: {
  label: ReactNode;
  detail?: ReactNode;
  control?: ReactNode;
  onOpen?: () => void;
  htmlFor?: string;
  testId?: string;
}) {
  const text = (
    <span className="list-row-text">
      {htmlFor ? (
        <label className="list-row-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="list-row-label">{label}</span>
      )}
      {detail && <span className="list-row-detail">{detail}</span>}
    </span>
  );
  if (onOpen) {
    return (
      <button type="button" className="list-row list-row-link" data-testid={testId} onClick={onOpen}>
        {text}
        {control && <span className="list-row-value">{control}</span>}
        <span className="list-row-chevron" aria-hidden="true">
          <svg
            aria-hidden="true"
            width="8"
            height="13"
            viewBox="0 0 8 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M1.5 1.5 6.5 6.5 1.5 11.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
    );
  }
  return (
    <div className="list-row" data-testid={testId}>
      {text}
      {control}
    </div>
  );
}
