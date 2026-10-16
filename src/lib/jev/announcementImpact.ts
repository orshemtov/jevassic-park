import type { Guest } from '@/games/coaster/types/economy';
import type { GameState } from '@/games/coaster/types/game';
import { announcedAttraction, attractionName } from './decisions';
import { findSpectacleVenue, spectacleForAnnouncement } from './spectacles';

export function announcementImpact(guests: Guest[], grid: GameState['grid'], announcement: { text: string; responders?: string[] } | null) {
  const ids = new Set(announcement?.responders);
  const kind = announcement && spectacleForAnnouncement(announcement.text);
  const venue = kind ? findSpectacleVenue(grid, kind) : undefined;
  const responding = guests.filter(guest => {
    if (!ids.has(guest.id)) return false;
    const destination = guest.queueRideId ?? guest.targetBuildingId;
    if (!destination) return false;
    if (venue) return destination === `${venue.x},${venue.y}`;
    const [x, y] = destination.split(',').map(Number);
    const type = grid[y]?.[x]?.building.type;
    return Boolean(type && announcedAttraction(announcement!.text, attractionName(type)));
  });
  return { ids: responding.map(guest => guest.id), heading: responding.filter(guest => guest.state === 'walking' && guest.path.length > 0).length };
}
