import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/games/coaster/types/game';
import { createGuest, updateGuest } from '@/components/coaster/guests/guestSystem';
import { parkRhythm, rideIncident } from './parkEvents';
import { nextParkAnnouncement } from './announcements';
import { advanceWatchWorld, applyWatchDecisions, buildWatchBatch, createWatchWorld } from './watchEngine';
import { chooseOffline, chooseOfflineAnnouncement, isDecisionBoundary } from './decisions';

const park: GameState = JSON.parse(readFileSync('public/parks/showcase.json', 'utf8'));
const now = Date.UTC(2026, 9, 16, 12);

describe('living park', () => {
  afterEach(() => vi.restoreAllMocks());
  it('anticipates the next real show and schedules afternoon, sunset and night', () => {
    expect(parkRhythm(9)).toMatchObject({ phase: 'morning', nextShow: { kind: 'parade', hour: 14 } });
    expect(parkRhythm(12).phase).toBe('lunch');
    expect(nextParkAnnouncement(undefined, 12)).toMatch(/hot dogs/i);
    expect(parkRhythm(15).nextShow.kind).toBe('fountain');
    expect(parkRhythm(19).nextShow.kind).toBe('fireworks');
    expect(nextParkAnnouncement(undefined, 15)).toMatch(/parade/i);
    expect(nextParkAnnouncement(undefined, 19)).toMatch(/fountain/i);
    expect(nextParkAnnouncement(undefined, 22)).toMatch(/fireworks/i);
    expect(nextParkAnnouncement(undefined, 22, false)).not.toMatch(/parade|fountain|fireworks/i);
  });
  it('only records ride reactions after an actual ride completes', () => {
    const water = park.grid.flat().find(tile => /^ride_.*(?:log_flume|rapids)/.test(tile.building?.type ?? ''))!;
    const guest = createGuest(water.x, water.y, park.gridSize);
    const before = { ...guest, state: 'riding' as const, queueRideId: `${water.x},${water.y}`, queueTimer: 0 };
    const after = updateGuest({ ...before, ridesRidden: [...before.ridesRidden] }, park.grid, 1);
    expect(after.ridesRidden.length).toBe(before.ridesRidden.length + 1);
    expect(rideIncident(before, after, park, now)?.kind).toBe('soaked');
    expect(rideIncident(after, after, park, now)).toBeUndefined();
  });
  it('keeps incidents bounded, timed and tied to a real guest', () => {
    let world = createWatchWorld(park, 10, now);
    world.nextIncidentAt = 0;
    world = advanceWatchWorld(world, park, now + 5000);
    expect(world.incidents?.length).toBeGreaterThan(0);
    expect(world.guests.some(guest => guest.id === world.incidents![0].guestId)).toBe(true);
    world.nextIncidentAt = Number.MAX_SAFE_INTEGER;
    world = advanceWatchWorld(world, park, now + 20000);
    expect(world.incidents).toEqual([]);
  });
  it('keeps code guests active with reachable choices over a ten-minute park day', () => {
    let seed = 431;
    vi.spyOn(Math, 'random').mockImplementation(() => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; });
    let clock = now;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    let world = createWatchWorld(park, 10, now);
    const moved = new Set<string>();
    const completedRides = new Set<string>();
    const decided = new Set<string>();
    const idleSince = new Map<string, number>();
    const kinds = new Set<string>();
    let accepts = 0;
    for (let step = 1; step <= 120; step++) {
      clock = now + step * 5000;
      const before = new Map(world.guests.map(guest => [guest.id, `${guest.tileX},${guest.tileY}`]));
      world = advanceWatchWorld(world, park, now + step * 5000);
      for (const guest of world.guests) {
        if (!isDecisionBoundary(guest)) idleSince.delete(guest.id);
        else {
          idleSince.set(guest.id, idleSince.get(guest.id) ?? step * 5000);
          expect(step * 5000 - idleSince.get(guest.id)!).toBeLessThanOrEqual(30000);
        }
        if (guest.ridesRidden.length) completedRides.add(guest.id);
        if (before.get(guest.id) !== `${guest.tileX},${guest.tileY}`) moved.add(guest.id);
        expect(park.grid[guest.tileY][guest.tileX].path || park.grid[guest.tileY][guest.tileX].queue).toBeTruthy();
      }
      const batch = buildWatchBatch(world, park, now + step * 5000);
      const decisions = batch.actors.map(actor => {
        const guest = world.guests.find(item => item.id === actor.id)!;
        const action = batch.announcement ? chooseOfflineAnnouncement(guest, actor.actions, batch.announcement) : actor.codeChoice ?? chooseOffline(guest, actor.actions);
        decided.add(actor.id);
        const chosen = actor.actions.find(item => item.id === action);
        expect(chosen).toBeTruthy();
        if (chosen) kinds.add(chosen.kind);
        return { id: actor.id, action };
      });
      accepts += decisions.length;
      world = applyWatchDecisions(world, batch.actors, decisions, 'offline', now + step * 5000);
    }
    expect(world.guests).toHaveLength(10);
    expect(moved.size).toBeGreaterThanOrEqual(10);
    expect(accepts).toBeGreaterThan(15);
    expect(kinds.has('ride')).toBe(true);
    expect(decided.size).toBeGreaterThanOrEqual(10);
    expect(completedRides.size).toBeGreaterThanOrEqual(5);
    expect(world.guests.every(guest => Number.isFinite(guest.cash) && guest.happiness > 0)).toBe(true);
    expect(world.incidents!.length).toBeLessThanOrEqual(8);
  });
});


it('runs all three phase shows with real arrivals and ordinary decisions in one day', () => {
  let seed = 812;
  const random = vi.spyOn(Math, 'random').mockImplementation(() => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; });
  try {
    const start = 600000 * Math.floor(now / 600000) - 120000;
    let clock = start;
    const clockMock = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    let world = createWatchWorld(park, 100, start);
    const shows = new Set<string>();
    const arrived = new Set<string>();
    let ordinary = 0;
    for (let step = 1; step <= 120; step++) {
      const at = start + step * 5000;
      clock = at;
      world = advanceWatchWorld(world, park, at);
      if (world.spectacle) {
        shows.add(world.spectacle.kind);
        const venue = `${world.spectacle.center.x},${world.spectacle.center.y}`;
        if (world.guests.some(guest => guest.queueRideId === venue && ['queuing', 'riding'].includes(guest.state))) arrived.add(world.spectacle.kind);
      }
      const batch = buildWatchBatch(world, park, at);
      if (!batch.announcement) ordinary += batch.actors.length;
      world = applyWatchDecisions(world, batch.actors, batch.actors.map(actor => {
        const guest = world.guests.find(item => item.id === actor.id)!;
        return { id: actor.id, action: batch.announcement ? chooseOfflineAnnouncement(guest, actor.actions, batch.announcement) : actor.codeChoice ?? chooseOffline(guest, actor.actions) };
      }), 'offline', at);
    }
    expect([...shows].sort()).toEqual(['fireworks', 'fountain', 'parade']);
    expect([...arrived].sort()).toEqual(['fireworks', 'fountain', 'parade']);
    expect(ordinary).toBeGreaterThan(100);
    clockMock.mockRestore();
  } finally { random.mockRestore(); vi.restoreAllMocks(); }
}, 15000);
