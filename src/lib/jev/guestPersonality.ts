import type { Guest } from '@/games/coaster/types/economy';

type Personality = NonNullable<Guest['personality']>;
const profiles = {
  'thrill-seeker': { label: 'Thrill seeker', icon: '🎢', preferExcitement: 9, preferIntensity: 8, nauseaTolerance: 9 },
  foodie: { label: 'Foodie', icon: '🌭', preferExcitement: 5, preferIntensity: 4, nauseaTolerance: 6 },
  sightseer: { label: 'Sightseer', icon: '📷', preferExcitement: 4, preferIntensity: 3, nauseaTolerance: 6 },
  collector: { label: 'Collector', icon: '🎁', preferExcitement: 6, preferIntensity: 5, nauseaTolerance: 6 },
  'bargain-hunter': { label: 'Bargain hunter', icon: '🏷️', preferExcitement: 5, preferIntensity: 4, nauseaTolerance: 6 },
  cautious: { label: 'Cautious', icon: '🌼', preferExcitement: 3, preferIntensity: 2, nauseaTolerance: 3 },
} satisfies Record<Personality, object>;

const hashId = (id: string) => {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
};

export function guestPersonality(guest: Pick<Guest, 'id' | 'personality'>) {
  const keys = Object.keys(profiles) as Personality[];
  const key = guest.personality ?? keys[hashId(guest.id) % keys.length];
  return { key, ...profiles[key] };
}

export function personalizeGuest(guest: Guest): Guest {
  const profile = guestPersonality(guest);
  const hash = hashId(guest.id);
  const character = hash % 97 === 0 ? ['banana-bob', 'auntie-chaos', 'professor-queue'][Math.floor(hash / 97) % 3] as NonNullable<Guest['recurringCharacter']> : undefined;
  const characterStyle = character === 'banana-bob' ? { name: 'Banana Bob', shirtColor: '#ffe442', hatColor: '#ffe442', pantsColor: '#82562b', hasHat: true } :
    character === 'auntie-chaos' ? { name: 'Auntie Chaos', shirtColor: '#ff59b7', hatColor: '#a956ff', pantsColor: '#483087', hasHat: true } :
      character === 'professor-queue' ? { name: 'Professor Queue', shirtColor: '#e6f2ed', hatColor: '#3652bd', pantsColor: '#3652bd', hasHat: true } : {};
  return { ...guest, personality: profile.key, preferExcitement: profile.preferExcitement,
    preferIntensity: profile.preferIntensity, nauseaTolerance: profile.nauseaTolerance,
    ...(character ? { recurringCharacter: character } : {}), ...characterStyle };
}

/** One party of three per twelve visitors; existing parties survive snapshot reloads. */
export function assignGuestGroups(guests: Guest[]): Guest[] {
  if (guests.some(guest => guest.groupId)) return guests;
  const unassigned = guests.filter(guest => !guest.groupId && !guest.recurringCharacter).sort((a, b) => a.id.localeCompare(b.id));
  const groups = new Map<string, { id: string; color: string }>();
  for (let i = 0; i + 2 < unassigned.length; i += 12) {
    const leader = unassigned[i];
    const group = { id: `friends:${leader.id}`, color: leader.shirtColor };
    for (const friend of unassigned.slice(i, i + 3)) groups.set(friend.id, group);
  }
  return guests.map(guest => {
    const group = groups.get(guest.id);
    return group ? { ...guest, groupId: group.id, shirtColor: group.color } : guest;
  });
}

export function guestSocialContext(guest: Guest, guests: Guest[]) {
  const companions = guest.groupId ? guests.filter(other => other.groupId === guest.groupId && other.id !== guest.id && other.state !== 'leaving') : [];
  const heading = companions.find(other => other.targetBuildingId);
  return { personality: guestPersonality(guest).label, ...(guest.groupId ? { groupId: guest.groupId } : {}),
    friends: companions.map(other => other.name), ...(heading?.targetBuildingId ? { destination: heading.targetBuildingId } : {}) };
}

export function companionAction(guest: Guest, guests: Guest[], actions: { id: string; buildingId?: string }[]): string | undefined {
  if (!guest.groupId || guest.hunger > 65 || guest.thirst > 65 || guest.bathroom > 65 || guest.energy < 30 || guest.nausea > 55) return undefined;
  const busyFriend = guests.some(friend => friend.id !== guest.id && friend.groupId === guest.groupId &&
    ['eating', 'shopping', 'riding', 'queuing'].includes(friend.state) &&
    Math.abs(friend.tileX - guest.tileX) + Math.abs(friend.tileY - guest.tileY) <= 4);
  if (busyFriend && actions.some(action => action.id === 'wait')) return 'wait';
  const destination = guestSocialContext(guest, guests).destination;
  return destination ? actions.find(action => (action.buildingId ?? action.id.split(':')[1]) === destination)?.id : undefined;
}

/** Personality nudges only choose from legal actions; pressing needs always win. */
export function personalityAction(guest: Guest, actions: { id: string; kind: string; label?: string; price?: number }[]): string | undefined {
  if (guest.hunger > 55 || guest.thirst > 55 || guest.bathroom > 65 || guest.energy < 30 || guest.nausea > 55) return undefined;
  const affordable = actions.filter(action => action.price == null || (action.price >= 0 && action.price <= guest.cash));
  const personality = guestPersonality(guest).key;
  const occasional = (hashId(guest.id) + Math.floor(guest.timeInPark / 600)) % 4 === 0;
  if (personality === 'bargain-hunter' && guest.hunger >= 25 && occasional) {
    return affordable.filter(action => action.kind === 'food' && action.price != null && action.price >= 0 && action.price <= guest.cash)
      .sort((a, b) => a.price! - b.price!)[0]?.id;
  }
  if (personality === 'foodie' && guest.hunger >= 25 && occasional) return affordable.find(action => action.kind === 'food')?.id;
  if (personality === 'collector' && guest.cash >= 25 && occasional) return affordable.find(action => action.kind === 'shop')?.id;
  const preferred = personality === 'cautious' ? /carousel|ferris|wheel|teacup|train|boat/i :
    personality === 'thrill-seeker' ? /coaster|drop|swing|rocket|tower/i : personality === 'sightseer' ? /wheel|train|boat|observation/i : undefined;
  return preferred ? affordable.find(action => action.kind === 'ride' && preferred.test(action.label ?? ''))?.id : undefined;
}
