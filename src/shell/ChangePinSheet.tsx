import { CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PIN_LENGTH } from "../access/accessSettings";
import { Button, Keypad, Sheet, type KeypadKey } from "../components/system";
import { createPosApi } from "../lib/posApi";

type Step = "current" | "choose" | "confirm";

const TITLE: Record<Step, string> = {
  current: "Enter your PIN now",
  choose: "Choose a new six-digit PIN",
  confirm: "Type it again",
};

/** What the till says once a PIN is changed. */
export const PIN_CHANGED_WORDS = "Your PIN is changed. Use it from now on, on this till and when the internet is down.";

/** Words for an answer that came with none of its own. */
const WORDS = {
  wrongNow: "That isn't your PIN now. Try again.",
  refusedNew: "Choose a new six-digit PIN: not the one you use now, and not one anybody could guess like 123456 or 111111.",
  expired: "Your session ended. Sign in again, then change your PIN.",
  noInternet: "Changing your PIN needs the internet. Try again when it's back.",
  failed: "Your PIN wasn't changed. Try again.",
};

function detailOf(error: unknown): string | undefined {
  const detail = (error as { detail?: unknown } | undefined)?.detail;
  return typeof detail === "string" && detail.trim() ? detail.trim() : undefined;
}

/**
 * Change my PIN (owner, 2026-11-07, approved from a mockup): anyone signed in
 * at the till changes their own PIN with the one they use now, and nobody
 * approves it. The PINs are never shown and go to Yetu only once the new one
 * has been typed twice.
 */
export function ChangePinSheet({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The PIN changed: the till gets ready to sign the person in offline with it. */
  onChanged: (newPin: string) => void;
}) {
  const [step, setStep] = useState<Step>("current");
  const [pin, setPinState] = useState("");
  const pinRef = useRef("");
  const currentRef = useRef("");
  const chosenRef = useRef("");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const keypadRef = useRef<HTMLDivElement>(null);

  // Opening starts afresh: nothing typed last time stays.
  useEffect(() => {
    if (!open) return;
    currentRef.current = "";
    chosenRef.current = "";
    pinRef.current = "";
    setPinState("");
    setProblem(null);
    setStep("current");
  }, [open]);

  function setPin(next: string) {
    pinRef.current = next;
    setPinState(next);
  }

  async function finish(confirmed: string) {
    if (confirmed !== chosenRef.current) {
      chosenRef.current = "";
      setProblem("The two PINs were different. Choose your new PIN again.");
      setStep("choose");
      return;
    }
    pendingRef.current = true;
    setPending(true);
    try {
      const result = await createPosApi().changeOwnPin(currentRef.current, chosenRef.current);
      const status = result.response.status;
      if (result.response.ok) {
        onChanged(chosenRef.current);
        onOpenChange(false);
        return;
      }
      if (status === 403) {
        currentRef.current = "";
        chosenRef.current = "";
        setProblem(detailOf(result.error) ?? WORDS.wrongNow);
        setStep("current");
      } else if (status === 422) {
        chosenRef.current = "";
        setProblem(detailOf(result.error) ?? WORDS.refusedNew);
        setStep("choose");
      } else {
        setProblem(status === 401 ? WORDS.expired : WORDS.failed);
      }
    } catch {
      setProblem(WORDS.noInternet);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function submit(value: string) {
    setPin("");
    if (step === "current") {
      currentRef.current = value;
      setProblem(null);
      setStep("choose");
    } else if (step === "choose") {
      chosenRef.current = value;
      setProblem(null);
      setStep("confirm");
    } else {
      void finish(value);
    }
  }

  function onKey(key: KeypadKey) {
    if (pendingRef.current) return;
    if (key === "delete") return setPin(pinRef.current.slice(0, -1));
    if (key === "clear") return setPin("");
    if (!/^\d$/.test(key) || pinRef.current.length >= PIN_LENGTH) return;
    const next = pinRef.current + key;
    setPin(next);
    if (next.length === PIN_LENGTH) submit(next);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && pendingRef.current) return;
        onOpenChange(next);
      }}
      title="Change my PIN"
      description={step === "current" ? "Your PIN now, then the new one twice." : undefined}
      testId="change-pin"
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending} data-testid="change-pin-cancel">
          Back
        </Button>
      }
    >
      <div className="y-pin">
        <h3 className="y-pin__step" data-testid="change-pin-step">
          {TITLE[step]}
        </h3>
        <div className="y-pin__dots" data-testid="change-pin-dots" role="img" aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}>
          {Array.from({ length: PIN_LENGTH }, (_, index) => (
            <span key={index} className={index < pin.length ? "y-pin__dot y-pin__dot--filled" : "y-pin__dot"} />
          ))}
        </div>
        <Keypad label="PIN" variant="pin" onKey={onKey} disabled={pending} testIdPrefix="change-pin-key" groupRef={keypadRef} />
        <p className="y-pin__status" role="status">
          {pending ? "Changing your PIN…" : ""}
        </p>
        {problem ? (
          <p className="y-pin__message" role="alert" data-testid="change-pin-error">
            <CircleAlert aria-hidden="true" />
            {problem}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
