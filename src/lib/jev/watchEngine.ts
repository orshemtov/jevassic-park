import { chargeGuestForActivity, createGuest, updateGuest } from '@/components/coaster/guests/guestSystem';
import type { Guest } from '@/games/coaster/types/economy';
import type { GameState } from '@/games/coaster/types/game';
import { chooseOffline, getGuestActions, isDecisionBoundary, type GuestAction, type ActionKind, announcedAttraction } from './decisions';
import { watchEnvironment } from './environment';
export { watchEnvironment } from './environment';
import { summarizePark, type ParkState } from './parkState';
import { announcementDelay, nextParkAnnouncement, type RadioReaction } from './announcements';

export type WatchActor = { id: string; guest: Pick<Guest, 'hunger' | 'thirst' | 'energy' | 'bathroom' | 'nausea' | 'happiness' | 'cash' | 'preferExcitement' | 'preferIntensity' | 'timeInPark' | 'ridesRidden'> & { activity: string }; actions: GuestAction[] };
export type WatchFeed = { id: number; guestId: string; name: string; action: string; mode: 'live' | 'offline'; time: number; kind?: ActionKind; broadcast?: boolean; radio?: RadioReaction };
export type WatchWorld = {
  guests: Guest[]; tick: number; feed: WatchFeed[]; mode: 'live' | 'offline'; decisionCount: number;
  population: number; detailedGuests?: number; updatedAt: number; nextDecisionAt: number; leaseUntil: number;
  lastDecided?: Record<string, number>;
  budgetExhausted?: boolean; day: string; spent: number; reserved: number; watchedMs: number; nextAnnouncementAt: number;
  announcement?: { id: number; text: string; at: number; park: ParkState; pending: string[]; total: number; processed: number; changed: number; stayed: number; responded?: number };
};

const day = (now: number) => new Date(now).toISOString().slice(0, 10);

const currentPark = (world: WatchWorld, park: GameState): GameState => ({
  ...park, ...watchEnvironment(world, park), guests: world.guests, tick: world.tick,
});

function spawn(park: GameState): Guest {
  const paths = park.grid.flat().filter(tile => tile.path && tile.x > 0 && tile.y > 0 && tile.x < park.gridSize - 1 && tile.y < park.gridSize - 1);
  const tile = paths[Math.floor(Math.random() * paths.length)];
  if (!tile) throw new Error('Spectator park has no paths');
  return { ...createGuest(tile.x, tile.y, park.gridSize), state: 'walking', targetTileX: tile.x, targetTileY: tile.y };
}

export function applyWatchAction(guest: Guest, action: GuestAction): Guest {
  if (action.kind === 'continue') return guest;
  if (action.kind === 'wait') return { ...guest, state: 'walking', path: [], pathIndex: 0, progress: 0,
    targetBuildingId: null, targetBuildingKind: null, queueRideId: null, decisionCooldown: 400 };
  const path = action.path.length ? action.path : [{ x: guest.tileX, y: guest.tileY }];
  return { ...guest, state: action.kind === 'leave' ? 'leaving' : 'walking', targetBuildingId: action.buildingId ?? null,
    targetBuildingKind: action.kind === 'ride' ? 'ride' : action.kind === 'shop' || action.kind === 'restroom' ? 'shop' : action.kind === 'food' || action.kind === 'drink' ? 'food' : null,
    targetPurchaseKind: action.kind === 'food' || action.kind === 'drink' || action.kind === 'restroom' ? action.kind : null,
    freeHotdogVoucher: action.kind === 'food' && action.price === 0,
    queueRideId: action.kind === 'ride' ? action.buildingId ?? null : null,
    path, pathIndex: 1, targetTileX: path[0].x, targetTileY: path[0].y, progress: 0, decisionCooldown: 0 };
}

export function createWatchWorld(park: GameState, population: number, now: number, detailedGuests = 100): WatchWorld {
  const count = Math.min(1000, Math.max(10, Math.floor(population)), Math.max(10, Math.floor(detailedGuests)));
  const guests = Array.from({ length: count }, (_, index) => {
    const guest = spawn(park);
    // Seed motion with code; only actual model responses appear as Jev decisions.
    if (index === 0) return guest;
    const actions = getGuestActions(park.grid, guest);
    return applyWatchAction(guest, actions.find(action => action.id === chooseOffline(guest, actions)) ?? actions[0]);
  });
  return { guests, tick: park.tick, feed: [], mode: 'offline', decisionCount: 0, population: Math.min(10000, Math.max(10, Math.floor(population))),
    detailedGuests, updatedAt: now, nextDecisionAt: now, leaseUntil: 0, day: day(now), spent: 0, reserved: 0, watchedMs: 0, nextAnnouncementAt: announcementDelay(true) };
}

export function advanceWatchWorld(world: WatchWorld, park: GameState, now: number, maxElapsedMs = now - world.updatedAt <= 15000 ? 15000 : 2500): WatchWorld {
  // A returning viewer advances one frame, never hours of unattended simulation.
  const elapsed = Math.max(0, Math.min(maxElapsedMs, now - world.updatedAt));
  const ticks = Math.floor(elapsed / 50);
  let guests = [...world.guests];
  for (let i = 0; i < ticks; i++) guests = guests.map(guest => chargeGuestForActivity(
    updateGuest({ ...guest, ridesRidden: [...guest.ridesRidden] }, park.grid, 1), park.settings.payPerRide).guest)
    .filter(guest => !(guest.state === 'leaving' && guest.path.length === 0 && guest.progress === 0));
  const count = Math.min(1000, world.population, world.detailedGuests ?? 100);
  guests = guests.slice(0, count);
  while (guests.length < count) guests.push(spawn(park));
  const next: WatchWorld = { ...world, guests, tick: world.tick + ticks, watchedMs: world.watchedMs + ticks * 50, updatedAt: now,
    ...(world.day !== day(now) ? { day: day(now), spent: 0, reserved: 0, budgetExhausted: false } : {}) };
  // Finish exposing one broadcast before starting another, including deferred busy guests.
  if (next.watchedMs >= next.nextAnnouncementAt && !next.announcement?.pending.length) {
    const id = (next.announcement?.id ?? 0) + 1;
    const text = nextParkAnnouncement(next.announcement?.text);
    const snapshot = summarizePark(currentPark(next, park), /free hot dogs/i.test(text));
    next.announcement = { id, text, at: now, park: snapshot, pending: guests.map(guest => guest.id), total: guests.length, processed: 0, changed: 0, stayed: 0, responded: 0 };
    next.nextAnnouncementAt = next.watchedMs + announcementDelay();
  }
  if (next.announcement) {
    const alive = new Set(guests.map(guest => guest.id));
    next.announcement = { ...next.announcement, pending: next.announcement.pending.filter(id => alive.has(id)) };
  }
  return next;
}

export function buildWatchBatch(world: WatchWorld, park: GameState, _now?: number): { actors: WatchActor[]; park: ParkState; announcement?: string } {
  const pending = new Set(world.announcement?.pending);
  const broadcast = world.announcement?.pending.length && world.guests.some(guest => pending.has(guest.id) &&
    ['walking', 'entering', 'queuing', 'leaving'].includes(guest.state)) ? world.announcement : undefined;
  const guests = world.guests.filter(guest => broadcast
    ? pending.has(guest.id) && ['walking', 'entering', 'queuing', 'leaving'].includes(guest.state)
    : isDecisionBoundary(guest)).sort((a, b) => (world.lastDecided?.[a.id] ?? 0) - (world.lastDecided?.[b.id] ?? 0)).slice(0, 8);
  const snapshot = broadcast?.park ?? summarizePark(currentPark(world, park), false);
  const actors = guests.map(guest => {
    const { hunger, thirst, energy, bathroom, nausea, happiness, cash, preferExcitement, preferIntensity, timeInPark } = guest;
    const actions = getGuestActions(park.grid, guest, snapshot.freeHotdogs, broadcast?.text);
    if (broadcast) actions.push({ id: 'continue', kind: 'continue', label: 'Keep current plan', price: 0, distance: 0, queue: 0, path: [] });
    return { id: guest.id, guest: { hunger, thirst, energy, bathroom, nausea, happiness, cash, preferExcitement, preferIntensity, timeInPark, ridesRidden: guest.ridesRidden.slice(-32), activity: guest.state }, actions };
  });
  return { actors, park: snapshot, ...(broadcast ? { announcement: broadcast.text } : {}) };
}

export function applyWatchDecisions(world: WatchWorld, actors: WatchActor[], decisions: { id: string; action: string }[], mode: 'live' | 'offline', now: number): WatchWorld {
  const accepted = new Map<string, GuestAction>();
  const feed: WatchFeed[] = [];
  for (const decision of decisions) {
    if (accepted.has(decision.id)) continue;
    const actor = actors.find(actor => actor.id === decision.id);
    const action = actor?.actions.find(action => action.id === decision.action);
    const guest = world.guests.find(guest => guest.id === decision.id);
    if (!action || !guest) continue;
    accepted.set(guest.id, action);
    const broadcast = world.announcement?.pending.includes(guest.id) ? world.announcement : undefined;
    const related = broadcast && announcedAttraction(broadcast.text, action.label);
    feed.push({ id: world.decisionCount + feed.length + 1, guestId: guest.id, name: guest.name,
      action: action.kind === 'continue' ? 'Kept their plan' : action.kind === 'leave' ? 'Headed for the exit' : action.kind === 'wait' ? 'Took a break' : `Chose ${action.label}`,
      mode, time: now, kind: action.kind, ...(broadcast ? { broadcast: true } : {}),
      ...(related ? { radio: { id: broadcast.id, text: broadcast.text, at: broadcast.at } } : {}) });
  }
  return { ...world, guests: world.guests.map(guest => accepted.has(guest.id) ? applyWatchAction(guest, accepted.get(guest.id)!) : guest),
    lastDecided: Object.fromEntries(world.guests.map(guest => [guest.id, accepted.has(guest.id) ? now : world.lastDecided?.[guest.id] ?? 0])),
    feed: [...feed.reverse(), ...world.feed].filter(entry => entry.kind !== 'continue').slice(0, 50), mode, decisionCount: world.decisionCount + accepted.size,
    ...(world.announcement ? { announcement: { ...world.announcement,
      pending: world.announcement.pending.filter(id => !accepted.has(id)),
      processed: world.announcement.processed + feed.filter(entry => entry.broadcast).length,
      responded: (world.announcement.responded ?? 0) + feed.filter(entry => entry.radio).length,
      changed: world.announcement.changed + feed.filter(entry => entry.broadcast && entry.kind !== 'continue').length,
      stayed: world.announcement.stayed + feed.filter(entry => entry.broadcast && entry.kind === 'continue').length,
    } } : {}) };
}
