import { ArrowBigUp, Delete } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { startWatchingInput, useKeyboardAllowed } from "../../lib/onScreenKeyboard";
import { cn } from "../../lib/utils";

/** Fallback height before the keyboard has been measured. */
export const KEYBOARD_HEIGHT_FALLBACK = 260;
/** Space kept between the field and the keyboard. */
const GAP = 12;
const KEYBOARD_ATTR = "data-touch-keyboard";

const ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];
const SYMBOLS = [
  { char: "-", label: "Dash" },
  { char: "/", label: "Slash" },
  { char: "@", label: "At sign" },
  { char: ".", label: "Full stop" },
  { char: ",", label: "Comma" },
];

const NOT_TEXT = new Set(["checkbox", "radio", "range", "file", "button", "submit", "reset", "image", "color", "hidden", "date", "time", "datetime-local", "month", "week", "number"]);

/** A box people type words or digits into, that has no keypad of its own. */
export function wantsKeyboard(node: EventTarget | null): node is HTMLInputElement | HTMLTextAreaElement {
  if (!(node instanceof HTMLElement)) return false;
  if (node.closest(`[${KEYBOARD_ATTR}]`) || node.closest("[data-no-touch-keyboard]")) return false;
  if (node instanceof HTMLTextAreaElement) return !node.readOnly && !node.disabled;
  if (!(node instanceof HTMLInputElement)) return false;
  if (node.readOnly || node.disabled || NOT_TEXT.has(node.type)) return false;
  // Money and percent boxes have the numeric keypad.
  if (node.classList.contains("y-money-field__input") || node.inputMode === "decimal") return false;
  return true;
}

/** Taps on the keyboard are not "outside" a sheet: its keys must not close it. */
export function keepKeyboardTaps(event: { target: EventTarget | null; preventDefault: () => void }) {
  if (event.target instanceof Element && event.target.closest(`[${KEYBOARD_ATTR}]`)) event.preventDefault();
}

/** Types into a field as typing would: React sees an input event, so state, validation and maxLength apply. */
export function typeInto(field: HTMLInputElement | HTMLTextAreaElement, action: { text: string } | { back: true }) {
  const value = field.value;
  let start = value.length;
  let end = value.length;
  try {
    start = field.selectionStart ?? value.length;
    end = field.selectionEnd ?? value.length;
  } catch {
    // Types such as email have no caret: the end it is.
  }
  let next: string;
  let caret: number;
  if ("back" in action) {
    if (start === end && start === 0) return;
    const from = start === end ? start - 1 : start;
    next = value.slice(0, from) + value.slice(end);
    caret = from;
  } else {
    next = value.slice(0, start) + action.text + value.slice(end);
    if (field.maxLength > 0 && next.length > field.maxLength) return;
    caret = start + action.text.length;
  }
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, next);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  try {
    field.setSelectionRange(caret, caret);
  } catch {
    // No caret to place.
  }
}

interface KeyboardState {
  field: HTMLInputElement | HTMLTextAreaElement | null;
  hide: () => void;
}
const KeyboardContext = createContext<KeyboardState>({ field: null, hide: () => {} });
export const useTouchKeyboard = () => useContext(KeyboardContext);

/**
 * One on-screen keyboard for the whole till. It docks at the bottom when a
 * text box gains focus, and hides on Done, Escape or when the box loses focus.
 * It never covers the box: the layer holding the box lifts to leave it clear.
 */
export function TouchKeyboardProvider({ children }: { children: ReactNode }) {
  const allowed = useKeyboardAllowed();
  const [field, setField] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => startWatchingInput(), []);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (wantsKeyboard(event.target)) {
        setField(event.target);
        setDismissed(false);
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      setField((now) => (now === event.target ? null : now));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown);
    // A box already focused when this mounts.
    if (wantsKeyboard(document.activeElement)) setField(document.activeElement);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const hide = useCallback(() => {
    setDismissed(true);
    field?.blur();
  }, [field]);

  const open = allowed && !dismissed && field !== null && field.isConnected;
  return (
    <KeyboardContext.Provider value={{ field: open ? field : null, hide }}>
      {children}
      {open && field ? createPortal(<TouchKeyboard field={field} onDone={hide} />, document.body) : null}
    </KeyboardContext.Provider>
  );
}

/** The layer a lifted field sits in: its sheet or dialog, else the whole page. */
function layerOf(field: HTMLElement): HTMLElement {
  return field.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? document.getElementById("root") ?? document.body;
}

function useKeepFieldClear(field: HTMLElement, keyboard: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const layer = layerOf(field);
    const height = keyboard.current?.getBoundingClientRect().height || KEYBOARD_HEIGHT_FALLBACK;
    field.scrollIntoView?.({ block: "center" });
    const bottom = field.getBoundingClientRect().bottom;
    const room = window.innerHeight - height - GAP;
    const lift = Math.max(0, Math.ceil(bottom - room));
    // `translate` is separate from a sheet's own transform, so neither clobbers the other.
    layer.style.translate = lift > 0 ? `0 -${lift}px` : "";
    layer.setAttribute("data-keyboard-lift", String(lift));
    return () => {
      layer.style.translate = "";
      layer.removeAttribute("data-keyboard-lift");
    };
  }, [field, keyboard]);
}

type Shift = "off" | "once" | "caps";

function TouchKeyboard({ field, onDone }: { field: HTMLInputElement | HTMLTextAreaElement; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState<Shift>("off");
  useKeepFieldClear(field, ref);

  // The first press on a key must not move focus out of the box (the box would lose it and the keyboard hide).
  const keepFocus = (event: ReactPointerEvent | React.MouseEvent) => event.preventDefault();
  const press = (text: string) => {
    typeInto(field, { text });
    if (shift === "once") setShift("off");
  };
  const cased = (letter: string) => (shift === "off" ? letter : letter.toUpperCase());

  const key = (label: string, onClick: () => void, extra?: { aria?: string; className?: string; pressed?: boolean; children?: ReactNode }) => (
    <button
      key={extra?.aria ?? label}
      type="button"
      className={cn("y-touch-keyboard__key", extra?.className)}
      aria-label={extra?.aria ?? label}
      aria-pressed={extra?.pressed}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      {extra?.children ?? label}
    </button>
  );

  return (
    <div
      ref={ref}
      role="group"
      aria-label="On-screen keyboard"
      className="y-touch-keyboard"
      style={{ pointerEvents: "auto" }}
      {...{ [KEYBOARD_ATTR]: "" }}
      data-testid="touch-keyboard"
    >
      <div className="y-touch-keyboard__row">
        {ROWS[0].map((digit) => key(digit, () => press(digit)))}
        {key("Backspace", () => typeInto(field, { back: true }), { aria: "Backspace", className: "y-touch-keyboard__key--wide", children: <Delete aria-hidden="true" /> })}
      </div>
      <div className="y-touch-keyboard__row">{ROWS[1].map((letter) => key(cased(letter), () => press(cased(letter)), { aria: cased(letter) }))}</div>
      <div className="y-touch-keyboard__row">{ROWS[2].map((letter) => key(cased(letter), () => press(cased(letter)), { aria: cased(letter) }))}</div>
      <div className="y-touch-keyboard__row">
        {key(
          "Shift",
          () => setShift((now) => (now === "off" ? "once" : now === "once" ? "caps" : "off")),
          {
            aria: shift === "caps" ? "Shift, capitals locked" : "Shift",
            pressed: shift !== "off",
            className: "y-touch-keyboard__key--wide",
            children: <ArrowBigUp aria-hidden="true" />,
          },
        )}
        {ROWS[3].map((letter) => key(cased(letter), () => press(cased(letter)), { aria: cased(letter) }))}
      </div>
      <div className="y-touch-keyboard__row">
        {SYMBOLS.map((symbol) => key(symbol.char, () => press(symbol.char), { aria: symbol.label }))}
        {key("Space", () => press(" "), { aria: "Space", className: "y-touch-keyboard__key--space" })}
        {key("Done", onDone, { aria: "Done", className: "y-touch-keyboard__key--done" })}
      </div>
    </div>
  );
}
