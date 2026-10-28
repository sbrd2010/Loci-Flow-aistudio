import { describe, it, expect } from "vitest";
import { deleteFailedText } from "./pages";

// #612: every way a delete can stop before anything is deleted says so.
describe("deleteFailedText", () => {
  it("names a cancelled, blocked or wrong-account sign-in", () => {
    expect(deleteFailedText({ code: "auth/popup-closed-by-user" })).toMatch(/cancelled/);
    expect(deleteFailedText({ code: "auth/cancelled-popup-request" })).toMatch(/cancelled/);
    expect(deleteFailedText(new Error("The user canceled the sign-in flow."))).toMatch(/cancelled/);
    expect(deleteFailedText({ code: "auth/popup-blocked" })).toMatch(/pop-ups/);
    expect(deleteFailedText({ code: "auth/user-mismatch" })).toMatch(/same Google account/);
  });

  it("falls back to a connection message, and always says nothing was deleted", () => {
    for (const err of [{ code: "auth/network-request-failed" }, new Error("network"), null]) {
      expect(deleteFailedText(err)).toMatch(/Nothing was deleted\.$/);
    }
    expect(deleteFailedText(null)).toMatch(/connection/);
  });
});
