/**
 * Owner, 2026-10-28: a test business's papers say so, top and bottom, so a
 * slip from a trial is never taken for a real sale. The words are plain; the
 * thermal printer spells the dash as "-".
 */
export const TEST_MARK = "TEST \u2014 not a real sale";

/** Owner, 2026-10-28: a sample paper (Status, Print sample papers) says so, top and bottom, and is never a sale. */
export const SAMPLE_MARK = "SAMPLE \u2014 not a real sale";

/** What a paper is marked with: nothing, the test-business words (true), or other words (a sample). */
export type PaperMark = boolean | string | undefined;

/** The words that open and close a paper, or null for an unmarked one. */
export function markWords(mark: PaperMark): string | null {
  if (typeof mark === "string") return mark.trim() ? mark : null;
  return mark === true ? TEST_MARK : null;
}

/** A laid-out text paper, marked top and bottom for a test business or a sample; untouched otherwise. */
export function markText(text: string, mark: PaperMark): string {
  const words = markWords(mark);
  return words ? `${words}\n\n${text.replace(/\n+$/, "")}\n\n${words}\n` : text;
}
