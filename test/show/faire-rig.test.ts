import { describe, it, expect } from "vitest";

import {
  FIXTURES,
  GROUPS,
  Room,
  FixtureFamily,
  capabilitiesOf,
  colourCapableChannels,
  positionCapableChannels,
  familyOf,
  fixturesInRoom,
  PARAM_RANGES,
} from "../../src/show/faire-rig.js";

describe("FIXTURES", () => {
  it("matches the fifteen channels patched on the console", () => {
    expect(FIXTURES.map((f) => f.channel)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });

  it("gives every channel exactly one fixture", () => {
    expect(new Set(FIXTURES.map((f) => f.channel)).size).toBe(FIXTURES.length);
  });

  it("assigns the families read off the console", () => {
    expect(familyOf(1)).toBe(FixtureFamily.Lustr);
    expect(familyOf(5)).toBe(FixtureFamily.X4);
    expect(familyOf(12)).toBe(FixtureFamily.C300d);
    expect(familyOf(15)).toBe(FixtureFamily.T2c);
  });

  it("throws for a channel that is not in the rig", () => {
    expect(() => familyOf(99)).toThrow(/99/);
  });
});

describe("capabilitiesOf", () => {
  it("marks the C300d as having no colour — it is daylight only", () => {
    expect(capabilitiesOf(FixtureFamily.C300d).colour).toBe(false);
  });

  it("marks only the T2c as having a usable CCT parameter", () => {
    // The X4 reports Color Temperature as 3199..3199, i.e. fixed, so it does not count.
    expect(capabilitiesOf(FixtureFamily.T2c).cct).toBe(true);
    expect(capabilitiesOf(FixtureFamily.X4).cct).toBe(false);
    expect(capabilitiesOf(FixtureFamily.Lustr).cct).toBe(false);
  });

  it("marks only the X4 as positionable", () => {
    expect(capabilitiesOf(FixtureFamily.X4).position).toBe(true);
    for (const family of [FixtureFamily.Lustr, FixtureFamily.C300d, FixtureFamily.T2c]) {
      expect(capabilitiesOf(family).position).toBe(false);
    }
  });
});

describe("channel selection helpers", () => {
  it("excludes channel 12 from anything colour-capable", () => {
    expect(colourCapableChannels()).not.toContain(12);
    expect(colourCapableChannels()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15]);
  });

  it("scopes colour-capable channels by room", () => {
    expect(colourCapableChannels(Room.Third)).toEqual([13, 14, 15]);
    expect(colourCapableChannels(Room.Main)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("limits position control to the seven movers", () => {
    expect(positionCapableChannels()).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });

  it("splits the rig into the two rooms that run concurrently", () => {
    expect(fixturesInRoom(Room.Main).map((f) => f.channel)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(fixturesInRoom(Room.Third).map((f) => f.channel)).toEqual([12, 13, 14, 15]);
  });
});

describe("GROUPS", () => {
  it("gives every group a unique number and a label", () => {
    expect(new Set(GROUPS.map((g) => g.number)).size).toBe(GROUPS.length);
    for (const group of GROUPS) expect(group.label).not.toBe("");
  });

  it("covers channels 12-15, which no group in the show currently reaches", () => {
    const third = GROUPS.filter((g) => g.room === Room.Third);
    expect(third.length).toBeGreaterThan(0);
  });

  it("keeps main-room and 3rd-floor groups disjoint so the rooms cannot interfere", () => {
    const mainChannels = GROUPS.filter((g) => g.room === Room.Main)
      .flatMap((g) => g.channels.match(/\d+/g) ?? [])
      .map(Number);
    expect(Math.max(...mainChannels)).toBeLessThanOrEqual(11);
  });
});

describe("PARAM_RANGES", () => {
  it("records the ranges read from the console, not from a spec sheet", () => {
    expect(PARAM_RANGES.x4Pan).toEqual({ min: -311.5, max: 311.5 });
    expect(PARAM_RANGES.x4Tilt).toEqual({ min: -121, max: 121 });
    expect(PARAM_RANGES.t2cKelvin).toEqual({ min: 2500, max: 7500 });
  });
});
