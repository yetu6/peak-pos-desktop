import { useState } from "react";
import { Button, Field, Sheet } from "../components/system";

/**
 * The order note goes with the order when it starts (Yetu takes it when the
 * order is created and has no way to change it afterwards).
 */
export function NoteSheet({
  note,
  locked,
  onSave,
  onClose,
}: {
  note: string;
  /** The order has started, so the note it started with stays. */
  locked: boolean;
  onSave: (note: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(note);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Order note"
      footer={
        locked ? (
          <div className="y-options__footer">
            <span />
            <Button variant="primary" size={56} onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <div className="y-options__footer">
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size={56}
              onClick={() => {
                onSave(text.trim());
                onClose();
              }}
            >
              Save note
            </Button>
          </div>
        )
      }
    >
      {locked ? (
        <div className="y-form">
          <p className="y-note__text">{note || "No note"}</p>
          <p className="y-cash__muted">Yetu keeps the note the order started with. It can't be changed now.</p>
        </div>
      ) : (
        <Field
          label="Order note"
          hint="It goes with the order to the kitchen."
          value={text}
          onChange={setText}
          autoComplete="off"
          autoFocus
        />
      )}
    </Sheet>
  );
}
