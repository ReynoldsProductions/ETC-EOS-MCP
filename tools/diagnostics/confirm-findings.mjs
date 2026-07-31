// Re-tests every claim in docs/eos-osc-findings.md against live hardware.
import { connect, ask, values } from "./lib.mjs";

const { eos, received } = await connect();
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

const paramsOf = async (chan) => {
  const r = await ask(eos, received, `/eos/get/params/${chan}`, [], 1100);
  const m = r.find((x) => x.address === `/eos/out/get/params/${chan}`);
  if (!m) return null;
  const v = values(m);
  const out = {};
  for (let i = 2; i + 3 < v.length + 1; i += 4) {
    if (typeof v[i] === "string") out[v[i]] = { cur: v[i + 1], min: v[i + 2], max: v[i + 3] };
  }
  return out;
};

console.log("\n=== §1  colour arguments are 0-100, not 0-1 ===");
await eos.send("/eos/chan/1", [100]);
await new Promise((r) => setTimeout(r, 600));

await eos.send("/eos/chan/1/color/rgb", [0, 100, 0]);
await new Promise((r) => setTimeout(r, 700));
const green100 = (await paramsOf(1))?.Green?.cur;

await eos.send("/eos/chan/1/color/rgb", [0, 0, 1]);
await new Promise((r) => setTimeout(r, 700));
const blue1 = (await paramsOf(1))?.Blue?.cur;

record(
  "colour scale is 0-100",
  green100 > 95 && blue1 < 50,
  `rgb[0,100,0] -> Green=${green100} (expect ~100);  rgb[0,0,1] -> Blue=${blue1} (expect small, NOT 100)`
);

console.log("\n=== §2  parameter ranges are self-describing ===");
const p = await paramsOf(1);
record(
  "ranges vary per parameter",
  p?.Hue?.max === 360 && p?.Saturation?.max === 100 && p?.["Shutter Strobe"]?.max === 255,
  `Hue max=${p?.Hue?.max} (360), Saturation max=${p?.Saturation?.max} (100), Strobe max=${p?.["Shutter Strobe"]?.max} (255)`
);
record(
  "degenerate ranges exist (must be guarded)",
  p?.["Cooling Fan"]?.min === p?.["Cooling Fan"]?.max,
  `Cooling Fan min=${p?.["Cooling Fan"]?.min} max=${p?.["Cooling Fan"]?.max}`
);

console.log("\n=== §3  live parameter push ===");
await eos.send("/eos/subscribe", [{ type: "i", value: 1 }]);
await eos.send("/eos/subscribe/param/intens", [{ type: "i", value: 1 }]);
// Give the subscription time to register before relying on it.
await new Promise((r) => setTimeout(r, 1200));

// Pushes are change-driven, so pick a target that differs from the current value —
// otherwise the set is a no-op and legitimately emits nothing.
const currentIntens = (await paramsOf(1))?.Intens?.cur ?? 0;
const target = currentIntens > 50 ? 20 : 70;

const pushBefore = received.length;
await eos.send("/eos/chan/1", [target]);
await new Promise((r) => setTimeout(r, 1400));
const pushed = received.slice(pushBefore);
const intensPush = pushed.filter((m) => m.address === "/eos/out/param/intens" && m.args.length >= 3);
const wheelPush = pushed.filter((m) => m.address.startsWith("/eos/out/active/wheel/"));

record(
  "/eos/subscribe/param pushes [value,min,max]",
  intensPush.length > 0,
  intensPush.length
    ? `${currentIntens} -> ${target} gave ${JSON.stringify(values(intensPush[0]))}`
    : `no /eos/out/param/intens after ${currentIntens} -> ${target}`
);
record(
  "/eos/out/active/wheel/* pushes selected-channel params",
  wheelPush.length > 0,
  wheelPush.length ? `${wheelPush.length} wheel msgs, e.g. ${JSON.stringify(values(wheelPush[0]))}` : "none"
);

// A no-op set must be silent — the UI must not wait for an echo that never comes.
const noopBefore = received.length;
await eos.send("/eos/chan/1", [target]);
await new Promise((r) => setTimeout(r, 1400));
const noopPushes = received
  .slice(noopBefore)
  .filter((m) => m.address === "/eos/out/param/intens" || m.address.startsWith("/eos/out/active/wheel/"));
record(
  "re-sending the same value emits nothing",
  noopPushes.length === 0,
  `re-sent ${target}, got ${noopPushes.length} push(es) — Eos is strictly change-driven`
);

console.log("\n=== §4  cue lists are not numbered from 1 ===");
const cl = await ask(eos, received, "/eos/get/cuelist/index/0");
const clDetail = cl.find((r) => r.address.includes("/list/"));
const listNumber = clDetail ? clDetail.address.split("/")[5] : null;
const list1 = await ask(eos, received, "/eos/get/cue/1/count");
record(
  "first cue list is not #1",
  listNumber !== null && listNumber !== "1",
  `enumerated cue list = ${listNumber} (label="${clDetail ? values(clDetail)[3] : "?"}"), /eos/get/cue/1/count -> ${list1.length ? values(list1[0])[0] : "no reply"}`
);

console.log("\n=== §5  empty index queries return malformed stubs ===");
const stub = await ask(eos, received, `/eos/get/cue/${listNumber}/index/0`);
const stubMsg = stub[0];
record(
  "empty index -> stub with wrong address, no UID",
  !!stubMsg && stubMsg.address === "/eos/out/get/cue/0/0",
  stubMsg ? `${stubMsg.address}  ${JSON.stringify(values(stubMsg))}` : "no reply at all"
);

console.log("\n=== §6  magic sheets expose metadata only ===");
const ms = await ask(eos, received, "/eos/get/ms/index/0");
const msMsg = ms.find((r) => r.address.includes("/ms/"));
const msVals = msMsg ? values(msMsg) : [];
record(
  "magic sheet = [index, uid, label] only",
  msVals.length === 3,
  msMsg ? `${msMsg.address} -> ${JSON.stringify(msVals)}` : "no reply"
);

console.log("\n=== §7  /eos/out/user echoes only on change ===");
const chgBefore = received.length;
await eos.send("/eos/user", [{ type: "i", value: 98 }]);   // change
await new Promise((r) => setTimeout(r, 900));
const onChange = received.slice(chgBefore).filter((m) => m.address === "/eos/out/user");

const sameBefore = received.length;
await eos.send("/eos/user", [{ type: "i", value: 98 }]);   // same again
await new Promise((r) => setTimeout(r, 900));
const onSame = received.slice(sameBefore).filter((m) => m.address === "/eos/out/user");

record(
  "echo on change, silence on re-claim",
  onChange.length > 0 && onSame.length === 0,
  `changing 99->98 gave ${onChange.length} echo(es); re-claiming 98 gave ${onSame.length}`
);
await eos.send("/eos/user", [{ type: "i", value: 99 }]);   // restore
await new Promise((r) => setTimeout(r, 500));

console.log("\n=== §8  idle console is silent ===");
const idleBefore = received.length;
await new Promise((r) => setTimeout(r, 3500));
const idleCount = received.length - idleBefore;
record("no traffic while idle", idleCount === 0, `${idleCount} message(s) over 3.5s with subscribe active`);

// --- restore ---
console.log("\n--- restoring channel 1 ---");
await eos.sendCommandLine("Chan 1 Home Enter");
await new Promise((r) => setTimeout(r, 700));
await eos.sendCommandLine("Chan 1 Out Enter");
await new Promise((r) => setTimeout(r, 700));
const final = await paramsOf(1);
console.log(`    channel 1 intensity now: ${final?.Intens?.cur}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${"=".repeat(60)}\n${results.length - failed.length}/${results.length} confirmed`);
if (failed.length) for (const f of failed) console.log(`  FAILED: ${f.name}`);

eos.close();
process.exit(failed.length ? 1 : 0);
