import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * Detail for support and technicians, closed by default so the screen stays
 * in plain words. Its text may be 13px (marked data-technical).
 */
export function TechnicalDetails({
  children,
  label = "Details for support",
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <details className={cn("y-details", className)}>
      <summary className="y-details__summary">{label}</summary>
      <div className="y-details__body" data-technical="">
        {children}
      </div>
    </details>
  );
}
