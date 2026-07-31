import osc from "osc";
import type { EosConfig, FeedbackEntry } from "../types.js";

const FEEDBACK_BUFFER_SIZE = 200;

/**
 * Thin wrapper around a UDP OSC socket talking to an ETC Eos console
 * (or Nomad/Puck host). All Eos OSC addresses must start with /eos;
 * all messages Eos sends back start with /eos/out.
 *
 * Eos OSC reference: addresses, argument shapes, and defaults below
 * are drawn from ETC's "OSC Eos Control" documentation.
 */
export class EosClient {
  private port: osc.UDPPort;
  private ready: Promise<void>;
  private feedback: FeedbackEntry[] = [];
  private config: EosConfig;

  constructor(config: EosConfig) {
    this.config = config;

    this.port = new osc.UDPPort({
      localAddress: "0.0.0.0",
      localPort: config.listenPort,
      remoteAddress: config.host,
      remotePort: config.sendPort,
      metadata: true,
    });

    this.port.on("message", (msg: { address: string; args: unknown[] }) => {
      this.feedback.push({
        address: msg.address,
        args: msg.args,
        receivedAt: new Date().toISOString(),
      });
      if (this.feedback.length > FEEDBACK_BUFFER_SIZE) {
        this.feedback.shift();
      }
      if (config.verbose) {
        console.error(`[eos <-] ${msg.address} ${JSON.stringify(msg.args)}`);
      }
    });

    this.port.on("error", (err: Error) => {
      console.error("[eos-client] OSC socket error:", err.message);
    });

    this.ready = new Promise((resolve) => {
      this.port.on("ready", () => resolve());
      this.port.open();
    });
  }

  async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  /**
   * Send a raw OSC message to Eos. `address` must start with /eos.
   * `args` are plain JS values (string | number); this wraps them in
   * the {type, value} shape the osc package expects.
   */
  async send(address: string, args: (string | number)[] = []): Promise<void> {
    await this.ready;
    if (!address.startsWith("/eos")) {
      throw new Error(`Eos OSC addresses must start with /eos (got "${address}")`);
    }
    const oscArgs = args.map((a) =>
      typeof a === "number"
        ? { type: "f", value: a }
        : { type: "s", value: a }
    );
    if (this.config.verbose) {
      console.error(`[eos ->] ${address} ${JSON.stringify(args)}`);
    }
    this.port.send({ address, args: oscArgs });
  }

  /** Send raw command-line text to Eos, as if typed on the keypad. */
  async sendCommandLine(text: string): Promise<void> {
    // A prior command left in an unsubmitted/error state (e.g. referencing a
    // cue list that doesn't exist) can sit open on the command line and get
    // silently merged with the next /eos/newcmd text instead of being
    // replaced by it. Explicitly clear first so every call starts fresh.
    // NOTE: /eos/key/clear_cmdline is our best-guess address by naming
    // convention with the other /eos/key/* keys already used in this file —
    // it has not yet been confirmed against real Eos hardware. On the
    // console itself, Backspace (not Escape) is what cleared the stuck
    // command line during testing; re-verify this address works the same
    // way over OSC before relying on it. See README "Known issues".
    await this.send("/eos/key/clear_cmdline");
    // Terminate with "#" or the literal word "Enter" so it submits
    // immediately instead of leaving the command line open.
    const terminated = /[#]$|\bEnter$/i.test(text.trim()) ? text : `${text} #`;
    await this.send("/eos/newcmd", [terminated]);
  }

  /** Return the most recent feedback messages received from Eos, newest last. */
  getRecentFeedback(limit = 50): FeedbackEntry[] {
    return this.feedback.slice(-limit);
  }

  /** Feedback messages whose address contains `substring` (e.g. "active/cue"). */
  getFeedbackMatching(substring: string, limit = 50): FeedbackEntry[] {
    return this.feedback
      .filter((f) => f.address.includes(substring))
      .slice(-limit);
  }

  close(): void {
    this.port.close();
  }
}
