/**
 * Wall-clock budgets in the test suite guard against algorithmic blowup, not
 * absolute speed. They are hardware sensitive: a two-core CI runner takes
 * roughly four times as long as a developer machine for the same work, so a
 * budget tuned locally fails there for no useful reason.
 *
 * Express budgets as the developer-machine figure and scale them here. Override
 * with XDRAW_BUDGET_SCALE when profiling or running on unusual hardware.
 */
export function budgetMs(developerMs: number): number {
  const raw = process.env.XDRAW_BUDGET_SCALE ?? (process.env.CI ? "6" : "1");
  const scale = Number.parseFloat(raw);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`XDRAW_BUDGET_SCALE must be a positive number, received '${raw}'`);
  }
  return developerMs * scale;
}
