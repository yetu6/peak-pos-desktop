/** Shared-terminal sessions only carry a staff number; there is no separate
 * display-name field to fetch. Initials give the avatar something legible
 * without another round trip. */
export function staffLabel(staffNumber: string | undefined): { name: string; initials: string } {
  const name = staffNumber?.trim() || "Staff";
  return { name, initials: name.slice(0, 2).toUpperCase() };
}

/** The signed-in person's name when this till's roster (already loaded for
 * the PIN screen) knows them; otherwise the staff number, as before. */
export function personLabel(
  staffNumber: string | undefined,
  roster: ReadonlyArray<{ fullName: string; staffNumber: string }> | undefined,
): { name: string; initials: string } {
  const fullName = roster?.find((entry) => entry.staffNumber === staffNumber)?.fullName.trim();
  if (!fullName) return staffLabel(staffNumber);
  const initials = fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return { name: fullName, initials };
}
