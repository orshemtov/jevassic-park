import { afterEach, expect, it, vi } from 'vitest';
import { watchConfig } from './config';
afterEach(() => vi.unstubAllEnvs());
it('defaults to a full park with a bounded detailed simulation', () => {
  vi.stubEnv('SPECTATOR_POPULATION', '');
  vi.stubEnv('WATCH_DETAILED_GUESTS', '');
  expect(watchConfig()).toMatchObject({ population: 5000, detailedGuests: 100 });
  vi.stubEnv('SPECTATOR_POPULATION', '100000');
  vi.stubEnv('WATCH_DETAILED_GUESTS', '100000');
  expect(watchConfig()).toMatchObject({ population: 10000, detailedGuests: 1000 });
});

it('caps the daily budget at five dollars and allows code-only operation', () => {
  vi.stubEnv('WATCH_DAILY_BUDGET', '100');
  expect(watchConfig().dailyBudget).toBe(5);
  vi.stubEnv('WATCH_DAILY_BUDGET', '0');
  expect(watchConfig().dailyBudget).toBe(0);
});
