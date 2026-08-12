import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseMagicSheet,
  emitMagicSheet,
  decodeUtf16,
  encodeUtf16,
  TargetType,
  PaletteList,
  describeTarget,
} from "../../src/show/magic-sheet-xml.js";

const fixture = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));

const allHands = () => parseMagicSheet(decodeUtf16(fixture("ms-all-hands.xml")));
const thirdFl = () => parseMagicSheet(decodeUtf16(fixture("ms-3rd-fl.xml")));

describe("decodeUtf16", () => {
  it("strips the BOM and decodes UTF-16LE", () => {
    const text = decodeUtf16(fixture("ms-3rd-fl.xml"));
    expect(text.startsWith("<?xml")).toBe(true);
    expect(text).toContain("MAGICSHEET");
  });

  it("round-trips through encodeUtf16 with a BOM intact", () => {
    const text = "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\n<A B=\"1\" />";
    const bytes = encodeUtf16(text);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xfe);
    expect(decodeUtf16(bytes)).toBe(text);
  });
});

describe("parseMagicSheet — Sheet 1 'All hands'", () => {
  it("reads the showfile version and viewport", () => {
    const sheet = allHands();
    expect(sheet.showfileVersion).toBe("122");
    expect(sheet.viewport.scale).toBeCloseTo(0.2526896, 5);
  });

  it("finds all 60 objects", () => {
    expect(allHands().items).toHaveLength(60);
  });

  it("reads the eleven channel symbols with their targets", () => {
    const channels = allHands().items.filter((i) => i.target.type === TargetType.Channel);
    expect(channels).toHaveLength(11);
    expect(channels.map((c) => c.target.id).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it("reads the colour palette direct selects", () => {
    const cps = allHands().items.filter(
      (i) => i.target.type === TargetType.Palette && i.target.listId === PaletteList.Colour
    );
    expect(cps).toHaveLength(12);
    expect(cps[0].text).toBe("RED");
  });

  it("reads the cue buttons and the cue list they point at", () => {
    const cues = allHands().items.filter((i) => i.target.type === TargetType.Cue);
    expect(cues).toHaveLength(13);
    // Every one points at cue list 1 — which does not exist in this show.
    expect(new Set(cues.map((c) => c.target.listId))).toEqual(new Set([1]));
  });

  it("reads the four group buttons with their sheet-only labels", () => {
    const groups = allHands().items.filter((i) => i.target.type === TargetType.Group);
    expect(groups.map((g) => g.text).sort()).toEqual(["All", "Centers", "Wings", "X4 Wash"]);
  });

  it("reads pen and brush links, which are off on every object", () => {
    const linked = allHands().items.filter(
      (i) => i.links.penLink !== 0 || i.links.brushLink !== 0
    );
    expect(linked).toHaveLength(0);
  });

  it("keeps the symbol image path so regenerated sheets reuse the same artwork", () => {
    const chan1 = allHands().items.find((i) => i.target.id === 1 && i.key === "Symbol");
    expect(chan1?.image).toContain("011_Source_4_LED.svg");
  });
});

describe("parseMagicSheet — Sheet 2 '3rd FL'", () => {
  it("finds all 7 objects", () => {
    expect(thirdFl().items).toHaveLength(7);
  });

  it("exposes the duplicate channel 15 target", () => {
    const channels = thirdFl()
      .items.filter((i) => i.target.type === TargetType.Channel)
      .map((i) => i.target.id);
    expect(channels).toEqual([12, 13, 14, 15, 15]);
  });

  it("has no palette, cue or group buttons at all", () => {
    const controls = thirdFl().items.filter((i) =>
      [TargetType.Palette, TargetType.Cue, TargetType.Group].includes(i.target.type)
    );
    expect(controls).toHaveLength(0);
  });
});

describe("emitMagicSheet", () => {
  it("round-trips Sheet 1 semantically", () => {
    const original = allHands();
    const reparsed = parseMagicSheet(emitMagicSheet(original));
    expect(reparsed).toEqual(original);
  });

  it("round-trips Sheet 2 semantically", () => {
    const original = thirdFl();
    const reparsed = parseMagicSheet(emitMagicSheet(original));
    expect(reparsed).toEqual(original);
  });

  it("emits the header Eos requires", () => {
    const xml = emitMagicSheet(thirdFl());
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-16"?>');
    expect(xml).toContain("<!DOCTYPE ETC>");
    expect(xml).toContain('<MAGICSHEET SHOWFILE_VERSION="122">');
  });

  it("preserves object counts", () => {
    const original = allHands();
    const reparsed = parseMagicSheet(emitMagicSheet(original));
    expect(reparsed.items).toHaveLength(original.items.length);
  });
});

describe("describeTarget", () => {
  it("names each target type for audit output", () => {
    expect(describeTarget({ type: TargetType.Channel, id: 5, listId: -1, mode: 1 })).toBe(
      "Channel 5"
    );
    expect(
      describeTarget({ type: TargetType.Palette, id: 2, listId: PaletteList.Colour, mode: 1 })
    ).toBe("Colour Palette 2");
    expect(
      describeTarget({ type: TargetType.Palette, id: 3, listId: PaletteList.Focus, mode: 1 })
    ).toBe("Focus Palette 3");
    expect(describeTarget({ type: TargetType.Cue, id: 4, listId: 99, mode: 1 })).toBe(
      "Cue 99 / 4"
    );
    expect(describeTarget({ type: TargetType.Group, id: 7, listId: -1, mode: 1 })).toBe("Group 7");
    expect(describeTarget({ type: TargetType.None, id: -1, listId: -1, mode: 0 })).toBe(
      "no target"
    );
  });
});
