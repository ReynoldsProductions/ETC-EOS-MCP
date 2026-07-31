# eos-mcp-server

MCP server that lets Claude control an ETC Eos lighting console (Nomad Puck
or any Eos-family desk) over OSC — fire and record cues, set channel levels,
drive faders, nudge encoders. Built for a **test system**, not a live rig —
see Safety notes below before pointing it at anything with an audience.

## How it talks to your rig

Claude → this MCP server → OSC over UDP → Eos (running on your Puck) →
sACN → Luminode gateways → DMX → fixtures.

This server never touches DMX/sACN directly — it drives Eos the same way
a TouchOSC panel or QLab would, via Eos's OSC command set. Eos remains the
single source of truth for the show.

## 1. Enable OSC on Eos

Setup > System > Show Control > OSC:
- OSC RX: enabled, port **8000** (ETC's recommended default)
- OSC TX: enabled, port **8001**, TX IP address = the machine running this
  server
- Also confirm **UDP Strings & OSC** is enabled for your network interface
  under Setup > System > Network > Interface Protocols

(You said OSC is already on — just double check the TX IP points at
wherever you run this server, or feedback/status won't arrive.)

## 2. Install and build

```bash
npm install
npm run build
```

## 3. Configure

Environment variables:

| Var              | Required | Default | Meaning                                      |
|-------------------|----------|---------|-----------------------------------------------|
| `EOS_HOST`        | yes      | —       | IP/hostname of the machine running Eos        |
| `EOS_SEND_PORT`   | no       | 8000    | Eos's OSC RX port                              |
| `EOS_LISTEN_PORT` | no       | 8001    | Local port to receive Eos's OSC TX feedback on |
| `EOS_VERBOSE`     | no       | off     | Set to `1` to log every OSC message to stderr |

## 4. Run the tests

```bash
npm test              # unit + integration tests
npm run test:coverage # with coverage report (80% threshold enforced)
```

## 5. Point Claude at it

Add to your MCP client config (e.g. Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "eos": {
      "command": "node",
      "args": ["/absolute/path/to/eos-mcp-server/dist/index.js"],
      "env": {
        "EOS_HOST": "192.168.1.50"
      }
    }
  }
}
```

## Tools

- `eos_fire_cue`, `eos_go`, `eos_select_cue` — playback
- `eos_record_cue` — record live state into a cue (overwrites existing cues)
- `eos_set_channel_level`, `eos_select_channel`, `eos_set_parameter`,
  `eos_nudge_wheel` — channel/parameter control
- `eos_set_fader`, `eos_configure_fader_bank` — OSC fader banks
- `eos_fire_macro` — run a saved macro
- `eos_send_raw_command` — escape hatch: send any command-line text
- `eos_get_status` — read back recent OSC feedback from Eos (active cue,
  command line echo, etc.)

## Known issues from live testing

Found while running this against a real Nomad console with a blank/no-cue
show file:

- **Recording into a cue list that doesn't exist fails.** `eos_record_cue`
  (and the raw `Record Cue <list>/<number>` command) errors with
  `Cue List Does Not Exist` if the target cue list hasn't been created yet —
  this includes cue list 1 on a genuinely blank show. Eos does not
  auto-create the list for you; create it on the console first (or record
  the very first cue with the bare `Record Enter` command, which targets
  cue list 1/cue 1 by default), then subsequent numbered records into that
  list work normally.
- **A failed/unsubmitted command can leak into the next one.** If a command
  sent via `eos_send_raw_command` / `eos_record_cue` errors partway through
  (e.g. the cue-list issue above), Eos can leave it sitting open on the
  command line instead of discarding it, and the *next* command sent via
  `/eos/newcmd` gets silently appended to that leftover text rather than
  replacing it — producing garbled commands. `sendCommandLine` in
  [`eos-client.ts`](src/services/eos-client.ts) now sends
  `/eos/key/clear_cmdline` before every text command as a fix, but **this
  address is unverified against real hardware** (testing was interrupted by
  the console losing power). On the console itself, physically clearing the
  stuck line took Backspace, not Escape — re-test `clear_cmdline` live and
  fall back to repeated `/eos/key/backspace` if it doesn't work.

## Safety notes before this touches a live rig

- `eos_record_cue` and `eos_send_raw_command` are destructive — they can
  overwrite show data with no undo prompt over OSC. Fine for a test show
  file; be deliberate before pointing this at production.
- Both tools require `confirm: true` to actually execute — without it,
  they return a preview of what would happen and touch nothing. Calls are
  also rate-limited (one per few seconds per action) to guard against a
  runaway loop hammering Record or the command line. See
  [`src/services/destructive-guard.ts`](src/services/destructive-guard.ts).
- OSC over UDP has no auth — anyone on the same network segment can send
  Eos commands. Keep the console's network isolated the way you already do
  for DMX/sACN.
