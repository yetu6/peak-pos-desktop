import { describe, expect, it } from "vitest";
import { MENU } from "../visual/registerData";
import { tagNote, tileNote } from "./fnbWords";

describe("staff's tags as the till says them", () => {
  it("puts allergies first, then what suits a guest", () => {
    // The curry's tags were chosen Vegan, then Contains nuts.
    expect(tagNote(MENU, "curry")).toBe("Contains nuts · Vegan");
    expect(tagNote(MENU, "tart")).toBe("Contains gluten · Contains eggs");
    expect(tagNote(MENU, "nyama")).toBeUndefined();
  });

  it("a tile's note is the tags, and offline says how sizes sell", () => {
    expect(tileNote(MENU, "curry")).toBe("Contains nuts · Vegan");
    expect(tileNote(MENU, "tusker", true)).toMatch(/size/i);
  });
});
