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

describe("happy hour on a tile (S17c)", () => {
  const happyMenu = {
    ...MENU,
    prices: {
      tusker: { ruleName: "Happy hour", priceMinor: 400_000, sizes: { "tusker-bottle": 400_000, "tusker-pint": 520_000 } },
      curry: { ruleName: "Lunch deal", priceMinor: 1_800_000 },
    },
  };

  it("the price now, the rule's name and the price it had", async () => {
    const { tileOfferOf } = await import("./fnbWords");
    expect(tileOfferOf(happyMenu, "curry", 2_150_000, "TZS")).toEqual({
      price: "TSh 18,000",
      offer: { label: "Lunch deal", was: "TSh 21,500" },
    });
    // An item with sizes: its default size's price, before and now.
    expect(tileOfferOf(happyMenu, "tusker", 500_000, "TZS")).toEqual({
      price: "TSh 4,000 · 3 sizes",
      offer: { label: "Happy hour", was: "TSh 5,000" },
    });
  });

  it("none offline, none without a rule", async () => {
    const { tileOfferOf } = await import("./fnbWords");
    expect(tileOfferOf(happyMenu, "curry", 2_150_000, "TZS", true)).toBeUndefined();
    expect(tileOfferOf(happyMenu, "nyama", 2_800_000, "TZS")).toBeUndefined();
  });
});
