import { useEffect, useState } from "react";
import { loadEmbeddedVersion, packagedAppVersion } from "../lib/diagnostics";

/** The version of the running app: the packaged number at once, the embedded one when the till app answers. */
export function useEmbeddedVersion(): string {
  const [version, setVersion] = useState(() => packagedAppVersion());
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    loadEmbeddedVersion()
      .then((found) => {
        if (!cancelled) setVersion(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return version;
}
