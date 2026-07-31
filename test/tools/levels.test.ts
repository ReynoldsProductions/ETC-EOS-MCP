import { describe, it, expect, beforeEach } from "vitest";
import { registerLevelTools } from "../../src/tools/levels.js";
import { createFakeServer } from "../helpers/fake-server.js";
import { createFakeEosClient } from "../helpers/fake-eos-client.js";

describe("level tools", () => {
  let tools: ReturnType<typeof createFakeServer>["tools"];
  let eos: ReturnType<typeof createFakeEosClient>;

  beforeEach(() => {
    const fakeServer = createFakeServer();
    eos = createFakeEosClient();
    registerLevelTools(fakeServer.server, eos.client);
    tools = fakeServer.tools;
  });

  it("eos_set_channel_level sets intensity on the channel address", async () => {
    await tools.get("eos_set_channel_level")!.handler({ channel: 12, level: 50 });
    expect(eos.sent).toEqual([{ address: "/eos/chan/12", args: [50] }]);
  });

  it("eos_select_channel selects without a level arg", async () => {
    await tools.get("eos_select_channel")!.handler({ channel: 12 });
    expect(eos.sent).toEqual([{ address: "/eos/chan", args: [12] }]);
  });

  it("eos_set_parameter targets the channel's named parameter", async () => {
    await tools.get("eos_set_parameter")!.handler({ channel: 12, parameter: "pan", value: 45 });
    expect(eos.sent).toEqual([{ address: "/eos/chan/12/param/pan", args: [45] }]);
  });

  it("eos_nudge_wheel nudges intensity when no parameter is given", async () => {
    await tools.get("eos_nudge_wheel")!.handler({ ticks: 5, fine: false });
    expect(eos.sent).toEqual([{ address: "/eos/wheel/level", args: [5] }]);
  });

  it("eos_nudge_wheel nudges a named parameter in coarse mode by default", async () => {
    await tools.get("eos_nudge_wheel")!.handler({ parameter: "pan", ticks: 3, fine: false });
    expect(eos.sent).toEqual([{ address: "/eos/wheel/coarse/pan", args: [3] }]);
  });

  it("eos_nudge_wheel switches to fine mode when requested", async () => {
    await tools.get("eos_nudge_wheel")!.handler({ parameter: "pan", ticks: -1, fine: true });
    expect(eos.sent).toEqual([{ address: "/eos/wheel/fine/pan", args: [-1] }]);
  });

  it("eos_set_fader addresses the bank/fader pair with a 0-1 level", async () => {
    await tools.get("eos_set_fader")!.handler({ bank_index: 1, fader_index: 2, level: 0.5 });
    expect(eos.sent).toEqual([{ address: "/eos/fader/1/2", args: [0.5] }]);
  });

  it("eos_configure_fader_bank omits the page segment when no page is given", async () => {
    await tools.get("eos_configure_fader_bank")!.handler({ bank_index: 1, fader_count: 8 });
    expect(eos.sent).toEqual([{ address: "/eos/fader/1/config/8", args: [] }]);
  });

  it("eos_configure_fader_bank includes the page segment when a page is given", async () => {
    await tools.get("eos_configure_fader_bank")!.handler({ bank_index: 1, fader_count: 8, page: 2 });
    expect(eos.sent).toEqual([{ address: "/eos/fader/1/config/2/8", args: [] }]);
  });
});
