import { useEffect, useState } from "react";

/**
 * Whether the computer has a network at all (the browser's own signal, which
 * follows the network cable and Wi-Fi). It cannot tell whether Yetu itself is
 * reachable; signing in finds that out.
 */
export function useNetworkOnline(): boolean {
  const read = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);
  const [online, setOnline] = useState(read);
  useEffect(() => {
    const update = () => setOnline(read());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
