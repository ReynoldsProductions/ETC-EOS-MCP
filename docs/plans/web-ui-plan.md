# Eos Web UI — implementation plan

## Context

We want a **web UI to control an ETC Eos console remotely** — cue recall, faders, and
colour on a tablet-friendly surface, with user-configurable OSC listen port, OSC send
port, and web UI port.

The MCP server was the scaffolding that got us here: it proved the OSC round trip against
real hardware and mapped the command surface. **The web UI is the product.** This plan
covers the web application only. The MCP entry point stays in the repo but isn't developed
further and isn't detailed here.

What carries forward is the OSC plumbing, already hardware-verified and just repaired:
`EosClient` (UDP socket, tagged-arg sending, dedicated OSC user, feedback ring buffer,
`onMessage()` stream) and `DestructiveActionGuard`.

**Prerequisite fixes: done** — shipped in `f88c9e3` (bind-failure hang, OSC integer args,
`/eos/user` replacing the `clear_cmdline` guess, `select_cue` NaN, `onMessage()`).
44 tests, 96% coverage.

### Key constraint: don't break Companion

Companion currently fires cues and lights buttons from active-cue feedback. Verified by
reading `bitfocus/companion-module-etc-eos`: it uses `OSC10.TCPSocketPort` on **TCP 3032**
(or 3037 SLIP) and **never uses UDP** (`src/constants.js`, `getOsc10Socket()` in
`src/main.js`). Eos's `OSC TX IP Address` governs **UDP only**.

Our web server is UDP. The transports are disjoint, so **Companion needs no changes, no
relay, and no custom module** — it keeps talking to the console directly on TCP.

The one realistic breakage vector isn't transport: `/eos/subscribe` and `/eos/filter/*`
**may be global rather than per-connection**. If filters are global, our filter set could
suppress output Companion depends on. Top hardware-verification item; ships with a kill
switch (`EOS_FILTER=off`).

---

## Architecture

One long-running server process owns the OSC socket, the show-state mirror, the HTTP API,
and the WebSocket feed.

### Config — env > file > default

| Key | Env | Default |
|---|---|---|
| host | `EOS_HOST` | — (required) |
| sendPort | `EOS_SEND_PORT` | 8000 |
| listenPort | `EOS_LISTEN_PORT` | 8001 |
| **webPort** | `EOS_WEB_PORT` | **8090** (not 8080 — PConAir already uses that) |
| webBind | `EOS_WEB_BIND` | `0.0.0.0` (tablets need LAN) |
| userId | `EOS_USER_ID` | 99 *(already implemented)* |

Pattern mirrors PConAir's `resolvePort()` (`PConAir/src/main/app-settings.ts:206`).
File at `EOS_CONFIG_FILE` or `~/.config/eos-mcp-server/config.json`, atomic tmp+rename.
Record each value's *source* so the UI can grey out env-pinned fields. Validate ports are
1–65535 and mutually distinct.

`PATCH /api/config` applies OSC ports and userId live via a new `reconfigure()` (close,
reopen, re-handshake). **Web port changes persist but require a restart** — rebinding the
socket that's serving the request is a footgun.

### OSC session handshake

`EosClient` already sends `/eos/user` on ready. Extend the handshake to add
`/eos/subscribe 1` → `/eos/filter/clear` → `/eos/filter/add` for only the addresses we
consume, re-run after every rebind and reconnect. Gate filters behind `EOS_FILTER=off`:
client-side discarding is free on a wired LAN, so if hardware shows filters are global we
ship with them off.

### Show-state mirror

Three files, each independently testable:

- **`osc-parse.ts`** — pure. `unwrapArgs()` (args arrive metadata-wrapped as
  `[{type:'s',value:'1/5'}]`, not `['1/5']`) plus
  `parseOut(address, args) → EosOutEvent` discriminated union.
- **`show-state.ts`** — snapshot of `connection / show / cue{active,pending,previous} /
  cmdline / cueLists / faders / channels / bootstrap`, fed by `EosClient.onMessage()`.
  **Broadcasts coalesce on a 50 ms timer carrying only dirty sections** — `%complete`
  streams fast during every fade, so a 6 s fade must produce ~120 frames, not ~600.
- **`state-bootstrap.ts`** — `/eos/get/*` count→index walk, started lazily on **first web
  client connect**. Token bucket: ≤20 in flight, ≥5 ms spacing, 2 s timeout, 1 retry.
  Order: version/show path → cuelist count → per-list cue count → cues. Catalogs
  (groups/subs/macros/presets/patch) are Phase 2.

Health: `/eos/ping` every 5 s; `healthy = now - lastRxAt < 15 s`; on recovery re-run the
handshake and re-bootstrap. A `/eos/out/show/name` change invalidates everything (show file
reloaded). Ignore datagrams whose source address isn't the configured host.

### Hardware-verified facts (tested against a live console, Eos 3.3.9)

These replace several assumptions from the original research. **Live output is far better
than the docs implied.**

**Live parameter feedback exists — three complementary mechanisms:**

| Mechanism | Gives us |
|---|---|
| `/eos/subscribe/param/<param> 1` | pushes `/eos/out/param/<param> [value, min, max]` on change |
| `/eos/out/active/wheel/<n>` | pushes **every** parameter of the *selected* channel, e.g. `["Intens  [40]", 1, 40]`, `["Blue  [0]", 3, 0]` |
| `/eos/out/color/hs` | pushes live hue/sat of the selection, e.g. `[1.61, 98.98]` |
| `/eos/get/params/<chan>` | polls true current values **with min/max per parameter** |

So the Sheet tab can show **real** state, not optimistic echo. The remaining gap is narrower
than stated before: there's no single push feed of *all* channels at once —
`/eos/out/active/chan` covers only the selection and is a summary string
(`"1  [40] ETC_Fixtures S4_LED_S3_Lustr_X8_Direct @ 37"`). For a small sheet, poll
`/eos/get/params/<chan>` per tile; for the selected fixture, use the pushed wheel data.

**Colour arguments are 0–100, not 0–1 — the OSC Dictionary is wrong.** Verified by
read-back: `color/rgb [0,0,1]` produced Blue **16.38** (a dim blue, converted through colour
space), while `color/rgb [0,100,0]` produced Green **100**. Hardcoding 0–1 would have made
every colour in the UI nearly black.

**Better still, ranges are self-describing.** `/eos/get/params/<chan>` returns
`[mfg, fixtureType, (name, current, min, max)...]` — e.g. `Hue 0–360`, `Saturation 0–100`,
`Shutter Strobe 0–255`, `Dimmer Curve 0–9`. **Build sliders from these at runtime rather
than hardcoding any units.**

**Cue lists are not numbered from 1.** The test show's only cue list is **99**
(label `"Master (U1)"`); `/eos/get/cue/1/count` returns 0. The UI must enumerate via
`/eos/get/cuelist/index/<n>` and never assume list 1 exists.

**Empty/out-of-range index queries return malformed responses.** `/eos/get/cue/99/index/0`
on an empty list replies `/eos/out/get/cue/0/0 [0]` — no UID, no label. `osc-parse` must
treat these as "absent" rather than trying to build a record.

**An idle console sends nothing** (0 messages over 3 s with `/eos/subscribe 1` active), and
`/eos/subscribe` itself returns no acknowledgement. Good for the coalescing design — traffic
is genuinely change-driven.

### The one real limitation to surface in the UI and README

**`/eos/get/ms/*` returns magic sheet metadata only** — confirmed on hardware:
`/eos/out/get/ms/1/list/0/3 → [0, "CF78C174-…", ""]` is index, UID, label. No object
geometry. The Sheet tab is magic-sheet-*flavoured* with our own layout, not a mirror of the
console's sheet. Worth saying plainly, since the test show is literally named
"…Magic Sheet updates" and the expectation is easy to form.

### HTTP + WebSocket API

**One dispatcher, two front doors.** `src/web/actions.ts` exports a
`createActionDispatcher({...deps})` factory (shape from
`PConAir/src/main/action-dispatch.ts:68`) returning
`{ok:true,body} | {ok:false,error:{code,message}}`, validated with **zod, already a
dependency**. HTTP routes and WS `action` frames both call it — one validation path, one
guard path, one place to test the OSC contract.

```
GET   /api/health   /api/state   /api/config   /api/feedback
PATCH /api/config
POST  /api/osc/send   /api/command      (raw + command line, guarded)
POST  /api/cue/fire|go|back|stop        GET /api/cuelists[/:list/cues]
POST  /api/chan/level|color|param
POST  /api/fader/config|level|page
POST  /api/sub/level|fire  /api/macro/fire  /api/key
```

Status: 400 zod validation, 409 guard-blocked (body carries `reason` + preview string),
503 OSC unbound. Security headers copied from `PConAir/src/main/server.ts`.

WS `/ws` (shapes mirror `WsServerMessage`, `PConAir/src/shared/types.ts:302`):
`state` on connect → `state_patch` (≤20 Hz, dirty sections) / `event` / `error`; inbound
`action` / `ping`. **Fader drags and colour-picker moves go over WS, throttled,
trailing-edge — never one HTTP request per move.**

Auth: none for MVP (the LAN already has unauthenticated OSC UDP to the console).
`EOS_WEB_PIN` in Phase 2.

Reuse `DestructiveActionGuard` unchanged, but instantiate a **web guard at 250 ms** — the
2000 ms default is right for an LLM loop and awful for a human clicking a button. The
`minIntervalMs` constructor arg (`destructive-guard.ts:16`) is already the seam. The
raw-command panel additionally requires a typed confirmation in the UI before sending
`confirm: true`.

### Frontend: vanilla ES modules in TypeScript, no bundler

The repo's entire build is `tsc`; the MVP is a handful of screens of buttons and sliders.
Adding vite/webpack doubles the build surface. PConAir's own remote UI is `index.html` +
`index.ts`. Browsers do ESM natively, so we keep full type safety — including **sharing
`ShowStateSnapshot` between server and browser**, which is the real payoff.

`tsconfig.web.json` compiles `src/web/public/**` → `dist/web/public`; a 20-line
`scripts/copy-web.mjs` (`fs.cpSync`, no deps) copies html/css.
`"build": "tsc && tsc -p tsconfig.web.json && node scripts/copy-web.mjs"`.

**Screens** (tablet-first, dark, large touch targets):
- **Top bar** — connection pill, show name, active cue + label, live command-line echo.
- **Cues** — list selector, cue rows (number + label), tap to fire, sticky **GO** /
  **STOP·BACK**; active row shows `%complete` as an inline bar, pending row outlined.
- **Faders** — `POST /api/fader/config {bank:1,count:10}` on entry, ten vertical sliders
  named from `/eos/out/fader/<bank>/<n>/name`, page ±.
- **Sheet** — CSS-grid tiles persisted in the config file
  (`{id,label,col,row,w,h,target:{type,id},swatch?}`). Tap = select + at level; long-press
  opens intensity slider, HS colour square + hue strip, RGB sliders, preset swatches.
  MVP ships a hand-editable JSON layout plus a minimal tile editor.

---

## Files

**New:** `src/config.ts`, `src/services/{osc-parse,show-state,state-bootstrap}.ts`,
`src/web/{server,actions,ws-hub}.ts`, `src/web/routes/{state,control,config}.ts`,
`src/web/public/{index.html,app.ts,state.ts,style.css}`,
`src/web/public/views/{cues,faders,sheet}.ts`, `tsconfig.web.json`,
`scripts/copy-web.mjs`.

**Modified:** `src/services/eos-client.ts` (extend handshake with subscribe/filter, add
`reconfigure()`), `src/types.ts` (state types, web config), `vitest.config.ts`,
`package.json` (`npm start` → web server), `README.md`.

**New deps:** `express@^4.18` (match PConAir; express 5 changed router semantics),
`ws@^8.17`; dev `@types/express`, `@types/ws`, `supertest`, `@types/supertest`.

---

## Phasing

- **Phase 1 — MVP.** Config, subscribe/filter handshake, `osc-parse` + `show-state` +
  `ws-hub`, web server, action dispatcher, Cues/Faders/Sheet tabs with manual layout.
  *(= recall cues, set faders and colours, magic-sheet-style controls.)*
- **Phase 2 — programming.** Catalog bootstrap → auto-generated sheet from
  `/eos/get/patch/*`, record/update verbs, live config editing, `EOS_WEB_PIN`.
- **Phase 3 — full surface.** Blind, effects, direct selects, palettes, patch editing.

---

## Verification

**Automated** (vitest; keep the 80% threshold):

| File | Covers |
|---|---|
| `test/config.test.ts` | env>file>default per key; port collision rejected |
| `test/services/osc-parse.test.ts` | table-driven over ~30 real address+arg fixtures; **commit captured hardware output as `test/fixtures/eos-out.json`** |
| `test/services/show-state.test.ts` | events → snapshot; 100 rapid `%complete` msgs under `vi.useFakeTimers()` produce **one** coalesced patch |
| `test/services/state-bootstrap.test.ts` | walk ordering, ≤20 in flight, timeout+retry, progress |
| `test/services/eos-client.test.ts` | extend: handshake sends subscribe + filters in order after `/eos/user` |
| `test/web/actions.test.ts` | one case per verb → exact OSC address + args (the "did we send the right OSC" contract) |
| `test/web/routes.test.ts` | supertest against `createWebServer().app`, never `listen()`; 400/409/503 paths |
| `test/web/ws.test.ts` | real `listen(0)` + ws client; initial `state`, a `state_patch`, inbound `action`; structure from `PConAir/tests/websocket.test.ts` |

> **Coverage trap:** `vitest.config.ts:9` has `include: ["src/**/*.ts"]`, which will sweep in
> `src/web/public/**` browser code with no jsdom env. **Add it to `exclude` or the build
> fails the 80% gate.**

**On hardware** — ordered by rework cost if wrong:

1. **`/eos/filter/*` scope** — global vs per-connection. Add a narrow filter, then confirm
   Companion feedback still updates. Decides whether filters ship on by default.
2. **`/eos/subscribe` scope**, same question; and which outputs actually require it.
3. **Companion regression, empirically.** Server running: Companion still shows connected;
   `netstat -an | grep -E '3032|3037|800[01]'` confirms disjoint sockets; fire 10 cues from
   Companion with the web UI open, watch for misses or command-line garbling.
4. Fader config shape — `levels.ts` emits two forms; confirm which Eos accepts and whether
   names arrive on `/eos/out/fader/<bank>/<n>/name`.
5. `/eos/get/*` throughput before responses drop — tunes the token bucket. Use the largest
   real show file available (the current test show has only 11 channels and 0 cues, so it
   proves nothing about scale).

*Resolved on hardware — no longer open:* colour units (0–100, docs were wrong), parameter
ranges (self-describing via `/eos/get/params`), magic sheet geometry (metadata only), live
parameter push (`/eos/subscribe/param` + `/eos/out/active/wheel/*` both work),
**`/eos/user` command-line isolation** (verified against a partial command left on the
keypad), and **which command-line address to echo**.

> **Design consequence — use the right command-line address.** Both `/eos/out/cmd` and
> `/eos/out/user/<n>/cmd` fire for a command, but `/eos/out/cmd` carries the latest command
> from *any* user, including the console operator's typing. The UI's command echo must
> subscribe to **`/eos/out/user/<our id>/cmd`**, or the operator's keystrokes will appear in
> our UI.

All ten documented findings are re-checkable in one run with
`node tools/diagnostics/confirm-findings.mjs` (10/10 passing as of Eos 3.3.9.25).

**Manual smoke:** start the server against a console, open `http://<host>:8090` from a
tablet, fire a cue, drag a fader, set a colour, confirm the active-cue bar tracks the fade
and Companion's buttons still light.
