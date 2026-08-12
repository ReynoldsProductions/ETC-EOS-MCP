import { describe, it, expect } from "vitest";

import {
  planckianXy,
  resolveColour,
  COLOURS,
  colourByName,
} from "../../src/show/colour-recipes.js";
import { FixtureFamily } from "../../src/show/faire-rig.js";

describe("planckianXy", () => {
  // The reference point recorded on hardware in docs/eos-osc-findings.md §1a: 3200 K is
  // x=0.4232 y=0.3991, which produced a convincing tungsten white on a Lustr X8.
  it("matches the hardware-verified 3200 K point", () => {
    const { x, y } = planckianXy(3200);
    expect(x).toBeCloseTo(0.4232, 3);
    expect(y).toBeCloseTo(0.3991, 3);
  });

  it("matches known CIE daylight points", () => {
    const d56 = planckianXy(5600);
    expect(d56.x).toBeCloseTo(0.3288, 2);
    expect(d56.y).toBeCloseTo(0.3417, 2);
  });

  it("moves toward blue as temperature rises", () => {
    expect(planckianXy(6500).x).toBeLessThan(planckianXy(2700).x);
  });

  it("clamps to the range the approximation is valid over", () => {
    expect(planckianXy(500)).toEqual(planckianXy(1667));
    expect(planckianXy(40000)).toEqual(planckianXy(25000));
  });
});

describe("resolveColour", () => {
  const red = colourByName("Red");
  const warm = colourByName("3200K");

  it("sends RGB on 0-100 to a Lustr, not the documented 0-1", () => {
    const commands = resolveColour(red, FixtureFamily.Lustr, 3);
    expect(commands).toEqual([{ address: "/eos/chan/3/color/rgb", args: [100, 0, 0] }]);
  });

  it("sends RGB on 0-100 to an X4", () => {
    const commands = resolveColour(red, FixtureFamily.X4, 7);
    expect(commands).toEqual([{ address: "/eos/chan/7/color/rgb", args: [100, 0, 0] }]);
  });

  it("uses color/hs on a T2c, because param/hue does nothing on hardware", () => {
    const commands = resolveColour(red, FixtureFamily.T2c, 14);
    expect(commands).toHaveLength(1);
    expect(commands[0].address).toBe("/eos/chan/14/color/hs");
    expect(commands[0].args[0]).toBeCloseTo(0, 1);
    expect(commands[0].args[1]).toBeCloseTo(100, 1);
  });

  it("emits nothing for the C300d, which has no colour parameters at all", () => {
    expect(resolveColour(red, FixtureFamily.C300d, 12)).toEqual([]);
    expect(resolveColour(warm, FixtureFamily.C300d, 12)).toEqual([]);
  });

  it("reaches a colour temperature on a Lustr via CIE xy on the 0-1 scale", () => {
    const commands = resolveColour(warm, FixtureFamily.Lustr, 1);
    expect(commands).toHaveLength(1);
    expect(commands[0].address).toBe("/eos/chan/1/color/xy");
    const [x, y] = commands[0].args;
    expect(x).toBeCloseTo(0.4232, 3);
    expect(y).toBeCloseTo(0.3991, 3);
    // The xy scale is 0-1 — the opposite of color/rgb. Sending 0-100 here is nonsense.
    expect(x).toBeLessThan(1);
    expect(y).toBeLessThan(1);
  });

  it("reaches a colour temperature on a T2c with its real CCT parameter", () => {
    const commands = resolveColour(warm, FixtureFamily.T2c, 13);
    expect(commands).toEqual([
      { address: "/eos/chan/13/param/Color Temperature", args: [3200] },
    ]);
  });

  it("clamps a CCT request to what the T2c can actually do", () => {
    const commands = resolveColour(colourByName("2700K"), FixtureFamily.T2c, 13);
    expect(commands[0].args[0]).toBe(2700);
    // 2500-7500 is the fixture's range; nothing outside it should ever be sent.
    for (const colour of COLOURS.filter((c) => c.kelvin !== undefined)) {
      const [command] = resolveColour(colour, FixtureFamily.T2c, 13);
      expect(command.args[0]).toBeGreaterThanOrEqual(2500);
      expect(command.args[0]).toBeLessThanOrEqual(7500);
    }
  });
});

describe("COLOURS", () => {
  it("covers the ten names the existing sheet promised, plus Open", () => {
    const names = COLOURS.map((c) => c.name);
    for (const expected of [
      "Red",
      "Orange",
      "Yellow",
      "Green",
      "Teal",
      "Cyan",
      "Blue",
      "Magenta",
      "Hot Pink",
      "Purple",
      "Open",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("assigns every colour a unique, stable palette number", () => {
    const numbers = COLOURS.map((c) => c.paletteNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(Math.min(...numbers)).toBeGreaterThan(0);
  });

  it("resolves every colour for every colour-capable family", () => {
    const families = [FixtureFamily.Lustr, FixtureFamily.X4, FixtureFamily.T2c];
    for (const colour of COLOURS) {
      for (const family of families) {
        const commands = resolveColour(colour, family, 1);
        expect(commands.length, `${colour.name} on ${family}`).toBeGreaterThan(0);
      }
    }
  });

  it("throws on an unknown colour name rather than silently doing nothing", () => {
    expect(() => colourByName("Chartreuse")).toThrow(/Chartreuse/);
  });
});
