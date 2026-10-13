import { describe, expect, it } from "vitest";
import { personLabel, staffLabel } from "./staffLabel";

const roster = [
  { fullName: "Amina Hassan", staffNumber: "00042" },
  { fullName: "Juma", staffNumber: "00007" },
];

describe("personLabel", () => {
  it("names the signed-in person from this till's roster", () => {
    expect(personLabel("00042", roster)).toEqual({ name: "Amina Hassan", initials: "AH" });
    expect(personLabel("00007", roster)).toEqual({ name: "Juma", initials: "J" });
  });

  it("falls back to the staff number the session carries when the roster does not have them", () => {
    expect(personLabel("00099", roster)).toEqual(staffLabel("00099"));
    expect(personLabel("00099", undefined)).toEqual(staffLabel("00099"));
    expect(personLabel(undefined, roster)).toEqual({ name: "Staff", initials: "ST" });
  });
});
