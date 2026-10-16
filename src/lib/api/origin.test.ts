import { describe, expect, it } from "vitest";
import { isLoopbackHostname } from "./origin";

describe("local runtime access is confined to loopback browser origins", () => {
  it.each(["localhost", "LOCALHOST", "localhost.", "127.0.0.1", "::1", "[::1]"])(
    "accepts actual local hostname %s", (hostname) => {
      expect(isLoopbackHostname(hostname)).toBe(true);
    },
  );
  it.each([
    "id-preview--xyz.lovable.app", "my-project.lovable.app",
    "github.io", "127.0.0.1.evil.example", "localhost.evil.example",
    "192.168.1.5", "0.0.0.0", "example.org", "",
  ])("blocks hosted or LAN origin %s", (hostname) => {
    expect(isLoopbackHostname(hostname)).toBe(false);
  });
});
