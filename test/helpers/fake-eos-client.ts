import type { EosClient } from "../../src/services/eos-client.js";
import type { FeedbackEntry } from "../../src/types.js";

export interface SentMessage {
  address: string;
  args: (string | number)[];
}

/** Records calls instead of touching a real UDP socket, for testing tool handlers. */
export function createFakeEosClient() {
  const sent: SentMessage[] = [];
  const commandLines: string[] = [];
  let feedback: FeedbackEntry[] = [];

  const fake = {
    async send(address: string, args: (string | number)[] = []) {
      sent.push({ address, args });
    },
    async sendCommandLine(text: string) {
      commandLines.push(text);
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
  };
}
