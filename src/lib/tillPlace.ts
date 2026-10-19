/**
 * What the till calls itself on screen: the hotel, the outlet and the till,
 * as the manager named them in Yetu (F-252). Yetu sends them with the lock
 * screen's staff list and with each sign-in; the till keeps them with its
 * identity, so they show before anyone signs in and when offline.
 */
export interface TillPlace {
  propertyName?: string;
  outletName?: string;
  tillName?: string;
}

function name(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The names in one of Yetu's answers (the device challenge or a PIN session). */
export function placeFrom(body: unknown): TillPlace {
  if (!body || typeof body !== "object") return {};
  const answer = body as Record<string, unknown>;
  const place: TillPlace = {};
  const propertyName = name(answer.propertyName);
  const outletName = name(answer.outletName);
  const tillName = name(answer.terminalName);
  if (propertyName) place.propertyName = propertyName;
  if (outletName) place.outletName = outletName;
  if (tillName) place.tillName = tillName;
  return place;
}

/** The heading: the hotel, else the outlet, else the till. */
export function placeTitle(place: TillPlace): string | null {
  return place.propertyName ?? place.outletName ?? place.tillName ?? null;
}

/** Beneath the heading: the outlet and the till, leaving out whatever the heading already says. */
export function placeSubtitle(place: TillPlace): string | null {
  const title = placeTitle(place);
  const parts = [place.outletName, place.tillName].filter((part): part is string => Boolean(part) && part !== title);
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return unique.length > 0 ? unique.join(" · ") : null;
}

/** The hotel's mark until it has a logo: the initials of its first two words, "The" aside. */
export function placeMonogram(place: TillPlace): string {
  const words = (place.propertyName ?? place.outletName ?? "")
    .split(/\s+/)
    .filter((word) => word.length > 0 && word.toLowerCase() !== "the");
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

/** The place as the till keeps it with its identity. */
export function placeOf(identity: { propertyName?: string; outletName?: string; terminalName?: string } | null | undefined): TillPlace {
  if (!identity) return {};
  return placeFrom({ propertyName: identity.propertyName, outletName: identity.outletName, terminalName: identity.terminalName });
}
