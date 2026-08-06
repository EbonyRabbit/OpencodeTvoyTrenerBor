export interface StartupWarningsInput {
  clientPortalUrl?: string;
  paymentBaseUrl?: string;
}

export function startupWarnings(cfg: StartupWarningsInput): string[] {
  const warnings: string[] = [];
  if (!cfg.clientPortalUrl?.trim()) {
    warnings.push(
      "[CONFIG] CLIENT_PORTAL_URL is not set: /myweb will reply that the portal is unavailable.",
    );
  }
  if (!cfg.paymentBaseUrl?.trim()) {
    warnings.push("[CONFIG] PAYMENT_BASE_URL is not set: \"Buy\" buttons in /programs are hidden.");
  }
  return warnings;
}
