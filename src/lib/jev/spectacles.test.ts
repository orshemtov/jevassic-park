import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/games/coaster/types/game';
import { createGuest } from '@/components/coaster/guests/guestSystem';
import { createParkSpectacle, findSpectacleVenue, spectacleForAnnouncement, spectacleAnnouncement } from './spectacles';
import { nextParkAnnouncement } from './announcements';
import { announcedAttraction, getGuestActions } from './decisions';

const park: GameState = JSON.parse(readFileSync('public/parks/showcase.json', 'utf8'));

describe('park spectacles', () => {
  it('keeps the entire parade route connected on real paths', () => {
    const spectacle = createParkSpectacle(park, 'parade', 1000)!;
    expect(spectacle.route.length).toBeGreaterThan(12);
    for (const [index, point] of spectacle.route.entries()) {
      expect(park.grid[point.y][point.x].path).toBeTruthy();
      if (index) expect(Math.abs(point.x - spectacle.route[index - 1].x) + Math.abs(point.y - spectacle.route[index - 1].y)).toBe(1);
    }
    expect(spectacle.route.at(-1)).toEqual(spectacle.route[0]);
  });
  for (const kind of ['parade', 'fireworks', 'fountain'] as const) it(`offers a reachable ${kind} viewing destination`, () => {
    const spectacle = createParkSpectacle(park, kind, 1000)!;
    expect(spectacle.startedAt).toBe(1000);
    expect(spectacle.durationMs).toBe(kind === 'fountain' ? 60000 : 90000);
    const text = spectacleAnnouncement(kind);
    expect(spectacleForAnnouncement(text)).toBe(kind);
    const point = spectacle.route[0];
    const guest = createGuest(point.x, point.y, park.gridSize);
    const actions = getGuestActions(park.grid, guest, false, text);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('ride');
    expect(announcedAttraction(text, actions[0].label)).toBe(true);
    expect(actions[0].buildingId).toBeTruthy();
  });
  it('launches fireworks at the central castle rather than decorative towers', () => {
    const castle = park.grid.flat().find(tile => tile.building?.type === 'ride_themed_facade')!;
    expect(castle).toBeTruthy();
    const spectacle = createParkSpectacle(park, 'fireworks', 0)!;
    expect(spectacle.center).toEqual({ x: castle.x, y: castle.y });
    const guest = createGuest(spectacle.route[0].x, spectacle.route[0].y, park.gridSize);
    expect(getGuestActions(park.grid, guest, false, spectacleAnnouncement('fireworks'))[0])
      .toMatchObject({ label: 'Fireworks', buildingId: `${castle.x},${castle.y}` });
  });
  it('sends every guest to the same visible fountain, even beside another fountain', () => {
    const duplicate = structuredClone(park);
    const venue = findSpectacleVenue(duplicate.grid, 'fountain')!;
    const nearbyPath = duplicate.grid.flat().find(tile => tile.path && tile.y > venue.y + 10 &&
      duplicate.grid[tile.y]?.[tile.x + 1] && !duplicate.grid[tile.y][tile.x + 1].path)!;
    duplicate.grid[nearbyPath.y][nearbyPath.x + 1].building = structuredClone(venue.building);
    const guest = createGuest(nearbyPath.x, nearbyPath.y, park.gridSize);
    const actions = getGuestActions(duplicate.grid, guest, false, spectacleAnnouncement('fountain'));
    expect(actions).toHaveLength(1);
    expect(actions[0].buildingId).toBe(`${venue.x},${venue.y}`);
    expect(createParkSpectacle(duplicate, 'fountain', 0)?.center).toEqual({ x: venue.x, y: venue.y });
  });
  it('schedules fireworks at night without repeating the previous broadcast', () => {
    expect(nextParkAnnouncement(undefined, 22)).toMatch(/Fireworks/);
    expect(nextParkAnnouncement('Fireworks above the castle!', 22)).not.toMatch(/Fireworks/);
    expect(nextParkAnnouncement(undefined, 12)).not.toMatch(/Fireworks/);
    expect(nextParkAnnouncement(undefined, 22, false)).not.toMatch(/parade|fountain show|fireworks/i);
  });
  it('does not invent an attraction when scenery is missing', () => {
    expect(createParkSpectacle({ grid: [] }, 'fountain', 0)).toBeUndefined();
  });
});
