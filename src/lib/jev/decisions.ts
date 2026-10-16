import { DEFAULT_PRICES, type Guest } from '@/games/coaster/types/economy';
import { attractionActivity } from './attractionActivity';
import { findSpectacleVenue, spectacleForAnnouncement } from './spectacles';
import { TOOL_INFO, type Tile, type Tool } from '@/games/coaster/types/game';

export type ActionKind = 'ride' | 'food' | 'drink' | 'shop' | 'restroom' | 'wait' | 'leave' | 'continue';
export type GuestAction = {
  id: string;
  kind: ActionKind;
  label: string;
  price: number;
  distance: number;
  queue: number;
  path: { x: number; y: number }[];
  buildingId?: string;
};

const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const key = (x: number, y: number) => `${x},${y}`;

export function attractionName(type: string): string {
  if (type.startsWith('station_wooden_')) return 'Wooden coaster';
  if (type.startsWith('station_steel_')) return 'Steel coaster';
  return TOOL_INFO[type as Tool]?.name ?? type.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
}

export function isDecisionBoundary(guest: Guest): boolean {
  return (guest.state === 'walking' || guest.state === 'entering') &&
    guest.progress === 0 && guest.path.length === 0 && !guest.targetBuildingId &&
    !guest.queueRideId && guest.decisionCooldown <= 0;
}

export function getGuestActions(grid: Tile[][], guest: Guest, freeHotdogs = false, announcement = '', guests: Guest[] = [], allReachable = false): GuestAction[] {
  const size = grid.length;
  const start = key(guest.tileX, guest.tileY);
  if (!grid[guest.tileY]?.[guest.tileX]?.path && !grid[guest.tileY]?.[guest.tileX]?.queue) {
    return announcement ? [] : [{ id: 'wait', kind: 'wait', label: 'Wait for a path', price: 0, distance: 0, queue: 0, path: [] }];
  }

  // One breadth-first search serves every destination for this guest.
  const previous = new Map<string, string | null>([[start, null]]);
  const queue = [{ x: guest.tileX, y: guest.tileY }];
  for (let head = 0; head < queue.length; head++) {
    const { x, y } = queue[head];
    for (const [dx, dy] of directions) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (!grid[ny][nx].path && !grid[ny][nx].queue) continue;
      const nextKey = key(nx, ny);
      if (previous.has(nextKey)) continue;
      previous.set(nextKey, key(x, y));
      queue.push({ x: nx, y: ny });
    }
  }

  const route = (destination: string) => {
    const path: { x: number; y: number }[] = [];
    let cursor: string | null | undefined = destination;
    while (cursor && cursor !== start) {
      const [x, y] = cursor.split(',').map(Number);
      path.push({ x, y });
      cursor = previous.get(cursor);
    }
    return path.reverse();
  };

  const show = spectacleForAnnouncement(announcement);
  const venue = show ? findSpectacleVenue(grid, show) : undefined;
  const activity = attractionActivity(guests);
  const candidates: GuestAction[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const type = grid[y][x].building?.type ?? '';
    if (type.endsWith('_footprint')) continue;
    let kind: ActionKind | null = null;
    if (type.startsWith('ride_') || type.startsWith('show_') || type.startsWith('station_')) kind = 'ride';
    else if (type.startsWith('drink_')) kind = 'drink';
    else if (type.startsWith('food_') || type.startsWith('snack_') || type.startsWith('cart_')) kind = 'food';
    else if (type === 'restroom') kind = 'restroom';
    else if (type.startsWith('shop_') || type.startsWith('game_') || type === 'arcade_building') kind = 'shop';
    const isVenue = venue?.x === x && venue?.y === y;
    const scenicShow = isVenue && (show === 'fountain' || show === 'fireworks');
    if (scenicShow) kind = 'ride';
    if (!kind) continue;
    const reachable = directions.map(([dx, dy]) => key(x + dx, y + dy))
      .filter(tile => previous.has(tile))
      .map(tile => route(tile))
      .sort((a, b) => a.length - b.length)[0];
    if (!reachable) continue;
    const price = freeHotdogs && type === 'food_hotdog' ? 0 : kind === 'drink' ? DEFAULT_PRICES.drinkItem :
      kind === 'food' ? DEFAULT_PRICES.foodItem : kind === 'shop' ? DEFAULT_PRICES.shopItem : 0;
    if (guest.cash < price) continue;
    candidates.push({ id: `${kind}:${x},${y}`, kind, label: scenicShow ? show === 'fountain' ? 'Fountain show' : 'Fireworks' : attractionName(type), price,
      distance: reachable.length, queue: activity.get(key(x, y))?.queued ?? 0, path: reachable, buildingId: key(x, y) });
  }

  const crowdCost = (action: GuestAction) => {
    const use = action.buildingId ? activity.get(action.buildingId) : undefined;
    return action.distance + action.queue * 4 + (use?.heading ?? 0) * 2 + (use?.riding ?? 0);
  };
  candidates.sort((a, b) => crowdCost(a) - crowdCost(b) || a.id.localeCompare(b.id));
  // Acceptance validates reachability, not the changing shortlist's crowd ranking.
  const picked: GuestAction[] = allReachable ? [...candidates] : [];
  const promoted = candidates.find(candidate => announcedAttraction(announcement, candidate.label) &&
    (!show || candidate.buildingId === `${venue?.x},${venue?.y}`));
  // Radio offers a specific detour; unrelated needs stay in the normal decision loop.
  if (announcement) return allReachable ? candidates.filter(candidate => announcedAttraction(announcement, candidate.label) &&
    (!show || candidate.buildingId === `${venue?.x},${venue?.y}`)) : promoted ? [promoted] : [];
  for (const kind of ['ride', 'food', 'drink', 'shop', 'restroom'] as const) {
    const first = kind === 'food' && freeHotdogs
      ? candidates.find(candidate => candidate.kind === 'food' && candidate.price === 0) ?? candidates.find(candidate => candidate.kind === kind)
      : candidates.find(candidate => candidate.kind === kind);
    if (first && !picked.some(item => item.id === first.id)) picked.push(first);
  }
  const friendDestination = guest.groupId ? guests.find(other => other.id !== guest.id && other.groupId === guest.groupId && other.targetBuildingId)?.targetBuildingId : undefined;
  const friendOption = candidates.find(candidate => candidate.buildingId === friendDestination);
  if (friendOption && !picked.some(item => item.id === friendOption.id)) picked.push(friendOption);
  for (const candidate of [...candidates.filter(item => item.kind === 'ride'), ...candidates]) {
    if (picked.length >= 7) break;
    if (!picked.some(item => item.id === candidate.id)) picked.push(candidate);
  }
  const exits = queue.filter(({ x, y }) => x === 0 || y === 0 || x === size - 1 || y === size - 1)
    .map(({ x, y }) => route(key(x, y))).sort((a, b) => a.length - b.length);
  if (exits[0]) picked.push({ id: 'leave', kind: 'leave', label: 'Leave the park', price: 0,
    distance: exits[0].length, queue: 0, path: exits[0] });
  picked.push({ id: 'wait', kind: 'wait', label: 'Rest here', price: 0, distance: 0, queue: 0, path: [] });
  return picked;
}

type ChoosingGuest = Pick<Guest, 'hunger' | 'thirst' | 'energy' | 'happiness' | 'cash' | 'preferExcitement'> &
  Partial<Pick<Guest, 'id' | 'bathroom' | 'nausea' | 'timeInPark' | 'ridesRidden'>>;

export function chooseOffline(guest: ChoosingGuest, actions: (Pick<GuestAction, 'id' | 'kind' | 'distance'> & Partial<Pick<GuestAction, 'queue'>>)[]): string {
  const visited = guest.timeInPark ?? 0;
  const wanted = (guest.happiness < 15 && visited > 2400) || (guest.cash < 2 && visited > 6000) ? 'leave' :
    (guest.bathroom ?? 0) > 65 ? 'restroom' : guest.hunger > 55 ? 'food' : guest.thirst > 55 ? 'drink' :
      guest.energy < 30 || (guest.nausea ?? 0) > 55 ? 'wait' : 'ride';
  if (wanted === 'ride') {
    const seed = guest.id ?? `${guest.preferExcitement}-${guest.cash}`;
    const score = (action: typeof actions[number]) => {
      let hash = 0;
      for (const character of `${seed}:${guest.preferExcitement}:${action.id}`) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
      const repeated = guest.ridesRidden?.includes(action.id.split(':')[1]) ? 25 : 0;
      return action.distance * .2 + (action.queue ?? 0) * 2 + hash % 100 / 10 + repeated;
    };
    const rides = actions.filter(action => action.kind === 'ride').sort((a, b) => score(a) - score(b));
    if (rides[0]) return rides[0].id;
  }
  return actions.find(action => action.kind === wanted)?.id ??
    actions.find(action => action.kind === 'food')?.id ?? actions.find(action => action.kind === 'drink')?.id ??
    actions.find(action => action.kind === 'shop')?.id ?? actions.find(action => action.kind === 'ride')?.id ?? 'wait';
}

export function announcedAttraction(announcement: string, label: string): boolean {
  return [/parade/i, /ferris wheel/i, /carousel/i, /sky swing/i, /hot\s*dogs?/i, /fountain show/i, /fireworks/i]
    .some(pattern => pattern.test(announcement) && pattern.test(label));
}

export function chooseOfflineAnnouncement(guest: Pick<Guest, 'hunger' | 'thirst' | 'energy' | 'happiness' | 'cash' | 'preferExcitement'> & Partial<Pick<Guest, 'id'>>, 
  actions: (Pick<GuestAction, 'id' | 'kind' | 'price'> & Partial<Pick<GuestAction, 'label'>>)[], announcement: string): string {
  if (/free\s+hot\s*dogs?/i.test(announcement)) {
    const freeFood = actions.find(action => action.kind === 'food' && action.price === 0);
    if (freeFood && (guest.hunger > 30 || guest.cash < 20)) return freeFood.id;
  }
  if (/mascot|escaped|panic/i.test(announcement) && guest.happiness < 40) {
    return actions.find(action => action.kind === 'leave')?.id ?? 'continue';
  }
  if (guest.thirst > 80) return actions.find(action => action.kind === 'drink')?.id ?? 'continue';
  const attraction = actions.find(action => action.label && announcedAttraction(announcement, action.label));
  let interest = 0;
  for (const character of `${guest.id ?? guest.preferExcitement}:${announcement}`) interest = (interest * 31 + character.charCodeAt(0)) >>> 0;
  if (attraction && guest.hunger < 70 && guest.thirst < 65 && guest.energy > 25 && interest % 100 < 45) return attraction.id;
  return 'continue';
}
