import { describe, expect, it } from 'vitest';
import type { GameState } from '@/games/coaster/types/game';
import { summarizePark } from './parkState';

describe('park decision snapshot', () => {
  it('captures one stable park view, including queues and free hotdogs', () => {
    const state = {
      tick: 10, freeHotdogsUntilTick: 20, hour: 13,
      weather: { current: 'sunny' }, settings: { entranceFee: 20 },
      guests: [{ state: 'queuing', queueRideId: '2,1' }, { state: 'walking' }],
      grid: [[{ x: 0, y: 0, building: { type: 'food_hotdog' } }],
        [{ x: 2, y: 1, building: { type: 'ride_carousel' } }]],
    } as unknown as GameState;
    const snapshot = summarizePark(state);

    expect(snapshot).toMatchObject({ activeGuests: 2, freeHotdogs: true, weather: 'sunny',
      attractions: [
        { id: 'food:0,0', price: 0, queue: 0 },
        { id: 'ride:2,1', queue: 1 },
      ] });

    state.tick = 21;
    state.guests.pop();
    expect(snapshot.activeGuests).toBe(2);
    expect(snapshot.freeHotdogs).toBe(true);
    expect(summarizePark(state).freeHotdogs).toBe(false);
  });
});
