/**
 * Gemeinsame UI-Bausteine (Bühnen-Design-System): große Touch-Ziele,
 * sichtbare Fokus-Ringe (Tastaturbedienung), konsistente Farben.
 */

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stage-accent';

export type ButtonVariant = 'default' | 'accent' | 'warn' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: 'border-stage-border bg-stage-surface-2 text-stage-text hover:bg-stage-border/40',
  accent: 'border-stage-accent bg-stage-accent/15 text-stage-accent hover:bg-stage-accent/25',
  warn: 'border-stage-warn bg-stage-warn/15 text-stage-warn hover:bg-stage-warn/25',
  danger: 'border-stage-danger/40 bg-transparent text-stage-danger hover:bg-stage-danger/10',
};

export function Button({
  label,
  onClick,
  variant = 'default',
  size = 'md',
  disabled = false,
  testId,
  ariaLabel,
}: {
  label: string;
  onClick: () => void;
  variant?: ButtonVariant;
  /** md = Steuer-Buttons (56 px), sm = Sekundär-Aktionen (44 px) */
  size?: 'md' | 'sm';
  disabled?: boolean;
  testId?: string | undefined;
  ariaLabel?: string | undefined;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={`${
        size === 'md'
          ? 'min-h-14 min-w-16 rounded-xl px-4 text-base font-semibold'
          : 'min-h-11 rounded-lg px-3 text-sm font-medium'
      } border transition-colors active:scale-[0.98] disabled:opacity-40 ${FOCUS_RING} ${BUTTON_VARIANTS[variant]}`}
    >
      {label}
    </button>
  );
}

export function IconButton({
  label,
  onClick,
  ariaLabel,
  testId,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  /** Pflicht: Icon-Buttons brauchen einen sprechenden Namen (Screenreader). */
  ariaLabel: string;
  testId?: string | undefined;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={`h-11 w-11 rounded-lg border border-stage-border bg-stage-surface-2 text-sm hover:bg-stage-border/40 disabled:opacity-40 ${FOCUS_RING}`}
    >
      {label}
    </button>
  );
}

export function ToggleChip({
  label,
  active,
  onClick,
  disabled = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 rounded-full border px-4 text-sm font-medium disabled:opacity-40 ${FOCUS_RING} ${
        active
          ? 'border-stage-accent bg-stage-accent/15 text-stage-accent'
          : 'border-stage-border bg-stage-surface-2 text-stage-muted'
      }`}
    >
      {label}
    </button>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string | undefined;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className={`h-5 w-5 accent-(--color-stage-accent) ${FOCUS_RING}`}
      />
      {label}
    </label>
  );
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-stage-border bg-stage-surface p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function StatusBadge({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string | undefined;
}) {
  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs sm:text-sm ${
        ok ? 'border-stage-ok/40 text-stage-ok' : 'border-stage-danger/40 text-stage-danger'
      }`}
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-stage-ok' : 'bg-stage-danger'}`}
        aria-hidden
      />
      <span className="font-medium">{label}</span>
      {detail ? <span className="hidden text-stage-muted sm:inline">{detail}</span> : null}
    </div>
  );
}

/** Textarea mit Label — überall gleiche Editor-Felder. */
export function LabeledTextarea({
  label,
  defaultValue,
  onCommit,
  rows = 2,
  mono = false,
  placeholder,
}: {
  label: string;
  defaultValue: string;
  onCommit: (value: string) => void;
  rows?: number;
  mono?: boolean;
  placeholder?: string | undefined;
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs uppercase tracking-wider text-stage-muted">{label}</span>
      <textarea
        defaultValue={defaultValue}
        placeholder={placeholder}
        onBlur={(event) => onCommit(event.target.value)}
        rows={rows}
        className={`mt-1 w-full rounded-lg border border-stage-border bg-stage-surface-2 p-2 text-sm ${FOCUS_RING} ${
          mono ? 'font-mono' : ''
        }`}
      />
    </label>
  );
}
