import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { GameState } from '@/games/coaster/types/game';
import { createGuest } from '@/components/coaster/guests/guestSystem';
import { previewAnnouncementDecisions, previewDecisions } from './previewDecisions';

it('keeps preview decisions bounded and only chooses idle guests', () => {
  const park: GameState = JSON.parse(readFileSync('public/parks/showcase.json', 'utf8'));
  const tile = park.grid.flat().find(tile => tile.path)!;
  park.guests = Array.from({ length: 12 }, () => ({ ...createGuest(tile.x, tile.y, park.gridSize),
    state: 'walking' as const, path: [], decisionCooldown: 0, targetBuildingId: null, queueRideId: null }));
  expect(previewDecisions(park)).toHaveLength(8);
  park.guests = park.guests.map(guest => ({ ...guest, state: 'riding' }));
  expect(previewDecisions(park)).toEqual([]);
});

it('lets every preview guest react to a broadcast without interrupting riders', () => {
  const park: GameState = JSON.parse(readFileSync('public/parks/showcase.json', 'utf8'));
  const tile = park.grid.flat().find(tile => tile.path)!;
  park.guests = [
    { ...createGuest(tile.x, tile.y, park.gridSize), state: 'walking', hunger: 95 },
    { ...createGuest(tile.x, tile.y, park.gridSize), state: 'riding' },
  ];
  const reactions = previewAnnouncementDecisions(park, 'The hotdog stand is giving away free hot dogs!');
  expect(reactions).toHaveLength(2);
  expect(reactions[0].action.kind).toBe('food');
  expect(reactions[0].action.price).toBe(0);
  expect(reactions[1].action.kind).toBe('continue');
});
