import { describe, it, expect, beforeEach } from "vitest";
import { registerMiscTools } from "../../src/tools/misc.js";
import { createFakeServer } from "../helpers/fake-server.js";
import { createFakeEosClient } from "../helpers/fake-eos-client.js";

describe("misc tools", () => {
  let tools: ReturnType<typeof createFakeServer>["tools"];
  let eos: ReturnType<typeof createFakeEosClient>;

  beforeEach(() => {
    const fakeServer = createFakeServer();
    eos = createFakeEosClient();
    registerMiscTools(fakeServer.server, eos.client);
    tools = fakeServer.tools;
  });

  it("eos_send_raw_command forwards text to the command line", async () => {
    await tools.get("eos_send_raw_command")!.handler({ command: "Chan 1 Thru 10 At 50 Enter" });
    expect(eos.commandLines).toEqual(["Chan 1 Thru 10 At 50 Enter"]);
  });

  it("eos_fire_macro sends the macro number to the fire address", async () => {
    await tools.get("eos_fire_macro")!.handler({ macro_number: 7 });
    expect(eos.sent).toEqual([{ address: "/eos/macro/fire", args: [7] }]);
  });

  it("eos_get_status reports when no feedback has arrived yet", async () => {
    const result = await tools.get("eos_get_status")!.handler({ limit: 20 });
    expect(result.content[0].text).toContain("No feedback received yet");
    expect(result.structuredContent).toBeUndefined();
  });

  it("eos_get_status returns recent feedback as structured content", async () => {
    eos.setFeedback([
      { address: "/eos/out/active/cue", args: ["1/5"], receivedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const result = await tools.get("eos_get_status")!.handler({ limit: 20 });
    expect(result.structuredContent).toEqual({
      entries: [
        { address: "/eos/out/active/cue", args: ["1/5"], receivedAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
  });

  it("eos_get_status filters feedback by substring when given", async () => {
    eos.setFeedback([
      { address: "/eos/out/active/cue", args: ["1/5"], receivedAt: "2026-01-01T00:00:00.000Z" },
      { address: "/eos/out/cmd", args: ["Chan 1"], receivedAt: "2026-01-01T00:00:01.000Z" },
    ]);
    const result = await tools.get("eos_get_status")!.handler({ filter: "active/cue", limit: 20 });
    expect(result.structuredContent).toEqual({
      entries: [
        { address: "/eos/out/active/cue", args: ["1/5"], receivedAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
  });
});
