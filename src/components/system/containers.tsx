import { CircleCheck, CircleX, Info, TriangleAlert, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

type BannerTone = "info" | "success" | "warning" | "danger";

const BANNER_ICON: Record<BannerTone, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
};

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
}: {
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
        >
          <header className="y-overlay__header">
            <div className="y-overlay__titles">
              <DialogPrimitive.Title className="y-overlay__title">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="y-overlay__description">{description}</DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close className="y-button y-button--quiet y-button--48 y-icon-button" aria-label="Close" title="Close">
              <X aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>
          <div className={bodyClassName}>{children}</div>
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
}: {
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
}: {
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
  children,
  className,
  ...props
}: {
  tone?: BannerTone;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  const ToneIcon = BANNER_ICON[tone];
  return (
    <div className={cn("y-banner", `y-banner--${tone}`, className)} {...props}>
      <ToneIcon className="y-banner__icon" aria-hidden="true" />
      <p className="y-banner__text" role={tone === "danger" ? "alert" : "status"}>
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
