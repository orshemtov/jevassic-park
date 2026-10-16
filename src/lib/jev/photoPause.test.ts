import { expect, it } from 'vitest';
import { createGuest, updateGuest } from '@/components/coaster/guests/guestSystem';
import type { Guest } from '@/games/coaster/types/economy';
import type { Tile } from '@/games/coaster/types/game';

const grid = Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, x) => ({ x, y, path: true, building: { type: 'empty' } }))) as Tile[][];

it('pauses for a photo then resumes the same route without resetting movement or needs', () => {
  const original: Guest = { ...createGuest(1, 1, 4), state: 'walking', photoPauseTicks: 40,
    targetTileX: 2, targetTileY: 1, progress: .35, path: [{ x: 2, y: 1 }, { x: 3, y: 1 }], pathIndex: 1 };
  let guest = original;
  for (let tick = 0; tick < 40; tick++) guest = updateGuest(guest, grid, 1);
  expect(guest.photoPauseTicks).toBe(0);
  expect(guest.progress).toBe(.35);
  expect(guest.path).toEqual(original.path);
  expect(guest.pathIndex).toBe(1);
  expect(guest.hunger).toBeGreaterThan(original.hunger);
  expect(guest.timeInPark).toBe(original.timeInPark + 40);
  guest = updateGuest(guest, grid, 1);
  expect(guest.progress).toBeCloseTo(.37);
  expect(guest.targetTileX).toBe(2);
  expect(original.photoPauseTicks).toBe(40);
});

it('bounds photo pauses and never stalls ride timers', () => {
  const guest = { ...createGuest(1, 1, 4), state: 'riding' as const, queueTimer: 50, photoPauseTicks: 10000 };
  const next = updateGuest(guest, grid, 1);
  expect(next.photoPauseTicks).toBe(39);
  expect(next.queueTimer).toBe(49);
});
