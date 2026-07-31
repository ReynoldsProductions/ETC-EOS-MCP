import type { EosClient } from "../../src/services/eos-client.js";
import type { FeedbackEntry, OscArg } from "../../src/types.js";

export interface SentMessage {
  address: string;
  args: OscArg[];
}

/** Records calls instead of touching a real UDP socket, for testing tool handlers. */
export function createFakeEosClient() {
  const sent: SentMessage[] = [];
  const commandLines: string[] = [];
  let feedback: FeedbackEntry[] = [];
  let nextEcho = "";

  const fake = {
    async send(address: string, args: OscArg[] = []) {
      sent.push({ address, args });
    },
    async sendCommandLine(text: string) {
      commandLines.push(text);
    },
    async sendCommandLineConfirming(text: string) {
      commandLines.push(text);
      return { echo: nextEcho, confirmed: false };
    },
    lastCommandEcho() {
      return nextEcho;
    },
    getRecentFeedback(limit = 50) {
      return feedback.slice(-limit);
    },
    getFeedbackMatching(substring: string, limit = 50) {
      return feedback.filter((f) => f.address.includes(substring)).slice(-limit);
    },
    async waitUntilReady() {},
    close() {},
  };

  return {
    client: fake as unknown as EosClient,
    sent,
    commandLines,
    setFeedback: (entries: FeedbackEntry[]) => {
      feedback = entries;
    },
    /** Simulate what the console's command line reports back. */
    setEcho: (echo: string) => {
      nextEcho = echo;
    },
  };
}
