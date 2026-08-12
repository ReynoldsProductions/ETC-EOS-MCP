// Cross-reference every button on a magic sheet against what actually exists in the
// loaded show. Reports targets that point at nothing — the failure mode that leaves a
// sheet full of buttons that do nothing when pressed, with no error anywhere.
//
//   EOS_HOST=10.0.0.5 node tools/diagnostics/audit-sheet.mjs "magic sheets/My Sheet.xml"
//
// Exits non-zero if any target is dead, so it works as a pre-show health check.
// Run `npm run build` first — this imports the compiled parser from dist/.
import { readFileSync } from "node:fs";
import { connect, ask, values } from "./lib.mjs";
import {
  parseMagicSheet,
  decodeUtf16,
  describeTarget,
  TargetType,
  PaletteList,
} from "../../dist/show/magic-sheet-xml.js";

const path = process.argv[2];
if (!path) {
  console.error('Usage: node tools/diagnostics/audit-sheet.mjs <sheet.xml>');
  process.exit(1);
}

let sheet;
try {
  sheet = parseMagicSheet(decodeUtf16(readFileSync(path)));
} catch (error) {
  console.error(`Could not read ${path}: ${error.message}`);
  process.exit(1);
}

const { eos, received } = await connect();

/** Number of targets of a kind, e.g. "cp" -> 12. */
async function countOf(kind) {
  const replies = await ask(eos, received, `/eos/get/${kind}/count`, [], 700);
  const reply = replies.find((r) => r.address === `/eos/out/get/${kind}/count`);
  return reply ? Number(values(reply)[0]) : 0;
}

/**
 * Walk a target list by index and return a Map of target number -> { label, channelCount }.
 *
 * Index queries are the only way to enumerate: target numbers are not contiguous and do
 * not start at 1 (see docs/eos-osc-findings.md §4). A reply with no UID means "absent"
 * rather than a real record (§5).
 */
async function enumerate(kind) {
  const total = await countOf(kind);
  const found = new Map();
  for (let i = 0; i < total; i++) {
    const replies = await ask(eos, received, `/eos/get/${kind}/index/${i}`, [], 550);
    for (const reply of replies) {
      const parts = reply.address.split("/");
      // /eos/out/get/<kind>/<number>/list/<i>/<n>
      if (!reply.address.includes("/list/") || reply.address.includes("/channels/")) continue;
      if (reply.address.includes("/byType/")) continue;
      const number = Number(parts[5]);
      const args = values(reply);
      if (!args[1]) continue; // no UID -> absent, not a record
      if (!found.has(number)) found.set(number, { label: String(args[2] ?? ""), channelCount: 0 });
    }
    // Channel membership arrives as a sibling message; args beyond index+UID are channels.
    for (const reply of replies) {
      if (!reply.address.includes("/channels/list/")) continue;
      const number = Number(reply.address.split("/")[5]);
      const entry = found.get(number);
      if (entry) entry.channelCount = Math.max(0, values(reply).length - 2);
    }
  }
  return found;
}

console.log(`\nAuditing ${path}`);
console.log(`  ${sheet.items.length} objects, showfile version ${sheet.showfileVersion}\n`);

console.log("Reading the loaded show...");
const patch = await enumerate("patch");
const groups = await enumerate("group");
const macros = await enumerate("macro");
const palettes = {
  [PaletteList.Intensity]: await enumerate("ip"),
  [PaletteList.Focus]: await enumerate("fp"),
  [PaletteList.Colour]: await enumerate("cp"),
  [PaletteList.Beam]: await enumerate("bp"),
};

// Cue lists, then the cues inside each. Never assume list 1 exists (§4).
const cueLists = new Map();
const listCount = await countOf("cuelist");
for (let i = 0; i < listCount; i++) {
  const replies = await ask(eos, received, `/eos/get/cuelist/index/${i}`, [], 600);
  const detail = replies.find((r) => r.address.includes("/list/") && values(r)[1]);
  if (!detail) continue;
  const listNumber = Number(detail.address.split("/")[5]);
  const cues = new Set();
  const cueCount = await countOf(`cue/${listNumber}`);
  for (let c = 0; c < cueCount; c++) {
    const cueReplies = await ask(eos, received, `/eos/get/cue/${listNumber}/index/${c}`, [], 550);
    for (const reply of cueReplies) {
      if (!reply.address.includes("/list/") || !values(reply)[1]) continue;
      cues.add(Number(reply.address.split("/")[6]));
    }
  }
  cueLists.set(listNumber, cues);
}

/** Resolve one target against the show. Returns null if fine, or a reason string. */
function checkTarget(target) {
  switch (target.type) {
    case TargetType.None:
      // Decoration is fine; a button in a non-decorative mode with no target is not.
      return target.mode === 0 || target.mode === 1
        ? null
        : "button has no target and no command";
    case TargetType.Channel:
      return patch.has(target.id) ? null : `channel ${target.id} is not patched`;
    case TargetType.Group: {
      const group = groups.get(target.id);
      if (!group) return `group ${target.id} does not exist`;
      return group.channelCount === 0 ? `group ${target.id} is empty` : null;
    }
    case TargetType.Palette: {
      const list = palettes[target.listId];
      if (!list) return `unknown palette list ${target.listId}`;
      const palette = list.get(target.id);
      if (!palette) return `does not exist`;
      return palette.channelCount === 0 ? `exists but is empty (no channel data)` : null;
    }
    case TargetType.Cue: {
      const cues = cueLists.get(target.listId);
      if (!cues) {
        const available = [...cueLists.keys()].join(", ") || "none";
        return `cue list ${target.listId} does not exist (lists in show: ${available})`;
      }
      return cues.has(target.id) ? null : `cue ${target.listId} / ${target.id} does not exist`;
    }
    default:
      return `unknown target type ${target.type}`;
  }
}

const dead = [];
const live = [];
for (const item of sheet.items) {
  // Objects that fire a command string are valid without a target.
  if (item.cmd.trim() !== "") {
    live.push(item);
    continue;
  }
  const reason = checkTarget(item.target);
  if (reason) dead.push({ item, reason });
  else live.push(item);
}

const interactive = sheet.items.filter(
  (i) => !(i.target.type === TargetType.None && i.target.mode <= 1 && i.cmd.trim() === "")
);

console.log(`\n=== ${dead.length ? "DEAD TARGETS" : "No dead targets"} ===`);
for (const { item, reason } of dead) {
  const label = item.text ? `"${item.text}"` : "(unlabelled)";
  console.log(
    `  ${item.key.padEnd(12)} ${label.padEnd(14)} ${describeTarget(item.target).padEnd(24)} ${reason}`
  );
}

// Two icons on one channel is almost always a copy-paste slip: the second fixture
// looks controllable but shadows the first, and one real fixture has no icon at all.
const channelUses = new Map();
for (const item of sheet.items) {
  if (item.target.type !== TargetType.Channel) continue;
  channelUses.set(item.target.id, (channelUses.get(item.target.id) ?? 0) + 1);
}
const duplicates = [...channelUses.entries()].filter(([, n]) => n > 1);
if (duplicates.length) {
  console.log(`\n=== DUPLICATE CHANNEL ICONS ===`);
  for (const [channel, n] of duplicates) {
    console.log(`  channel ${channel} has ${n} icons on this sheet`);
  }
}

console.log(`\n=== summary ===`);
console.log(`  objects total ......... ${sheet.items.length}`);
console.log(`  interactive ........... ${interactive.length}`);
console.log(`  dead .................. ${dead.length}`);
console.log(`  working ............... ${interactive.length - dead.length}`);

// Unused show resources are not failures, but they are usually why a sheet feels thin.
const usedPalettes = new Set(
  sheet.items
    .filter((i) => i.target.type === TargetType.Palette)
    .map((i) => `${i.target.listId}:${i.target.id}`)
);
const unusedCounts = Object.entries(palettes).map(([listId, list]) => {
  const unused = [...list.keys()].filter((n) => !usedPalettes.has(`${listId}:${n}`));
  return [listId, unused];
});
const effects = await enumerate("fx");
const subs = await enumerate("sub");

// Effects and macros have no magic sheet target type — they are fired from command
// buttons — so anything here is capability the sheet simply is not offering.
const macroList = [...macros.keys()];
const effectList = [...effects.entries()].map(([n, e]) => (e.label ? `${n} ${e.label}` : `${n}`));
const subList = [...subs.keys()];
const unusedChannels = [...patch.keys()].filter(
  (c) => !sheet.items.some((i) => i.target.type === TargetType.Channel && i.target.id === c)
);

console.log(`\n=== in the show but not on this sheet ===`);
let reportedAny = false;
for (const [listId, unused] of unusedCounts) {
  if (unused.length === 0) continue;
  const names = { 1: "intensity", 2: "focus", 3: "colour", 4: "beam" };
  console.log(`  ${names[listId] ?? listId} palettes: ${unused.join(", ")}`);
  reportedAny = true;
}
if (macroList.length) {
  console.log(`  macros: ${macroList.join(", ")}`);
  reportedAny = true;
}
if (effectList.length) {
  console.log(`  effects (${effectList.length}): ${effectList.join(", ")}`);
  reportedAny = true;
}
if (subList.length) {
  console.log(`  submasters: ${subList.join(", ")}`);
  reportedAny = true;
}
if (unusedChannels.length) {
  console.log(`  patched channels with no icon: ${unusedChannels.join(", ")}`);
  reportedAny = true;
}
if (!reportedAny) console.log("  (nothing — the sheet covers everything in the show)");

eos.close();
process.exit(dead.length > 0 || duplicates.length > 0 ? 1 : 0);
