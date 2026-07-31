const DEFAULT_MIN_INTERVAL_MS = 2000;

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Gates show-data-destroying Eos actions (Record, raw command line): each
 * call must explicitly opt in via confirm: true, and repeats of the same
 * action are throttled so a runaway loop can't hammer the console.
 */
export class DestructiveActionGuard {
  private lastRunAt = new Map<string, number>();

  constructor(private readonly minIntervalMs = DEFAULT_MIN_INTERVAL_MS) {}

  check(action: string, confirm: boolean): GuardResult {
    if (!confirm) {
      return { allowed: false, reason: "confirm was not set to true" };
    }
    const now = Date.now();
    const last = this.lastRunAt.get(action);
    if (last !== undefined && now - last < this.minIntervalMs) {
      const waitMs = this.minIntervalMs - (now - last);
      return { allowed: false, reason: `rate limited, wait ${waitMs}ms before repeating this action` };
    }
    this.lastRunAt.set(action, now);
    return { allowed: true };
  }
}
