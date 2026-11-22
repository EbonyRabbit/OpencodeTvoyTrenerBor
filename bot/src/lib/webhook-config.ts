export const ALLOWED_UPDATES = ["message", "callback_query", "chat_member"] as const;

export function buildWebhookOptions(secretToken: string) {
  return {
    secret_token: secretToken,
    allowed_updates: [...ALLOWED_UPDATES],
    drop_pending_updates: true,
  };
}
