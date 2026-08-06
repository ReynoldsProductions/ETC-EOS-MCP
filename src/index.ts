#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EosClient } from "./services/eos-client.js";
import { DestructiveActionGuard } from "./services/destructive-guard.js";
import { loadConfig } from "./config.js";
import { registerCueTools } from "./tools/cues.js";
import { registerLevelTools } from "./tools/levels.js";
import { registerMiscTools } from "./tools/misc.js";
import type { LoadedConfig } from "./config.js";

async function main(): Promise<void> {
  let config: LoadedConfig;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(
      `[eos-mcp-server] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
  if (config.warning) {
    console.error(`[eos-mcp-server] warning: ${config.warning}`);
  }

  const eos = new EosClient(config);
  try {
    await eos.waitUntilReady();
  } catch (error) {
    // A failed bind used to hang here forever; surface it and exit instead.
    console.error(
      `[eos-mcp-server] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
  console.error(
    `[eos-mcp-server] listening on UDP ${config.listenPort}, sending to ${config.host}:${config.sendPort} as OSC user ${config.userId}`
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
