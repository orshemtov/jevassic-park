import { describe, expect, it } from 'vitest';
import { createGuest } from '@/components/coaster/guests/guestSystem';
import { guestVisualOffset, reconcileSpectatorGuests } from './spectatorMotion';

const walking = () => ({ ...createGuest(10, 10, 60), state: 'walking' as const,
  targetTileX: 11, targetTileY: 10, progress: .8 });

describe('spectator motion', () => {
  it('preserves a walking guest visible position when a delayed authoritative frame arrives', () => {
    const old = walking();
    const incoming = { ...old, progress: .2, cash: old.cash - 5 };
    const [guest] = reconcileSpectatorGuests([old], [incoming], 1000);
    expect(guest.progress).toBe(.2);
    expect(guest.cash).toBe(incoming.cash);
    expect(guestVisualOffset(guest, 1000).x).toBeCloseTo(19.2);
    expect(guestVisualOffset(guest, 1000).y).toBeCloseTo(11.52);
    expect(guestVisualOffset(guest, 1500).x).toBeCloseTo(4.8);
    expect(guestVisualOffset(guest, 2000)).toEqual({ x: 0, y: 0 });
    expect(incoming.visualCorrection).toBeUndefined();
  });

  it('incorporates the unexpired correction when another frame arrives', () => {
    const old = walking();
    const [first] = reconcileSpectatorGuests([old], [{ ...old, progress: .2 }], 1000);
    const [second] = reconcileSpectatorGuests([first], [{ ...old, progress: .2 }], 1500);
    expect(guestVisualOffset(second, 1500)).toEqual(guestVisualOffset(first, 1500));
  });

  it('does not drag new identities across the map or alter ride visibility', () => {
    const old = walking();
    const fresh = { ...old, id: 'new-guest', tileX: 50 };
    const rider = { ...old, state: 'riding' as const };
    expect(reconcileSpectatorGuests([old], [fresh, rider], 1000)).toEqual([fresh, rider]);
    expect(guestVisualOffset(fresh, 1000)).toEqual({ x: 0, y: 0 });
  });
});
