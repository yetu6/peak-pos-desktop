import fbcMark from "../assets/brand/fbc-mark.png";
import fbcMarkOnDark from "../assets/brand/fbc-mark-on-dark.png";
import wordmarkInk from "../assets/brand/yetu-wordmark-ink.png";
import wordmarkWhite from "../assets/brand/yetu-wordmark-white.png";

/**
 * The brand lockup: the FBC mark beside the Yetu wordmark.
 *
 * FBC carries the trust and "Yetu" names the product. The station is
 * dark-first, so the on-dark mark and the white wordmark are the default;
 * the light theme (body.light-theme) swaps to the ink set through CSS in
 * index.css, so the lockup follows the theme with no script. `height` is the
 * mark's height in px; the wordmark sits at 72% of it. Never add a border,
 * box or shadow around it, and never use the mark alone as an icon.
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
        <>
          <img className="brand-lockup__on-dark" src={wordmarkWhite} alt="Yetu" width={wordmarkWidth} height={wordmarkHeight} draggable={false} />
          <img className="brand-lockup__on-light" src={wordmarkInk} alt="Yetu" width={wordmarkWidth} height={wordmarkHeight} draggable={false} />
        </>
      ) : null}
    </span>
  );
}
