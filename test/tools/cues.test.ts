import { describe, it, expect, beforeEach } from "vitest";
import { registerCueTools } from "../../src/tools/cues.js";
import { createFakeServer } from "../helpers/fake-server.js";
import { createFakeEosClient } from "../helpers/fake-eos-client.js";
import { DestructiveActionGuard } from "../../src/services/destructive-guard.js";

describe("cue tools", () => {
  let tools: ReturnType<typeof createFakeServer>["tools"];
  let eos: ReturnType<typeof createFakeEosClient>;

  beforeEach(() => {
    const fakeServer = createFakeServer();
    eos = createFakeEosClient();
    registerCueTools(fakeServer.server, eos.client, new DestructiveActionGuard());
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

  it("eos_record_cue previews instead of executing when confirm is not set", async () => {
    const result = await tools.get("eos_record_cue")!.handler({ cue_list: 1, cue_number: "5" });
    expect(eos.commandLines).toEqual([]);
    expect(result.content[0].text).toContain("Not executed");
    expect(result.content[0].text).toContain("Record Cue 1/5");
  });

  it("eos_record_cue records via the command line when confirmed", async () => {
    await tools.get("eos_record_cue")!.handler({ cue_list: 1, cue_number: "5", confirm: true });
    // Spaces around the slash are mandatory — Eos rejects "Cue 1/5" as out of range.
    expect(eos.commandLines).toEqual(["Record Cue 1 / 5 Enter"]);
  });

  it("eos_record_cue also labels the cue when a label is given", async () => {
    await tools.get("eos_record_cue")!.handler({ cue_list: 1, cue_number: "5", label: "Wash Up", confirm: true });
    expect(eos.commandLines).toEqual([
      "Record Cue 1 / 5 Enter",
      "Cue 1 / 5 Label Wash Up Enter",
    ]);
  });

  it("eos_record_cue surfaces a console error instead of claiming success", async () => {
    eos.setEcho("LIVE: Record Cue 99 /  Error: Number Out Of Range");
    const result = await tools
      .get("eos_record_cue")!
      .handler({ cue_list: 99, cue_number: "1", confirm: true });
    expect(result.content[0].text).toContain("Eos rejected the record");
    expect(result.content[0].text).toContain("does not create cue lists automatically");
  });

  it("eos_record_cue reports the console echo on success", async () => {
    eos.setEcho("LIVE: Cue  99 / 1 : Record Cue 99 / 1 #");
    const result = await tools
      .get("eos_record_cue")!
      .handler({ cue_list: 99, cue_number: "1", confirm: true });
    expect(result.content[0].text).toContain("Recorded cue 99/1");
    expect(result.content[0].text).toContain("Console reported");
  });

  it("eos_select_cue sends the cue number to the cue list address", async () => {
    await tools.get("eos_select_cue")!.handler({ cue_list: 1, cue_number: "12.5" });
    expect(eos.sent).toEqual([{ address: "/eos/cue/1", args: ["12.5"] }]);
  });

  it("eos_select_cue keeps non-numeric cue numbers intact instead of sending NaN", async () => {
    await tools.get("eos_select_cue")!.handler({ cue_list: 1, cue_number: "5A" });
    expect(eos.sent).toEqual([{ address: "/eos/cue/1", args: ["5A"] }]);
  });
});
