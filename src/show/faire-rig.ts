/**
 * The Faire rig, as a single source of truth.
 *
 * Everything downstream is generated from this file: the palettes and groups recorded
 * onto the console, the magic sheets, and (later) the web UI's sheet layout. Nothing
 * here talks to hardware — it is plain data so it can be unit tested and diffed.
 *
 * Fixture types and parameter ranges were read off the live console with
 * `tools/diagnostics/params.mjs`, not taken from a spec sheet. They drive real
 * decisions: which fixtures can be positioned, which can hit a colour temperature
 * directly, and which cannot do colour at all.
 */

/** Fixture families in the rig. Capability differences between these drive everything. */
export const FixtureFamily = {
  /** ETC S4 LED S3 Lustr X8 Direct — eight emitters, full gamut, no CCT parameter. */
  Lustr: "lustr",
  /** GLP Impression X4 Normal — RGBW mover. Its CCT parameter reports 3199..3199, i.e. fixed. */
  X4: "x4",
  /** Aputure Light Storm C300d II — daylight only. No colour parameters whatsoever. */
  C300d: "c300d",
  /** Aputure amaran T2c — Hue/Sat plus a genuinely settable 2500-7500 K CCT. */
  T2c: "t2c",
} as const;

export type FixtureFamilyValue = (typeof FixtureFamily)[keyof typeof FixtureFamily];

/** Which set a fixture belongs to. The two rooms run concurrently and must not interact. */
export const Room = {
  Main: "main",
  Third: "third",
} as const;

export type RoomValue = (typeof Room)[keyof typeof Room];

export interface FixtureCapabilities {
  /** Can be given a colour at all. False for the C300d. */
  colour: boolean;
  /** Has a usable Color Temperature parameter. True only for the T2c. */
  cct: boolean;
  /** Has Pan/Tilt. True only for the X4 movers. */
  position: boolean;
  zoom: boolean;
}

const CAPABILITIES: Record<FixtureFamilyValue, FixtureCapabilities> = {
  [FixtureFamily.Lustr]: { colour: true, cct: false, position: false, zoom: false },
  [FixtureFamily.X4]: { colour: true, cct: false, position: true, zoom: true },
  [FixtureFamily.C300d]: { colour: false, cct: false, position: false, zoom: false },
  [FixtureFamily.T2c]: { colour: true, cct: true, position: false, zoom: false },
};

export function capabilitiesOf(family: FixtureFamilyValue): FixtureCapabilities {
  return CAPABILITIES[family];
}

/** Parameter ranges read from the console, used to clamp anything we send. */
export const PARAM_RANGES = {
  /** GLP Impression X4 Normal. */
  x4Pan: { min: -311.5, max: 311.5 },
  x4Tilt: { min: -121, max: 121 },
  x4Zoom: { min: 7, max: 50 },
  /** Aputure amaran T2c. */
  t2cKelvin: { min: 2500, max: 7500 },
} as const;

export interface Fixture {
  channel: number;
  family: FixtureFamilyValue;
  room: RoomValue;
  /** What this unit does in the room, used as its sheet label. */
  role: string;
  /** Symbol artwork, matching the paths Eos ships. */
  symbol: string;
}

const SYMBOL = {
  s4Led: "011_Source_4_LED.svg",
  movingWash: "006_Moving_Wash.svg",
  panel: "017_fos4_Px8.svg",
} as const;

/**
 * The patch, as read from the console.
 *
 * Roles for 1-11 follow the groups already in the show (Wings = 1,4; Centers = 2,3).
 * Roles for 12-15 come from the labels on the "3rd FL" sheet — note that sheet targets
 * channel 15 twice and never targets one of the tubes, which is corrected here.
 */
export const FIXTURES: readonly Fixture[] = [
  { channel: 1, family: FixtureFamily.Lustr, room: Room.Main, role: "Wing L", symbol: SYMBOL.s4Led },
  { channel: 2, family: FixtureFamily.Lustr, room: Room.Main, role: "Center L", symbol: SYMBOL.s4Led },
  { channel: 3, family: FixtureFamily.Lustr, room: Room.Main, role: "Center R", symbol: SYMBOL.s4Led },
  { channel: 4, family: FixtureFamily.Lustr, room: Room.Main, role: "Wing R", symbol: SYMBOL.s4Led },
  { channel: 5, family: FixtureFamily.X4, room: Room.Main, role: "Wash 1", symbol: SYMBOL.movingWash },
  { channel: 6, family: FixtureFamily.X4, room: Room.Main, role: "Wash 2", symbol: SYMBOL.movingWash },
  { channel: 7, family: FixtureFamily.X4, room: Room.Main, role: "Wash 3", symbol: SYMBOL.movingWash },
  { channel: 8, family: FixtureFamily.X4, room: Room.Main, role: "Wash 4", symbol: SYMBOL.movingWash },
  { channel: 9, family: FixtureFamily.X4, room: Room.Main, role: "Wash 5", symbol: SYMBOL.movingWash },
  { channel: 10, family: FixtureFamily.X4, room: Room.Main, role: "Wash 6", symbol: SYMBOL.movingWash },
  { channel: 11, family: FixtureFamily.X4, room: Room.Main, role: "Wash 7", symbol: SYMBOL.movingWash },
  { channel: 12, family: FixtureFamily.C300d, room: Room.Third, role: "Left Key", symbol: SYMBOL.panel },
  { channel: 13, family: FixtureFamily.T2c, room: Room.Third, role: "Right Key", symbol: SYMBOL.panel },
  { channel: 14, family: FixtureFamily.T2c, room: Room.Third, role: "Desk Up Light", symbol: SYMBOL.panel },
  { channel: 15, family: FixtureFamily.T2c, room: Room.Third, role: "Tube 3", symbol: SYMBOL.panel },
];

export function fixturesInRoom(room: RoomValue): readonly Fixture[] {
  return FIXTURES.filter((f) => f.room === room);
}

/** Channels that can be given a colour — everything except the C300d. */
export function colourCapableChannels(room?: RoomValue): readonly number[] {
  return FIXTURES.filter(
    (f) => capabilitiesOf(f.family).colour && (room === undefined || f.room === room)
  ).map((f) => f.channel);
}

/** Channels that can be positioned — the X4 movers only. */
export function positionCapableChannels(): readonly number[] {
  return FIXTURES.filter((f) => capabilitiesOf(f.family).position).map((f) => f.channel);
}

export function familyOf(channel: number): FixtureFamilyValue {
  const fixture = FIXTURES.find((f) => f.channel === channel);
  if (!fixture) throw new Error(`Channel ${channel} is not in the rig.`);
  return fixture.family;
}

export interface GroupSpec {
  number: number;
  label: string;
  /** Eos channel-range syntax, e.g. "1 + 4" or "5 Thru 11". */
  channels: string;
  room: RoomValue;
}

/**
 * Groups 1-4 already exist on the console but are unlabelled, so their names live only
 * on the magic sheet. 5 and 11-13 are new: nothing in the show currently reaches 12-15.
 */
export const GROUPS: readonly GroupSpec[] = [
  { number: 1, label: "Wings", channels: "1 + 4", room: Room.Main },
  { number: 2, label: "Centers", channels: "2 Thru 3", room: Room.Main },
  { number: 3, label: "Main All", channels: "1 Thru 11", room: Room.Main },
  { number: 4, label: "X4 Wash", channels: "5 Thru 11", room: Room.Main },
  { number: 5, label: "S4 Front", channels: "1 Thru 4", room: Room.Main },
  { number: 11, label: "3rd Fl All", channels: "12 Thru 15", room: Room.Third },
  { number: 12, label: "3rd Fl Keys", channels: "12 + 13", room: Room.Third },
  { number: 13, label: "3rd Fl Tubes", channels: "13 Thru 15", room: Room.Third },
];

/**
 * Cue lists, one per room, so both sets can run at once without interfering.
 * List 99 already exists (label "Master (U1)"). Eos does not auto-create cue lists —
 * list 12 has to be recorded into explicitly (docs/eos-osc-findings.md §4).
 */
export const CUE_LISTS: readonly { number: number; label: string; room: RoomValue }[] = [
  { number: 99, label: "Main Room", room: Room.Main },
  { number: 12, label: "3rd Floor", room: Room.Third },
];

/**
 * Positions for the seven X4 movers, recorded as focus palettes.
 *
 * The numbers and labels are reserved here so the sheet buttons are correct before the
 * rig is hung; the values can only be captured on site, from the record buttons on the
 * "Setup & Focus" sheet.
 */
export const POSITIONS: readonly { paletteNumber: number; label: string }[] = [
  { paletteNumber: 1, label: "Stage" },
  { paletteNumber: 2, label: "Audience" },
  { paletteNumber: 3, label: "Bar" },
  { paletteNumber: 4, label: "Ceiling" },
  { paletteNumber: 5, label: "Home" },
  { paletteNumber: 6, label: "Spare" },
];

/** Intensity palettes. 1-9 exist; 6-9 are unlabelled on the console and 10 is missing. */
export const INTENSITIES: readonly { paletteNumber: number; label: string; level: number }[] = [
  { paletteNumber: 1, label: "10%", level: 10 },
  { paletteNumber: 2, label: "20%", level: 20 },
  { paletteNumber: 3, label: "30%", level: 30 },
  { paletteNumber: 4, label: "40%", level: 40 },
  { paletteNumber: 5, label: "50%", level: 50 },
  { paletteNumber: 6, label: "60%", level: 60 },
  { paletteNumber: 7, label: "70%", level: 70 },
  { paletteNumber: 8, label: "80%", level: 80 },
  { paletteNumber: 9, label: "90%", level: 90 },
  { paletteNumber: 10, label: "Full", level: 100 },
];

/** Pan/tilt nudge steps offered on the Setup & Focus sheet. */
export const NUDGE_STEPS: readonly number[] = [5, 15];
