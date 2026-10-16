import { describe, expect, it } from 'vitest';
import { createGuest } from '@/components/coaster/guests/guestSystem';
import { detectGuestStories } from './guestStories';
import type { Tile } from '@/games/coaster/types/game';

const visitor = () => ({ ...createGuest(1, 1, 60), name: 'Ada Park', state: 'walking' as const,
  ridesRidden: ['1,1', '2,2'], nausea: 0 });

describe('guest stories', () => {
  it('reports a third completed ride once, with the real identity', () => {
    const before = visitor();
    const after = { ...before, ridesRidden: [...before.ridesRidden, '3,3'] };
    expect(detectGuestStories([before], [after], 100)).toEqual([{
      id: `${before.id}:three-rides`, guestId: before.id, name: 'Ada Park',
      icon: '🏆', text: 'Three rides. Still standing.', at: 100,
    }]);
    expect(detectGuestStories([after], [after], 200)).toEqual([]);
    expect(detectGuestStories([], [after], 200)).toEqual([]);
  });

  it('counts repeat visits to the same ride, rather than all rides', () => {
    const before = visitor();
    const after = { ...before, ridesRidden: [...before.ridesRidden, '1,1'] };
    expect(detectGuestStories([before], [after], 100)[0].text).toBe('Same ride. Round 2.');
  });

  it('reports nausea only when a completed ride crosses the threshold', () => {
    const before = { ...visitor(), nausea: 38 };
    const after = { ...before, nausea: 46, ridesRidden: [...before.ridesRidden, '3,3'] };
    expect(detectGuestStories([before], [after], 100)[0].icon).toBe('😵‍💫');
    expect(detectGuestStories([before], [{ ...before, nausea: 46 }], 100)).toEqual([]);
  });

  it('distinguishes a hungry food purchase from a drink or ongoing meal', () => {
    const before = { ...visitor(), hunger: 80 };
    const after = { ...before, state: 'eating' as const, targetPurchaseKind: 'food' as const };
    expect(detectGuestStories([before], [after], 100)[0].text).toBe('Snack secured.');
    expect(detectGuestStories([after], [after], 200)).toEqual([]);
    expect(detectGuestStories([before], [{ ...after, targetPurchaseKind: 'drink' }], 100)).toEqual([]);
  });

  it('needs a real shopping expense to mention a nearly empty wallet', () => {
    const before = { ...visitor(), cash: 12 };
    const after = { ...before, cash: 7, state: 'shopping' as const, targetPurchaseKind: null };
    expect(detectGuestStories([before], [after], 100)[0].icon).toBe('🎁');
    expect(detectGuestStories([before], [{ ...after, targetPurchaseKind: 'restroom' }], 100)).toEqual([]);
    expect(detectGuestStories([after], [after], 200)).toEqual([]);
  });

  it('excludes scenic attendance from ride milestones when a grid is available', () => {
    const grid = Array.from({ length: 5 }, (_, y) => Array.from({ length: 5 }, (_, x) => ({
      x, y, building: { type: 'empty' },
    }))) as Tile[][];
    grid[1][1].building.type = 'ride_carousel';
    grid[2][2].building.type = 'station_wooden_1';
    grid[3][3].building.type = 'fountain_small_1';
    grid[4][4].building.type = 'ride_ferris_led';
    const before = visitor();
    const show = { ...before, ridesRidden: [...before.ridesRidden, '3,3'], nausea: 45 };
    expect(detectGuestStories([before], [show], 100, grid)).toEqual([]);
    const thirdRide = { ...show, ridesRidden: [...show.ridesRidden, '4,4'] };
    expect(detectGuestStories([show], [thirdRide], 200, grid)[0].text).toBe('Three rides. Still standing.');
    const repeatShow = { ...show, ridesRidden: [...show.ridesRidden, '3,3'] };
    expect(detectGuestStories([show], [repeatShow], 300, grid)).toEqual([]);
  });

  it('limits simultaneous story candidates to three', () => {
    const previous = Array.from({ length: 8 }, visitor);
    const current = previous.map(guest => ({ ...guest, ridesRidden: [...guest.ridesRidden, '3,3'] }));
    expect(detectGuestStories(previous, current, 100)).toHaveLength(3);
  });
});
