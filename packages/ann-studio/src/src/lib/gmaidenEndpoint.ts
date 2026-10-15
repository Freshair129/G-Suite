export const DEFAULT_GMAIDEN_INSTALL_ENDPOINT = "http://127.0.0.1:3000/announcer/install";

export function resolveGmaidenInstallEndpoint(override: string | undefined): string {
  if (!override?.trim()) return DEFAULT_GMAIDEN_INSTALL_ENDPOINT;
  try {
    const endpoint = new URL(override.trim());
    if (
      endpoint.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]", "::1"].includes(endpoint.hostname.toLowerCase()) &&
      endpoint.pathname === "/announcer/install" &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash
    ) {
      return endpoint.toString();
    }
  } catch {
    // Invalid build-time overrides fall back to the local G-Maiden endpoint.
  }
  return DEFAULT_GMAIDEN_INSTALL_ENDPOINT;
}

/** The override exists for local acceptance fixtures; only loopback URLs are allowed. */
export const GMAIDEN_INSTALL_ENDPOINT = resolveGmaidenInstallEndpoint(
  import.meta.env.VITE_GMAIDEN_INSTALL_ENDPOINT,
);
