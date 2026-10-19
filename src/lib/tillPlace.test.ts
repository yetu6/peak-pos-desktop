import { describe, expect, it } from "vitest";
import { placeFrom, placeMonogram, placeSubtitle, placeTitle } from "./tillPlace";

// F-252: the till said "This till" and showed Yetu's logo; it is the hotel's till.
describe("the till's place, as the manager named it in Yetu", () => {
  const bahari = { propertyName: "Bahari QA Hotel", outletName: "Restaurant", tillName: "Main till" };

  it("reads the names from Yetu's answers, and nothing that isn't a name", () => {
    expect(placeFrom({ propertyName: " Bahari QA Hotel ", outletName: "Restaurant", terminalName: "Main till", staff: [] })).toEqual(bahari);
    expect(placeFrom({ propertyName: "", outletName: 7, terminalName: null })).toEqual({});
    expect(placeFrom(null)).toEqual({});
  });

  it("is headed by the hotel, with the outlet and the till beneath", () => {
    expect(placeTitle(bahari)).toBe("Bahari QA Hotel");
    expect(placeSubtitle(bahari)).toBe("Restaurant · Main till");
  });

  it("says what it knows when Yetu sent less, and never repeats itself", () => {
    expect(placeTitle({ outletName: "Restaurant", tillName: "Main till" })).toBe("Restaurant");
    expect(placeSubtitle({ outletName: "Restaurant", tillName: "Main till" })).toBe("Main till");
    expect(placeSubtitle({ propertyName: "Bahari", outletName: "Bahari" })).toBeNull();
    expect(placeTitle({ tillName: "Main till" })).toBe("Main till");
    expect(placeSubtitle({ tillName: "Main till" })).toBeNull();
    expect(placeTitle({})).toBeNull();
  });

  it("marks the hotel with its initials until it has a logo", () => {
    expect(placeMonogram(bahari)).toBe("BQ");
    expect(placeMonogram({ propertyName: "The Jacaranda" })).toBe("J");
    expect(placeMonogram({ propertyName: "Kilima View Hotel" })).toBe("KV");
    expect(placeMonogram({ outletName: "Pool bar" })).toBe("PB");
    expect(placeMonogram({})).toBe("");
  });
});
