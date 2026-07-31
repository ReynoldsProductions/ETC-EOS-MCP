import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EosClient } from "../services/eos-client.js";

export function registerLevelTools(server: McpServer, eos: EosClient): void {
  server.registerTool(
    "eos_set_channel_level",
    {
      title: "Set Eos Channel Intensity",
      description: `Set a channel's intensity level directly (0-100). This both selects the channel and sets its level in one call, equivalent to "Chan <n> At <level> Enter" on the console.

Args:
  - channel (number): Channel number.
  - level (number): Intensity 0-100.

Note: this affects Live output immediately. It does not get recorded into a cue unless you separately call eos_record_cue.`,
      inputSchema: {
        channel: z.number().int().min(1).describe("Channel number"),
        level: z.number().min(0).max(100).describe("Intensity level, 0-100"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channel, level }) => {
      await eos.send(`/eos/chan/${channel}`, [level]);
      return {
        content: [{ type: "text" as const, text: `Set channel ${channel} to ${level}.` }],
      };
    }
  );

  server.registerTool(
    "eos_select_channel",
    {
      title: "Select Eos Channel",
      description: `Select a channel on the command line without changing its level. Use this before eos_adjust_parameter or eos_nudge_wheel, which act on whatever is currently selected.

Args:
  - channel (number): Channel number to select.`,
      inputSchema: {
        channel: z.number().int().min(1),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channel }) => {
      await eos.send(`/eos/chan`, [channel]);
      return { content: [{ type: "text" as const, text: `Selected channel ${channel}.` }] };
    }
  );

  server.registerTool(
    "eos_set_parameter",
    {
      title: "Set Eos Parameter (encoder-style absolute value)",
      description: `Set a non-intensity parameter (pan, tilt, a color channel, zoom, etc.) to an absolute value for a specific channel — the OSC equivalent of dialing an encoder to a target value.

Args:
  - channel (number): Channel number.
  - parameter (string): Parameter name as Eos knows it, e.g. "pan", "tilt", "zoom", "red", "green", "blue".
  - value (number): Target value. Range depends on the parameter (e.g. pan/tilt are typically in degrees, color channels 0-100).

Example: channel=12, parameter="pan", value=45 sets channel 12's pan to 45.`,
      inputSchema: {
        channel: z.number().int().min(1),
        parameter: z.string().min(1).describe('Eos parameter name, e.g. "pan", "tilt", "zoom", "red"'),
        value: z.number().describe("Target value for the parameter"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channel, parameter, value }) => {
      await eos.send(`/eos/chan/${channel}/param/${parameter}`, [value]);
      return {
        content: [{ type: "text" as const, text: `Set channel ${channel} ${parameter} to ${value}.` }],
      };
    }
  );

  server.registerTool(
    "eos_nudge_wheel",
    {
      title: "Nudge Eos Encoder Wheel",
      description: `Simulate turning an encoder wheel by a relative number of ticks, for whatever channel/parameter is currently selected (use eos_select_channel first). This is the closest OSC equivalent to physically twisting a console knob, useful for live "nudge it a bit" adjustments rather than jumping to an absolute value.

Args:
  - parameter (string, optional): Parameter to nudge, e.g. "pan". Omit to nudge the intensity/level wheel.
  - ticks (number): Positive nudges up, negative nudges down. Magnitude controls how far — small values (~1) for fine nudges, larger (~5-10) for bigger moves.
  - fine (boolean, optional): Use fine mode instead of coarse. Default false.`,
      inputSchema: {
        parameter: z.string().optional().describe('Parameter to nudge, e.g. "pan"; omit for intensity'),
        ticks: z.number().describe("Wheel ticks, positive = up, negative = down"),
        fine: z.boolean().optional().default(false).describe("Use fine mode instead of coarse"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ parameter, ticks, fine }) => {
      const mode = fine ? "fine" : "coarse";
      const address = parameter
        ? `/eos/wheel/${mode}/${parameter}`
        : `/eos/wheel/level`;
      await eos.send(address, [ticks]);
      return {
        content: [
          {
            type: "text" as const,
            text: `Nudged ${parameter ?? "intensity"} by ${ticks} ${mode} ticks.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "eos_set_fader",
    {
      title: "Set Eos OSC Fader",
      description: `Set a fader in an OSC fader bank to a level. Requires the bank to already exist on the console (call eos_configure_fader_bank first if you haven't created bank_index yet — it only needs to be done once per session).

Args:
  - bank_index (number): 1-based OSC fader bank index (created via eos_configure_fader_bank). Use 0 for the master fader.
  - fader_index (number): Fader position within the bank.
  - level (number): 0.0-1.0 (0% to 100%).`,
      inputSchema: {
        bank_index: z.number().int().min(0),
        fader_index: z.number().int().min(1),
        level: z.number().min(0).max(1).describe("Fader level, 0.0-1.0"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ bank_index, fader_index, level }) => {
      await eos.send(`/eos/fader/${bank_index}/${fader_index}`, [level]);
      return {
        content: [
          { type: "text" as const, text: `Set fader ${bank_index}/${fader_index} to ${Math.round(level * 100)}%.` },
        ],
      };
    }
  );

  server.registerTool(
    "eos_configure_fader_bank",
    {
      title: "Configure Eos OSC Fader Bank",
      description: `Create (or re-page) an OSC fader bank so eos_set_fader can address it. Must be called once before using a given bank_index. Safe to call again to jump pages.

Args:
  - bank_index (number): 1-based index for this OSC fader bank (your own numbering, independent of console fader numbers).
  - fader_count (number): How many faders in this bank.
  - page (number, optional): Which page to start on. Defaults to page 1.`,
      inputSchema: {
        bank_index: z.number().int().min(1),
        fader_count: z.number().int().min(1).max(50),
        page: z.number().int().min(1).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ bank_index, fader_count, page }) => {
      const address = page
        ? `/eos/fader/${bank_index}/config/${page}/${fader_count}`
        : `/eos/fader/${bank_index}/config/${fader_count}`;
      await eos.send(address);
      return {
        content: [
          {
            type: "text" as const,
            text: `Configured OSC fader bank ${bank_index} with ${fader_count} faders${page ? ` (page ${page})` : ""}.`,
          },
        ],
      };
    }
  );
}
