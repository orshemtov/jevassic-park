import type { Guest } from '@/games/coaster/types/economy';

export type AttractionActivity = { riding: number; eating: number; drinking: number; shopping: number; using: number; queued: number; heading: number };
export const emptyActivity = (): AttractionActivity => ({ riding: 0, eating: 0, drinking: 0, shopping: 0, using: 0, queued: 0, heading: 0 });

export function activityKind(guest: Guest): keyof AttractionActivity | null {
  if (guest.state === 'riding') return 'riding';
  if (guest.state === 'queuing') return 'queued';
  if (guest.state === 'eating') return guest.targetPurchaseKind === 'drink' ? 'drinking' : 'eating';
  if (guest.state === 'shopping') return guest.targetPurchaseKind === 'restroom' ? 'using' : 'shopping';
  if (guest.state === 'walking' && guest.targetBuildingId) return 'heading';
  return null;
}

export const activityLabels: Record<keyof AttractionActivity, string> = {
  riding: 'Riding', eating: 'Eating', drinking: 'Drinking', shopping: 'Shopping', using: 'Using', queued: 'In line', heading: 'On the way',
};

export function attractionActivity(guests: Guest[]): Map<string, AttractionActivity> {
  const counts = new Map<string, AttractionActivity>();
  for (const guest of guests) {
    const kind = activityKind(guest);
    const id = guest.state === 'riding' || guest.state === 'queuing' ? guest.queueRideId ?? guest.targetBuildingId : guest.targetBuildingId;
    if (!kind || !id) continue;
    const activity = counts.get(id) ?? emptyActivity();
    activity[kind]++;
    counts.set(id, activity);
  }
  return counts;
}

export type ActivityEvent = { buildingId: string; kind: keyof AttractionActivity | 'finished'; count: number; at: number };
export function activityEvents(previous: Guest[], current: Guest[], at: number): ActivityEvent[] {
  const before = new Map(previous.map(guest => [guest.id, guest]));
  const events = new Map<string, ActivityEvent>();
  for (const guest of current) {
    const old = before.get(guest.id);
    if (old?.state === 'riding' && guest.state !== 'riding' && guest.ridesRidden.length > old.ridesRidden.length) {
      const ride = old.queueRideId ?? old.targetBuildingId;
      if (ride) {
        const key = `${ride}:finished`;
        const event = events.get(key) ?? { buildingId: ride, kind: 'finished' as const, count: 0, at };
        event.count++;
        events.set(key, event);
      }
    }
    const kind = activityKind(guest);
    const buildingId = guest.state === 'riding' ? guest.queueRideId ?? guest.targetBuildingId : guest.targetBuildingId;
    if (!old || !buildingId || !kind || kind === 'heading' || kind === 'queued' ||
      (activityKind(old) === kind && (old.queueRideId ?? old.targetBuildingId) === buildingId)) continue;
    const key = `${buildingId}:${kind}`;
    const event = events.get(key) ?? { buildingId, kind, count: 0, at };
    event.count++;
    events.set(key, event);
  }
  return [...events.values()];
}

export function activityEventText(event: ActivityEvent): string {
  const count = event.count;
  switch (event.kind) {
    case 'finished': return `🎉 ${count === 1 ? 'What a ride!' : `${count} happy landings!`}`;
    case 'riding': return `🎢 ${count === 1 ? 'All aboard!' : `${count} guests aboard!`}`;
    case 'eating': return `🌭 ${count === 1 ? 'Snack time!' : `${count} hungry guests served!`}`;
    case 'drinking': return `🥤 ${count === 1 ? 'Cheers!' : `${count} drinks served!`}`;
    case 'shopping': return `🎁 ${count === 1 ? 'Souvenir secured!' : `${count} souvenir hunters!`}`;
    default: return '🚻 Pit stop!';
  }
}
