import type { GameState } from '@/games/coaster/types/game';
import type { ParkSpectacle } from './spectacles';
import type { GuestStory } from './guestStories';
import { attractionActivity } from './attractionActivity';
import { attractionName } from './decisions';

export type DirectorShot = { key: string; x: number; y: number; zoom: number; label: string; guestId?: string };

export function chooseDirectorShot(park: Pick<GameState, 'guests' | 'grid'>, spectacle: ParkSpectacle | undefined,
  story: GuestStory | null, previousKey: string, now: number): DirectorShot | null {
  if (spectacle && now >= spectacle.startedAt && now - spectacle.startedAt < spectacle.durationMs) {
    const key = `show:${spectacle.startedAt}`;
    if (key !== previousKey) return { key, ...spectacle.center, zoom: spectacle.kind === 'fireworks' ? .75 : 1.1,
      label: spectacle.kind === 'parade' ? 'Parade' : spectacle.kind === 'fireworks' ? 'Fireworks' : 'Fountain show' };
  }
  const subject = story && now - story.at < 20_000 ? park.guests.find(guest => guest.id === story.guestId && guest.state !== 'riding') : undefined;
  if (subject && story && previousKey !== story.id) return { key: story.id, x: subject.tileX, y: subject.tileY, zoom: 1.5,
    label: `${subject.name} · ${story.text}`, guestId: subject.id };
  const busy = [...attractionActivity(park.guests)].map(([id, activity]) => ({ id, score: activity.riding * 3 + activity.queued * 2 + activity.eating + activity.drinking + activity.shopping + activity.using }))
    .filter(item => item.score > 0 && `place:${item.id}` !== previousKey).sort((a, b) => b.score - a.score)[0];
  if (busy) {
    const [x, y] = busy.id.split(',').map(Number);
    const type = park.grid[y]?.[x]?.building.type;
    if (type) return { key: `place:${busy.id}`, x, y, zoom: 1.25, label: attractionName(type) };
  }
  const guest = park.guests.find(guest => guest.state === 'walking' && guest.path.length && `guest:${guest.id}` !== previousKey);
  return guest ? { key: `guest:${guest.id}`, x: guest.tileX, y: guest.tileY, zoom: 1.35, label: guest.name, guestId: guest.id } : null;
}
