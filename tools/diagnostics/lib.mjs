// Shared helpers for the diagnostic scripts. Run `npm run build` first — these
// import the compiled client from dist/ so they exercise the real code path.
import { EosClient } from "../../dist/services/eos-client.js";

export function readEnv() {
  const host = process.env.EOS_HOST;
  if (!host) {
    console.error(
      "Set EOS_HOST to the IP or hostname of the machine running Eos.\n" +
        "  e.g.  EOS_HOST=10.0.0.5 node tools/diagnostics/probe.mjs"
    );
    process.exit(1);
  }
  return {
    host,
    sendPort: Number(process.env.EOS_SEND_PORT ?? 8000),
    listenPort: Number(process.env.EOS_LISTEN_PORT ?? 8001),
    userId: Number(process.env.EOS_USER_ID ?? 99),
    verbose: process.env.EOS_VERBOSE === "1",
  };
}

/** Connect, and collect every inbound message into an array for inspection. */
export async function connect() {
  const config = readEnv();
  const eos = new EosClient(config);
  try {
    await eos.waitUntilReady();
  } catch (error) {
    console.error(`Could not start: ${error.message}`);
    process.exit(1);
  }
  const received = [];
  eos.onMessage((entry) => received.push(entry));
  return { eos, config, received };
}

/** Plain values from the metadata-wrapped args Eos sends. */
export function values(entry) {
  return entry.args.map((a) => (a && typeof a === "object" && "value" in a ? a.value : a));
}

/** Send a query and return whatever came back within `waitMs`. */
export async function ask(eos, received, address, args = [], waitMs = 900) {
  const before = received.length;
  await eos.send(address, args);
  await new Promise((r) => setTimeout(r, waitMs));
  return received.slice(before);
}

export function printReplies(label, address, replies, limit = 10) {
  console.log(`\n>>> ${label}   ${address}`);
  if (replies.length === 0) {
    console.log("    (no reply)");
    return;
  }
  for (const r of replies.slice(0, limit)) {
    console.log(`    ${r.address}`);
    console.log(`       ${JSON.stringify(values(r))}`);
  }
  if (replies.length > limit) console.log(`    ... +${replies.length - limit} more`);
}
