import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { GameState } from '@/games/coaster/types/game';
import { buildWatchBatch, createWatchWorld, watchEnvironment } from './watchEngine';

const park: GameState = JSON.parse(readFileSync('public/parks/showcase.json', 'utf8'));

it('shows the same changing weather and wall clock to spectators and ordinary Jev decisions', () => {
  const world = createWatchWorld(park, 10, 0);
  const morning = watchEnvironment(world, park);
  expect(morning.hour).toBeGreaterThanOrEqual(7);
  expect(morning.hour).toBeLessThan(18);
  world.watchedMs = 360_000;
  world.updatedAt = 390_000;
  const environment = watchEnvironment(world, park);
  expect(environment.hour).not.toBe(morning.hour);
  expect(environment.weather.current).toBe('rain');
  expect(environment.weather.current).not.toBe(morning.weather.current);
  const batch = buildWatchBatch(world, park);
  expect(batch.park.hour).toBe(environment.hour);
  expect(batch.park.weather).toBe(environment.weather.current);
  expect(watchEnvironment(world, park)).toEqual(environment);
});

it('spends seven minutes in daylight and one minute at night during each ten-minute cycle', () => {
  const world = createWatchWorld(park, 10, 0);
  let daylight = 0;
  let night = 0;
  for (let second = 0; second < 600; second++) {
    const { hour } = watchEnvironment({ ...world, updatedAt: second * 1000 }, park);
    if (hour >= 7 && hour < 18) daylight++;
    if (hour >= 21 || hour < 5) night++;
  }
  expect(daylight).toBe(420);
  expect(night).toBe(60);
  expect(watchEnvironment({ ...world, updatedAt: 600_000 }, park)).toEqual(watchEnvironment(world, park));
});
