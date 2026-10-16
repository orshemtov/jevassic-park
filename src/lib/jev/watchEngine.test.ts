import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/games/coaster/types/game';
import { getGuestActions } from './decisions';
import { advanceWatchWorld, applyWatchDecisions, buildWatchBatch, createWatchWorld, watchEnvironment } from './watchEngine';

const park: GameState = JSON.parse(readFileSync('public/parks/showcase.json', 'utf8'));
const now = Date.UTC(2026, 9, 16);

describe('shared spectator world', () => {
  it('cycles visible weather from watched time and daylight from wall time', () => {
    const world = createWatchWorld(park, 10, now);
    const initial = watchEnvironment(world, park);
    expect(initial.weather.current).toBe('sunny');
    expect(watchEnvironment({ ...world, watchedMs: 360000 }, park).weather.current).toBe('rain');
    expect(watchEnvironment({ ...world, updatedAt: now + 60000 }, park).hour).not.toBe(initial.hour);
    expect(watchEnvironment({ ...world, updatedAt: now + 60000 }, park).weather.current).toBe('sunny');
  });
  it('keeps a large visual crowd separate from the configured detailed guests', () => {
    const world = createWatchWorld(park, 5000, now);
    expect(world.population).toBe(5000);
    expect(world.guests).toHaveLength(100);
    const next = advanceWatchWorld({ ...world, detailedGuests: 20 }, park, now + 2000);
    expect(next.population).toBe(5000);
    expect(next.guests).toHaveLength(20);
  });
  it('seeds reachable movement and never catches up unattended time', () => {
    const initial = createWatchWorld(park, 10, now);
    expect(initial.guests.some(guest => guest.path.length > 0)).toBe(true);
    expect(initial.decisionCount).toBe(0);
    const next = advanceWatchWorld(initial, park, now + 86400000);
    expect(next.tick - initial.tick).toBe(50);
    expect(next.watchedMs).toBe(2500);
    expect(next.guests).toHaveLength(10);
    expect(next.announcement).toBeUndefined();
  });

  it('keeps up with active viewer cadence while clamping a long unattended gap', () => {
    const world = createWatchWorld(park, 10, now);
    expect(advanceWatchWorld(world, park, now + 8000).watchedMs).toBe(8000);
    expect(advanceWatchWorld(world, park, now + 3600000).watchedMs).toBe(2500);
  });

  it('shares one immutable broadcast snapshot across batches and includes every guest', () => {
    let world = createWatchWorld(park, 10, now);
    world.watchedMs = 45000;
    world = advanceWatchWorld(world, park, now);
    const snapshot = structuredClone(world.announcement!.park);
    expect(world.announcement!.pending).toHaveLength(10);
    const first = buildWatchBatch(world, park);
    expect(first.actors.length).toBeLessThanOrEqual(8);
    world = applyWatchDecisions(world, first.actors, first.actors.map(actor => ({ id: actor.id, action: 'continue' })), 'live', now);
    world = advanceWatchWorld(world, park, now + 2000);
    const second = buildWatchBatch(world, park);
    expect(second.park).toEqual(snapshot);
    expect(second.announcement).toBe(first.announcement);
    expect(second.actors.every(actor => !first.actors.some(previous => previous.id === actor.id))).toBe(true);
    expect(world.feed.every(entry => entry.name.length > 0 && entry.mode === 'live')).toBe(true);
    expect(world.announcement).toMatchObject({ total: 10, processed: first.actors.length, changed: 0, stayed: first.actors.length });
  });

  it('keeps busy guests pending until they can react to the same broadcast', () => {
    let world = createWatchWorld(park, 10, now);
    const busyId = world.guests[0].id;
    world.guests[0] = { ...world.guests[0], state: 'riding', queueTimer: 1000 };
    world.watchedMs = 45000;
    world = advanceWatchWorld(world, park, now);
    const snapshot = structuredClone(world.announcement!.park);
    for (let index = 0; index < 2; index++) {
      const batch = buildWatchBatch(world, park);
      expect(batch.actors.some(actor => actor.id === busyId)).toBe(false);
      world = applyWatchDecisions(world, batch.actors, batch.actors.map(actor => ({ id: actor.id, action: 'continue' })), 'live', now);
    }
    expect(world.announcement!.pending).toEqual([busyId]);
    world.guests[1] = { ...world.guests[1], state: 'walking', path: [], progress: 0, targetBuildingId: null, queueRideId: null, decisionCooldown: 0 };
    const ordinary = buildWatchBatch(world, park);
    expect(ordinary.announcement).toBeUndefined();
    expect(ordinary.actors.map(actor => actor.id)).toContain(world.guests[1].id);
    world.guests = world.guests.map(guest => guest.id === busyId ? { ...guest, state: 'walking' } : guest);
    const deferred = buildWatchBatch(world, park);
    expect(deferred.actors.map(actor => actor.id)).toEqual([busyId]);
    expect(deferred.park).toEqual(snapshot);
  });

  it('gives an undecided idle guest a turn before a guest who already chose', () => {
    const world = createWatchWorld(park, 10, now);
    world.guests = world.guests.slice(0, 2).map(guest => ({ ...guest, state: 'walking', path: [], progress: 0,
      targetBuildingId: null, queueRideId: null, decisionCooldown: 0 }));
    world.lastDecided = { [world.guests[0].id]: now - 1000 };
    expect(buildWatchBatch(world, park).actors[0].id).toBe(world.guests[1].id);
  });

  it('ignores invented actions and applies only an offered reachable route', () => {
    const world = createWatchWorld(park, 10, now);
    const batch = buildWatchBatch(world, park);
    const actor = batch.actors[0];
    const action = actor.actions.find(action => action.path.length > 0)!;
    expect(action).toBeDefined();
    expect(action.path.every(point => park.grid[point.y][point.x].path || park.grid[point.y][point.x].queue)).toBe(true);
    const invalid = applyWatchDecisions(world, batch.actors, [{ id: actor.id, action: 'ride:999,999' }], 'live', now);
    expect(invalid.decisionCount).toBe(0);
    const next = applyWatchDecisions(world, batch.actors, [{ id: actor.id, action: action.id }, { id: actor.id, action: action.id }], 'live', now);
    expect(next.decisionCount).toBe(1);
    expect(next.guests.find(guest => guest.id === actor.id)!.path).toEqual(action.path);
  });
});


it('offers the announced parade to every broadcast batch without forcing attendance', () => {
  let world = createWatchWorld(park, 10, now);
  world = advanceWatchWorld({ ...world, watchedMs: 45000 }, park, now);
  world.announcement!.text = 'The parade is starting. Front-row enthusiasm encouraged.';
  const parade = park.grid.flat().find(tile => tile.building.type === 'show_parade_float')!;
  const target = `ride:${parade.x},${parade.y}`;
  const first = buildWatchBatch(world, park);
  expect(first.actors).toHaveLength(8);
  for (const actor of first.actors) {
    expect(actor.actions.some(action => action.id === target)).toBe(true);
    expect(actor.actions.length).toBeLessThanOrEqual(10);
  }
  const decisions = first.actors.map((actor, index) => ({ id: actor.id, action: index === 0 ? target : 'continue' }));
  const next = applyWatchDecisions(world, first.actors, decisions, 'live', now);
  expect(next.guests.find(guest => guest.id === first.actors[0].id)?.targetBuildingId).toBe(`${parade.x},${parade.y}`);
  expect(next.announcement).toMatchObject({ processed: 8, changed: 1, stayed: 7 });
  const second = buildWatchBatch(next, park);
  expect(second.actors).toHaveLength(2);
  expect(second.park).toEqual(first.park);
  expect(second.actors.every(actor => actor.actions.some(action => action.id === target))).toBe(true);
});

it('only attributes choices matching the announcement to the radio', () => {
  let world = createWatchWorld(park, 10, now);
  world = advanceWatchWorld({ ...world, watchedMs: 45000 }, park, now);
  world.announcement!.text = 'The parade is starting.';
  const batch = buildWatchBatch(world, park);
  const parade = batch.actors[0].actions.find(action => /parade/i.test(action.label))!;
  const drink = getGuestActions(park.grid, world.guests.find(guest => guest.id === batch.actors[1].id)!).find(action => action.kind === 'drink')!;
  expect(batch.actors[1].actions.some(action => action.id === drink.id)).toBe(false);
  const next = applyWatchDecisions(world, batch.actors, [
    { id: batch.actors[0].id, action: parade.id },
    { id: batch.actors[1].id, action: drink.id },
    { id: batch.actors[2].id, action: 'continue' },
  ], 'live', now);
  expect(next.announcement).toMatchObject({ processed: 2, responded: 1, changed: 1, stayed: 1 });
  expect(next.feed.find(entry => entry.guestId === batch.actors[0].id)?.radio)
    .toEqual({ id: world.announcement!.id, text: 'The parade is starting.', at: world.announcement!.at });
  expect(next.feed.some(entry => entry.guestId === batch.actors[1].id)).toBe(false);
  expect(next.feed.find(entry => entry.guestId === batch.actors[2].id)?.radio).toBeUndefined();
});
