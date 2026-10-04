/**
 * In-memory freemium usage tracking for the Free plan.
 *
 * Quota: FREE_MONTHLY_LIMIT estimate_tax calls per calendar month (UTC),
 * default 10. Pro subscribers get unlimited estimates (enforced by the
 * marketplace; this gate is the in-code backstop).
 */

const usageByMonth = new Map<string, number>();

function currentMonthKey(): string {
  // YYYY-MM in UTC.
  return new Date().toISOString().slice(0, 7);
}

export function freeMonthlyLimit(): number {
  const raw = process.env.FREE_MONTHLY_LIMIT;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10;
}

export interface QuotaCheck {
  allowed: boolean;
  /** Present when !allowed. */
  message?: string;
  used: number;
  limit: number;
}

/**
 * Check the monthly quota and consume one estimate when allowed.
 * Returns allowed=false (without consuming) once the limit is reached.
 */
export function checkAndConsumeEstimate(): QuotaCheck {
  const limit = freeMonthlyLimit();
  const key = currentMonthKey();
  const used = usageByMonth.get(key) ?? 0;

  if (used >= limit) {
    return {
      allowed: false,
      message: `Free quota exceeded (${limit} estimates/month). Subscribe to Pro for unlimited access.`,
      used,
      limit,
    };
  }

  // Prune stale months so the map never grows unboundedly.
  for (const k of usageByMonth.keys()) {
    if (k !== key) usageByMonth.delete(k);
  }
  usageByMonth.set(key, used + 1);
  return { allowed: true, used: used + 1, limit };
}

/** For tests: reset in-memory counters. */
export function resetUsage(): void {
  usageByMonth.clear();
}
