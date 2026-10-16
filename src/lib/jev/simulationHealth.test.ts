import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import type { GameState } from '@/games/coaster/types/game';
import { createGuest, updateGuest } from '@/components/coaster/guests/guestSystem';
import { applyWeatherEffectsToGuest } from '@/context/CoasterContext';
import { chooseOffline, type GuestAction } from './decisions';

const park: GameState = JSON.parse(readFileSync('public/parks/showcase.json', 'utf8'));
const tile = park.grid.flat().find(tile => tile.path)!;
const actions: Pick<GuestAction, 'id' | 'kind' | 'distance'>[] = [
  { id: 'ride:1,1', kind: 'ride', distance: 2 },
  { id: 'food:1,2', kind: 'food', distance: 2 },
  { id: 'drink:1,3', kind: 'drink', distance: 2 },
  { id: 'restroom:1,4', kind: 'restroom', distance: 2 },
  { id: 'wait', kind: 'wait', distance: 0 },
  { id: 'leave', kind: 'leave', distance: 5 },
];
afterEach(() => vi.restoreAllMocks());

it('keeps a hundred arrivals solvent and gives them different needs and first choices', () => {
  let seed = 12345;
  vi.spyOn(Math, 'random').mockImplementation(() => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32));
  const guests = Array.from({ length: 100 }, () => {
    const guest = createGuest(tile.x, tile.y, park.gridSize);
    return { ...guest, cash: guest.cash - 35 };
  });
  expect(guests.every(guest => guest.cash >= 45)).toBe(true);
  expect(new Set(guests.map(guest => Math.floor(guest.hunger / 10))).size).toBeGreaterThan(3);
  expect(new Set(guests.map(guest => chooseOffline(guest, actions)))).toEqual(new Set(['ride:1,1', 'food:1,2', 'drink:1,3']));
});

it('does not turn five minutes of unmet needs into a mass exit', () => {
  let guests = Array.from({ length: 100 }, () => ({ ...createGuest(tile.x, tile.y, park.gridSize),
    state: 'walking' as const, path: [], targetBuildingId: null, queueRideId: null,
    hunger: 30, thirst: 30, bathroom: 20, happiness: 80, energy: 80, cash: 80 }));
  // 20 physics ticks/second, deliberately no food, rides, or rest during this worst-case visit.
  for (let tick = 0; tick < 6000; tick++) guests = guests.map(guest => updateGuest(guest, park.grid, 1)) as typeof guests;
  expect(guests.every(guest => guest.happiness > 40)).toBe(true);
  expect(guests.every(guest => chooseOffline(guest, actions) !== 'leave')).toBe(true);
  expect(chooseOffline({ ...guests[0], happiness: 5, timeInPark: 10_000 }, actions)).toBe('leave');
});

it('rain changes moods gradually rather than emptying the park in a minute', () => {
  let guest = { ...createGuest(tile.x, tile.y, park.gridSize), happiness: 80, hunger: 30, thirst: 30, energy: 80 };
  for (let tick = 0; tick < 1200; tick++) guest = applyWeatherEffectsToGuest(updateGuest(guest, park.grid, 1), 'rain');
  expect(guest.happiness).toBeGreaterThan(70);
  expect(guest.happiness).toBeLessThan(80);
  expect(chooseOffline(guest, actions)).not.toBe('leave');
});
