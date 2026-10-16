import { describe, expect, it } from 'vitest';
import { createGuest } from '@/components/coaster/guests/guestSystem';
import { assignGuestGroups, companionAction, guestPersonality, guestSocialContext, personalizeGuest, personalityAction } from './guestPersonality';

const visitor = (id: string) => ({ ...createGuest(1, 1, 60), id, recurringCharacter: undefined, groupId: undefined,
  hunger: 10, thirst: 10, bathroom: 10, energy: 90, nausea: 0 });

describe('guest personalities and friends', () => {
  it('derives a stable identity and physical preferences without random decisions', () => {
    const guest = visitor('stable-person');
    const a = personalizeGuest(guest), b = personalizeGuest(guest);
    expect(a).toEqual(b);
    expect(a.personality).toBeDefined();
    expect(a.preferIntensity).toBe(guestPersonality(a).preferIntensity);
    expect(guestPersonality({ id: 'different', personality: 'cautious' }).preferIntensity).toBe(2);
  });

  it('creates a minority of parties with matching outfits and keeps assignments stable', () => {
    const guests = Array.from({ length: 24 }, (_, i) => visitor(`friend-${i}`));
    const grouped = assignGuestGroups(guests);
    expect(grouped.filter(guest => guest.groupId)).toHaveLength(6);
    const group = grouped.filter(guest => guest.groupId === grouped.find(item => item.groupId)!.groupId);
    expect(group).toHaveLength(3);
    expect(new Set(group.map(guest => guest.shirtColor)).size).toBe(1);
    expect(assignGuestGroups(grouped)).toEqual(grouped);
    expect(guests.every(guest => !guest.groupId)).toBe(true);
  });

  it('offers a reachable friend destination, while urgent needs take priority', () => {
    const guest = { ...visitor('follower'), groupId: 'party-1' };
    const friend = { ...visitor('leader'), groupId: 'party-1', targetBuildingId: '4,5', name: 'Friendly Fran' };
    const strangers = { ...visitor('stranger'), groupId: 'party-2', targetBuildingId: '2,2' };
    const actions = [{ id: 'ride:4,5', buildingId: '4,5' }];
    expect(guestSocialContext(guest, [guest, friend, strangers]).friends).toEqual(['Friendly Fran']);
    expect(companionAction(guest, [guest, friend], actions)).toBe('ride:4,5');
    expect(companionAction(guest, [guest, friend], [{ id: 'ride:4,5' }])).toBe('ride:4,5');
    expect(companionAction({ ...guest, thirst: 80 }, [guest, friend], actions)).toBeUndefined();
    expect(companionAction(guest, [guest, friend], [])).toBeUndefined();
  });

  it('waits for nearby busy friends only when waiting is legal and needs allow it', () => {
    const guest = { ...visitor('follower'), groupId: 'party-1' };
    const friend = { ...visitor('leader'), groupId: 'party-1', state: 'eating' as const, targetBuildingId: '4,5' };
    const actions = [{ id: 'wait' }, { id: 'food:4,5', buildingId: '4,5' }];
    expect(companionAction(guest, [guest, friend], actions)).toBe('wait');
    expect(companionAction({ ...guest, hunger: 80 }, [guest, friend], actions)).toBeUndefined();
    expect(companionAction(guest, [guest, friend], [actions[1]])).toBe('food:4,5');
    expect(companionAction(guest, [guest, { ...friend, tileX: 40 }], actions)).toBe('food:4,5');
  });

  it('matches personality to legal rides and leaves urgent needs to normal decisions', () => {
    const actions = [{ id: 'ride:1,1', kind: 'ride', label: 'Wooden Coaster' },
      { id: 'ride:2,2', kind: 'ride', label: 'Carousel' }];
    const guest = visitor('picker');
    expect(personalityAction({ ...guest, personality: 'cautious' }, actions)).toBe('ride:2,2');
    expect(personalityAction({ ...guest, personality: 'thrill-seeker' }, actions)).toBe('ride:1,1');
    expect(personalityAction({ ...guest, personality: 'thrill-seeker', thirst: 80 }, actions)).toBeUndefined();
    expect(personalityAction({ ...guest, personality: 'cautious' }, [actions[0]])).toBeUndefined();
  });

  it('lets foodies snack and collectors shop occasionally rather than every decision', () => {
    const guest = { ...visitor('occasional'), hunger: 35 };
    const actions = [{ id: 'food:1,1', kind: 'food' }, { id: 'shop:2,2', kind: 'shop' }];
    const food = Array.from({ length: 4 }, (_, i) => personalityAction({ ...guest, personality: 'foodie', timeInPark: i * 600 }, actions));
    const shops = Array.from({ length: 4 }, (_, i) => personalityAction({ ...guest, personality: 'collector', timeInPark: i * 600 }, actions));
    expect(food.filter(Boolean)).toEqual(['food:1,1']);
    expect(shops.filter(Boolean)).toEqual(['shop:2,2']);
  });

  it('lets bargain hunters choose the cheapest affordable snack occasionally', () => {
    const guest = { ...visitor('bargain'), personality: 'bargain-hunter' as const, hunger: 35, cash: 5 };
    const choices = [
      { id: 'food:paid', kind: 'food', price: 4 },
      { id: 'food:free', kind: 'food', price: 0 },
      { id: 'food:expensive', kind: 'food', price: 10 },
    ];
    const visits = Array.from({ length: 4 }, (_, i) => ({ ...guest, timeInPark: i * 600 }));
    expect(visits.map(item => personalityAction(item, choices)).filter(Boolean)).toEqual(['food:free']);
    expect(visits.map(item => personalityAction(item, choices.filter(action => action.price > 0))).filter(Boolean)).toEqual(['food:paid']);
    expect(visits.map(item => personalityAction({ ...item, hunger: 80 }, choices)).filter(Boolean)).toEqual([]);
    expect(visits.map(item => personalityAction(item, [choices[2]])).filter(Boolean)).toEqual([]);
    expect(guestPersonality(guest).label).toBe('Bargain hunter');
  });

  it('gives rare recurring characters the same recognizable name and outfit', () => {
    const base = visitor('base');
    const characters = Array.from({ length: 1000 }, (_, i) => personalizeGuest({ ...base, id: `character-${i}` }))
      .filter(guest => guest.recurringCharacter);
    expect(characters.length).toBeGreaterThan(0);
    expect(characters.length).toBeLessThan(30);
    for (const character of characters) {
      expect(character.hasHat).toBe(true);
      expect(['Banana Bob', 'Auntie Chaos', 'Professor Queue']).toContain(character.name);
      expect(personalizeGuest(character)).toEqual(character);
    }
  });
});
