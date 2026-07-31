// Is the console reachable, and is feedback getting back to us?
//
//   EOS_HOST=10.0.0.5 node tools/diagnostics/probe.mjs
//
// If sends succeed but nothing comes back, the return path is broken — check for a
// VPN on either machine, and confirm Eos's OSC TX IP points at THIS machine.
// See docs/eos-osc-findings.md §10.
import { connect, ask, values } from "./lib.mjs";

const { eos, config, received } = await connect();
console.log(
  `Connected: sending to ${config.host}:${config.sendPort}, ` +
    `listening on ${config.listenPort}, as OSC user ${config.userId}`
);

const ping = await ask(eos, received, "/eos/ping", ["probe"], 2000);
const version = await ask(eos, received, "/eos/get/version", [], 1500);

const gotPing = ping.some((m) => m.address === "/eos/out/ping");
const versionMsg = version.find((m) => m.address === "/eos/out/get/version");
// The console echoes the user claim during the handshake, which completes before we
// attach a listener — so read it from the client's ring buffer, not `received`.
const userEcho = eos.getFeedbackMatching("/eos/out/user", 5).pop();

console.log(`\n  ping replied ......... ${gotPing ? "yes" : "NO"}`);
console.log(`  version .............. ${versionMsg ? values(versionMsg).join(", ") : "no reply"}`);
console.log(
  `  user claim echoed .... ${
    userEcho
      ? values(userEcho)[0]
      : "not seen (only echoed when the user actually changes)"
  }`
);

if (!gotPing && !versionMsg) {
  console.log(
    "\nNo feedback at all. Sends are leaving this machine, so check:\n" +
      "  1. A VPN on either machine (the usual cause)\n" +
      `  2. Eos: Setup > System > Show Control > OSC — TX enabled, TX IP = this machine, TX port = ${config.listenPort}\n` +
      "  3. 'UDP Strings & OSC' enabled on the console's network interface"
  );
}

eos.close();
process.exit(gotPing ? 0 : 1);
