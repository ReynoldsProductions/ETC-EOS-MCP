// Record everything Eos sends, to build parser test fixtures from real hardware.
//
//   EOS_HOST=10.0.0.5 node tools/diagnostics/capture.mjs [seconds] [outFile]
//
// Drive the console by hand while this runs — fire cues, move faders, select
// channels — to capture representative output.
import { writeFileSync } from "node:fs";
import { connect, values } from "./lib.mjs";

const seconds = Number(process.argv[2] ?? 30);
const outFile = process.argv[3] ?? "eos-out-capture.json";

const { eos, received } = await connect();

// Ask for implicit output, and for pushed intensity updates.
await eos.send("/eos/subscribe", [{ type: "i", value: 1 }]);
await eos.send("/eos/subscribe/param/intens", [{ type: "i", value: 1 }]);

console.log(
  `Capturing for ${seconds}s — drive the console now (fire cues, move faders, select channels).`
);

const seen = new Set();
const unsubscribe = eos.onMessage((entry) => {
  if (!seen.has(entry.address)) {
    seen.add(entry.address);
    console.log(`  new address: ${entry.address}  ${JSON.stringify(values(entry)).slice(0, 100)}`);
  }
});

await new Promise((r) => setTimeout(r, seconds * 1000));
unsubscribe();

writeFileSync(outFile, JSON.stringify(received, null, 2));
console.log(`\n${received.length} messages, ${seen.size} distinct addresses -> ${outFile}`);
console.log(
  "Scrub any local file paths (the show path leaks a filesystem location) before committing."
);

eos.close();
process.exit(0);
