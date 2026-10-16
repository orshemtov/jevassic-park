import { chargeGuestForActivity, createGuest, updateGuest } from '@/components/coaster/guests/guestSystem';
import type { Guest } from '@/games/coaster/types/economy';
import type { GameState } from '@/games/coaster/types/game';
import { chooseOffline, getGuestActions, isDecisionBoundary, type GuestAction, type ActionKind, announcedAttraction } from './decisions';
import { createParkSpectacle, spectacleAnnouncement, spectacleForAnnouncement, type ParkSpectacle } from './spectacles';
import { assignGuestGroups, guestSocialContext, personalizeGuest, companionAction, personalityAction } from './guestPersonality';
import { guestIncident, parkRhythm, rideIncident, type ParkIncident } from './parkEvents';
import { watchEnvironment } from './environment';
export { watchEnvironment } from './environment';
import { summarizePark, type ParkState } from './parkState';
import { announcementDelay, nextParkAnnouncement, type RadioReaction } from './announcements';

export type WatchActor = { id: string; codeChoice?: string; guest: Pick<Guest, 'hunger' | 'thirst' | 'energy' | 'bathroom' | 'nausea' | 'happiness' | 'cash' | 'preferExcitement' | 'preferIntensity' | 'timeInPark' | 'ridesRidden'> & { activity: string } & ReturnType<typeof guestSocialContext>; actions: GuestAction[] };
export type WatchFeed = { id: number; guestId: string; name: string; action: string; mode: 'live' | 'offline'; time: number; kind?: ActionKind; probability?: number; broadcast?: boolean; radio?: RadioReaction };
export type WatchWorld = {
  guests: Guest[]; tick: number; feed: WatchFeed[]; mode: 'live' | 'offline'; decisionCount: number;
  population: number; detailedGuests?: number; updatedAt: number; nextDecisionAt: number; leaseUntil: number;
  lastDecided?: Record<string, number>; lastBatchBroadcast?: boolean;
  budgetExhausted?: boolean; day: string; spent: number; reserved: number; watchedMs: number; nextAnnouncementAt: number;
  spectacle?: ParkSpectacle; showCycle?: number; showsStarted?: ParkSpectacle['kind'][];
  incidents?: ParkIncident[]; nextIncidentAt?: number; rhythm?: ReturnType<typeof parkRhythm>;
  announcement?: { id: number; text: string; at: number; park: ParkState; pending: string[]; total: number; processed: number; changed: number; stayed: number; responded?: number; responders?: string[] };
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
  return { guests: assignGuestGroups(guests), tick: park.tick, feed: [], mode: 'offline', decisionCount: 0, population: Math.min(10000, Math.max(10, Math.floor(population))),
    detailedGuests, updatedAt: now, nextDecisionAt: now, leaseUntil: 0, day: day(now), spent: 0, reserved: 0, watchedMs: 0, nextAnnouncementAt: announcementDelay(true) };
}

export function advanceWatchWorld(world: WatchWorld, park: GameState, now: number, maxElapsedMs = now - world.updatedAt <= 15000 ? 15000 : 2500): WatchWorld {
  // A returning viewer advances one frame, never hours of unattended simulation.
  const elapsed = Math.max(0, Math.min(maxElapsedMs, now - world.updatedAt));
  const ticks = Math.floor(elapsed / 50);
  let guests = assignGuestGroups(world.guests.map(guest => guest.personality ? guest : personalizeGuest(guest)));
  const incidents = (world.incidents ?? []).filter(incident => incident.expiresAt > now);
  for (let i = 0; i < ticks; i++) guests = guests.map(guest => {
    const updated = chargeGuestForActivity(updateGuest({ ...guest, ridesRidden: [...guest.ridesRidden] }, park.grid, 1), park.settings.payPerRide).guest;
    const incident = rideIncident(guest, updated, park, now);
    if (incident) incidents.push(incident);
    return updated;
  }).filter(guest => !(guest.state === 'leaving' && guest.path.length === 0 && guest.progress === 0));
  const count = Math.min(1000, world.population, world.detailedGuests ?? 100);
  guests = guests.slice(0, count);
  while (guests.length < count) guests.push(spawn(park));
  const next: WatchWorld = { ...world, guests, tick: world.tick + ticks, watchedMs: world.watchedMs + ticks * 50, updatedAt: now,
    ...(world.day !== day(now) ? { day: day(now), spent: 0, reserved: 0, budgetExhausted: false } : {}) };
  next.rhythm = parkRhythm(watchEnvironment(next, park).hour);
  if (ticks && next.watchedMs >= (world.nextIncidentAt ?? 15_000)) {
    const walkers = guests.filter(guest => guest.state === 'walking' && guest.path.length > 1);
    const guest = walkers[Math.floor(Math.random() * walkers.length)];
    if (guest) {
      const kinds = ['hat', 'balloon', 'mascot', 'photo'] as const;
      const chosen = kinds[Math.floor(Math.random() * kinds.length)];
      const kind = chosen === 'hat' && !guest.hasHat ? 'photo' : chosen;
      incidents.push(guestIncident(guest, kind, now));
      if (kind === 'photo') {
        guests = guests.map(item => item.id === guest.id ? { ...item, photoPauseTicks: 40 } : item);
        next.guests = guests;
      }
      if (kind === 'hat') {
        guests = guests.map(item => item.id === guest.id ? { ...item, hasHat: false } : item);
        next.guests = guests;
      }
    }
    next.nextIncidentAt = next.watchedMs + 18_000 + Math.floor(Math.random() * 12_000);
  }
  next.incidents = incidents.slice(-8);
  if (next.spectacle && now - next.spectacle.startedAt >= next.spectacle.durationMs) delete next.spectacle;
  const cycle = Math.floor((now + 120_000) / 600_000);
  const hour = watchEnvironment(next, park).hour;
  if (next.showCycle !== cycle) {
    const returning = world.showCycle === undefined || now - world.updatedAt > 15000;
    const earlier: ParkSpectacle['kind'][] = returning && (hour < 7 || hour >= 20) ? ['parade', 'fountain'] : returning && hour >= 18 ? ['parade'] : [];
    next.showCycle = cycle; next.showsStarted = [...earlier, ...(next.spectacle ? [next.spectacle.kind] : [])];
  }
  const eligible: ParkSpectacle['kind'][] = hour < 7 || hour >= 20 ? ['parade', 'fountain', 'fireworks'] : hour >= 18 ? ['parade', 'fountain'] : hour >= 14 ? ['parade'] : [];
  const dueShow = !next.spectacle ? eligible.find(kind => !next.showsStarted?.includes(kind)) : undefined;
  // Phase shows get the next free radio slot; ordinary decisions still run between broadcasts.
  if ((dueShow || next.watchedMs >= next.nextAnnouncementAt) && !next.announcement?.pending.length) {
    const id = (next.announcement?.id ?? 0) + 1;
    const text = dueShow ? spectacleAnnouncement(dueShow) : nextParkAnnouncement(next.announcement?.text, hour, false);
    const kind = spectacleForAnnouncement(text);
    if (kind) {
      next.spectacle = createParkSpectacle(park, kind, now);
      if (next.spectacle) next.showsStarted = [...(next.showsStarted ?? []), kind];
    }
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

export function buildWatchBatch(world: WatchWorld, park: GameState, now = world.updatedAt): { actors: WatchActor[]; park: ParkState; announcement?: string } {
  const pending = new Set(world.announcement?.pending);
  const idleAfterRadio = world.guests.some(guest => !pending.has(guest.id) && isDecisionBoundary(guest));
  const broadcast = (!idleAfterRadio || world.lastBatchBroadcast === false) && world.announcement?.pending.length && world.guests.some(guest => pending.has(guest.id) &&
    ['walking', 'entering', 'queuing', 'leaving'].includes(guest.state)) ? world.announcement : undefined;
  const guests = world.guests.filter(guest => broadcast
    ? pending.has(guest.id) && ['walking', 'entering', 'queuing', 'leaving'].includes(guest.state)
    : isDecisionBoundary(guest) && (!idleAfterRadio || !pending.has(guest.id))).sort((a, b) => (world.lastDecided?.[a.id] ?? 0) - (world.lastDecided?.[b.id] ?? 0)).slice(0, broadcast && world.guests.length > 32 ? 32 : 8);
  const snapshot = broadcast?.park ?? summarizePark(currentPark(world, park), false);
  const actors = guests.map(guest => {
    const { hunger, thirst, energy, bathroom, nausea, happiness, cash, preferExcitement, preferIntensity, timeInPark } = guest;
    const show = broadcast ? spectacleForAnnouncement(broadcast.text) : undefined;
    const remaining = world.spectacle && show === world.spectacle.kind
      ? world.spectacle.startedAt + world.spectacle.durationMs - now : show ? 0 : Infinity;
    const actions = getGuestActions(park.grid, guest, snapshot.freeHotdogs, broadcast?.text, world.guests)
      .filter(action => !show || action.distance * 2500 + 20_000 <= remaining);
    if (broadcast) actions.push({ id: 'continue', kind: 'continue', label: 'Keep current plan', price: 0, distance: 0, queue: 0, path: [] });
    const codeChoice = !broadcast ? companionAction(guest, world.guests, actions) ?? personalityAction(guest, actions) : undefined;
    return { id: guest.id, ...(codeChoice ? { codeChoice } : {}), guest: { hunger, thirst, energy, bathroom, nausea, happiness, cash, preferExcitement, preferIntensity, timeInPark, ridesRidden: guest.ridesRidden.slice(-32), activity: guest.state, ...guestSocialContext(guest, world.guests) }, actions };
  });
  return { actors, park: snapshot, ...(broadcast ? { announcement: broadcast.text } : {}) };
}

export function applyWatchDecisions(world: WatchWorld, actors: WatchActor[], decisions: { id: string; action: string; probability?: number }[], mode: 'live' | 'offline', now: number): WatchWorld {
  const accepted = new Map<string, GuestAction>();
  const feed: WatchFeed[] = [];
  for (const decision of decisions) {
    if (accepted.has(decision.id)) continue;
    const actor = actors.find(actor => actor.id === decision.id);
    const action = actor?.actions.find(action => action.id === decision.action);
    const guest = world.guests.find(guest => guest.id === decision.id);
    if (!action || !guest) continue;
    accepted.set(guest.id, action);
    const broadcast = actor?.actions.some(option => option.kind === 'continue') && world.announcement?.pending.includes(guest.id) ? world.announcement : undefined;
    const related = broadcast && announcedAttraction(broadcast.text, action.label);
    feed.push({ id: world.decisionCount + feed.length + 1, guestId: guest.id, name: guest.name,
      action: action.kind === 'continue' ? 'Kept their plan' : action.kind === 'leave' ? 'Headed for the exit' : action.kind === 'wait' ? 'Took a break' : `Chose ${action.label}`,
      mode, time: now, kind: action.kind,
      ...(mode === 'live' && Number.isFinite(decision.probability) && decision.probability! >= 0 && decision.probability! <= 1 ? { probability: decision.probability } : {}), ...(broadcast ? { broadcast: true } : {}),
      ...(related ? { radio: { id: broadcast.id, text: broadcast.text, at: broadcast.at } } : {}) });
  }
  return { ...world, lastBatchBroadcast: actors.some(actor => actor.actions.some(action => action.kind === 'continue')), guests: world.guests.map(guest => accepted.has(guest.id) ? applyWatchAction(guest, accepted.get(guest.id)!) : guest),
    lastDecided: Object.fromEntries(world.guests.map(guest => [guest.id, accepted.has(guest.id) ? now : world.lastDecided?.[guest.id] ?? 0])),
    feed: [...feed.reverse(), ...world.feed].filter(entry => entry.kind !== 'continue').slice(0, 50), mode, decisionCount: world.decisionCount + accepted.size,
    ...(world.announcement?.pending.length && world.announcement.pending.every(id => feed.some(entry => entry.guestId === id && entry.broadcast))
      ? { nextAnnouncementAt: world.watchedMs + announcementDelay() } : {}),
    ...(world.announcement ? { announcement: { ...world.announcement,
      pending: world.announcement.pending.filter(id => !feed.some(entry => entry.guestId === id && entry.broadcast)),
      processed: world.announcement.processed + feed.filter(entry => entry.broadcast).length,
      responded: (world.announcement.responded ?? 0) + feed.filter(entry => entry.radio).length,
      responders: [...new Set([...(world.announcement.responders ?? []), ...feed.filter(entry => entry.radio).map(entry => entry.guestId)])].slice(-1000),
      changed: world.announcement.changed + feed.filter(entry => entry.broadcast && entry.kind !== 'continue').length,
      stayed: world.announcement.stayed + feed.filter(entry => entry.broadcast && entry.kind === 'continue').length,
    } } : {}) };
}
