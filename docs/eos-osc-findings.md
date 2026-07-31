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

## 1a. `color/xy` is 0–1 — the opposite of `color/rgb`

The two colour addresses use **different scales**, which is easy to get backwards:

| Address | Scale |
|---|---|
| `/eos/chan/<n>/color/rgb` | **0–100** |
| `/eos/chan/<n>/color/xy` | **0–1** (true CIE 1931 chromaticity) |

Sending xy on a 0–100 scale drives the request far outside the gamut and Eos clamps to
something meaningless. Verified with a 3200K target (x=0.4232, y=0.3991):

```
xy [0.4232, 0.3991]   -> Lustr: Red 100  Green 99.9  Amber 100  Blue 0   (warm white)
xy [42.32, 39.91]     -> Lustr: Red 0    Green 0     Amber 100  Blue 0   (nonsense)
```

**CIE xy is the reliable way to hit a colour temperature.** Neither an ETC Lustr X8 nor a
GLP Impression X4 exposes a settable CCT parameter — the X4 reports
`Color Temperature` with range `3199..3199`, i.e. fixed — so converting the target
temperature to a point on the Planckian locus and letting Eos's colour engine map it to
each fixture's emitters is the only general approach.

For reference, 3200K is x=0.4232, y=0.3991. On a Lustr X8 that produces
`Amber 100, Lime 100, Deep Red 100, Red 100, Green 99.9, Indigo 79.6, Cyan 0, Blue 0` —
a convincing tungsten white.

## 1b. Hue and Saturation are not settable as raw parameters

`/eos/chan/<n>/param/hue` and `/param/saturation` **do nothing** on these fixtures, even
though both appear in `/eos/get/params` with sensible ranges (0–360 and 0–100).

Use `/eos/chan/<n>/color/hs [hue, sat]` instead — that works.

This is specific to the virtual colour controls. `/eos/chan/<n>/param/<name>` is fine for
real parameters: `param/pan [45]` moved pan from 0 to 45 exactly as expected.

**Worse, Hue and Saturation always read back as 0**, whatever the actual colour. After
setting a fully saturated cyan via `color/hs [200, 100]`, `/eos/get/params` still reported
`Hue=0 Saturation=0` while the emitters correctly showed `Red 0, Green 100, Blue 18`.
**Verify colour from the emitter values, never from Hue/Saturation.**

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

**Pushes are strictly change-driven — a no-op set is silent.** Setting a parameter to the
value it already holds produces **no** output at all:

```
set intensity 60  ->  1 param push, 1 wheel push
set intensity 30  ->  1 param push, 1 wheel push
set intensity 30  ->  0 pushes          <- same value again
set intensity 30  ->  0 pushes
```

This matters for UI design: **never block on a confirmation echo**, because one may never
arrive. Treat a control as applied optimistically and let a push correct it if the value
actually changed. (It also makes any test of the push mechanism order-dependent — pick a
target value that differs from the current one, which is why
`tools/diagnostics/confirm-findings.mjs` reads the current value first.)

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

### Isolation is confirmed on hardware

Tested with a partial command left on the console keypad:

1. Operator typed `Chan 5 Thru 8` on the console (user 1) and did **not** press Enter.
2. We sent `Chan 2 At 25 Enter` as user 99.

Result: channel 2 went to 25, channels 5–8 **did not move**, and the operator's partial
command line was untouched. Over OSC, `/eos/out/user/99/cmd` carried our text and
`/eos/out/user/1/cmd` emitted **nothing at all**.

Had the lines merged — the failure mode this design prevents — `Chan 5 Thru 8` followed by
`At 25` would have driven channels 5–8 to 25. Reproduce with
`tools/diagnostics/user-isolation.mjs`.

## 7a. `/eos/out/cmd` is console-wide; `/eos/out/user/<n>/cmd` is yours

Both fire for the same command, and the difference matters:

```
/eos/out/user/99/cmd   ["LIVE: Chan 2 @ 25 #", 0]   <- only our user's line
/eos/out/cmd           ["LIVE: Chan 2 @ 25 #", 0]   <- the latest command from ANY user
```

`/eos/out/cmd` is the more obvious address to reach for, and it is the wrong one for a
third-party controller: it carries the console operator's typing as well as your own, so a
UI echoing it will show the operator's keystrokes and appear to "jump around" for no
reason.

**Subscribe to `/eos/out/user/<your id>/cmd`** for your own command-line echo. Use
`/eos/out/cmd` only if you genuinely want a console-wide activity feed.

## 7b. Command-line syntax: slashes need spaces, and destructive commands need a second Enter

Two separate traps when driving the command line via `/eos/newcmd`.

**Slashes must be surrounded by spaces.** The natural form fails:

```
Record Cue 99/1 Enter     ->  "LIVE: Record Cue 99 /  Error: Number Out Of Range"
Record Cue 99 / 1 Enter   ->  "LIVE: Cue  99 / 1 : Record Cue 99 / 1 #"   works
```

Without spaces the cue number is dropped entirely and the command errors. This applies to
`Delete` and `Cue … Label` too — anywhere a list/number pair appears.

**Destructive commands park on a confirmation.** Recording over an existing cue, or
deleting one, does not execute on the first Enter:

```
Record Cue 99 / 900 Enter   (cue is new)       -> executes immediately
Record Cue 99 / 900 Enter   (cue now exists)   -> "Please Confirm", waits
Delete Cue 99 / 900 Enter                      -> "Please Confirm", waits
```

The pending command sits there until a second Enter arrives (`/eos/key/enter`). **Without
it the command silently does nothing** — no error, no change, and the OSC sender has no
idea. `EosClient.sendCommandLineConfirming()` handles this: it sends, waits for the echo,
and presses Enter again only if the echo contains "Please Confirm".

Because Eos never acknowledges command-line input synchronously, any code that reports
"recorded" without reading `/eos/out/user/<n>/cmd` back is guessing. Check the echo for
`Error` before claiming success.

## 7c. The default cue fade is 5 seconds

Cues record with a 5000 ms up time unless told otherwise, so a cue fired over OSC takes
five seconds to arrive. Reading channel values sooner returns **mid-fade** numbers that
look like the cue is wrong. Wait out the fade (or set a shorter time explicitly) before
verifying anything.

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
