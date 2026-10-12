import { ChevronDown, Lock, UsersRound } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { KeyHint } from "../components/system";
import { keyHintForCommand } from "../lib/keyboard";

/**
 * Who is signed in. Pressing the name offers Switch person and Lock. The shell
 * holds whether it is open, so a global key or Esc anywhere closes it.
 */
export function PersonMenu({
  person,
  open,
  onOpenChange: setOpen,
  onSwitchPerson,
  onLock,
}: {
  person: { name: string; initials: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchPerson: () => void;
  onLock: () => void;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemsRef.current[0]?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = itemsRef.current.filter((item): item is HTMLButtonElement => item !== null);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="y-person" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="y-person__trigger"
        data-testid="person-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="y-avatar" aria-hidden="true">
          {person.initials}
        </span>
        <span className="y-person__name" data-testid="staff-name">
          {person.name}
        </span>
        <ChevronDown className="y-person__chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" id={menuId} aria-label={person.name} className="y-menu" onKeyDown={onMenuKeyDown}>
          <button
            ref={(element) => {
              itemsRef.current[0] = element;
            }}
            type="button"
            role="menuitem"
            className="y-menu__item"
            data-testid="switch-staff"
            onClick={() => choose(onSwitchPerson)}
          >
            <UsersRound aria-hidden="true" />
            Switch person
          </button>
          <button
            ref={(element) => {
              itemsRef.current[1] = element;
            }}
            type="button"
            role="menuitem"
            className="y-menu__item"
            data-testid="lock-till"
            onClick={() => choose(onLock)}
          >
            <Lock aria-hidden="true" />
            Lock
            <KeyHint keys={keyHintForCommand("lock") ?? ""} className="y-menu__hint" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
