// What's actually in the loaded show? Read-only.
//
//   EOS_HOST=10.0.0.5 node tools/diagnostics/inventory.mjs
//
// Note cue lists are NOT necessarily numbered from 1 — this enumerates them
// properly. See docs/eos-osc-findings.md §4.
import { connect, ask, values, printReplies } from "./lib.mjs";

const { eos, received } = await connect();

await eos.send("/eos/subscribe", [{ type: "i", value: 1 }]);

const COUNTS = [
  ["patch (channels)", "/eos/get/patch/count"],
  ["cue lists", "/eos/get/cuelist/count"],
  ["groups", "/eos/get/group/count"],
  ["submasters", "/eos/get/sub/count"],
  ["macros", "/eos/get/macro/count"],
  ["magic sheets", "/eos/get/ms/count"],
  ["colour palettes", "/eos/get/cp/count"],
  ["presets", "/eos/get/preset/count"],
  ["effects", "/eos/get/fx/count"],
];

console.log("\n=== show ===");
const path = await ask(eos, received, "/eos/get/show/path");
const version = await ask(eos, received, "/eos/get/version");
console.log(`  version: ${version.length ? values(version[0]).join(", ") : "?"}`);
console.log(`  file:    ${path.length ? values(path[0])[0] : "?"}`);

console.log("\n=== counts ===");
const counts = {};
for (const [label, address] of COUNTS) {
  const replies = await ask(eos, received, address, [], 700);
  const n = replies.length ? values(replies[0])[0] : "(no reply)";
  counts[label] = n;
  console.log(`  ${label.padEnd(20)} ${n}`);
}

// Enumerate cue lists properly rather than assuming list 1 exists.
const listCount = Number(counts["cue lists"]) || 0;
console.log("\n=== cue lists (enumerated) ===");
for (let i = 0; i < listCount; i++) {
  const replies = await ask(eos, received, `/eos/get/cuelist/index/${i}`);
  const detail = replies.find((r) => r.address.includes("/list/"));
  if (!detail) continue;
  // Address form: /eos/out/get/cuelist/<listNumber>/list/<i>/<total>
  const listNumber = detail.address.split("/")[5];
  const v = values(detail);
  console.log(`  cue list ${listNumber}  label="${v[3] ?? ""}"  uid=${v[1]}`);

  const cueCount = await ask(eos, received, `/eos/get/cue/${listNumber}/count`);
  console.log(`     cues: ${cueCount.length ? values(cueCount[0])[0] : "?"}`);
}

printReplies("first group", "/eos/get/group/index/0", await ask(eos, received, "/eos/get/group/index/0"));
printReplies("first magic sheet", "/eos/get/ms/index/0", await ask(eos, received, "/eos/get/ms/index/0"));

eos.close();
process.exit(0);
