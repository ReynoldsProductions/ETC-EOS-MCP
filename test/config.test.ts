import { describe, it, expect } from "vitest";
import { loadConfig, resolvePort } from "../src/config.js";

describe("resolvePort", () => {
  it("falls back to the default when the variable is unset", () => {
    expect(resolvePort(undefined, "EOS_SEND_PORT", 8000)).toBe(8000);
  });

  it("accepts a valid port number", () => {
    expect(resolvePort("9000", "EOS_SEND_PORT", 8000)).toBe(9000);
  });

  it("tolerates surrounding whitespace", () => {
    expect(resolvePort("  9000  ", "EOS_SEND_PORT", 8000)).toBe(9000);
  });

  it("rejects a non-numeric value instead of passing NaN to the socket", () => {
    expect(() => resolvePort("abc", "EOS_SEND_PORT", 8000)).toThrow(
      /EOS_SEND_PORT must be a whole number/
    );
  });

  it("rejects an empty value instead of silently binding port 0", () => {
    // Number("") is 0, and ?? does not catch "" — an empty EOS_LISTEN_PORT used to
    // hand port 0 to the socket, which makes the OS pick a random port that Eos's
    // configured TX port will never match.
    expect(() => resolvePort("", "EOS_LISTEN_PORT", 8001)).toThrow(
      /EOS_LISTEN_PORT must be a whole number/
    );
  });

  it("rejects a fractional port", () => {
    expect(() => resolvePort("80.5", "EOS_SEND_PORT", 8000)).toThrow(
      /EOS_SEND_PORT must be a whole number/
    );
  });

  it("rejects port 0, which asks the OS for an arbitrary port", () => {
    expect(() => resolvePort("0", "EOS_LISTEN_PORT", 8001)).toThrow(
      /EOS_LISTEN_PORT must be between 1 and 65535/
    );
  });

  it("rejects a port above the 16-bit range", () => {
    expect(() => resolvePort("65536", "EOS_SEND_PORT", 8000)).toThrow(
      /EOS_SEND_PORT must be between 1 and 65535/
    );
  });

  it("accepts the highest valid port", () => {
    expect(resolvePort("65535", "EOS_SEND_PORT", 8000)).toBe(65535);
  });

  it("rejects a negative port", () => {
    expect(() => resolvePort("-1", "EOS_SEND_PORT", 8000)).toThrow(
      /EOS_SEND_PORT must be between 1 and 65535/
    );
  });

  it("names the offending variable so the operator knows which one to fix", () => {
    expect(() => resolvePort("nope", "EOS_LISTEN_PORT", 8001)).toThrow(/"nope"/);
  });
});

describe("loadConfig", () => {
  it("uses ETC's recommended defaults when only the host is set", () => {
    const config = loadConfig({ EOS_HOST: "192.168.1.50" });
    expect(config).toEqual({
      host: "192.168.1.50",
      sendPort: 8000,
      listenPort: 8001,
      userId: 99,
      verbose: false,
    });
  });

  it("reads both ports from the environment", () => {
    const config = loadConfig({
      EOS_HOST: "eos.local",
      EOS_SEND_PORT: "9000",
      EOS_LISTEN_PORT: "9001",
    });
    expect(config.sendPort).toBe(9000);
    expect(config.listenPort).toBe(9001);
  });

  it("throws when EOS_HOST is missing", () => {
    expect(() => loadConfig({})).toThrow(/EOS_HOST/);
  });

  it("throws when EOS_HOST is blank rather than binding to nothing", () => {
    expect(() => loadConfig({ EOS_HOST: "   " })).toThrow(/EOS_HOST/);
  });

  it("propagates an invalid send port", () => {
    expect(() => loadConfig({ EOS_HOST: "eos.local", EOS_SEND_PORT: "abc" })).toThrow(
      /EOS_SEND_PORT/
    );
  });

  it("propagates an invalid listen port", () => {
    expect(() => loadConfig({ EOS_HOST: "eos.local", EOS_LISTEN_PORT: "abc" })).toThrow(
      /EOS_LISTEN_PORT/
    );
  });

  it("propagates an invalid EOS_USER_ID", () => {
    expect(() => loadConfig({ EOS_HOST: "eos.local", EOS_USER_ID: "0" })).toThrow(
      /background user/
    );
  });

  it("returns the operator-shared-user warning rather than swallowing it", () => {
    const config = loadConfig({ EOS_HOST: "eos.local", EOS_USER_ID: "-1" });
    expect(config.userId).toBe(-1);
    expect(config.warning).toMatch(/shares the console operator's command line/);
  });

  it("leaves warning undefined for a dedicated virtual user", () => {
    const config = loadConfig({ EOS_HOST: "eos.local", EOS_USER_ID: "42" });
    expect(config.userId).toBe(42);
    expect(config.warning).toBeUndefined();
  });

  it("enables verbose only for exactly \"1\"", () => {
    expect(loadConfig({ EOS_HOST: "h", EOS_VERBOSE: "1" }).verbose).toBe(true);
    expect(loadConfig({ EOS_HOST: "h", EOS_VERBOSE: "true" }).verbose).toBe(false);
    expect(loadConfig({ EOS_HOST: "h" }).verbose).toBe(false);
  });

  it("trims the host so a stray space doesn't become part of the address", () => {
    expect(loadConfig({ EOS_HOST: "  192.168.1.50  " }).host).toBe("192.168.1.50");
  });
});
