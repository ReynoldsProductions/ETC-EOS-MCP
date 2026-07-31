import { describe, it, expect, afterEach } from "vitest";
import osc from "osc";
import {
  EosClient,
  resolveUserId,
  DEFAULT_OSC_USER_ID,
} from "../../src/services/eos-client.js";
import type { EosConfig, FeedbackEntry } from "../../src/types.js";
import type { OscMessage, UDPPort } from "osc";

let nextPort = 19100;
/** Grabs a fresh, non-overlapping port pair per test so parallel runs don't collide. */
function allocatePortPair(): { sendPort: number; listenPort: number } {
  const sendPort = nextPort++;
  const listenPort = nextPort++;
  return { sendPort, listenPort };
}

function configFor(
  ports: { sendPort: number; listenPort: number },
  overrides: Partial<EosConfig> = {}
): EosConfig {
  return {
    host: "127.0.0.1",
    sendPort: ports.sendPort,
    listenPort: ports.listenPort,
    userId: DEFAULT_OSC_USER_ID,
    verbose: false,
    ...overrides,
  };
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

/** Wait for a specific address, ignoring the session handshake and any other traffic. */
function waitForAddress(received: OscMessage[], address: string): Promise<OscMessage> {
  return waitFor(() => received.find((m) => m.address === address));
}

describe("resolveUserId", () => {
  it("defaults to a dedicated virtual user", () => {
    expect(resolveUserId(undefined)).toEqual({ userId: DEFAULT_OSC_USER_ID });
    expect(resolveUserId("")).toEqual({ userId: DEFAULT_OSC_USER_ID });
  });

  it("accepts a virtual user in range without warning", () => {
    expect(resolveUserId("12")).toEqual({ userId: 12 });
  });

  it("rejects user 0, which has no command line", () => {
    expect(() => resolveUserId("0")).toThrow(/background user/i);
  });

  it("warns but allows -1, which shares the operator's command line", () => {
    const resolved = resolveUserId("-1");
    expect(resolved.userId).toBe(-1);
    expect(resolved.warning).toMatch(/operator/i);
  });

  it("rejects out-of-range and non-integer values", () => {
    expect(() => resolveUserId("100")).toThrow(/-1, or 1-99/);
    expect(() => resolveUserId("-2")).toThrow(/-1, or 1-99/);
    expect(() => resolveUserId("abc")).toThrow(/whole number/i);
    expect(() => resolveUserId("1.5")).toThrow(/whole number/i);
  });
});

describe("EosClient", () => {
  const opened: Array<{ close(): void }> = [];
  afterEach(() => {
    while (opened.length) opened.pop()!.close();
  });

  it("claims its OSC user as an integer on ready", async () => {
    const ports = allocatePortPair();
    const fakeConsole = await openLoopbackPort(ports.sendPort, ports.listenPort);
    opened.push(fakeConsole);

    const received: OscMessage[] = [];
    fakeConsole.on("message", (msg) => received.push(msg));

    const client = new EosClient(configFor(ports, { userId: 42 }));
    opened.push(client);
    await client.waitUntilReady();

    const msg = await waitForAddress(received, "/eos/user");
    expect(msg.args).toEqual([{ type: "i", value: 42 }]);
  });

  it("sends well-formed OSC messages to the configured host/port", async () => {
    const ports = allocatePortPair();
    // Stand-in for Eos: listens on the port the client sends to.
    const fakeConsole = await openLoopbackPort(ports.sendPort, ports.listenPort);
    opened.push(fakeConsole);

    const received: OscMessage[] = [];
    fakeConsole.on("message", (msg) => received.push(msg));

    const client = new EosClient(configFor(ports));
    opened.push(client);
    await client.waitUntilReady();

    await client.send("/eos/chan/12", [50]);

    const msg = await waitForAddress(received, "/eos/chan/12");
    expect(msg.args).toEqual([{ type: "f", value: 50 }]);
  });

  it("passes explicitly tagged integer args through as integers", async () => {
    const ports = allocatePortPair();
    const fakeConsole = await openLoopbackPort(ports.sendPort, ports.listenPort);
    opened.push(fakeConsole);

    const received: OscMessage[] = [];
    fakeConsole.on("message", (msg) => received.push(msg));

    const client = new EosClient(configFor(ports));
    opened.push(client);
    await client.waitUntilReady();

    await client.send("/eos/subscribe", [{ type: "i", value: 1 }]);

    const msg = await waitForAddress(received, "/eos/subscribe");
    expect(msg.args).toEqual([{ type: "i", value: 1 }]);
  });

  it("rejects addresses that don't start with /eos", async () => {
    const ports = allocatePortPair();
    const client = new EosClient(configFor(ports));
    opened.push(client);
    await client.waitUntilReady();

    await expect(client.send("/foo/bar")).rejects.toThrow(/must start with \/eos/);
  });

  it("sendCommandLine sends only /eos/newcmd, with no command-line clear", async () => {
    const ports = allocatePortPair();
    const fakeConsole = await openLoopbackPort(ports.sendPort, ports.listenPort);
    opened.push(fakeConsole);

    const received: OscMessage[] = [];
    fakeConsole.on("message", (msg) => received.push(msg));

    const client = new EosClient(configFor(ports));
    opened.push(client);
    await client.waitUntilReady();

    await client.sendCommandLine("Record Enter");

    const msg = await waitForAddress(received, "/eos/newcmd");
    expect(msg.args).toEqual([{ type: "s", value: "Record Enter" }]);
    // Our own OSC user makes clearing unnecessary — it must not be sent.
    expect(received.some((m) => m.address === "/eos/key/clear_cmdline")).toBe(false);
  });

  it("sendCommandLine terminates text that doesn't already submit", async () => {
    const ports = allocatePortPair();
    const fakeConsole = await openLoopbackPort(ports.sendPort, ports.listenPort);
    opened.push(fakeConsole);

    const received: OscMessage[] = [];
    fakeConsole.on("message", (msg) => received.push(msg));

    const client = new EosClient(configFor(ports));
    opened.push(client);
    await client.waitUntilReady();

    await client.sendCommandLine("Chan 1 At Full");

    const msg = await waitForAddress(received, "/eos/newcmd");
    expect(msg.args).toEqual([{ type: "s", value: "Chan 1 At Full #" }]);
  });

  it("rejects instead of hanging when the listen port is already bound", async () => {
    const ports = allocatePortPair();

    const first = new EosClient(configFor(ports));
    opened.push(first);
    await first.waitUntilReady();
    expect(first.bound).toBe(true);

    // Same listen port: the bind must fail loudly rather than leaving `ready` pending.
    const second = new EosClient(configFor(ports));
    opened.push(second);

    await expect(second.waitUntilReady()).rejects.toThrow(/Could not bind UDP port/);
    expect(second.bound).toBe(false);
    expect(second.bindError).toBeInstanceOf(Error);
  });

  it("buffers incoming feedback from Eos", async () => {
    const ports = allocatePortPair();
    const client = new EosClient(configFor(ports));
    opened.push(client);
    await client.waitUntilReady();

    // Stand-in for Eos: sends feedback to the port the client listens on.
    const fakeConsole = await openLoopbackPort(ports.sendPort, ports.listenPort);
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
    const ports = allocatePortPair();
    const client = new EosClient(configFor(ports));
    opened.push(client);
    await client.waitUntilReady();

    const fakeConsole = await openLoopbackPort(ports.sendPort, ports.listenPort);
    opened.push(fakeConsole);
    fakeConsole.send({ address: "/eos/out/active/cue", args: [] });
    fakeConsole.send({ address: "/eos/out/cmd", args: [] });

    await waitFor(() => (client.getRecentFeedback(10).length >= 2 ? true : undefined));

    const matches = client.getFeedbackMatching("active/cue");
    expect(matches).toHaveLength(1);
    expect(matches[0].address).toBe("/eos/out/active/cue");
  });

  it("onMessage streams feedback live and stops after unsubscribe", async () => {
    const ports = allocatePortPair();
    const client = new EosClient(configFor(ports));
    opened.push(client);
    await client.waitUntilReady();

    const seen: FeedbackEntry[] = [];
    const unsubscribe = client.onMessage((entry) => seen.push(entry));

    const fakeConsole = await openLoopbackPort(ports.sendPort, ports.listenPort);
    opened.push(fakeConsole);
    fakeConsole.send({ address: "/eos/out/active/cue", args: [] });

    await waitFor(() => seen[0]);
    expect(seen[0].address).toBe("/eos/out/active/cue");

    unsubscribe();
    fakeConsole.send({ address: "/eos/out/cmd", args: [] });
    // Let it arrive at the socket; the listener must not see it.
    await waitFor(() => (client.getRecentFeedback(10).length >= 2 ? true : undefined));
    expect(seen).toHaveLength(1);
  });

  it("keeps working when a feedback listener throws", async () => {
    const ports = allocatePortPair();
    const client = new EosClient(configFor(ports));
    opened.push(client);
    await client.waitUntilReady();

    const seen: FeedbackEntry[] = [];
    client.onMessage(() => {
      throw new Error("bad subscriber");
    });
    client.onMessage((entry) => seen.push(entry));

    const fakeConsole = await openLoopbackPort(ports.sendPort, ports.listenPort);
    opened.push(fakeConsole);
    fakeConsole.send({ address: "/eos/out/active/cue", args: [] });

    await waitFor(() => seen[0]);
    expect(seen[0].address).toBe("/eos/out/active/cue");
  });
});
