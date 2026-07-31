import { describe, it, expect, vi, afterEach } from "vitest";
import { DestructiveActionGuard } from "../../src/services/destructive-guard.js";

describe("DestructiveActionGuard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks when confirm is false", () => {
    const guard = new DestructiveActionGuard();
    const result = guard.check("record", false);
    expect(result).toEqual({ allowed: false, reason: "confirm was not set to true" });
  });

  it("allows a confirmed call outside the rate-limit window", () => {
    const guard = new DestructiveActionGuard(2000);
    expect(guard.check("record", true)).toEqual({ allowed: true });
  });

  it("rate-limits a second confirmed call for the same action within the window", () => {
    vi.useFakeTimers();
    const guard = new DestructiveActionGuard(2000);
    expect(guard.check("record", true).allowed).toBe(true);

    vi.advanceTimersByTime(500);
    const second = guard.check("record", true);
    expect(second.allowed).toBe(false);
    expect(second.reason).toContain("rate limited");
  });

  it("allows again once the rate-limit window has elapsed", () => {
    vi.useFakeTimers();
    const guard = new DestructiveActionGuard(2000);
    expect(guard.check("record", true).allowed).toBe(true);

    vi.advanceTimersByTime(2001);
    expect(guard.check("record", true).allowed).toBe(true);
  });

  it("tracks rate limits independently per action name", () => {
    vi.useFakeTimers();
    const guard = new DestructiveActionGuard(2000);
    expect(guard.check("record", true).allowed).toBe(true);
    expect(guard.check("raw_command", true).allowed).toBe(true);
  });
});
