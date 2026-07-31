# Diagnostics

Read-only probes for a live Eos console. Run `npm run build` first — these import the
compiled client from `dist/`, so they exercise the same code path the server uses.

All of them take the console address from the environment:

```bash
export EOS_HOST=10.0.0.5        # required — the machine running Eos
export EOS_SEND_PORT=8000       # optional, Eos's OSC RX port
export EOS_LISTEN_PORT=8001     # optional, must match Eos's OSC TX port
export EOS_USER_ID=99           # optional, the OSC user to claim
```

| Script | Purpose |
|---|---|
| `probe.mjs` | Is the console reachable, and does feedback get back? Start here. |
| `inventory.mjs` | What's in the loaded show — counts, and cue lists enumerated properly. |
| `params.mjs <chan>` | Every parameter of a channel with live value and real min/max. |
| `capture.mjs [secs] [file]` | Record raw OSC output to build parser fixtures. |
| `confirm-findings.mjs` | Re-tests all 10 claims in `docs/eos-osc-findings.md`. |
| `user-isolation.mjs` | Proves our command line can't disturb the operator's. |

```bash
node tools/diagnostics/probe.mjs
node tools/diagnostics/inventory.mjs
node tools/diagnostics/params.mjs 1
node tools/diagnostics/capture.mjs 30 capture.json
node tools/diagnostics/confirm-findings.mjs
```

`probe.mjs` and `confirm-findings.mjs` exit non-zero on failure, so both work in a health
check or CI job with hardware attached.

## Re-validating after an Eos upgrade

`confirm-findings.mjs` is the regression check for everything in
[`docs/eos-osc-findings.md`](../../docs/eos-osc-findings.md) — several of those findings
contradict ETC's published docs, so a console upgrade could silently change them. Run it
after any Eos version change; a failure means the docs (and probably some UI code) need
revisiting.

It briefly drives channel 1 (intensity and colour) and changes the OSC user, restoring both
before it exits.

`user-isolation.mjs` needs a human: type `Chan 5 Thru 8` on the console keypad **without
pressing Enter**, then run it. It sends `Chan 2 At 25 Enter` as our OSC user. Isolation
holds if channel 2 moves, channels 5–8 do not, and the keypad's partial line survives.

## If sends succeed but nothing comes back

Almost always the return path, not the code. In order:

1. **A VPN on either machine** — this has caused it twice. A VPN on the client can hijack
   the LAN route (`netstat -rn -f inet | grep <subnet>`; two routes for one subnet is the
   tell). A VPN on the console machine breaks the return path silently.
2. **Eos's OSC TX IP** must point at the machine running the client, *not* at the console,
   and TX must be enabled: Setup > System > Show Control > OSC.
3. **`UDP Strings & OSC`** enabled on the console's network interface.

To prove RX works independently, send a harmless visible command and watch the console:

```bash
EOS_HOST=10.0.0.5 node -e 'import("../../dist/services/eos-client.js")'
```

or just run `probe.mjs` — if the console reacts to commands but nothing returns, it is
definitively the return path.

See [`docs/eos-osc-findings.md`](../../docs/eos-osc-findings.md) for what these scripts
discovered.
