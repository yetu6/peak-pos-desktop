import { Ban, Bell, CircleCheck, CircleDot, CircleX, Info, TriangleAlert } from "lucide-react";
import type { CSSProperties, HTMLAttributes, MouseEvent, ReactNode } from "react";
import { formatMoney } from "../../lib/money";
import { cn } from "../../lib/utils";
import type { Tone } from "../../lib/words";

export type MoneySize = "small" | "body" | "lead" | "title" | "heading" | "figure" | "display";

/** An amount from minor units in the currency the backend returned: `TSh 42,500`. */
export function Money({
  minor,
  currency,
  size = "body",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  minor: number | null | undefined;
  currency: string | null | undefined;
  size?: MoneySize;
}) {
  return (
    <span className={cn("y-money", `y-money--${size}`, className)} {...props}>
      {formatMoney(minor, currency)}
    </span>
  );
}

const TONE_ICON: Record<Tone, typeof Info> = {
  neutral: CircleDot,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
  accent: Bell,
};

/** A state in a word, a colour and an icon together: never colour alone. */
export function StatusChip({
  tone = "neutral",
  icon,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; icon?: ReactNode; children: string | ReactNode }) {
  const ToneIcon = TONE_ICON[tone];
  return (
    <span className={cn("y-chip", `y-chip--${tone}`, className)} {...props}>
      {icon ?? <ToneIcon aria-hidden="true" />}
      <span className="y-chip__words">{children}</span>
    </span>
  );
}

/**
 * A menu tile: the name (up to two lines), the price, and a thin category mark.
 * A sold-out item keeps its place, greyed, with the words "Sold out".
 */
export function Tile({
  name,
  price,
  soldOut = false,
  disabled = false,
  mark,
  onClick,
  onContextMenu,
  className,
  "data-testid": testId,
}: {
  name: string;
  price: string;
  soldOut?: boolean;
  /** Can't be added just now; the screen says why. It stays focusable and keeps its place. */
  disabled?: boolean;
  /** One of the four category marks (decoration only). */
  mark?: 1 | 2 | 3 | 4;
  onClick?: () => void;
  /** A right-click or long press (marking sold out). */
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  "data-testid"?: string;
}) {
  const style = mark ? ({ ["--tile-mark" as string]: `var(--mark-${mark})` } as CSSProperties) : undefined;
  const inactive = soldOut || disabled;
  return (
    <button
      type="button"
      className={cn("y-tile", soldOut && "y-tile--sold-out", mark && "y-tile--marked", className)}
      style={style}
      aria-disabled={inactive || undefined}
      data-testid={testId}
      onClick={inactive ? undefined : onClick}
      onContextMenu={onContextMenu}
    >
      <span className="y-tile__name">{name}</span>
      {soldOut ? (
        <StatusChip tone="neutral" icon={<Ban aria-hidden="true" />}>
          Sold out
        </StatusChip>
      ) : (
        <span className="y-tile__price">{price}</span>
      )}
    </button>
  );
}

/** One line of the order ticket: the quantity (large), the name, options beneath, and the price. */
export function TicketLine({
  quantity,
  name,
  options = [],
  note,
  amount,
  sent = false,
  selected = false,
  onSelect,
  className,
}: {
  quantity: number;
  name: string;
  options?: readonly string[];
  note?: string;
  amount: string;
  sent?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
}) {
  const label = [`${quantity} × ${name}`, ...options, note ? `Note: ${note}` : "", sent ? "Sent to kitchen" : "", amount]
    .filter(Boolean)
    .join(", ");
  const body = (
    <>
      <span className="y-ticket-line__qty">{quantity}</span>
      <span className="y-ticket-line__main">
        <span className="y-ticket-line__name">{name}</span>
        {options.map((option) => (
          <span key={option} className="y-ticket-line__option">
            {option}
          </span>
        ))}
        {note ? <span className="y-ticket-line__note">{note}</span> : null}
        {sent ? (
          <StatusChip tone="info" className="y-ticket-line__sent">
            Sent
          </StatusChip>
        ) : null}
      </span>
      <span className="y-ticket-line__amount">{amount}</span>
    </>
  );
  if (!onSelect) {
    return (
      <div className={cn("y-ticket-line", className)} aria-label={label} role="group">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cn("y-ticket-line", className)}
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {body}
    </button>
  );
}

/** A row in a list: something at the start, a title with a line beneath, and a figure or status at the end. */
export function ListRow({
  title,
  meta,
  leading,
  trailing,
  selected = false,
  onClick,
  className,
}: {
  title: string;
  meta?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      {leading ? <span className="y-row__leading">{leading}</span> : null}
      <span className="y-row__main">
        <span className="y-row__title">{title}</span>
        {meta ? <span className="y-row__meta">{meta}</span> : null}
      </span>
      {trailing ? <span className="y-row__trailing">{trailing}</span> : null}
    </>
  );
  if (!onClick) return <div className={cn("y-row", className)}>{body}</div>;
  return (
    <button
      type="button"
      className={cn("y-row", "y-row--action", className)}
      aria-current={selected || undefined}
      onClick={onClick}
    >
      {body}
    </button>
  );
}

/** A placeholder shaped like what is loading. Screen readers hear the loading words of the region instead. */
export function Skeleton({
  width,
  height,
  radius = "control",
  className,
}: {
  width?: number | string;
  height: number | string;
  radius?: "control" | "card" | "round";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("y-skeleton", `y-skeleton--${radius}`, className)}
      style={{ width, height }}
    />
  );
}

/** What is missing, why, and what to do next. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("y-empty", className)}>
      {icon ? (
        <span className="y-empty__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <h2 className="y-empty__title">{title}</h2>
      {description ? <p className="y-empty__description">{description}</p> : null}
      {action ? <div className="y-empty__action">{action}</div> : null}
    </div>
  );
}
