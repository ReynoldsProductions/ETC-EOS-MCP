import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: unknown;
}

export interface RegisteredTool {
  name: string;
  config: unknown;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/** Minimal stand-in for McpServer that just records registerTool calls, so tool
 * handlers can be invoked directly in tests without spinning up the MCP transport. */
export function createFakeServer(): { server: McpServer; tools: Map<string, RegisteredTool> } {
  const tools = new Map<string, RegisteredTool>();
  const fake = {
    registerTool(name: string, config: unknown, handler: RegisteredTool["handler"]) {
      tools.set(name, { name, config, handler });
    },
  };
  return { server: fake as unknown as McpServer, tools };
}
