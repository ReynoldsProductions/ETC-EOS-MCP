/**
 * Turn a named colour into the right OSC for each fixture family.
 *
 * A single "Red" or "3200K" button has to reach three different kinds of fixture that
 * accept colour three different ways. Resolving that here — once, at palette-record
 * time — means everything downstream (magic sheet button, cue, web UI) only ever deals
 * with a palette number.
 *
 * The mechanisms and their scales are hardware-verified in docs/eos-osc-findings.md:
 *
 *   - `color/rgb` is **0-100**, not the 0-1 ETC's OSC Dictionary documents (§1).
 *   - `color/xy` is **0-1**, the opposite scale to rgb, and is the only way to hit a
 *     colour temperature on a fixture with no CCT parameter (§1a).
 *   - `param/hue` and `param/saturation` do nothing; `color/hs` works (§1b).
 */
import {
  FixtureFamily,
  type FixtureFamilyValue,
  capabilitiesOf,
  PARAM_RANGES,
} from "./faire-rig.js";

export interface OscCommand {
  address: string;
  args: number[];
}

export interface ColourSpec {
  name: string;
  /** Colour palette number this records into. */
  paletteNumber: number;
  /** RGB on the 0-100 scale Eos actually uses. Mutually exclusive with `kelvin`. */
  rgb?: readonly [number, number, number];
  /** A colour temperature in kelvin. Mutually exclusive with `rgb`. */
  kelvin?: number;
}

/**
 * Palette numbers 1-11 deliberately match the colour buttons already drawn on the
 * "All hands" sheet, so those twelve dead buttons start working without being moved.
 */
export const COLOURS: readonly ColourSpec[] = [
  { name: "Red", paletteNumber: 1, rgb: [100, 0, 0] },
  { name: "Orange", paletteNumber: 2, rgb: [100, 45, 0] },
  { name: "Yellow", paletteNumber: 3, rgb: [100, 100, 0] },
  { name: "Green", paletteNumber: 4, rgb: [0, 100, 0] },
  { name: "Teal", paletteNumber: 5, rgb: [0, 100, 60] },
  { name: "Cyan", paletteNumber: 6, rgb: [0, 100, 100] },
  { name: "Blue", paletteNumber: 7, rgb: [0, 0, 100] },
  { name: "Magenta", paletteNumber: 8, rgb: [100, 0, 100] },
  { name: "Hot Pink", paletteNumber: 9, rgb: [100, 0, 45] },
  { name: "Purple", paletteNumber: 10, rgb: [50, 0, 100] },
  { name: "Open", paletteNumber: 11, rgb: [100, 100, 100] },
  { name: "2700K", paletteNumber: 21, kelvin: 2700 },
  { name: "3200K", paletteNumber: 22, kelvin: 3200 },
  { name: "4300K", paletteNumber: 23, kelvin: 4300 },
  { name: "5600K", paletteNumber: 24, kelvin: 5600 },
  { name: "6500K", paletteNumber: 25, kelvin: 6500 },
];

export function colourByName(name: string): ColourSpec {
  const colour = COLOURS.find((c) => c.name === name);
  if (!colour) {
    throw new Error(
      `Unknown colour "${name}". Known colours: ${COLOURS.map((c) => c.name).join(", ")}.`
    );
  }
  return colour;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Valid range of the Kim et al. cubic approximation used below. */
const LOCUS_MIN_K = 1667;
const LOCUS_MAX_K = 25000;

/**
 * CIE 1931 chromaticity of a black body at `kelvin`, via the Kim et al. cubic spline
 * approximation of the Planckian locus.
 *
 * Verified against hardware: 3200 K gives x=0.4232 y=0.3991, which is the point recorded
 * in docs/eos-osc-findings.md §1a as producing a convincing tungsten white on a Lustr X8.
 *
 * Note this is the Planckian locus, not the CIE daylight locus — above ~5000 K the two
 * diverge slightly. Planckian is what matches Eos's colour engine in practice.
 */
export function planckianXy(kelvin: number): { x: number; y: number } {
  const t = clamp(kelvin, LOCUS_MIN_K, LOCUS_MAX_K);
  const t2 = t * t;
  const t3 = t2 * t;

  const x =
    t <= 4000
      ? -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.179910
      : -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.240390;

  const x2 = x * x;
  const x3 = x2 * x;

  let y: number;
  if (t <= 2222) {
    y = -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683;
  } else if (t <= 4000) {
    y = -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867;
  } else {
    y = 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483;
  }

  return { x, y };
}

/** Hue (0-360) and saturation (0-100) for an RGB triple on the 0-100 scale. */
function rgbToHs(rgb: readonly [number, number, number]): { hue: number; saturation: number } {
  const [r, g, b] = rgb.map((c) => clamp(c, 0, 100) / 100);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return { hue, saturation: max === 0 ? 0 : (delta / max) * 100 };
}

/**
 * The OSC needed to put `colour` on `channel`, given its fixture family.
 *
 * Returns an empty list for fixtures with no colour parameters at all — the C300d is
 * daylight-only, and sending it colour would be a silent no-op that looks like a bug.
 */
export function resolveColour(
  colour: ColourSpec,
  family: FixtureFamilyValue,
  channel: number
): OscCommand[] {
  if (!capabilitiesOf(family).colour) return [];

  const base = `/eos/chan/${channel}`;

  if (colour.kelvin !== undefined) {
    if (family === FixtureFamily.T2c) {
      // The only fixture in the rig with a real, settable CCT parameter.
      const kelvin = clamp(colour.kelvin, PARAM_RANGES.t2cKelvin.min, PARAM_RANGES.t2cKelvin.max);
      return [{ address: `${base}/param/Color Temperature`, args: [kelvin] }];
    }
    // No usable CCT parameter: hit the colour temperature as a point on the Planckian
    // locus and let Eos's colour engine map it onto the fixture's emitters. Scale is
    // 0-1 here, unlike color/rgb.
    const { x, y } = planckianXy(colour.kelvin);
    return [{ address: `${base}/color/xy`, args: [x, y] }];
  }

  if (!colour.rgb) {
    throw new Error(`Colour "${colour.name}" specifies neither rgb nor kelvin.`);
  }

  if (family === FixtureFamily.T2c) {
    // Hue/Sat is the T2c's native colour model. Must go via color/hs — the raw
    // param/hue and param/saturation addresses do nothing on hardware.
    const { hue, saturation } = rgbToHs(colour.rgb);
    return [{ address: `${base}/color/hs`, args: [hue, saturation] }];
  }

  // Lustr and X4 both take RGB on 0-100.
  return [{ address: `${base}/color/rgb`, args: [...colour.rgb] }];
}
