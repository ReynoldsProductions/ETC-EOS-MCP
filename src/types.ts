export interface EosConfig {
  /** IP address or hostname of the machine running Eos (the Nomad/Puck host). */
  host: string;
  /** Port Eos is listening on for incoming OSC (Setup > System > Show Control > OSC UDP RX Port). ETC's recommended default is 8000. */
  sendPort: number;
  /** Local port this server listens on for Eos's OSC feedback (must match Eos's OSC UDP TX Port). ETC's recommended default is 8001. */
  listenPort: number;
  /** Log every outgoing OSC message to stderr. Useful while pointed at a test system. */
  verbose: boolean;
}

export interface FeedbackEntry {
  address: string;
  args: unknown[];
  receivedAt: string; // ISO timestamp
}
