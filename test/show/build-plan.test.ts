import { describe, it, expect } from "vitest";

import {
  buildPlan,
  channelList,
  eosNumber,
  groupSteps,
  colourPaletteSteps,
  intensityPaletteSteps,
  focusPaletteSteps,
  thirdFloorCueSteps,
  SNEAK_ALL,
} from "../../src/show/build-plan.js";
import { colourByName } from "../../src/show/colour-recipes.js";
import type { BuildStep } from "../../src/show/build-plan.js";

/** Every command a step sends, in the order it sends them. */
const allCommands = (steps: BuildStep[]): string[] =>
  steps.flatMap((s) => [...s.beforeCommands, ...s.commands]);

describe("eosNumber", () => {
  // A bare single digit is read as tens on the Eos command line: `At 5` is 50%,
  // `Pan + 5` is +50 degrees. Verified on hardware.
  it("keeps single digits from being read as tens", () => {
    expect(eosNumber(5)).toBe("5.0");
    expect(eosNumber(0)).toBe("0.0");
    expect(eosNumber(-5)).toBe("-5.0");
  });

  it("leaves two-digit integers alone", () => {
    expect(eosNumber(15)).toBe("15");
    expect(eosNumber(100)).toBe("100");
    expect(eosNumber(-30)).toBe("-30");
  });

  it("passes decimals through", () => {
    expect(eosNumber(2.5)).toBe("2.5");
  });
});

describe("channelList", () => {
  it("collapses contiguous runs", () => {
    expect(channelList([1, 2, 3, 4])).toBe("1 Thru 4");
  });

  it("joins separate runs with +", () => {
    expect(channelList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15])).toBe(
      "1 Thru 11 + 13 Thru 15"
    );
  });

  it("handles single channels", () => {
    expect(channelList([7])).toBe("7");
    expect(channelList([1, 4])).toBe("1 + 4");
  });

  it("sorts before collapsing", () => {
    expect(channelList([3, 1, 2])).toBe("1 Thru 3");
  });
});

describe("groupSteps", () => {
  it("labels every group, including the four that already exist unlabelled", () => {
    const steps = groupSteps();
    const labels = steps.flatMap((s) => s.commands).filter((c) => c.includes("Label"));
    expect(labels).toContain("Group 1 Label Wings Enter");
    expect(labels).toContain("Group 11 Label 3rd Fl All Enter");
  });

  it("creates groups reaching channels 12-15, which nothing currently does", () => {
    expect(allCommands(groupSteps())).toContain("Chan 12 Thru 15 Enter");
  });
});

describe("colourPaletteSteps", () => {
  const red = colourByName("Red");
  const warm = colourByName("3200K");

  it("uses the underscore keyword, because 'Color Palette' records a cue instead", () => {
    const [step] = colourPaletteSteps([red]);
    expect(step.commands).toContain("Record Color_Palette 1 Enter");
    expect(step.commands.some((c) => /Record Color Palette/.test(c))).toBe(false);
  });

  it("sneaks first, so the palette does not inherit the previous step's channels", () => {
    const [step] = colourPaletteSteps([red]);
    expect(step.beforeCommands[0]).toBe(SNEAK_ALL);
  });

  it("sneaks and selects BEFORE the colour OSC, never after", () => {
    // A Sneak sent after the OSC would release the very manual data the Record needs.
    const [step] = colourPaletteSteps([red]);
    expect(step.beforeCommands).toContain(SNEAK_ALL);
    expect(step.commands).not.toContain(SNEAK_ALL);
    expect(step.commands[0]).toMatch(/^Record /);
  });

  it("covers channels 1-11 and 13-15, excluding the colourless C300d on 12", () => {
    const [step] = colourPaletteSteps([red]);
    expect(step.beforeCommands).toContain("Chan 1 Thru 11 + 13 Thru 15 Enter");
    expect(step.osc.some((c) => c.address.includes("/chan/12/"))).toBe(false);
  });

  it("drives each family with its own colour mechanism in one step", () => {
    const [step] = colourPaletteSteps([red]);
    const addresses = step.osc.map((c) => c.address);
    expect(addresses).toContain("/eos/chan/1/color/rgb"); // Lustr
    expect(addresses).toContain("/eos/chan/5/color/rgb"); // X4
    expect(addresses).toContain("/eos/chan/13/color/hs"); // T2c
  });

  it("reaches a colour temperature three different ways in one palette", () => {
    const [step] = colourPaletteSteps([warm]);
    const byAddress = new Map(step.osc.map((c) => [c.address, c.args]));
    // No CCT parameter on these two — go via the Planckian locus on the 0-1 xy scale.
    expect(byAddress.get("/eos/chan/1/color/xy")?.[0]).toBeCloseTo(0.4232, 3);
    expect(byAddress.get("/eos/chan/5/color/xy")?.[0]).toBeCloseTo(0.4232, 3);
    // The T2c has a real one.
    expect(byAddress.get("/eos/chan/13/param/Color Temperature")).toEqual([3200]);
  });
});

describe("intensityPaletteSteps", () => {
  it("extends the palettes to the whole rig so the 3rd floor can use them", () => {
    const commands = allCommands(intensityPaletteSteps());
    expect(commands.some((c) => c.startsWith("Chan 1 Thru 15 At"))).toBe(true);
  });

  it("uses Full rather than 100 for the top palette", () => {
    expect(allCommands(intensityPaletteSteps())).toContain("Chan 1 Thru 15 At Full Enter");
  });

  it("never emits a bare single-digit level", () => {
    const levels = allCommands(intensityPaletteSteps()).filter((c) => c.includes(" At "));
    for (const command of levels) {
      expect(command).not.toMatch(/ At \d Enter$/);
    }
  });
});

describe("focusPaletteSteps", () => {
  it("only touches the seven movers", () => {
    const commands = allCommands(focusPaletteSteps());
    expect(commands.some((c) => c.startsWith("Chan 5 Thru 11 Pan"))).toBe(true);
    expect(commands.some((c) => /Chan 1 Thru/.test(c) && c.includes("Pan"))).toBe(false);
  });

  it("emits safe two-digit or decimal angles, never a bare single digit", () => {
    const angles = allCommands(focusPaletteSteps()).filter((c) => /Pan|Tilt/.test(c));
    for (const command of angles) {
      expect(command).not.toMatch(/(Pan|Tilt) -?\d Enter$/);
    }
  });

  it("reserves all six numbered positions", () => {
    expect(focusPaletteSteps()).toHaveLength(6);
  });
});

describe("thirdFloorCueSteps", () => {
  it("creates cue list 12 with spaces around the slash", () => {
    const commands = allCommands(thirdFloorCueSteps());
    expect(commands).toContain("Record Cue 12 / 1 Enter");
    expect(commands.some((c) => /Cue 12\/\d/.test(c))).toBe(false);
  });

  it("only touches 3rd floor channels, so it cannot disturb the main room", () => {
    for (const step of thirdFloorCueSteps()) {
      const everything = [...step.beforeCommands, ...step.commands];
      for (const command of everything.filter((c) => c.startsWith("Chan"))) {
        if (command === SNEAK_ALL) continue;
        expect(command).toMatch(/^Chan 12 Thru 15/);
      }
      for (const osc of step.osc) {
        const channel = Number(osc.address.split("/")[3]);
        expect(channel).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it("gives every cue a label and a time", () => {
    for (const step of thirdFloorCueSteps()) {
      expect(step.commands.some((c) => c.includes("Label"))).toBe(true);
      expect(step.commands.some((c) => c.includes("Time"))).toBe(true);
    }
  });
});

describe("buildPlan", () => {
  it("ends by releasing manual control", () => {
    const steps = buildPlan();
    expect(steps.at(-1)?.commands).toEqual([SNEAK_ALL]);
  });

  it("never emits an unspaced slash anywhere", () => {
    for (const command of allCommands(buildPlan())) {
      expect(command).not.toMatch(/\S\/|\/\S/);
    }
  });

  it("never emits a multi-word palette keyword without an underscore", () => {
    for (const command of allCommands(buildPlan())) {
      expect(command).not.toMatch(/(Color|Focus|Intensity|Beam) Palette/);
    }
  });
});
