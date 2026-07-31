// Does running as our own OSC user keep the console operator's command line intact?
import { connect, ask, values } from "./lib.mjs";

const { eos, config, received } = await connect();
console.log(`We are OSC user ${config.userId}. Operator is presumably user 1.\n`);

await eos.send("/eos/subscribe", [{ type: "i", value: 1 }]);
await new Promise((r) => setTimeout(r, 700));

const cmdLines = () =>
  received
    .filter((m) => m.address.includes("/cmd"))
    .map((m) => `${m.address}  ${JSON.stringify(values(m))}`);

console.log("--- command-line traffic before we send anything ---");
const pre = cmdLines();
console.log(pre.length ? pre.join("\n") : "  (silent — operator's line is settled, nothing re-emitted)");

const before = received.length;

console.log("\n--- sending 'Chan 2 At 25 Enter' as user 99 ---");
await eos.sendCommandLine("Chan 2 At 25 Enter");
await new Promise((r) => setTimeout(r, 1800));

const after = received.slice(before);
console.log("\n--- everything received after our command ---");
for (const m of after) {
  console.log(`  ${m.address}  ${JSON.stringify(values(m)).slice(0, 140)}`);
}

const ourCmd = after.filter((m) => m.address === `/eos/out/user/${config.userId}/cmd`);
const operatorCmd = after.filter((m) => m.address === "/eos/out/user/1/cmd");
const genericCmd = after.filter((m) => m.address === "/eos/out/cmd");

console.log("\n=== analysis ===");
console.log(`  our line   (/eos/out/user/${config.userId}/cmd): ${ourCmd.length} msg(s)`);
for (const m of ourCmd) console.log(`      ${JSON.stringify(values(m))}`);
console.log(`  operator   (/eos/out/user/1/cmd):  ${operatorCmd.length} msg(s)`);
for (const m of operatorCmd) console.log(`      ${JSON.stringify(values(m))}`);
console.log(`  generic    (/eos/out/cmd):         ${genericCmd.length} msg(s)`);
for (const m of genericCmd) console.log(`      ${JSON.stringify(values(m))}`);

const operatorDisturbed = operatorCmd.some((m) => {
  const t = String(values(m)[0] ?? "");
  return t.includes("Chan 2") || t.includes("At 25");
});
console.log(
  `\n  operator's line shows OUR text? ${operatorDisturbed ? "YES — isolation FAILED" : "no"}`
);

// Read back channel 2 to confirm our command actually executed.
const p = await ask(eos, received, "/eos/get/params/2", [], 1100);
const m = p.find((x) => x.address === "/eos/out/get/params/2");
if (m) {
  const v = values(m);
  const idx = v.indexOf("Intens");
  console.log(`  channel 2 intensity now: ${idx > -1 ? v[idx + 1] : "?"}  (expect 25 if our command ran)`);
}

eos.close();
process.exit(0);
