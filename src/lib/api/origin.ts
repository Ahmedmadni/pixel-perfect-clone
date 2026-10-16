/**
 * Only an interface actually opened from the loopback computer is allowed to
 * receive or send a local runtime bearer token. A hosted Lovable/GitHub Pages
 * preview may display mock content but must never bridge to the owner's PC.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export function isLocalBrowserOrigin(): boolean {
  if (typeof window === "undefined") return false;
  return (window.location.protocol === "http:" || window.location.protocol === "https:") &&
    isLoopbackHostname(window.location.hostname);
}
