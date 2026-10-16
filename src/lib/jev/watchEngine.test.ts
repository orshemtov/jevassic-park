import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/games/coaster/types/game';
import { createParkSpectacle } from './spectacles';
import { getGuestActions } from './decisions';
import { advanceWatchWorld, applyWatchDecisions, buildWatchBatch, createWatchWorld, watchEnvironment } from './watchEngine';

const park: GameState = JSON.parse(readFileSync('public/parks/showcase.json', 'utf8'));
const now = Date.UTC(2026, 9, 16);

describe('shared spectator world', () => {
  it('shares spectacle timing and removes expired spectacles', () => {
    const world = createWatchWorld(park, 10, now);
    world.spectacle = createParkSpectacle(park, 'parade', now);
    world.nextAnnouncementAt = Number.MAX_SAFE_INTEGER;
    expect(advanceWatchWorld(world, park, now + 5000).spectacle).toEqual(world.spectacle);
    expect(advanceWatchWorld(world, park, now + 120000).spectacle).toBeUndefined();
  });
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
    // Busy guests keep their plan; idle guests get an ordinary turn before the next radio batch.
    world.guests = world.guests.map(guest => first.actors.some(actor => actor.id === guest.id) ? { ...guest, decisionCooldown: 100 } : guest);
    const second = buildWatchBatch(world, park);
    expect(second.park).toEqual(snapshot);
    expect(second.announcement).toBe(first.announcement);
    expect(second.actors.every(actor => !first.actors.some(previous => previous.id === actor.id))).toBe(true);
    expect(world.feed).toEqual([]);
    expect(world.decisionCount).toBe(first.actors.length);
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
    world.guests = world.guests.map(guest => guest.id === busyId ? { ...guest, state: 'walking' } : { ...guest, decisionCooldown: 100 });
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
  world.spectacle = createParkSpectacle(park, 'parade', now);
  world.announcement!.text = 'The parade is starting. Front-row enthusiasm encouraged.';
  const parade = park.grid.flat().find(tile => tile.building.type === 'show_parade_float')!;
  const target = `ride:${parade.x},${parade.y}`;
  const first = buildWatchBatch(world, park);
  expect(first.actors).toHaveLength(8);
  for (const actor of first.actors) {
    const guest = world.guests.find(guest => guest.id === actor.id)!;
    const option = getGuestActions(park.grid, guest, false, world.announcement!.text).find(action => action.id === target);
    expect(actor.actions.some(action => action.id === target)).toBe(Boolean(option && option.distance * 2500 + 20000 <= world.spectacle!.durationMs));
    expect(actor.actions.length).toBeLessThanOrEqual(10);
  }
  const attendee = first.actors.find(actor => actor.actions.some(action => action.id === target))!;
  const decisions = first.actors.map(actor => ({ id: actor.id, action: actor.id === attendee.id ? target : 'continue' }));
  const next = applyWatchDecisions(world, first.actors, decisions, 'live', now);
  expect(next.guests.find(guest => guest.id === attendee.id)?.targetBuildingId).toBe(`${parade.x},${parade.y}`);
  expect(next.announcement).toMatchObject({ processed: 8, changed: 1, stayed: 7 });
  const second = buildWatchBatch({ ...next, lastBatchBroadcast: false }, park);
  expect(second.actors).toHaveLength(2);
  expect(second.park).toEqual(first.park);
  expect(second.actors.every(actor => actor.actions.some(action => action.id === 'continue'))).toBe(true);
});

it('only attributes choices matching the announcement to the radio', () => {
  let world = createWatchWorld(park, 10, now);
  world = advanceWatchWorld({ ...world, watchedMs: 45000 }, park, now);
  world.spectacle = createParkSpectacle(park, 'parade', now);
  world.announcement!.text = 'The parade is starting.';
  const batch = buildWatchBatch(world, park);
  const radioActor = batch.actors.find(actor => actor.actions.some(action => /parade/i.test(action.label)))!;
  const parade = radioActor.actions.find(action => /parade/i.test(action.label))!;
  const others = batch.actors.filter(actor => actor.id !== radioActor.id);
  const drink = getGuestActions(park.grid, world.guests.find(guest => guest.id === others[0].id)!).find(action => action.kind === 'drink')!;
  expect(others[0].actions.some(action => action.id === drink.id)).toBe(false);
  const next = applyWatchDecisions(world, batch.actors, [
    { id: radioActor.id, action: parade.id },
    { id: others[0].id, action: drink.id },
    { id: others[1].id, action: 'continue' },
  ], 'live', now);
  expect(next.announcement).toMatchObject({ processed: 2, responded: 1, changed: 1, stayed: 1, responders: [radioActor.id] });
  expect(next.feed).toHaveLength(1);
  expect(next.feed[0].kind).toBe('ride');
  expect(next.feed.find(entry => entry.guestId === radioActor.id)?.radio)
    .toEqual({ id: world.announcement!.id, text: 'The parade is starting.', at: world.announcement!.at });
  expect(next.feed.some(entry => entry.guestId === others[0].id)).toBe(false);
  expect(next.feed.find(entry => entry.guestId === others[1].id)?.radio).toBeUndefined();
});


it('keeps a running show while broadcasting other park news', () => {
  let world = createWatchWorld(park, 10, now);
  world.spectacle = createParkSpectacle(park, 'fountain', now);
  world.watchedMs = 45000;
  world = advanceWatchWorld(world, park, now + 5000);
  expect(world.spectacle?.kind).toBe('fountain');
  expect(world.spectacle?.startedAt).toBe(now);
  expect(world.announcement?.text).not.toMatch(/parade|fountain show|fireworks/i);
});

it('offers only continuation when a broadcast show will finish before arrival', () => {
  let world = createWatchWorld(park, 10, now);
  world = advanceWatchWorld({ ...world, watchedMs: 45000 }, park, now);
  world.spectacle = createParkSpectacle(park, 'parade', now);
  world.announcement!.text = 'The parade is starting.';
  const batch = buildWatchBatch(world, park, now + world.spectacle!.durationMs - 10000);
  expect(batch.actors).toHaveLength(8);
  expect(batch.actors.every(actor => actor.actions.length === 1 && actor.actions[0].id === 'continue')).toBe(true);
});

it('lets idle guests resume normal life while others are still hearing the radio', () => {
  let world = createWatchWorld(park, 10, now);
  world = advanceWatchWorld({ ...world, watchedMs: 45000 }, park, now);
  const heard = world.guests[0];
  world.announcement!.pending = world.guests.slice(1).map(guest => guest.id);
  world.guests[0] = { ...heard, state: 'walking', path: [], progress: 0, targetBuildingId: null, queueRideId: null, decisionCooldown: 0, hunger: 100 };
  const batch = buildWatchBatch(world, park);
  expect(batch.announcement).toBeUndefined();
  expect(batch.actors.map(actor => actor.id)).toContain(heard.id);
  const action = batch.actors[0].actions.find(action => action.kind === 'food')!;
  expect(action).toBeDefined();
  const next = applyWatchDecisions(world, batch.actors, [{ id: heard.id, action: action.id }], 'live', now);
  expect(next.guests[0].targetBuildingId).toBeTruthy();
  expect(next.announcement!.pending).toEqual(world.announcement!.pending);
  expect(next.feed[0].radio).toBeUndefined();
});

it('leaves a full normal-play interval after the last radio response', () => {
  let world = createWatchWorld(park, 10, now);
  world = advanceWatchWorld({ ...world, watchedMs: 45000 }, park, now);
  world.announcement!.pending = [world.guests[0].id];
  const batch = buildWatchBatch(world, park);
  const next = applyWatchDecisions(world, batch.actors, [{ id: batch.actors[0].id, action: 'continue' }], 'live', now);
  expect(next.announcement!.pending).toEqual([]);
  expect(next.nextAnnouncementAt - next.watchedMs).toBeGreaterThanOrEqual(60000);
});


it('upgrades legacy guests once without moving, charging or regrouping them', () => {
  const world = createWatchWorld(park, 10, now);
  for (const guest of world.guests) { delete guest.personality; delete guest.groupId; }
  const positions = world.guests.map(guest => ({ id: guest.id, tileX: guest.tileX, tileY: guest.tileY, cash: guest.cash, ridesRidden: guest.ridesRidden }));
  const upgraded = advanceWatchWorld(world, park, now);
  expect(upgraded.guests.every(guest => guest.personality)).toBe(true);
  expect(upgraded.guests.some(guest => guest.groupId)).toBe(true);
  expect(upgraded.guests.map(guest => ({ id: guest.id, tileX: guest.tileX, tileY: guest.tileY, cash: guest.cash, ridesRidden: guest.ridesRidden }))).toEqual(positions);
  const reloaded = advanceWatchWorld(JSON.parse(JSON.stringify(upgraded)), park, now);
  expect(reloaded.guests).toEqual(upgraded.guests);
  expect(world.guests.every(guest => !guest.personality && !guest.groupId)).toBe(true);
});

it('alternates a large radio queue with ordinary decisions so neither starves', () => {
  let world = createWatchWorld(park, 100, now);
  world = advanceWatchWorld({ ...world, watchedMs: 45000 }, park, now);
  world.announcement!.text = 'The hotdog stand is giving away free hot dogs!';
  let ordinary = 0;
  let radio = 0;
  let batches = 0;
  while (world.announcement!.pending.length && batches < 12) {
    world.guests = world.guests.map(guest => ({ ...guest, state: 'walking', path: [], pathIndex: 0, progress: 0,
      targetBuildingId: null, targetBuildingKind: null, queueRideId: null, decisionCooldown: 0 }));
    const batch = buildWatchBatch(world, park, now + batches * 5000);
    if (batch.announcement) radio += batch.actors.length;
    else ordinary += batch.actors.length;
    world = applyWatchDecisions(world, batch.actors, batch.actors.map(actor => ({ id: actor.id,
      action: batch.announcement ? 'continue' : actor.actions.find(action => action.kind === 'wait')!.id })), 'offline', now + batches * 5000);
    batches++;
  }
  expect(radio).toBe(100);
  expect(ordinary).toBeGreaterThan(0);
  expect(world.announcement!.pending).toEqual([]);
  expect(batches * 5000).toBeLessThanOrEqual(60000);
});


it('starts a night arrival with fireworks instead of replaying missed daytime shows', () => {
  const at = Math.floor(now / 600000) * 600000 - 120000 + 500000;
  const world = advanceWatchWorld(createWatchWorld(park, 10, at), park, at + 5000);
  expect(world.spectacle?.kind).toBe('fireworks');
  expect(world.showsStarted).toContain('parade');
  expect(world.showsStarted).toContain('fountain');
});
