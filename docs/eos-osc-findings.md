# Eos OSC: findings from live hardware

Notes from driving a real Eos console (**v3.3.9.25**, show file v3.3.9.2) over OSC/UDP.

Several of these **contradict ETC's published OSC documentation**, and one of them would
have quietly broken every colour in a UI. Recorded here so they don't have to be
rediscovered.

Reproduce any of this with the scripts in [`tools/diagnostics/`](../tools/diagnostics).

---

## 1. Colour arguments are 0–100, not 0–1

ETC's OSC Dictionary documents `/eos/chan/<n>/color/rgb` as taking `0.0–1.0` per component.
**On hardware it is 0–100.** Verified by setting a value and reading it back with
`/eos/get/params/<chan>`:

| Sent | Result |
|---|---|
| `/eos/chan/1/color/rgb [0, 0, 1]` | Blue = **16.38** — i.e. a nearly-black blue |
| `/eos/chan/1/color/rgb [0, 100, 0]` | Green = **100** — full |

The `16.38` is not a 1:1 mapping because RGB is converted through colour space into the
fixture's actual emitters (the test fixture is an 8-colour LED), but the scale is
unambiguous: 100 is full, 1 is nearly nothing.

Building to the documented 0–1 scale would make every colour in a UI almost black.

## 2. Parameter ranges are self-describing — don't hardcode units

`/eos/get/params/<chan>` returns:

```
[manufacturer, fixtureType, (name, current, min, max), (name, current, min, max), ...]
```

Real response for an ETC S4 LED S3 Lustr X8:

```
"ETC Fixtures", "S4 LED S3 Lustr X8 Direct",
"Intens" 0 0 100      "Red"    0 0 100     "Amber"  0 0 100    "Lime"     0 0 100
"Green"  0 0 100      "Blue"   0 0 100     "Indigo" 0 0 100    "Cyan"     0 0 100
"Deep Red" 0 0 100    "Hue"    0 0 360     "Saturation" 0 0 100
"Cooling Fan" 0 -2 -2 "Shutter Strobe" 0 0 255        "Dimmer Curve" 0 0 9
```

So ranges vary per parameter (`Hue` is 0–360, `Strobe` is 0–255, `Dimmer Curve` is 0–9) and
per fixture type. **Query them at runtime and build controls from the returned min/max**
rather than hardcoding anything. Note `Cooling Fan` reports `min = max = -2`, so guard
against degenerate ranges.

This query also returns **live current values**, which makes it a general-purpose way to
read true channel state.

## 3. Live parameter feedback does exist

It is easy to conclude from `/eos/out/active/chan` alone that Eos only emits a
human-readable summary. It emits considerably more:

| Mechanism | Behaviour |
|---|---|
| `/eos/subscribe/param/<param> 1` | pushes `/eos/out/param/<param> [value, min, max]` on every change |
| `/eos/out/active/wheel/<n>` | pushes **every** parameter of the *currently selected* channel |
| `/eos/out/color/hs` | pushes live hue/saturation of the selection |
| `/eos/get/params/<chan>` | polls true current values for any channel |

Observed samples:

```
/eos/out/param/intens        [40, 0, 100]
/eos/out/active/wheel/1      ["Intens  [40]", 1, 40]
/eos/out/active/wheel/6      ["Blue  [0]", 3, 0]
/eos/out/color/hs            [1.61, 98.98]
/eos/out/active/chan         ["1  [40] ETC_Fixtures S4_LED_S3_Lustr_X8_Direct @ 37"]
```

**The remaining gap:** there is no single push feed carrying *all* channels at once.
`/eos/out/active/wheel/*` covers only the selection. To track a grid of fixtures, poll
`/eos/get/params/<chan>` per channel, and use the pushed wheel data for whatever is
selected.

`/eos/out/active/chan` is a formatted string, not structured data — parse it only as a last
resort.

## 4. Cue lists are not numbered from 1

The test show's only cue list is **99** (label `"Master (U1)"`). `/eos/get/cue/1/count`
returns `0`, and recording into list 1 fails with `Cue List Does Not Exist`.

**Always enumerate** via `/eos/get/cuelist/count` then `/eos/get/cuelist/index/<n>`. Never
assume list 1 exists. Eos does not auto-create cue lists; a blank show has none at all, and
the first cue must be created on the console or with a bare `Record Enter`.

## 5. Empty / out-of-range index queries return malformed responses

Querying an index that doesn't exist does **not** produce an error or an empty reply — it
produces a stub with the wrong address:

```
send:     /eos/get/cue/99/index/0     (list 99 exists but contains 0 cues)
receive:  /eos/out/get/cue/0/0  [0]   (no UID, no label)
```

A parser must treat a response lacking a UID as "absent" rather than constructing a record
from it.

## 6. Magic sheets expose metadata only

```
send:     /eos/get/ms/index/0
receive:  /eos/out/get/ms/1/list/0/3   [0, "CF78C174-F7D4-4FAC-BA61-FC111BA5CDF3", ""]
```

That is list index, UID, and label — **no object geometry, positions, or layout**. A
"magic sheet" view in a third-party UI has to define its own layout; it cannot mirror the
console's.

## 7. `/eos/user` gives you your own command line

`/eos/user=<n>`:

- **0** — the *background* user. Has **no command line at all**, so command-line operations
  (`Record`, raw text) silently do nothing. Avoid unless that is precisely what you want.
- **-1** — the console's current user. Your commands share the operator's command line, so
  a command sent while they are mid-entry can merge with theirs and produce garbage such as
  `LIVE: Record Cue 99 /`.
- **1–99** — a virtual user with its **own** command line. This is what a third-party
  controller should claim.

The console confirms the claim by echoing `/eos/out/user [<n>]` — but **only when the user
actually changes**. Re-claiming a user that is already active produces no echo, so absence
of the echo is not an error and must not be used as a connectivity check.

There is no need to clear the command line before sending text if you hold your own user;
`/eos/newcmd` replaces your line rather than appending to it.

## 8. Traffic is genuinely change-driven

With `/eos/subscribe 1` active, an idle console emitted **zero** messages over a 3-second
window. `/eos/subscribe` itself returns no acknowledgement. Output arrives only on actual
change — so a state mirror can coalesce aggressively without missing anything.

Be aware that `%complete` on a running cue *does* stream at a high rate during fades; that
is the one case that needs throttling.

## 9. Transport separation (why Companion is unaffected)

Bitfocus Companion's official ETC Eos module connects over **TCP 3032** (or **3037** with
SLIP framing) and never uses UDP. Eos's `OSC TX IP Address` setting governs **UDP only**,
and is a single destination.

A UDP OSC client therefore runs on a completely separate transport and cannot disturb
Companion's feedback — no relay or fan-out is required.

**Still unverified:** whether `/eos/subscribe` and `/eos/filter/*` are global to the console
or scoped per connection. If global, filters set by one client could suppress output another
depends on. Until this is tested, keep output filters behind a switch.

## 10. Network gotchas that look like OSC bugs

Two separate incidents where sends succeeded but no feedback arrived, neither of which was
a code or console-settings problem:

- **A VPN on the machine running the OSC client** advertised a duplicate route for the LAN
  subnet, so traffic went into the tunnel. Symptom: `EHOSTUNREACH` on send. Check with
  `netstat -rn -f inet | grep <subnet>` — two routes for one subnet is the tell.
- **A VPN on the console machine.** Sends left cleanly with no error and the console visibly
  reacted, but nothing came back.

Diagnostic order that works: confirm sends leave without `EHOSTUNREACH` → send a harmless
visible command such as `/eos/key/live` to prove RX → if the console reacts but nothing
returns, the problem is the return path (a VPN, or the console's OSC TX IP), not the code.

The OSC TX IP must point at **the machine running the client**, not at the console.
