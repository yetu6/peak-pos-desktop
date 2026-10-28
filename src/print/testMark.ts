/**
 * Owner, 2026-10-28: a test business's papers say so, top and bottom, so a
 * slip from a trial is never taken for a real sale. The words are plain; the
 * thermal printer spells the dash as "-".
 */
export const TEST_MARK = "TEST \u2014 not a real sale";

/** A laid-out text paper, marked top and bottom for a test business; untouched otherwise. */
export function markText(text: string, testBusiness: boolean | undefined): string {
  return testBusiness ? `${TEST_MARK}\n\n${text.replace(/\n+$/, "")}\n\n${TEST_MARK}\n` : text;
}
