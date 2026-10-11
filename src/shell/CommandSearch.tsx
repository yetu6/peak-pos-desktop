import { Search } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { KeyHint } from "../components/system";
import { cn } from "../lib/utils";

export interface ShellCommand {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  /** What people call the job ("close shift", "printer"), so the search finds it. */
  keywords: readonly string[];
  keys?: string;
  /** Present when the command is closed right now, in words. */
  disabledReason?: string;
  run: () => void;
}

function matches(command: ShellCommand, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [command.label, command.description, ...command.keywords].join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * Ctrl+K: find a section or an action by typing what it is called. Arrow keys
 * move, Enter opens, Esc closes. Closed sections are listed with the reason.
 */
export function CommandSearch({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly ShellCommand[];
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="y-scrim" />
        <DialogPrimitive.Content className="y-command" data-command-search="" aria-describedby={undefined}>
          {open ? <CommandSearchBody commands={commands} onDone={() => onOpenChange(false)} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CommandSearchBody({ commands, onDone }: { commands: readonly ShellCommand[]; onDone: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => commands.filter((command) => matches(command, query)), [commands, query]);
  const current = results[Math.min(active, results.length - 1)];

  function run(command: ShellCommand | undefined) {
    if (!command || command.disabledReason) return;
    onDone();
    command.run();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (Math.min(index, results.length - 1) + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(current);
    }
  }

  return (
    <>
      <DialogPrimitive.Title className="sr-only">Search the till</DialogPrimitive.Title>
      <div className="y-command__field">
        <Search className="y-command__icon" aria-hidden="true" />
        <input
          className="y-command__input"
          role="combobox"
          aria-label="Search the till"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current ? `${listId}-${current.id}` : undefined}
          placeholder="Search: Sell, close shift, printer"
          value={query}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <ul className="y-command__list" role="listbox" id={listId} aria-label="Results">
        {results.map((command) => (
          <li
            key={command.id}
            id={`${listId}-${command.id}`}
            role="option"
            aria-selected={command === current}
            aria-disabled={command.disabledReason ? true : undefined}
            className={cn("y-command__option", command === current && "y-command__option--active")}
            onPointerMove={() => setActive(results.indexOf(command))}
            onClick={() => run(command)}
          >
            <span className="y-command__option-icon" aria-hidden="true">
              {command.icon}
            </span>
            <span className="y-command__option-text">
              <span className="y-command__option-label">{command.label}</span>
              <span className="y-command__option-description">{command.disabledReason ?? command.description}</span>
            </span>
            {command.keys ? <KeyHint keys={command.keys} /> : null}
          </li>
        ))}
      </ul>
      {results.length === 0 ? (
        <p className="y-command__empty" role="status">
          Nothing matches “{query}”. Try a section, like Sell or Cash.
        </p>
      ) : null}
      <p className="y-command__help">
        <KeyHint keys="↑ ↓" /> move <KeyHint keys="Enter" /> open <KeyHint keys="Esc" /> close
      </p>
    </>
  );
}
