export interface StartupWarningsInput {
  clientPortalUrl?: string;
  prodamusPayformBaseUrl?: string;
}

export function startupWarnings(cfg: StartupWarningsInput): string[] {
  const warnings: string[] = [];
  if (!cfg.clientPortalUrl?.trim()) {
    warnings.push(
      "[CONFIG] CLIENT_PORTAL_URL is not set: /myweb will reply that the portal is unavailable.",
    );
  }
  if (!cfg.prodamusPayformBaseUrl?.trim()) {
    warnings.push(
      "[CONFIG] PRODAMUS_PAYFORM_BASE_URL is not set: the purchase flow cannot issue payment links.",
    );
  }
  return warnings;
}