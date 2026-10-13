/**
 * Named settings for the kitchen and bar display. Each is a default a
 * business could change; the screens read them from here, never a literal.
 *
 * Not here: an Undo window and a Recall count. Yetu moves a ticket only
 * forwards (fbc-peak internal/pos operations.go TransitionOrder and
 * stations.go TransitionStationTicket allow SENT to PREPARING to READY to
 * SERVED and nothing back), so the till has no Undo or Recall to time or
 * count until the backend can take a step back.
 */

/** kitchen.warnAfterMinutes: from this many minutes after it was sent, a ticket reads "Getting late". */
export const KITCHEN_WARN_AFTER_MINUTES = 10;

/** kitchen.lateAfterMinutes: from this many minutes after it was sent, a ticket reads "Late". */
export const KITCHEN_LATE_AFTER_MINUTES = 15;

/** How long a ticket nobody has started yet carries the orange New marker, from when it was sent. */
export const KITCHEN_NEW_MARKER_SECONDS = 30;

/**
 * How often the board asks Yetu for its tickets again, besides live updates
 * (a missed update shows within this time).
 */
export const KITCHEN_REFRESH_SECONDS = 15;

/** How often ages and the New marker are worked out again on screen. */
export const KITCHEN_CLOCK_TICK_SECONDS = 5;
