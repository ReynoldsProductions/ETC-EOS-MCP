/**
 * The ordered set of steps that turns an empty show into one the magic sheets can
 * actually drive. Pure data — nothing here touches the network, so the exact commands
 * are unit testable. `scripts/build-show.mjs` executes them.
 *
 * Command-line syntax rules this file exists to encode correctly (all verified on
 * hardware, see docs/eos-osc-findings.md §7b and §7e):
 *
 *   - Multi-word keywords need **underscores**: `Color_Palette`, never `Color Palette`.
 *     `Record Color Palette 5` does not error — it records **Cue 5**.
 *   - Slashes need spaces around them: `Cue 12 / 1`, never `Cue 12/1`.
 *   - A single-digit number is read as tens: `At 5` is 50%, `Pan + 5` is +50 degrees.
 *     Always emit two digits or a decimal point.
 */
import {
  COLOURS,
  resolveColour,
  type ColourSpec,
  type OscCommand,
} from "./colour-recipes.js";
import {
  FIXTURES,
  GROUPS,
  INTENSITIES,
  POSITIONS,
  Room,
  capabilitiesOf,
  colourCapableChannels,
  positionCapableChannels,
} from "./faire-rig.js";

export interface BuildStep {
  /** One-line description, printed as the script runs. */
  description: string;
  /**
   * Command-line text sent *before* the OSC — clearing the programmer and selecting.
   * Order matters: a Sneak sent after the OSC would release the very manual data the
   * following Record is meant to capture.
   */
  beforeCommands: readonly string[];
  /** Direct OSC putting colour or position on channels, ready to be recorded. */
  osc: readonly OscCommand[];
  /** Command-line text sent after the OSC — the Record and Label. */
  commands: readonly string[];
}

/**
 * Format a number for the Eos command line.
 *
 * A bare single digit is interpreted as tens — `At 5` means 50%, `Pan + 5` means +50 —
 * so anything under 10 must carry a decimal point to be read literally.
 */
export function eosNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) >= 10) return String(value);
  if (Number.isInteger(value)) return `${value}.0`;
  return String(value);
}

/** Eos channel-list syntax for an arbitrary set of channels, e.g. "1 Thru 11 + 13 Thru 15". */
export function channelList(channels: readonly number[]): string {
  const sorted = [...channels].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (const channel of sorted.slice(1)) {
    if (channel === previous + 1) {
      previous = channel;
      continue;
    }
    runs.push(start === previous ? `${start}` : `${start} Thru ${previous}`);
    start = channel;
    previous = channel;
  }
  runs.push(start === previous ? `${start}` : `${start} Thru ${previous}`);
  return runs.join(" + ");
}

/**
 * Release manual control of everything.
 *
 * Recording a palette captures every channel holding manual data, not just the current
 * selection — so without this between steps, each palette accumulates the leftovers of
 * the one before. `Release` is not a command-line word in Eos 3.3; `Sneak` is.
 */
export const SNEAK_ALL = "Chan 1 Thru 15 Sneak Enter";

/** Label the four existing unlabelled groups and create the missing ones. */
export function groupSteps(): BuildStep[] {
  return GROUPS.map((group) => ({
    description: `Group ${group.number} "${group.label}" (${group.channels})`,
    beforeCommands: [`Chan ${group.channels} Enter`],
    osc: [],
    commands: [
      `Record Group ${group.number} Enter`,
      `Group ${group.number} Label ${group.label} Enter`,
    ],
  }));
}

/**
 * Record one colour palette per named colour, across every colour-capable channel.
 *
 * Each family gets the colour by its own mechanism first — RGB for the Lustrs and X4s,
 * CIE xy for a colour temperature on those same fixtures, Hue/Sat or the real CCT
 * parameter for the T2c tubes — and then a single Record captures the lot. The C300d
 * has no colour parameters and is silently absent from every palette.
 */
export function colourPaletteSteps(colours: readonly ColourSpec[] = COLOURS): BuildStep[] {
  const channels = colourCapableChannels();
  return colours.map((colour) => {
    const osc = FIXTURES.filter((f) => capabilitiesOf(f.family).colour).flatMap((f) =>
      resolveColour(colour, f.family, f.channel)
    );
    return {
      description: `Colour Palette ${colour.paletteNumber} "${colour.name}"`,
      beforeCommands: [SNEAK_ALL, `Chan ${channelList(channels)} Enter`],
      osc,
      commands: [
        `Record Color_Palette ${colour.paletteNumber} Enter`,
        `Color_Palette ${colour.paletteNumber} Label ${colour.name} Enter`,
      ],
    };
  });
}

/**
 * Intensity palettes across the whole rig, including 12-15.
 *
 * IP 1-9 already exist but cover only channels 1-11, so nothing on the 3rd-floor sheet
 * could use them. Re-recording extends them; 10 ("Full") is new.
 */
export function intensityPaletteSteps(): BuildStep[] {
  const channels = channelList(FIXTURES.map((f) => f.channel));
  return INTENSITIES.map((intensity) => ({
    description: `Intensity Palette ${intensity.paletteNumber} "${intensity.label}"`,
    beforeCommands: [
      SNEAK_ALL,
      `Chan ${channels} At ${intensity.level >= 100 ? "Full" : eosNumber(intensity.level)} Enter`,
    ],
    osc: [],
    commands: [
      `Record Intensity_Palette ${intensity.paletteNumber} Enter`,
      `Intensity_Palette ${intensity.paletteNumber} Label ${intensity.label} Enter`,
    ],
  }));
}

/**
 * Placeholder focus palettes for the seven movers.
 *
 * Real positions can only be set with the rig hung, so these are recorded at safe,
 * distinct tilts near home rather than at guessed angles that might point a mover at
 * the audience. They exist so the sheet's position buttons are live and correctly
 * numbered; the record buttons on the Setup & Focus sheet overwrite them on site.
 */
export function focusPaletteSteps(): BuildStep[] {
  const channels = channelList(positionCapableChannels());
  const placeholderTilts = [-30, -15, 0, 15, 0, 0];

  return POSITIONS.map((position, index) => ({
    description: `Focus Palette ${position.paletteNumber} "${position.label}" (placeholder — re-record on site)`,
    beforeCommands: [
      SNEAK_ALL,
      `Chan ${channels} Pan ${eosNumber(0)} Enter`,
      `Chan ${channels} Tilt ${eosNumber(placeholderTilts[index] ?? 0)} Enter`,
    ],
    osc: [],
    commands: [
      `Record Focus_Palette ${position.paletteNumber} Enter`,
      `Focus_Palette ${position.paletteNumber} Label ${position.label} Enter`,
    ],
  }));
}

export interface ThirdFloorCue {
  number: number;
  label: string;
  level: number;
  colourName?: string;
}

/** Basic looks for the 3rd floor, so its operator sheet has something to fire. */
export const THIRD_FLOOR_CUES: readonly ThirdFloorCue[] = [
  { number: 1, label: "Warm", level: 70, colourName: "3200K" },
  { number: 2, label: "Neutral", level: 70, colourName: "4300K" },
  { number: 3, label: "Cool", level: 70, colourName: "5600K" },
  { number: 4, label: "Low Warm", level: 30, colourName: "2700K" },
  { number: 5, label: "Blackout", level: 0 },
];

/**
 * Create cue list 12 for the 3rd floor so both rooms can run at once.
 *
 * Eos does not auto-create cue lists (docs/eos-osc-findings.md §4) — the list comes into
 * existence when the first cue is recorded into it. Note the spaces around the slash.
 */
export function thirdFloorCueSteps(): BuildStep[] {
  const thirdFloor = FIXTURES.filter((f) => f.room === Room.Third);
  const channels = channelList(thirdFloor.map((f) => f.channel));

  return THIRD_FLOOR_CUES.map((cue) => {
    const colour = cue.colourName ? COLOURS.find((c) => c.name === cue.colourName) : undefined;
    const osc = colour
      ? thirdFloor
          .filter((f) => capabilitiesOf(f.family).colour)
          .flatMap((f) => resolveColour(colour, f.family, f.channel))
      : [];

    return {
      description: `Cue 12 / ${cue.number} "${cue.label}"`,
      beforeCommands: [
        SNEAK_ALL,
        `Chan ${channels} At ${cue.level >= 100 ? "Full" : eosNumber(cue.level)} Enter`,
      ],
      osc,
      commands: [
        `Record Cue 12 / ${cue.number} Enter`,
        `Cue 12 / ${cue.number} Label ${cue.label} Enter`,
        `Cue 12 / ${cue.number} Time ${eosNumber(2)} Enter`,
      ],
    };
  });
}

/** The whole build, in the order it must run. */
export function buildPlan(): BuildStep[] {
  return [
    ...groupSteps(),
    ...colourPaletteSteps(),
    ...intensityPaletteSteps(),
    ...focusPaletteSteps(),
    ...thirdFloorCueSteps(),
    {
      description: "Release manual control",
      beforeCommands: [],
      osc: [],
      commands: [SNEAK_ALL],
    },
  ];
}
