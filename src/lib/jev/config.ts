export function isAdminMode(): boolean {
  return process.env.ADMIN_MODE === '1' || (process.env.ADMIN_MODE !== '0' && process.env.VERCEL !== '1');
}

export function watchConfig() {
  return {
    population: Math.max(10, Math.min(10_000, Math.floor(Number(process.env.SPECTATOR_POPULATION) || 5000))),
    detailedGuests: Math.max(10, Math.min(1000, Math.floor(Number(process.env.WATCH_DETAILED_GUESTS) || 100))),
    decisionIntervalMs: Math.max(100, Math.min(60_000, Number(process.env.DECISION_INTERVAL_MS) || 5000)),
    dailyBudget: Math.max(0, Math.min(5, Number(process.env.WATCH_DAILY_BUDGET ?? 5) || 0)),
  };
}
