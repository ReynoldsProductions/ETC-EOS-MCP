import { describe, it, expect, beforeEach } from "vitest";
import { registerCueTools } from "../../src/tools/cues.js";
import { createFakeServer } from "../helpers/fake-server.js";
import { createFakeEosClient } from "../helpers/fake-eos-client.js";

describe("cue tools", () => {
  let tools: ReturnType<typeof createFakeServer>["tools"];
  let eos: ReturnType<typeof createFakeEosClient>;

  beforeEach(() => {
    const fakeServer = createFakeServer();
    eos = createFakeEosClient();
    registerCueTools(fakeServer.server, eos.client);
    tools = fakeServer.tools;
  });

  it("eos_fire_cue sends a fire command for the given list/number", async () => {
    const result = await tools.get("eos_fire_cue")!.handler({ cue_list: 1, cue_number: "5" });
    expect(eos.sent).toEqual([{ address: "/eos/cue/1/5/fire", args: [] }]);
    expect(result.content[0].text).toContain("cue 1/5");
  });

  it("eos_go targets a specific cue list when given one", async () => {
    await tools.get("eos_go")!.handler({ cue_list: 3 });
    expect(eos.sent).toEqual([{ address: "/eos/go/3", args: [] }]);
  });

  it("eos_go falls back to the default Go key when no list is given", async () => {
    await tools.get("eos_go")!.handler({});
    expect(eos.sent).toEqual([{ address: "/eos/key/go_0", args: [] }]);
  });

  it("eos_record_cue records via the command line", async () => {
    await tools.get("eos_record_cue")!.handler({ cue_list: 1, cue_number: "5" });
    expect(eos.commandLines).toEqual(["Record Cue 1/5 Enter"]);
  });

  it("eos_record_cue also labels the cue when a label is given", async () => {
    await tools.get("eos_record_cue")!.handler({ cue_list: 1, cue_number: "5", label: "Wash Up" });
    expect(eos.commandLines).toEqual([
      "Record Cue 1/5 Enter",
      "Cue 1/5 Label Wash Up Enter",
    ]);
  });

  it("eos_select_cue sends the numeric cue number to the cue list address", async () => {
    await tools.get("eos_select_cue")!.handler({ cue_list: 1, cue_number: "12.5" });
    expect(eos.sent).toEqual([{ address: "/eos/cue/1", args: [12.5] }]);
  });
});
