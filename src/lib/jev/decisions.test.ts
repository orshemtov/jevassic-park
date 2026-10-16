import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chargeGuestForActivity, createGuest, updateGuest } from '@/components/coaster/guests/guestSystem';
import { attractionName, chooseOffline, chooseOfflineAnnouncement, getGuestActions, isDecisionBoundary } from './decisions';
import { applyWatchAction } from './watchEngine';
import type { Tile } from '@/games/coaster/types/game';

const grid = Array.from({ length: 5 }, (_, y) => Array.from({ length: 5 }, (_, x) => ({
  x, y, path: y === 2, queue: false, building: { type: 'empty' },
}))) as Tile[][];
grid[1][2].building.type = 'ride_carousel';
grid[1][4].building.type = 'drink_soda';
grid[1][3].building.type = 'food_burger';
grid[1][3].building.type = 'food_hotdog';

describe('guest decisions', () => {
  it('offers only reachable affordable actions and keeps leave and wait legal', () => {
    const guest = { ...createGuest(0, 2, 5), tileX: 1, tileY: 2, cash: 10 };
    const actions = getGuestActions(grid, guest);
    expect(actions.map(action => action.id)).toEqual(['ride:2,1', 'food:3,1', 'drink:4,1', 'leave', 'wait']);
    expect(actions.find(action => action.kind === 'ride')?.path).toEqual([{ x: 2, y: 2 }]);
    expect(actions.length).toBeLessThanOrEqual(8);
  });

  it('never invents an offline action', () => {
    const actions = getGuestActions(grid, { ...createGuest(0, 2, 5), cash: 10 });
    expect(chooseOffline({ hunger: 20, thirst: 90, energy: 60, happiness: 80, cash: 10, preferExcitement: 5 }, actions)).toBe('drink:4,1');
    expect(chooseOffline({ hunger: 90, thirst: 90, energy: 60, happiness: 80, cash: 10, preferExcitement: 5 }, actions)).toBe('food:3,1');
  });

  it('holds an idle guest for Jev and completes an exit route', () => {
    const guest = { ...createGuest(0, 2, 5), state: 'walking' as const, targetTileX: 0, targetTileY: 2,
      decisionCooldown: 0 };
    expect(isDecisionBoundary(guest)).toBe(true);
    expect(updateGuest(guest, grid, 1).tileX).toBe(0);
    const leaving = { ...guest, state: 'leaving' as const, path: [{ x: 0, y: 2 }], pathIndex: 1, progress: .99 };
    const arrived = updateGuest(leaving, grid, 1);
    expect(arrived.state).toBe('leaving');
    expect(arrived.path).toEqual([]);
  });

  it('charges the chosen food or drink price once at arrival', () => {
    const guest = createGuest(0, 2, 5);
    const drink = chargeGuestForActivity({ ...guest, state: 'eating', lastState: 'walking', targetPurchaseKind: 'drink' }, false);
    const food = chargeGuestForActivity({ ...guest, state: 'eating', lastState: 'walking', targetPurchaseKind: 'food' }, false);
    expect(drink.fee).toBe(2);
    expect(food.fee).toBe(3);
    expect(chargeGuestForActivity({ ...drink.guest, lastState: 'eating' }, false).fee).toBe(0);
  });

  it('offers a real free hotdog and lets a busy guest react or continue', () => {
    const guest = { ...createGuest(0, 2, 5), tileX: 1, tileY: 2, cash: 0, hunger: 80 };
    const actions = getGuestActions(grid, guest, true);
    expect(actions.find(action => action.id === 'food:3,1')?.price).toBe(0);
    expect(chooseOfflineAnnouncement(guest, [{ id: 'continue', kind: 'continue', price: 0 }, ...actions],
      'The hotdog stand is giving away free hot dogs!')).toBe('food:3,1');
    const charged = chargeGuestForActivity({ ...guest, state: 'eating', lastState: 'walking',
      targetPurchaseKind: 'food', freeHotdogVoucher: true }, false);
    expect(charged.fee).toBe(0);
    expect(charged.guest.freeHotdogVoucher).toBe(false);
  });
});

it('names coaster stations as rides rather than exposing asset IDs', () => {
  expect(attractionName('station_wooden_1')).toBe('Wooden coaster');
  expect(attractionName('station_steel_2')).toBe('Steel coaster');
  expect(attractionName('food_hotdog')).toBe('Hot Dog Stand');
});

it('routes urgent guests to a free restroom and relieves the need without shop charges', () => {
  const facilities = structuredClone(grid);
  facilities[1][0].building.type = 'restroom';
  const guest = { ...createGuest(1, 2, 5), bathroom: 95, hunger: 20, thirst: 20, energy: 90 };
  const actions = getGuestActions(facilities, guest);
  const chosen = chooseOffline(guest, actions);
  expect(chosen).toBe('restroom:0,1');
  const routed = applyWatchAction(guest, actions.find(action => action.id === chosen)!);
  expect(routed.targetPurchaseKind).toBe('restroom');
  const arrived = { ...routed, state: 'shopping' as const, lastState: 'walking' as const, queueTimer: 1 };
  expect(chargeGuestForActivity(arrived, false).fee).toBe(0);
  expect(updateGuest(arrived, facilities, 1).bathroom).toBe(0);
});

it('rest actually restores energy and nausea rather than trapping tired guests', () => {
  let guest = { ...createGuest(1, 2, 5), state: 'walking' as const, hunger: 10, thirst: 10, bathroom: 10,
    energy: 10, nausea: 70, happiness: 80, decisionCooldown: 400 };
  for (let tick = 0; tick < 400; tick++) guest = updateGuest(guest, grid, 1) as typeof guest;
  expect(guest.energy).toBeGreaterThan(50);
  expect(guest.nausea).toBeLessThan(35);
  expect(isDecisionBoundary(guest)).toBe(true);
});

it('does not eject a new guest just for low cash and varies rides by identity and history', () => {
  const actions = [{ id: 'ride:2,1', kind: 'ride' as const, distance: 2 },
    { id: 'ride:3,1', kind: 'ride' as const, distance: 2 }, { id: 'leave', kind: 'leave' as const, distance: 1 }];
  const guest = { ...createGuest(1, 2, 5), cash: 0, happiness: 80, hunger: 10, thirst: 10, energy: 90 };
  expect(chooseOffline(guest, actions)).not.toBe('leave');
  expect(chooseOffline({ ...guest, timeInPark: 7000 }, actions)).toBe('leave');
  const selected = new Set(Array.from({ length: 30 }, (_, id) => chooseOffline({ ...guest, id: String(id) }, actions)));
  expect(selected.size).toBe(2);
  expect(chooseOffline({ ...guest, ridesRidden: ['2,1'] }, actions)).toBe('ride:3,1');
});

it('offers three different rides alongside services when available', () => {
  const facilities = structuredClone(grid);
  facilities[3][0].building.type = 'ride_ferris_led';
  facilities[3][1].building.type = 'ride_carousel';
  facilities[3][2].building.type = 'shop_souvenir_1';
  facilities[3][3].building.type = 'restroom';
  const actions = getGuestActions(facilities, { ...createGuest(1, 2, 5), cash: 100 });
  expect(actions.filter(action => action.kind === 'ride')).toHaveLength(3);
  expect(actions.some(action => action.kind === 'restroom')).toBe(true);
  expect(actions.length).toBeLessThanOrEqual(9);
});


it('lets every showcase ride receive guests, run, and return them to a new decision', () => {
  const park = JSON.parse(readFileSync('public/parks/showcase.json', 'utf8')) as { grid: Tile[][] };
  const rides = park.grid.flat().filter(tile => /^(ride_|station_|show_)/.test(tile.building.type) &&
    !tile.building.type.endsWith('_footprint'));
  expect(rides.length).toBeGreaterThan(20);
  for (const ride of rides) {
    const entrance = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => park.grid[ride.y + dy]?.[ride.x + dx])
      .find(tile => tile?.path || tile?.queue);
    expect(entrance, `${ride.building.type} has an accessible entrance`).toBeDefined();
    const guest = { ...createGuest(entrance!.x, entrance!.y, park.grid.length), state: 'walking' as const,
      decisionCooldown: 0, cash: 100 };
    const action = getGuestActions(park.grid, guest).find(action => action.buildingId === `${ride.x},${ride.y}`);
    expect(action?.kind, ride.building.type).toBe('ride');
    let visitor = applyWatchAction(guest, action!);
    const states = new Set<string>();
    for (let tick = 0; tick < 1000 && !visitor.ridesRidden.includes(`${ride.x},${ride.y}`); tick++) {
      visitor = updateGuest(visitor, park.grid, 1);
      states.add(visitor.state);
      if (visitor.state === 'riding') {
        expect(visitor.queueRideId).toBe(`${ride.x},${ride.y}`);
        expect(visitor.targetBuildingId).toBe(`${ride.x},${ride.y}`);
      }
    }
    expect(states.has('queuing'), ride.building.type).toBe(true);
    expect(states.has('riding'), ride.building.type).toBe(true);
    expect(visitor.ridesRidden, ride.building.type).toContain(`${ride.x},${ride.y}`);
    expect(isDecisionBoundary(visitor), ride.building.type).toBe(true);
  }
});


it('recovers idle guests waiting for a Jev turn instead of exhausting the whole crowd', () => {
  let guest = { ...createGuest(1, 2, 5), state: 'walking' as const, targetBuildingId: null,
    path: [], decisionCooldown: 0, energy: 0 };
  for (let tick = 0; tick < 1200; tick++) guest = updateGuest(guest, grid, 1) as typeof guest;
  expect(guest.energy).toBeGreaterThan(29);
  expect(isDecisionBoundary(guest)).toBe(true);
  const moving = applyWatchAction({ ...guest, energy: 50 }, getGuestActions(grid, guest).find(action => action.kind === 'ride')!);
  expect(updateGuest(moving, grid, 1).energy).toBeLessThan(50);
});


it.each([
  ['The parade is starting.', 'show_parade_float'],
  ['Visit the Ferris wheel!', 'ride_ferris_led'],
  ['The carousel riders are welcome.', 'ride_carousel'],
  ['Visit the Sky Swing!', 'ride_sky_swing'],
] as const)('offers the announced attraction even when nearer rides fill the normal menu: %s', (text, type) => {
  const facilities = Array.from({ length: 14 }, (_, y) => Array.from({ length: 14 }, (_, x) => ({
    x, y, path: y === 2, queue: false, building: { type: 'empty' },
  }))) as Tile[][];
  ['ride_teacups', 'ride_go_karts', 'ride_scrambler', 'ride_inversion', 'ride_top_spin'].forEach((type, x) => {
    facilities[1][x + 1].building.type = type as Tile['building']['type'];
  });
  ['food_hotdog', 'drink_soda', 'shop_souvenir_1', 'restroom'].forEach((type, x) => {
    facilities[3][x + 1].building.type = type as Tile['building']['type'];
  });
  facilities[1][11].building.type = type;
  const guest = { ...createGuest(0, 2, 14), cash: 100 };
  expect(getGuestActions(facilities, guest).some(action => action.id === 'ride:11,1')).toBe(false);
  const promoted = getGuestActions(facilities, guest, false, text);
  expect(promoted.some(action => action.id === 'ride:11,1')).toBe(true);
  expect(promoted.length + 1).toBeLessThanOrEqual(10);
  facilities[2][10].path = false;
  expect(getGuestActions(facilities, guest, false, text).some(action => action.id === 'ride:11,1')).toBe(false);
});

it('lets interested healthy code guests attend a parade while others keep their plans', () => {
  const actions = [{ id: 'continue', kind: 'continue' as const, label: 'Keep current plan', price: 0 },
    { id: 'ride:11,1', kind: 'ride' as const, label: 'Parade Float', price: 0 }];
  const guest = { ...createGuest(0, 2, 14), hunger: 20, thirst: 20, energy: 90, happiness: 80 };
  const choices = new Set(Array.from({ length: 50 }, (_, index) => chooseOfflineAnnouncement({ ...guest, id: String(index) }, actions, 'The parade is starting.')));
  expect(choices).toEqual(new Set(['continue', 'ride:11,1']));
  expect(chooseOfflineAnnouncement({ ...guest, energy: 0 }, actions, 'The parade is starting.')).toBe('continue');
});
