import { AccessLayout } from "../access/AccessLayout";
import { OPENING_SHIFT_WORDS } from "../cash/autoShiftWords";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { placeOf } from "../lib/tillPlace";

/**
 * The outlet opens its shifts by itself: while the till asks Yetu to open this
 * one, a calm line in words instead of the float screen. `words` is Yetu's own
 * sentence when it asked the till to wait (it is still bringing the date up to
 * today); `checking` is the moment before the till knows the outlet's setting.
 */
export function OpeningShiftScreen({ words, checking = false }: { words?: string; checking?: boolean }) {
  const { identity } = useDeviceSession();
  return (
    <AccessLayout
      testId="opening-shift-screen"
      title={checking ? "One moment…" : OPENING_SHIFT_WORDS}
      place={placeOf(identity)}
      lede={words}
    >
      <p className="y-cash__muted" role="status">
        {words ? "Yetu will try again by itself." : checking ? "Checking how this till opens its shift." : "Yetu is opening this till's shift."}
      </p>
    </AccessLayout>
  );
}
