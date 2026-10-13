import { useState } from "react";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { AccessLayout } from "../access/AccessLayout";
import { accessNotice, addressProblemWords } from "../access/accessWords";
import { Button, Field, TechnicalDetails } from "../components/system";
import { validatePeakApiUrl } from "../lib/peakConfig";

/**
 * A till normally finds its Yetu server by itself (the address is built into
 * the installed app). This screen appears only when it has none: support
 * types the address once.
 */
export function SetupScreen() {
  const { saveApiUrl, error } = useDeviceSession();
  return <SetupView error={error} onSave={saveApiUrl} />;
}

export function SetupView({
  error,
  onSave,
  initialAddress = "https://",
}: {
  /** The device session's message after a failed save. */
  error: string | null;
  onSave: (address: string) => Promise<void>;
  initialAddress?: string;
}) {
  const [address, setAddress] = useState(initialAddress);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const shown = problem ?? accessNotice(error)?.words ?? null;

  async function submit(): Promise<void> {
    if (pending) return;
    const check = validatePeakApiUrl(address);
    if (!check.ok) {
      setProblem(addressProblemWords(check.error));
      return;
    }
    setProblem(null);
    setPending(true);
    try {
      await onSave(address.trim());
    } catch {
      // The device session words the failure (shown from `error`).
    } finally {
      setPending(false);
    }
  }

  return (
    <AccessLayout
      testId="setup-screen"
      title="Connect to your Yetu server"
      lede={<p>Type the address your Yetu support team gave you. You only do this once on this till.</p>}
    >
      <form
        className="y-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Server address"
          hint="It starts with https://"
          value={address}
          onChange={(value) => {
            setAddress(value);
            setProblem(null);
          }}
          error={shown ?? undefined}
          errorTestId="setup-error"
          id="peak-url"
          data-testid="peak-url"
          autoComplete="off"
          autoFocus
          inputMode="url"
          spellCheck={false}
        />
        <Button type="submit" variant="primary" size={56} block data-testid="save-peak-url" disabled={pending}>
          {pending ? "Connecting…" : "Connect"}
        </Button>
      </form>
      <TechnicalDetails>
        <p className="y-access__muted">
          The till only accepts https:// addresses. A development build may also use http://localhost.
        </p>
        <p className="y-access__muted">Till version {__APP_VERSION__}</p>
      </TechnicalDetails>
    </AccessLayout>
  );
}
