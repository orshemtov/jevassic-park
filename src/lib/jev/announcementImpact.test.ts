import { expect, it } from 'vitest';
import { createGuest } from '@/components/coaster/guests/guestSystem';
import type { Tile } from '@/games/coaster/types/game';
import { announcementImpact } from './announcementImpact';

it('highlights only actual responders still heading to the advertised destination', () => {
  const grid = [[{ x: 0, y: 0, building: { type: 'ride_carousel' } }, { x: 1, y: 0, building: { type: 'drink_soda' } }]] as Tile[][];
  const guest = { ...createGuest(0, 0, 2), state: 'walking' as const, targetBuildingId: '0,0', path: [{ x: 0, y: 1 }] };
  const event = { text: 'The carousel is boarding.', responders: [guest.id] };
  expect(announcementImpact([guest], grid, event)).toEqual({ ids: [guest.id], heading: 1 });
  expect(announcementImpact([{ ...guest, targetBuildingId: '1,0' }], grid, event)).toEqual({ ids: [], heading: 0 });
  expect(announcementImpact([guest], grid, { ...event, responders: [] }).ids).toEqual([]);
  expect(announcementImpact([guest], grid, null).ids).toEqual([]);
});
