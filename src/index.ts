#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EosClient } from "./services/eos-client.js";
import { DestructiveActionGuard } from "./services/destructive-guard.js";
import { registerCueTools } from "./tools/cues.js";
import { registerLevelTools } from "./tools/levels.js";
import { registerMiscTools } from "./tools/misc.js";
import type { EosConfig } from "./types.js";

function loadConfig(): EosConfig {
  const host = process.env.EOS_HOST;
  if (!host) {
    console.error(
      "Missing EOS_HOST env var — set it to the IP or hostname of the machine running Eos (the Nomad/Puck host)."
    );
    process.exit(1);
  }
  return {
    host,
    // ETC's recommended defaults: Eos receives on 8000, transmits on 8001.
    sendPort: Number(process.env.EOS_SEND_PORT ?? 8000),
    listenPort: Number(process.env.EOS_LISTEN_PORT ?? 8001),
    verbose: process.env.EOS_VERBOSE === "1",
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const eos = new EosClient(config);
  await eos.waitUntilReady();
  console.error(
    `[eos-mcp-server] listening on UDP ${config.listenPort}, sending to ${config.host}:${config.sendPort}`
  );

  const server = new McpServer({
    name: "eos-mcp-server",
    version: "1.0.0",
  });

  const guard = new DestructiveActionGuard();
  registerCueTools(server, eos, guard);
  registerLevelTools(server, eos);
  registerMiscTools(server, eos, guard);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("[eos-mcp-server] fatal error:", error);
  process.exit(1);
});
