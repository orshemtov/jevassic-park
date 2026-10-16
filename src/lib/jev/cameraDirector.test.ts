import { expect, it } from 'vitest';
import { createGuest } from '@/components/coaster/guests/guestSystem';
import { chooseDirectorShot } from './cameraDirector';
import type { GameState } from '@/games/coaster/types/game';

const guest = { ...createGuest(1, 1, 4), state: 'walking' as const, path: [{ x: 1, y: 2 }] };
const park = { guests: [guest], grid: [] } as unknown as GameState;
it('prioritizes active spectacles and ignores expired ones', () => {
  const show = { kind: 'parade' as const, startedAt: 1000, durationMs: 90000, center: { x: 2, y: 3 }, route: [] };
  expect(chooseDirectorShot(park, show, null, '', 2000)).toMatchObject({ x: 2, y: 3, label: 'Parade' });
  expect(chooseDirectorShot(park, show, null, '', 92000)?.guestId).toBe(guest.id);
});
it('follows a recent observed story without repeating the same shot', () => {
  const story = { id: 'third-ride', guestId: guest.id, name: guest.name, icon: '🎢', text: 'Three rides.', at: 1000 };
  expect(chooseDirectorShot(park, undefined, story, '', 2000)).toMatchObject({ key: story.id, guestId: guest.id });
  expect(chooseDirectorShot(park, undefined, story, story.id, 2000)).toBeNull();
  expect(chooseDirectorShot({ ...park, guests: [] }, undefined, story, '', 2000)).toBeNull();
});

it('avoids recent guests and holds a developing story for thirty seconds', () => {
  const story = { id: 'developing', guestId: guest.id, name: guest.name, icon: '🎢', text: 'Still going.', at: 1000 };
  expect(chooseDirectorShot(park, undefined, story, story.id, 25_000)).toBeNull();
  expect(chooseDirectorShot(park, undefined, null, 'elsewhere', 25_000, [`guest:${guest.id}`])).toBeNull();
  expect(chooseDirectorShot(park, undefined, story, story.id, 35_000)?.key).toBe(`guest:${guest.id}`);
});
