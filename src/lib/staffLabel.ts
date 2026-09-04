/** Shared-terminal sessions only carry a staff number; there is no separate
 * display-name field to fetch. Initials give the avatar something legible
 * without another round trip. */
export function staffLabel(staffNumber: string | undefined): { name: string; initials: string } {
  const name = staffNumber?.trim() || "Staff";
  return { name, initials: name.slice(0, 2).toUpperCase() };
}
