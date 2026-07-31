import osc from "osc";
import type {
  EosConfig,
  FeedbackEntry,
  OscArg,
  TaggedOscArg,
} from "../types.js";

const FEEDBACK_BUFFER_SIZE = 200;

/** Eos OSC user claimed by default: a dedicated virtual user with its own command line. */
export const DEFAULT_OSC_USER_ID = 99;

export interface ResolvedUserId {
  userId: number;
  /** Non-fatal advice to surface at startup, if any. */
  warning?: string;
}

/**
 * Validate an EOS_USER_ID value.
 *
 * Eos user IDs: 0 is the background user (no command line at all), -1 is whoever is
 * currently at the desk, and 1-99 are virtual users that each get their own command
 * line. We default to a dedicated virtual user so our commands can never merge into a
 * half-typed command on the console operator's line.
 */
export function resolveUserId(raw: string | undefined): ResolvedUserId {
  if (raw === undefined || raw.trim() === "") {
    return { userId: DEFAULT_OSC_USER_ID };
  }

  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed)) {
    throw new Error(`EOS_USER_ID must be a whole number (got "${raw}").`);
  }

  if (parsed === 0) {
    throw new Error(
      "EOS_USER_ID 0 is the Eos background user, which has no command line — " +
        "eos_record_cue and eos_send_raw_command would silently do nothing. " +
        "Use 1-99 for a dedicated user, or -1 to share the console operator's."
    );
  }

  if (parsed < -1 || parsed > 99) {
    throw new Error(`EOS_USER_ID must be -1, or 1-99 (got ${parsed}).`);
  }

  if (parsed === -1) {
    return {
      userId: parsed,
      warning:
        "EOS_USER_ID -1 shares the console operator's command line. A command sent " +
        "while they are mid-entry can merge with theirs. Prefer a dedicated user (1-99).",
    };
  }

  return { userId: parsed };
}

/** Give an outgoing argument its OSC wire type, defaulting bare values the way Eos expects. */
function toOscArgument(arg: OscArg): TaggedOscArg {
  if (typeof arg === "number") return { type: "f", value: arg };
  if (typeof arg === "string") return { type: "s", value: arg };
  return arg;
}

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
  /** Resolves when the socket is bound; rejects if binding fails. */
  private socketReady: Promise<void>;
  /** Resolves once the socket is bound AND the OSC session handshake has been sent. */
  private ready: Promise<void>;
  private feedback: FeedbackEntry[] = [];
  private listeners = new Set<(entry: FeedbackEntry) => void>();
  private config: EosConfig;

  /** True once the UDP socket has successfully bound. */
  bound = false;
  /** The error that prevented binding, if binding failed. */
  bindError: Error | null = null;

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
      const entry: FeedbackEntry = {
        address: msg.address,
        args: msg.args,
        receivedAt: new Date().toISOString(),
      };

      this.feedback.push(entry);
      if (this.feedback.length > FEEDBACK_BUFFER_SIZE) {
        this.feedback.shift();
      }
      if (config.verbose) {
        console.error(`[eos <-] ${msg.address} ${JSON.stringify(msg.args)}`);
      }

      this.notify(entry);
    });

    this.socketReady = new Promise<void>((resolve, reject) => {
      this.port.on("ready", () => {
        this.bound = true;
        resolve();
      });

      this.port.on("error", (err: Error) => {
        // Once we're bound, a socket error is transient (e.g. a failed send) and
        // must not tear down a working client. Before that, it means we never got
        // the port — surface it instead of leaving `ready` pending forever.
        if (this.bound) {
          console.error("[eos-client] OSC socket error:", err.message);
          return;
        }
        this.bindError = err;
        reject(
          new Error(
            `Could not bind UDP port ${config.listenPort} for Eos feedback: ${err.message}. ` +
              "Another instance of this server may already be running, or set EOS_LISTEN_PORT to a free port."
          )
        );
      });

      this.port.open();
    });

    this.ready = this.socketReady.then(() => this.handshake());
    // Mark the rejection handled so a failed bind doesn't trip an unhandled rejection
    // warning; callers still see it via waitUntilReady() or any send().
    this.ready.catch(() => undefined);
  }

  /**
   * Claim our OSC user on the console. Doing this first means every subsequent
   * command-line message lands on our own command line rather than the operator's.
   */
  private async handshake(): Promise<void> {
    this.sendNow("/eos/user", [{ type: "i", value: this.config.userId }]);
  }

  async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  /**
   * Send a raw OSC message to Eos. `address` must start with /eos.
   * Bare numbers are sent as floats and bare strings as strings; pass an explicit
   * {type, value} argument where Eos requires a specific wire type.
   */
  async send(address: string, args: OscArg[] = []): Promise<void> {
    await this.ready;
    this.sendNow(address, args);
  }

  /** Send without waiting on readiness — used by the handshake, which runs as part of it. */
  private sendNow(address: string, args: OscArg[]): void {
    if (!address.startsWith("/eos")) {
      throw new Error(`Eos OSC addresses must start with /eos (got "${address}")`);
    }
    const oscArgs = args.map(toOscArgument);
    if (this.config.verbose) {
      console.error(`[eos ->] ${address} ${JSON.stringify(args)}`);
    }
    this.port.send({ address, args: oscArgs });
  }

  /** Send raw command-line text to Eos, as if typed on the keypad. */
  async sendCommandLine(text: string): Promise<void> {
    // No need to clear the command line first: we run as our own OSC user (see
    // handshake), so there is no operator text to collide with, and /eos/newcmd
    // replaces our line rather than appending to it.
    // Terminate with "#" or the literal word "Enter" so it submits
    // immediately instead of leaving the command line open.
    const terminated = /[#]$|\bEnter$/i.test(text.trim()) ? text : `${text} #`;
    await this.send("/eos/newcmd", [terminated]);
  }

  /** The most recent command-line echo for our OSC user, or "" if none seen. */
  lastCommandEcho(): string {
    const entry = this.getFeedbackMatching(`/eos/out/user/${this.config.userId}/cmd`, 5).pop();
    if (!entry) return "";
    const first = entry.args[0] as { value?: unknown } | string | undefined;
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && typeof first.value === "string") return first.value;
    return "";
  }

  /**
   * Send command-line text, then answer Eos's "Please Confirm" prompt if it appears.
   *
   * Destructive command-line operations (recording over an existing cue, deleting)
   * don't execute immediately — Eos parks them awaiting a second Enter. Without
   * that second press the command silently does nothing at all.
   *
   * Eos never acknowledges commands synchronously, so this waits `settleMs` for the
   * echo to arrive before deciding. Returns what happened for the caller to report.
   */
  async sendCommandLineConfirming(
    text: string,
    settleMs = 900
  ): Promise<{ echo: string; confirmed: boolean }> {
    await this.sendCommandLine(text);
    await new Promise((resolve) => setTimeout(resolve, settleMs));

    const echo = this.lastCommandEcho();
    if (!/please confirm/i.test(echo)) {
      return { echo, confirmed: false };
    }

    await this.send("/eos/key/enter");
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    return { echo: this.lastCommandEcho(), confirmed: true };
  }

  /**
   * Subscribe to every message Eos sends us, as it arrives. Returns an unsubscribe
   * function. The feedback ring buffer is unaffected — this is for consumers that
   * need a live stream rather than a snapshot.
   */
  onMessage(listener: (entry: FeedbackEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(entry: FeedbackEntry): void {
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (error) {
        // One bad subscriber must not stop the others or kill the socket handler.
        console.error("[eos-client] feedback listener threw:", error);
      }
    }
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
    this.listeners.clear();
    this.port.close();
  }
}
