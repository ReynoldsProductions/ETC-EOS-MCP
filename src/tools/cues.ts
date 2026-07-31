import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EosClient } from "../services/eos-client.js";
import type { DestructiveActionGuard } from "../services/destructive-guard.js";

export function registerCueTools(server: McpServer, eos: EosClient, guard: DestructiveActionGuard): void {
  server.registerTool(
    "eos_fire_cue",
    {
      title: "Fire Eos Cue",
      description: `Fire a specific cue immediately, regardless of playback sequence (equivalent to selecting it and pressing Go, but works even if it's out of order).

Args:
  - cue_list (number): Cue list number the cue lives in.
  - cue_number (string): Cue number, e.g. "5" or "12.5" for a numbered part.

Returns confirmation text once the OSC message is sent. Eos does not send a synchronous acknowledgement, so success here means "the command was sent," not "the cue finished." Use eos_get_status to check playback position afterward.

Example: cue_list=1, cue_number="5" fires cue 5 in cue list 1.`,
      inputSchema: {
        cue_list: z.number().int().min(1).describe("Cue list number"),
        cue_number: z.string().min(1).describe('Cue number, e.g. "5" or "12.5"'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ cue_list, cue_number }) => {
      await eos.send(`/eos/cue/${cue_list}/${cue_number}/fire`);
      return {
        content: [
          {
            type: "text" as const,
            text: `Sent fire command for cue ${cue_list}/${cue_number}.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "eos_go",
    {
      title: "Press Eos Go",
      description: `Press the [Go] button on a cue list, advancing to the next cue in sequence (the normal way a show runs, as opposed to eos_fire_cue which jumps to an arbitrary cue out of order).

Args:
  - cue_list (number, optional): Cue list to advance. Omit to press Go on the default/active cue list.`,
      inputSchema: {
        cue_list: z.number().int().min(1).optional().describe("Cue list to advance; omit for the active list"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ cue_list }) => {
      const address = cue_list ? `/eos/go/${cue_list}` : `/eos/key/go_0`;
      await eos.send(address);
      return {
        content: [{ type: "text" as const, text: `Sent Go${cue_list ? ` for cue list ${cue_list}` : ""}.` }],
      };
    }
  );

  server.registerTool(
    "eos_record_cue",
    {
      title: "Record Eos Cue",
      description: `Record the current live state into a cue. This OVERWRITES existing cue data if the cue number already exists — Eos has no separate "confirm" step over OSC, so double-check the cue number before calling this on a real rig. Safe to experiment with on a test system.

Uses the Eos command line under the hood (there's no dedicated OSC verb for recording), equivalent to typing "Record Cue <list>/<number> Enter" on the console.

Args:
  - cue_list (number): Cue list to record into.
  - cue_number (string): Cue number to record, e.g. "5" or "12.5".
  - label (string, optional): Text label to apply to the cue.
  - confirm (boolean): Must be explicitly set to true to actually execute. Omit or set false to get a preview of what would be recorded without touching the show.

Calls are also rate-limited to one per few seconds to guard against a runaway loop hammering Record.`,
      inputSchema: {
        cue_list: z.number().int().min(1).describe("Cue list to record into"),
        cue_number: z.string().min(1).describe('Cue number, e.g. "5" or "12.5"'),
        label: z.string().max(100).optional().describe("Optional text label for the cue"),
        confirm: z.boolean().default(false).describe("Must be true to actually record; otherwise this just previews the action"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ cue_list, cue_number, label, confirm }) => {
      const preview = `Record Cue ${cue_list}/${cue_number}${label ? ` with label "${label}"` : ""}`;
      const gate = guard.check("eos_record_cue", confirm);
      if (!gate.allowed) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Not executed (${gate.reason}). Would run: ${preview}. Call again with confirm: true to proceed.`,
            },
          ],
        };
      }
      await eos.sendCommandLine(`Record Cue ${cue_list}/${cue_number} Enter`);
      if (label) {
        await eos.sendCommandLine(`Cue ${cue_list}/${cue_number} Label ${label} Enter`);
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Recorded cue ${cue_list}/${cue_number}${label ? ` with label "${label}"` : ""}.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "eos_select_cue",
    {
      title: "Select Eos Cue",
      description: `Select a cue on the command line without firing it — useful before eos_record_cue-style raw edits, or to inspect a cue before running it.

Args:
  - cue_list (number): Cue list number.
  - cue_number (string): Cue number to select.`,
      inputSchema: {
        cue_list: z.number().int().min(1),
        cue_number: z.string().min(1),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ cue_list, cue_number }) => {
      await eos.send(`/eos/cue/${cue_list}`, [Number(cue_number)]);
      return {
        content: [{ type: "text" as const, text: `Selected cue ${cue_list}/${cue_number}.` }],
      };
    }
  );
}
