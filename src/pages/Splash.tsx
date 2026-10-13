import { useEffect, useState } from "react";
import { SPLASH_SLOW_AFTER_MS } from "../access/accessSettings";
import { BrandLockup } from "../components/BrandLockup";
import { Banner } from "../components/system";

/**
 * The screen every launch begins with while the till opens its secure
 * storage and finds its server. Calm, in words, never a percentage. If
 * opening takes longer than it should, it says what to do.
 */
export function Splash({ slowAfterMs = SPLASH_SLOW_AFTER_MS }: { slowAfterMs?: number }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), slowAfterMs);
    return () => window.clearTimeout(timer);
  }, [slowAfterMs]);

  return (
    <div className="y-splash" data-testid="splash-screen">
      <BrandLockup height={44} />
      <h1 className="y-splash__title">Opening the till</h1>
      <span className="y-splash__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {slow ? (
        <div className="y-splash__slow" data-testid="splash-slow">
          <Banner tone="warning">
            Opening is taking longer than usual. Check the till is connected to the internet. If nothing changes, close
            the till and open it again. If it keeps happening, call support.
          </Banner>
        </div>
      ) : null}
    </div>
  );
}
