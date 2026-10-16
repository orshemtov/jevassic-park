import { spectacleAnnouncement } from './spectacles';

export const PARK_ANNOUNCEMENTS = [
  'The hotdog stand is giving away free hot dogs!',
  'The parade is starting. Front-row enthusiasm encouraged.',
  'The Sky Swing is boarding. Bags down, bravery up.',
  'The Ferris wheel offers excellent views of your questionable decisions.',
  'The fountain show is starting. Front row may get splashed.',
  'The carousel is boarding. Pick your noble steed.',
];

export function nextParkAnnouncement(previous?: string, hour = 12, allowSpectacles = true): string {
  if (hour >= 11 && hour < 14 && previous !== PARK_ANNOUNCEMENTS[0]) return PARK_ANNOUNCEMENTS[0];
  const scheduled = hour >= 20 || hour < 7 ? 'fireworks' : hour >= 18 ? 'fountain' : hour >= 14 ? 'parade' : undefined;
  if (allowSpectacles && scheduled && !new RegExp(scheduled === 'fountain' ? 'fountain show' : scheduled, 'i').test(previous ?? '')) return spectacleAnnouncement(scheduled);
  const available = PARK_ANNOUNCEMENTS.filter(text => !/parade|fountain show|fireworks/i.test(text));
  const choices = available.filter(text => text !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}

export function announcementDelay(first = false): number {
  return first ? 20_000 + Math.floor(Math.random() * 15_000) : 60_000 + Math.floor(Math.random() * 40_000);
}

export type RadioReaction = { id: number; text: string; at: number };

export function isCurrentRadioReaction(reaction: RadioReaction | undefined, announcement: { id: number } | null,
  visible: boolean, now = Date.now()): boolean {
  return Boolean(visible && reaction && reaction.id === announcement?.id && now - reaction.at < 45_000);
}
