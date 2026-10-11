import { describe, expect, it } from "vitest";
import { errorMessage } from "./client.js";

describe("errorMessage", () => {
  it("liest die Meldung aus Fords Fehler-JSON", async () => {
    const res = new Response(JSON.stringify({ error: 403, message: "Forbidden", traceId: "abc" }), { status: 403 });
    expect(await errorMessage(res)).toBe("Forbidden (traceId abc)");
  });

  it("liefert null bei einer HTML-Fehlerseite", async () => {
    expect(await errorMessage(new Response("<html>nope</html>", { status: 401 }))).toBeNull();
  });
});
