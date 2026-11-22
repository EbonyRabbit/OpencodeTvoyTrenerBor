import { describe, expect, it } from "vitest";
import { ALLOWED_UPDATES, buildWebhookOptions } from "../webhook-config.js";

describe("webhook config", () => {
  it("allows chat member updates for channel join attribution", () => {
    expect(ALLOWED_UPDATES).toEqual(["message", "callback_query", "chat_member"]);
  });

  it("builds webhook options with the configured secret", () => {
    expect(buildWebhookOptions("secret")).toEqual({
      secret_token: "secret",
      allowed_updates: ["message", "callback_query", "chat_member"],
      drop_pending_updates: true,
    });
  });
});
