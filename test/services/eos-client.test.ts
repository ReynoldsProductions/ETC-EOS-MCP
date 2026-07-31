import { describe, it, expect, afterEach } from "vitest";
import osc from "osc";
import { EosClient } from "../../src/services/eos-client.js";
import type { OscMessage, UDPPort } from "osc";

let nextPort = 19100;
/** Grabs a fresh, non-overlapping port pair per test so parallel runs don't collide. */
function allocatePortPair(): { sendPort: number; listenPort: number } {
  const sendPort = nextPort++;
  const listenPort = nextPort++;
  return { sendPort, listenPort };
}

function openLoopbackPort(localPort: number, remotePort: number): Promise<UDPPort> {
  return new Promise((resolve) => {
    const port = new osc.UDPPort({
      localAddress: "127.0.0.1",
      localPort,
      remoteAddress: "127.0.0.1",
      remotePort,
      metadata: true,
    });
    port.on("ready", () => resolve(port));
    port.open();
  });
}

function waitFor<T>(getValue: () => T | undefined, timeoutMs = 1000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const value = getValue();
      if (value !== undefined) return resolve(value);
      if (Date.now() - start > timeoutMs) return reject(new Error("timed out waiting for value"));
      setTimeout(check, 10);
    };
    check();
  });
}

describe("EosClient", () => {
  const opened: Array<{ close(): void }> = [];
  afterEach(() => {
    while (opened.length) opened.pop()!.close();
  });

  it("sends well-formed OSC messages to the configured host/port", async () => {
    const { sendPort, listenPort } = allocatePortPair();
    // Stand-in for Eos: listens on the port the client sends to.
    const fakeConsole = await openLoopbackPort(sendPort, listenPort);
    opened.push(fakeConsole);

    const received: OscMessage[] = [];
    fakeConsole.on("message", (msg) => received.push(msg));

    const client = new EosClient({ host: "127.0.0.1", sendPort, listenPort, verbose: false });
    opened.push(client);
    await client.waitUntilReady();

    await client.send("/eos/chan/12", [50]);

    const msg = await waitFor(() => received[0]);
    expect(msg.address).toBe("/eos/chan/12");
    expect(msg.args).toEqual([{ type: "f", value: 50 }]);
  });

  it("rejects addresses that don't start with /eos", async () => {
    const { sendPort, listenPort } = allocatePortPair();
    const client = new EosClient({ host: "127.0.0.1", sendPort, listenPort, verbose: false });
    opened.push(client);
    await client.waitUntilReady();

    await expect(client.send("/foo/bar")).rejects.toThrow(/must start with \/eos/);
  });

  it("buffers incoming feedback from Eos", async () => {
    const { sendPort, listenPort } = allocatePortPair();
    const client = new EosClient({ host: "127.0.0.1", sendPort, listenPort, verbose: false });
    opened.push(client);
    await client.waitUntilReady();

    // Stand-in for Eos: sends feedback to the port the client listens on.
    const fakeConsole = await openLoopbackPort(sendPort, listenPort);
    opened.push(fakeConsole);
    fakeConsole.send({
      address: "/eos/out/active/cue",
      args: [{ type: "s", value: "1/5" }],
    });

    const entry = await waitFor(() => client.getRecentFeedback(1)[0]);
    expect(entry.address).toBe("/eos/out/active/cue");
    expect(entry.args).toEqual([{ type: "s", value: "1/5" }]);
  });

  it("getFeedbackMatching filters buffered feedback by address substring", async () => {
    const { sendPort, listenPort } = allocatePortPair();
    const client = new EosClient({ host: "127.0.0.1", sendPort, listenPort, verbose: false });
    opened.push(client);
    await client.waitUntilReady();

    const fakeConsole = await openLoopbackPort(sendPort, listenPort);
    opened.push(fakeConsole);
    fakeConsole.send({ address: "/eos/out/active/cue", args: [] });
    fakeConsole.send({ address: "/eos/out/cmd", args: [] });

    await waitFor(() => (client.getRecentFeedback(10).length >= 2 ? true : undefined));

    const matches = client.getFeedbackMatching("active/cue");
    expect(matches).toHaveLength(1);
    expect(matches[0].address).toBe("/eos/out/active/cue");
  });
});
