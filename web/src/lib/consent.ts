// ⚠️ MUST stay in sync with bot/src/handlers/consent.ts (bot records the version it shows)
export const PRIVACY_POLICY_VERSION = "2026-11-18.18plus";

type ConsentState = {
  client_consent_given: boolean;
  client_consent_version: string | null;
};

export function hasCurrentConsent(client: ConsentState | null | undefined): boolean {
  return (
    client?.client_consent_given === true &&
    client.client_consent_version === PRIVACY_POLICY_VERSION
  );
}
