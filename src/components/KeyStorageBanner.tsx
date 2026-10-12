import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { Banner, TechnicalDetails } from "./system";

/**
 * Shown when the till cannot keep its device key in the computer's secure
 * storage. The words say what it means and what to do; the till's own detail
 * is kept for support behind Technical details.
 */
export function KeyStorageBanner() {
  const { keyStorageWarning } = useDeviceSession();
  if (!keyStorageWarning) return null;
  return <KeyStorageBannerView detail={keyStorageWarning} />;
}

export function KeyStorageBannerView({ detail }: { detail: string }) {
  return (
    <Banner tone="danger" data-testid="key-storage-warning" action={<TechnicalDetails>{detail}</TechnicalDetails>}>
      This till can&apos;t store its key safely. Call support before taking payments.
    </Banner>
  );
}
