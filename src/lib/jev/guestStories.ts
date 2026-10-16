import type { Guest } from '@/games/coaster/types/economy';
import type { GameState } from '@/games/coaster/types/game';

export type GuestStory = { id: string; guestId: string; name: string; icon: string; text: string; at: number };

/** Observed transitions only: these captions do not invent a guest's thoughts. */
export function detectGuestStories(previous: Guest[], current: Guest[], now: number, grid?: GameState['grid']): GuestStory[] {
  const physicalRides = (history: string[]) => grid ? history.filter(id => {
    const [x, y] = id.split(',').map(Number);
    return /^(ride_|station_)/.test(grid[y]?.[x]?.building.type ?? '');
  }) : history;
  const before = new Map(previous.map(guest => [guest.id, guest]));
  const stories: GuestStory[] = [];
  for (const guest of current) {
    const old = before.get(guest.id);
    if (!old) continue;
    let caption: { key: string; icon: string; text: string } | undefined;
    const oldRides = physicalRides(old.ridesRidden);
    const rides = physicalRides(guest.ridesRidden);
    const completedRide = rides.length > oldRides.length;
    const ride = rides.at(-1);
    if (completedRide && old.nausea < 40 && guest.nausea >= 40) {
      caption = { key: `ride:${rides.length}`, icon: '😵‍💫', text: 'What a ride. Time for a breather.' };
    } else if (completedRide && ride && oldRides.includes(ride)) {
      const round = rides.filter(id => id === ride).length;
      caption = { key: `ride:${rides.length}`, icon: '🎢', text: `Same ride. Round ${round}.` };
    } else if (completedRide && oldRides.length < 3 && rides.length >= 3) {
      caption = { key: 'three-rides', icon: '🏆', text: 'Three rides. Still standing.' };
    } else if (guest.state === 'eating' && guest.targetPurchaseKind === 'food' &&
      old.state !== 'eating' && old.hunger >= 65) {
      caption = { key: `snack:${now}`, icon: '🌭', text: 'Snack secured.' };
    } else if (guest.state === 'shopping' && guest.targetPurchaseKind !== 'restroom' &&
      old.cash >= 10 && guest.cash < 10 && guest.cash < old.cash) {
      caption = { key: `shopping:${now}`, icon: '🎁', text: 'Souvenir secured. Wallet nearly empty.' };
    }
    if (caption) {
      stories.push({ id: `${guest.id}:${caption.key}`, guestId: guest.id, name: guest.name,
        icon: caption.icon, text: caption.text, at: now });
      if (stories.length === 3) break;
    }
  }
  return stories;
}
