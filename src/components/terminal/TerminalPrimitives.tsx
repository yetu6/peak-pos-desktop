import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { AlertCircle, CloudOff, LoaderCircle } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export function ActionButton({
  hierarchy = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  hierarchy?: "primary" | "secondary" | "quiet" | "danger";
}) {
  const variant = hierarchy === "primary" ? "default" : hierarchy === "danger" ? "destructive" : hierarchy === "secondary" ? "outline" : "ghost";
  return <Button variant={variant} size="lg" className={cn("action-button", `action-button--${hierarchy}`, className)} {...props} />;
}

export function ProductTile({
  name,
  price,
  soldOut = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  name: string;
  price: string;
  soldOut?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn("product-tile", soldOut && "product-tile--sold-out", className)}
      {...props}
    >
      <span className="product-tile__name">{name}</span>
      <span className="product-tile__price">{soldOut ? "86'd" : price}</span>
    </button>
  );
}

export function CategoryTab({
  active,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button type="button" aria-pressed={active} className={cn("category-tab", className)} {...props}>
      {children}
    </button>
  );
}

export function QuantityStepper({
  label,
  value,
  onDecrease,
  onIncrease,
  minimum = 1,
}: {
  label: string;
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  minimum?: number;
}) {
  return (
    <div className="quantity-stepper" aria-label={`${label} quantity`}>
      <button
        type="button"
        className="quantity-stepper__button"
        onClick={onDecrease}
        disabled={value <= minimum}
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <output className="quantity-stepper__value" aria-live="polite">
        {value}
      </output>
      <button type="button" className="quantity-stepper__button" onClick={onIncrease} aria-label={`Increase ${label}`}>
        +
      </button>
    </div>
  );
}

export function OrderLine({ className, ...props }: HTMLAttributes<HTMLLIElement>) {
  return <li className={cn("order-line", className)} {...props} />;
}

export function OrderRail({
  title,
  headerMeta,
  children,
  footer,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  title: string;
  headerMeta?: ReactNode;
  footer: ReactNode;
}) {
  return (
    <aside className={cn("current-order-rail", "order-rail", className)} aria-label={title} {...props}>
      <header className="current-order-rail__header">
        <div className="text-sm font-bold text-[var(--foreground)]">{title}</div>
        {headerMeta}
      </header>
      <div className="current-order-rail__body">{children}</div>
      <footer className="current-order-rail__footer">{footer}</footer>
    </aside>
  );
}

export function MoneyDisplay({
  children,
  prominence = "normal",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  prominence?: "normal" | "strong" | "hero";
}) {
  return <span className={cn("money-display", `money-display--${prominence}`, className)} {...props}>{children}</span>;
}

export function OperationalStatus({
  tone = "neutral",
  children,
  className,
  announce = false,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "offline" | "info";
  children: ReactNode;
  className?: string;
  announce?: boolean;
}) {
  return (
    <span
      className={cn("operational-status", `operational-status--${tone}`, className)}
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
    >
      <span className="operational-status__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

const STATE_ICONS = {
  empty: AlertCircle,
  loading: LoaderCircle,
  error: AlertCircle,
  revoked: AlertCircle,
  offline: CloudOff,
};

export function TerminalState({
  state,
  title,
  description,
  action,
}: {
  state: keyof typeof STATE_ICONS;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const StateIcon = STATE_ICONS[state];
  return (
    <section className="terminal-state" data-state={state} aria-live={state === "loading" ? "polite" : undefined}>
      <StateIcon size={26} aria-hidden="true" className={state === "loading" ? "terminal-state__spinner" : ""} />
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </section>
  );
}
