import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EosClient } from "../services/eos-client.js";

export function registerMiscTools(server: McpServer, eos: EosClient): void {
  server.registerTool(
    "eos_send_raw_command",
    {
      title: "Send Raw Eos Command Line Text",
      description: `Escape hatch: send arbitrary text to the Eos command line, exactly as if it were typed on the keypad. Use this for anything the other tools don't cover (patch changes, group/preset creation, palette recording, "Sneak", etc.).

Args:
  - command (string): Command line text, e.g. "Chan 1 Thru 10 At 50 Enter" or "Group 1 Record Enter".

The command is auto-terminated with Enter if you don't already end it with "#" or "Enter". Because this can do literally anything the console can do, treat it like you would typing directly on the desk — double-check destructive commands (Record, Delete, Update) before sending.`,
      inputSchema: {
        command: z.string().min(1).describe("Eos command line text to send"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ command }) => {
      await eos.sendCommandLine(command);
      return { content: [{ type: "text" as const, text: `Sent command: ${command}` }] };
    }
  );

  server.registerTool(
    "eos_fire_macro",
    {
      title: "Fire Eos Macro",
      description: `Run a saved macro by number (1-127).

Args:
  - macro_number (number): Macro to fire.`,
      inputSchema: {
        macro_number: z.number().int().min(1).max(127),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ macro_number }) => {
      await eos.send(`/eos/macro/fire`, [macro_number]);
      return { content: [{ type: "text" as const, text: `Fired macro ${macro_number}.` }] };
    }
  );

  server.registerTool(
    "eos_get_status",
    {
      title: "Get Recent Eos Status Feedback",
      description: `Read back recent OSC feedback Eos has sent (active cue, command line text, live/blind state, etc). Eos pushes this asynchronously — this tool returns whatever has arrived so far in this session, not a live query, so call it shortly after an action if you want to see its effect.

Args:
  - filter (string, optional): Only return feedback whose address contains this substring, e.g. "active/cue" or "out/cmd". Omit for everything.
  - limit (number, optional): Max entries to return, most recent last. Default 20.

Returns:
  JSON array of {address, args, receivedAt} entries. Empty array means either nothing has happened yet or Eos's OSC TX isn't reaching this server (check host/ports and that {OSC TX} is enabled on Eos).`,
      inputSchema: {
        filter: z.string().optional().describe('Substring to match against the OSC address, e.g. "active/cue"'),
        limit: z.number().int().min(1).max(200).optional().default(20),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ filter, limit }) => {
      const entries = filter ? eos.getFeedbackMatching(filter, limit) : eos.getRecentFeedback(limit);
      if (entries.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No feedback received yet. If you expect some, confirm Eos has {OSC TX} enabled and its OSC UDP TX Port matches this server's listen port.",
            },
          ],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(entries, null, 2) }],
        structuredContent: { entries },
      };
    }
  );
}
