import type { Guest } from '@/games/coaster/types/economy';
import type { GameState } from '@/games/coaster/types/game';

export type ParkIncident = {
  id: string; guestId: string; kind: 'hat' | 'balloon' | 'mascot' | 'photo' | 'wobble' | 'soaked';
  at: number; expiresAt: number; x: number; y: number; name: string; text: string;
};

export function parkRhythm(hour: number) {
  const phase = hour < 7 || hour >= 20 ? 'night' : hour < 11 ? 'morning' : hour < 14 ? 'lunch' : hour < 18 ? 'afternoon' : 'sunset';
  const nextShow = hour < 14 ? { kind: 'parade' as const, label: 'Afternoon parade', hour: 14 } :
    hour < 18 ? { kind: 'fountain' as const, label: 'Sunset fountain show', hour: 18 } :
      hour < 20 ? { kind: 'fireworks' as const, label: 'Castle fireworks', hour: 20 } :
        { kind: 'parade' as const, label: 'Afternoon parade', hour: 14 };
  const labels = { morning: 'Morning stroll', lunch: 'Lunch rush', afternoon: 'Parade time', sunset: 'Golden hour', night: 'Night lights' };
  return { phase, label: labels[phase], nextShow };
}

export function guestIncident(guest: Guest, kind: ParkIncident['kind'], now: number): ParkIncident {
  const texts = { hat: 'Hat escaped. Dignity pending.', balloon: 'Balloon: promoted to cloud.', mascot: 'Mascot spotted!', photo: 'One more photo. Obviously.', wobble: 'Legs still on the coaster.', soaked: 'Splash rating: completely soaked.' };
  return { id: `${guest.id}:${now}:${kind}`, guestId: guest.id, kind, at: now, expiresAt: now + 12_000,
    x: guest.tileX, y: guest.tileY, name: guest.name, text: texts[kind] };
}

export function rideIncident(before: Guest, after: Guest, park: Pick<GameState, 'grid'>, now: number): ParkIncident | undefined {
  if (after.ridesRidden.length <= before.ridesRidden.length) return;
  const [x, y] = (after.ridesRidden.at(-1) ?? before.queueRideId ?? '').split(',').map(Number);
  const type = park.grid[y]?.[x]?.building?.type ?? '';
  if (/^ride_.*(?:water|log_flume|rapids|splash|bumper_boats)/.test(type)) return guestIncident(after, 'soaked', now);
  if (/station_|coaster|drop|swing/.test(type)) return guestIncident(after, 'wobble', now);
}
