import { BACK_WORDS, BACK_ACCESSIBLE_WORDS } from "../../lib/words";
import { CircleCheck, CircleX, Info, TriangleAlert, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode, RefObject } from "react";
import { cn } from "../../lib/utils";

type BannerTone = "info" | "success" | "warning" | "danger";

const BANNER_ICON: Record<BannerTone, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
};

interface OverlayOptions {
  /** Where focus starts when it opens; otherwise the first thing that takes focus. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** The description is read aloud with the title but not shown (the body already shows it). */
  descriptionHidden?: boolean;
  /**
   * Names the body as a region a keyboard can focus and scroll: for a body that
   * may hold nothing focusable (an order's details) yet can be longer than the screen.
   */
  bodyLabel?: string;
}

function Overlay({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  contentClassName,
  bodyClassName,
  testId,
  initialFocus,
  descriptionHidden = false,
  bodyLabel,
}: OverlayOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  children?: ReactNode;
  contentClassName: string;
  bodyClassName: string;
  testId?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="y-scrim" />
        <DialogPrimitive.Content
          className={contentClassName}
          data-testid={testId}
          {...(description ? {} : { "aria-describedby": undefined })}
          onOpenAutoFocus={(event) => {
            if (!initialFocus?.current) return;
            event.preventDefault();
            initialFocus.current.focus();
          }}
        >
          <header className="y-overlay__header">
            <div className="y-overlay__titles">
              <DialogPrimitive.Title className="y-overlay__title">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className={cn("y-overlay__description", descriptionHidden && "y-visually-hidden")}>
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close className="y-button y-button--quiet y-button--48 y-icon-button" aria-label={BACK_ACCESSIBLE_WORDS} title={BACK_WORDS}>
              <X aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>
          {bodyLabel ? (
            <div className={bodyClassName} role="region" aria-label={bodyLabel} tabIndex={0}>
              {children}
            </div>
          ) : (
            <div className={bodyClassName}>{children}</div>
          )}
          {footer ? <footer className="y-overlay__footer">{footer}</footer> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * A sheet slides in from the side it belongs to (or fills the screen) for a
 * focused job: options, pay, ask a supervisor. Esc closes the top sheet only.
 */
export function Sheet({
  side = "right",
  className,
  ...props
}: OverlayOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  children?: ReactNode;
  side?: "right" | "full";
  className?: string;
  testId?: string;
}) {
  return (
    <Overlay
      {...props}
      contentClassName={cn("y-sheet", `y-sheet--${side}`, className)}
      bodyClassName="y-sheet__body"
    />
  );
}

/** A short question or confirmation in the middle of the screen. */
export function Dialog({
  className,
  ...props
}: OverlayOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return <Overlay {...props} contentClassName={cn("y-dialog", className)} bodyClassName="y-dialog__body" />;
}

/**
 * A full-width notice under the top bar. It pushes the work area down rather
 * than covering it, so it never hides the ticket or Pay. Danger interrupts
 * (alert); the rest are announced politely.
 */
export function Banner({
  tone = "info",
  action,
  live = true,
  inline = false,
  children,
  className,
  ...props
}: {
  tone?: BannerTone;
  action?: ReactNode;
  /** False when the banner sits inside a live region that already announces it. */
  live?: boolean;
  /** Inside a card or a sheet: a rounded notice, not the bar under the top bar. */
  inline?: boolean;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  const ToneIcon = BANNER_ICON[tone];
  return (
    <div className={cn("y-banner", `y-banner--${tone}`, inline && "y-banner--inline", className)} {...props}>
      <ToneIcon className="y-banner__icon" aria-hidden="true" />
      <p className="y-banner__text" role={live ? (tone === "danger" ? "alert" : "status") : undefined}>
        {children}
      </p>
      {action ? <div className="y-banner__action">{action}</div> : null}
    </div>
  );
}

/** A short confirmation that something happened. It never covers the ticket or Pay. */
export function Toast({ tone = "info", children, className }: { tone?: BannerTone; children: ReactNode; className?: string }) {
  const ToneIcon = BANNER_ICON[tone];
  return (
    <div className={cn("y-toast", `y-toast--${tone}`, className)} role="status">
      <ToneIcon className="y-toast__icon" aria-hidden="true" />
      {children}
    </div>
  );
}

/** Where toasts appear: bottom left of the work area, away from the ticket and Pay on the right. */
export function ToastRegion({ children }: { children: ReactNode }) {
  return <div className="y-toast-region">{children}</div>;
}
