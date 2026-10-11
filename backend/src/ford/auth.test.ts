import { describe, expect, it } from "vitest";
import { isExpired, loginUrl } from "./auth.js";

const ford = {
  clientId: "my-client",
  clientSecret: "secret",
  redirectUri: "http://localhost:8080/callback",
  authUrl: "https://example.test/auth",
  tokenUrl: "https://example.test/token",
  apiBase: "https://example.test/api",
};

describe("auth", () => {
  it("baut die Login-Adresse ohne das Secret", () => {
    const url = new URL(loginUrl(ford, "abc"));
    expect(url.searchParams.get("client_id")).toBe("my-client");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("redirect_uri")).toBe(ford.redirectUri);
    expect(url.toString()).not.toContain("secret");
  });

  it("erneuert das Token eine Minute vor Ablauf", () => {
    const tokens = { access_token: "a", refresh_token: "r", expires_in: 1200, obtained_at: 0 };
    expect(isExpired(tokens, 1_000_000)).toBe(false);
    expect(isExpired(tokens, 1_141_000)).toBe(true);
  });
});
