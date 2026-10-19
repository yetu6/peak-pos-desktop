import { placeMonogram, placeSubtitle, placeTitle, type TillPlace } from "../lib/tillPlace";
import { cn } from "../lib/utils";

/**
 * Whose till this is: the hotel's mark (its initials until Yetu holds its
 * logo), the hotel, and the outlet with the till beneath (F-252). In the top
 * bar ("bar") and on the sign-in screens' hotel pane ("pane"). "This till"
 * only when Yetu has sent no names at all (a Yetu from before F-252).
 */
export function PlaceMark({
  place,
  size = "bar",
  className,
  "data-testid": testId,
}: {
  place: TillPlace;
  size?: "bar" | "pane";
  className?: string;
  "data-testid"?: string;
}) {
  const title = placeTitle(place) ?? "This till";
  const subtitle = placeSubtitle(place);
  const monogram = placeMonogram(place);
  return (
    <span className={cn("y-place", `y-place--${size}`, className)} data-testid={testId}>
      {monogram ? (
        <span className="y-place__mark" aria-hidden="true">
          {monogram}
        </span>
      ) : null}
      <span className="y-place__names">
        <span className="y-place__title" data-testid="place-title">
          {title}
        </span>
        {subtitle ? (
          <span className="y-place__subtitle" data-testid="place-subtitle">
            {subtitle}
          </span>
        ) : null}
      </span>
    </span>
  );
}
