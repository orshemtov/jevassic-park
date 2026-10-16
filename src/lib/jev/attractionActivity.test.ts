import { expect, it } from 'vitest';
import { createGuest } from '@/components/coaster/guests/guestSystem';
import { activityEvents, attractionActivity } from './attractionActivity';

it('counts actual riders, queues, service users and arrivals separately', () => {
  const base = createGuest(1, 1, 60);
  const counts = attractionActivity([
    { ...base, state: 'riding', queueRideId: '2,3' },
    { ...base, state: 'queuing', queueRideId: '2,3' },
    { ...base, state: 'walking', targetBuildingId: '2,3' },
    { ...base, state: 'eating', targetBuildingId: '4,5', targetPurchaseKind: 'drink' },
    { ...base, state: 'shopping', targetBuildingId: '6,7', targetPurchaseKind: 'restroom' },
    { ...base, state: 'exiting_building', targetBuildingId: '6,7' },
  ]);
  expect(counts.get('2,3')).toMatchObject({ riding: 1, queued: 1, heading: 1 });
  expect(counts.get('4,5')).toMatchObject({ drinking: 1, eating: 0 });
  expect(counts.get('6,7')?.using).toBe(1);
});

it('only announces new observed activity and groups simultaneous arrivals', () => {
  const guest = { ...createGuest(1, 1, 60), targetBuildingId: '2,3', state: 'walking' as const };
  const eating = { ...guest, state: 'eating' as const };
  expect(activityEvents([], [eating], 100)).toEqual([]);
  expect(activityEvents([eating], [eating], 100)).toEqual([]);
  expect(activityEvents([guest, { ...guest, id: 'second' }], [eating, { ...eating, id: 'second' }], 100))
    .toEqual([{ buildingId: '2,3', kind: 'eating', count: 2, at: 100 }]);
});

it('emits boarding events for every ride destination, plus shops and restrooms', () => {
  const guest = createGuest(1, 1, 60);
  const previous = [
    { ...guest, id: 'wheel', state: 'queuing' as const, queueRideId: '3,4' },
    { ...guest, id: 'flume', state: 'queuing' as const, queueRideId: '8,9' },
    { ...guest, id: 'shop', state: 'walking' as const, targetBuildingId: '4,5' },
    { ...guest, id: 'restroom', state: 'walking' as const, targetBuildingId: '6,7' },
  ];
  const current = previous.map(g => ({ ...g, state: g.queueRideId ? 'riding' as const : 'shopping' as const,
    targetPurchaseKind: g.id === 'restroom' ? 'restroom' as const : null }));
  expect(activityEvents(previous, current, 200).map(event => [event.buildingId, event.kind]))
    .toEqual([['3,4', 'riding'], ['8,9', 'riding'], ['4,5', 'shopping'], ['6,7', 'using']]);
});

it('marks completed rides at their own attraction', () => {
  const before = { ...createGuest(1, 1, 60), state: 'riding' as const, queueRideId: '8,9', ridesRidden: [] };
  const after = { ...before, state: 'walking' as const, queueRideId: null, targetBuildingId: null, ridesRidden: ['8,9'] };
  expect(activityEvents([before], [after], 300)).toEqual([{ buildingId: '8,9', kind: 'finished', count: 1, at: 300 }]);
});
