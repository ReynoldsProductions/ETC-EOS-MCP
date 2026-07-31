// Show every parameter of a channel with its live value and real min/max.
// This is how to discover control ranges instead of hardcoding them.
//
//   EOS_HOST=10.0.0.5 node tools/diagnostics/params.mjs 1
//
// See docs/eos-osc-findings.md §2.
import { connect, ask, values } from "./lib.mjs";

const channel = Number(process.argv[2] ?? 1);
if (!Number.isInteger(channel) || channel < 1) {
  console.error("Usage: node tools/diagnostics/params.mjs <channel>");
  process.exit(1);
}

const { eos, received } = await connect();

const replies = await ask(eos, received, `/eos/get/params/${channel}`, [], 1200);
const msg = replies.find((r) => r.address === `/eos/out/get/params/${channel}`);

if (!msg) {
  console.error(`No parameter data for channel ${channel} — is it patched?`);
  eos.close();
  process.exit(1);
}

const v = values(msg);
const [manufacturer, fixtureType] = v;
console.log(`\nChannel ${channel}: ${manufacturer} / ${fixtureType}\n`);
console.log("  parameter          current      min      max");
console.log("  " + "-".repeat(48));

// After the two leading strings, args repeat as (name, current, min, max).
for (let i = 2; i + 3 < v.length + 1; i += 4) {
  const [name, current, min, max] = [v[i], v[i + 1], v[i + 2], v[i + 3]];
  if (typeof name !== "string") continue;
  const degenerate = min === max ? "   <- no usable range" : "";
  console.log(
    `  ${String(name).padEnd(18)} ${String(current).padStart(7)}  ${String(min).padStart(7)}  ${String(max).padStart(7)}${degenerate}`
  );
}

console.log(
  "\nBuild UI controls from these min/max values — they vary per parameter and per\n" +
    "fixture type (Hue is typically 0-360, Strobe 0-255, colour emitters 0-100)."
);

eos.close();
process.exit(0);
