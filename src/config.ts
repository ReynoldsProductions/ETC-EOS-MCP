import { resolveUserId } from "./services/eos-client.js";
import type { EosConfig } from "./types.js";

/** ETC's recommended defaults: Eos receives OSC on 8000 and transmits on 8001. */
const DEFAULT_SEND_PORT = 8000;
const DEFAULT_LISTEN_PORT = 8001;

export interface LoadedConfig extends EosConfig {
  /** Non-fatal advice to surface at startup, if any. */
  warning?: string;
}

export type Env = Record<string, string | undefined>;

/**
 * Parse a UDP port from the environment, falling back to `fallback` when unset.
 *
 * Validated rather than coerced: `Number("abc")` is NaN and `Number("")` is 0, and
 * both used to reach the socket unchallenged. A NaN port throws deep inside dgram
 * with no mention of which variable caused it, and port 0 makes the OS hand out an
 * arbitrary free port — the server then binds successfully, logs a healthy-looking
 * startup line, and never receives a single message, because Eos is transmitting to
 * the port the operator actually configured. Failing loudly here is the only way
 * that mistake is visible.
 */
export function resolvePort(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback;

  const trimmed = raw.trim();
  const parsed = Number(trimmed);
  // Number("") is 0, so the empty string has to be rejected explicitly — `??` above
  // only catches undefined, not a variable that is set but blank.
  if (trimmed === "" || !Number.isInteger(parsed)) {
    throw new Error(`${name} must be a whole number (got "${raw}").`);
  }
  if (parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be between 1 and 65535 (got ${parsed}).`);
  }
  return parsed;
}

/**
 * Build the server's configuration from environment variables.
 *
 * Throws on any invalid value rather than exiting, so the caller owns the process
 * and this stays testable; index.ts catches and exits 1. Same contract as
 * resolveUserId, which this delegates to for EOS_USER_ID.
 */
export function loadConfig(env: Env = process.env): LoadedConfig {
  const host = env.EOS_HOST?.trim();
  if (!host) {
    throw new Error(
      "Missing EOS_HOST env var — set it to the IP or hostname of the machine running Eos (the Nomad/Puck host)."
    );
  }

  const resolved = resolveUserId(env.EOS_USER_ID);

  return {
    host,
    sendPort: resolvePort(env.EOS_SEND_PORT, "EOS_SEND_PORT", DEFAULT_SEND_PORT),
    listenPort: resolvePort(env.EOS_LISTEN_PORT, "EOS_LISTEN_PORT", DEFAULT_LISTEN_PORT),
    userId: resolved.userId,
    verbose: env.EOS_VERBOSE === "1",
    warning: resolved.warning,
  };
}
