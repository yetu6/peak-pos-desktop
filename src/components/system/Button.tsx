import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
/** Touch sizes: 48 minimum, 56 for frequent actions, 64 for money actions (Pay, Take cash, Approve). */
export type ButtonSize = 48 | 56 | 64;

/** Shows the key that does the same thing, so every action has a mouse-free path people can see. */
export function KeyHint({ keys, className }: { keys: string; className?: string }) {
  return <kbd className={cn("y-kbd", className)}>{keys}</kbd>;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** An icon drawn before the words (decorative; the words name the button). */
  icon?: ReactNode;
  keyHint?: string;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = 48, icon, keyHint, block, className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn("y-button", `y-button--${variant}`, `y-button--${size}`, block && "y-button--block", className)}
      {...props}
    >
      {icon ? (
        <span className="y-button__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
      {keyHint ? <KeyHint keys={keyHint} /> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  /** Required: what the button does, read aloud and shown on hover. */
  label: string;
  icon: ReactNode;
  variant?: Exclude<ButtonVariant, "danger">;
  size?: ButtonSize;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = "quiet", size = 48, className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn("y-button", "y-icon-button", `y-button--${variant}`, `y-button--${size}`, className)}
      {...props}
    >
      <span className="y-button__icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
});
