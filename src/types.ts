/** OSC argument type tags this server emits. */
export type OscArgType = "i" | "f" | "s";

/** An OSC argument with an explicit wire type. */
export interface TaggedOscArg {
  type: OscArgType;
  value: number | string;
}

/**
 * An outgoing OSC argument. Bare numbers are sent as floats and bare strings as
 * strings, which is what Eos wants nearly everywhere. Pass a TaggedOscArg when the
 * wire type matters — /eos/user, /eos/subscribe and /eos/filter/* are all documented
 * as taking integers.
 */
export type OscArg = number | string | TaggedOscArg;

export interface EosConfig {
  /** IP address or hostname of the machine running Eos (the Nomad/Puck host). */
  host: string;
  /** Port Eos is listening on for incoming OSC (Setup > System > Show Control > OSC UDP RX Port). ETC's recommended default is 8000. */
  sendPort: number;
  /** Local port this server listens on for Eos's OSC feedback (must match Eos's OSC UDP TX Port). ETC's recommended default is 8001. */
  listenPort: number;
  /**
   * OSC user ID to claim on the console. 1-99 gives us our own command line, isolated
   * from the console operator's. -1 means "whoever is at the desk" and reintroduces
   * command-line collisions. 0 is the background user, which has no command line at
   * all and is rejected — see resolveUserId in services/eos-client.ts.
   */
  userId: number;
  /** Log every outgoing OSC message to stderr. Useful while pointed at a test system. */
  verbose: boolean;
}

export interface FeedbackEntry {
  address: string;
  args: unknown[];
  receivedAt: string; // ISO timestamp
}
