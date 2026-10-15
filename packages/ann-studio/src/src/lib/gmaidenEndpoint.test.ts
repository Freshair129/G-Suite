import { describe, expect, it } from "vitest";
import {
  DEFAULT_GMAIDEN_INSTALL_ENDPOINT,
  resolveGmaidenInstallEndpoint,
} from "./gmaidenEndpoint";

describe("G-Maiden install endpoint", () => {
  it("accepts a loopback fixture on a dedicated port", () => {
    expect(resolveGmaidenInstallEndpoint("http://127.0.0.1:38431/announcer/install"))
      .toBe("http://127.0.0.1:38431/announcer/install");
  });

  it("keeps the default endpoint for non-loopback hosts", () => {
    expect(resolveGmaidenInstallEndpoint("http://example.com/announcer/install"))
      .toBe(DEFAULT_GMAIDEN_INSTALL_ENDPOINT);
  });

  it("keeps the default endpoint for other paths or malformed overrides", () => {
    expect(resolveGmaidenInstallEndpoint("http://127.0.0.1:38431/other"))
      .toBe(DEFAULT_GMAIDEN_INSTALL_ENDPOINT);
    expect(resolveGmaidenInstallEndpoint("not a URL"))
      .toBe(DEFAULT_GMAIDEN_INSTALL_ENDPOINT);
  });
});
