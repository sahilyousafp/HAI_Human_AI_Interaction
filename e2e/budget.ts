/**
 * Timing budgets are for a quiet reference laptop. A shared CI runner (CPU only, other jobs beside it) is several times
 * slower, so a test that measures time takes its limit from here: `allow(local, ci)`.
 */
export const onCi = Boolean(process.env.CI);

export const allow = (local: number, ci: number): number => (onCi ? ci : local);
