// Record the palettes, groups and cues the magic sheets need onto a live console.
//
//   EOS_HOST=10.0.0.5 node scripts/build-show.mjs --i-have-a-backup
//   EOS_HOST=10.0.0.5 node scripts/build-show.mjs --dry-run
//
// This WRITES TO THE LOADED SHOW. Save a copy of the show file first — there is no undo.
//
// The steps come from src/show/build-plan.ts, which is unit tested; this script only
// executes them and checks each echo. Run `npm run build` first.
import { EosClient } from "../dist/services/eos-client.js";
import { buildPlan } from "../dist/show/build-plan.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const acknowledged = args.includes("--i-have-a-backup");

if (!dryRun && !acknowledged) {
  console.error(
    "This rewrites palettes, groups and cues in the LOADED SHOW.\n\n" +
      "  Save a copy of the show file on the console first, then re-run with:\n" +
      "    node scripts/build-show.mjs --i-have-a-backup\n\n" +
      "  To see the commands without sending anything:\n" +
      "    node scripts/build-show.mjs --dry-run"
  );
  process.exit(1);
}

const plan = buildPlan();

if (dryRun) {
  console.log(`\n${plan.length} steps — dry run, nothing will be sent.\n`);
  for (const [index, step] of plan.entries()) {
    console.log(`${String(index + 1).padStart(3)}. ${step.description}`);
    for (const command of step.beforeCommands) {
      console.log(`       cmd  ${command}`);
    }
    for (const osc of step.osc) {
      console.log(`       osc  ${osc.address} ${JSON.stringify(osc.args)}`);
    }
    for (const command of step.commands) {
      console.log(`       cmd  ${command}`);
    }
  }
  process.exit(0);
}

const host = process.env.EOS_HOST;
if (!host) {
  console.error("Set EOS_HOST to the IP of the machine running Eos.");
  process.exit(1);
}

const eos = new EosClient({
  host,
  sendPort: Number(process.env.EOS_SEND_PORT ?? 8000),
  listenPort: Number(process.env.EOS_LISTEN_PORT ?? 8001),
  userId: Number(process.env.EOS_USER_ID ?? 99),
  verbose: process.env.EOS_VERBOSE === "1",
});

try {
  await eos.waitUntilReady();
} catch (error) {
  console.error(`Could not reach the console: ${error.message}`);
  process.exit(1);
}

const showPath = await new Promise((resolve) => {
  const stop = eos.onMessage((entry) => {
    if (!entry.address.includes("/get/show/path")) return;
    stop();
    const first = entry.args[0];
    resolve(typeof first === "object" && first ? first.value : first);
  });
  eos.send("/eos/get/show/path");
  setTimeout(() => {
    stop();
    resolve("(unknown)");
  }, 1500);
});

console.log(`\nBuilding into: ${showPath}`);
console.log(`${plan.length} steps, as OSC user ${process.env.EOS_USER_ID ?? 99}.\n`);

const failures = [];

for (const [index, step] of plan.entries()) {
  const label = `${String(index + 1).padStart(3)}/${plan.length}`;
  process.stdout.write(`${label} ${step.description} ... `);

  let stepFailed = false;

  const run = async (command) => {
    const { echo } = await eos.sendCommandLineConfirming(command, 700);
    // Eos never acknowledges synchronously, so the echo is the only evidence a command
    // did what we asked. Anything containing "Error" did not.
    if (/error/i.test(echo)) {
      failures.push({ step: step.description, command, echo });
      stepFailed = true;
    }
  };

  // Clear the programmer and select, THEN put colour or position on the channels, THEN
  // record. Sneaking after the OSC would release the very data the Record must capture.
  for (const command of step.beforeCommands) await run(command);

  for (const osc of step.osc) {
    await eos.send(osc.address, osc.args);
    await new Promise((r) => setTimeout(r, 15));
  }
  if (step.osc.length) await new Promise((r) => setTimeout(r, 250));

  for (const command of step.commands) await run(command);

  console.log(stepFailed ? "FAILED" : "ok");
}

console.log(`\n=== ${failures.length ? `${failures.length} FAILED COMMANDS` : "All steps completed"} ===`);
for (const failure of failures) {
  console.log(`  ${failure.step}`);
  console.log(`    ${failure.command}`);
  console.log(`    ${failure.echo}`);
}

console.log(
  "\nNext: verify with\n" +
    "  node tools/diagnostics/inventory.mjs\n" +
    '  node tools/diagnostics/audit-sheet.mjs "magic sheets/<sheet>.xml"\n'
);

eos.close();
process.exit(failures.length > 0 ? 1 : 0);
