import fbcMark from "../assets/brand/fbc-mark.png";
import fbcMarkOnDark from "../assets/brand/fbc-mark-on-dark.png";
import wordmarkInk from "../assets/brand/yetu-wordmark-ink.png";

/**
 * The brand lockup: the FBC mark beside the Yetu wordmark.
 *
 * FBC carries the trust and "Yetu" names the product. The Yetu wordmark is
 * always the blue one (owner, 2026-10-27), never white: on a dark theme or
 * the dark brand pane it sits on a light badge so the blue stays legible
 * (CSS in index.css). Only the FBC mark swaps with the theme. `height` is the
 * mark's height in px; the wordmark sits at 72% of it. Never use the mark
 * alone as an icon.
 */
const MARK = { width: 512, height: 404 } as const;
const WORDMARK = { width: 1605, height: 611 } as const;

export function BrandLockup({ height = 24, wordmark = true, className }: { height?: number; wordmark?: boolean; className?: string }) {
  const markWidth = Math.round((height * MARK.width) / MARK.height);
  const wordmarkHeight = Math.round(height * 0.72);
  const wordmarkWidth = Math.round((wordmarkHeight * WORDMARK.width) / WORDMARK.height);
  const markAlt = wordmark ? "" : "FBC";
  return (
    <span className={`brand-lockup ${className ?? ""}`} data-brand-lockup>
      <img className="brand-lockup__on-dark" src={fbcMarkOnDark} alt={markAlt} width={markWidth} height={height} draggable={false} />
      <img className="brand-lockup__on-light" src={fbcMark} alt={markAlt} width={markWidth} height={height} draggable={false} />
      {wordmark ? (
        <img className="brand-lockup__wordmark" src={wordmarkInk} alt="Yetu" width={wordmarkWidth} height={wordmarkHeight} draggable={false} />
      ) : null}
    </span>
  );
}
