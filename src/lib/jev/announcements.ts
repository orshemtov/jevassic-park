export const PARK_ANNOUNCEMENTS = [
  'The hotdog stand is giving away free hot dogs!',
  'The parade is starting. Front-row enthusiasm encouraged.',
  'The Sky Swing is boarding. Bags down, bravery up.',
  'The Ferris wheel offers excellent views of your questionable decisions.',
  'The fountain show is starting. Front row may get splashed.',
  'The carousel is boarding. Pick your noble steed.',
];

export function nextParkAnnouncement(previous?: string, hour = 12, allowSpectacles = true): string {
  if (allowSpectacles && (hour >= 20 || hour < 7) && !/fireworks/i.test(previous ?? '')) return 'Fireworks above the castle! Come watch the sky sparkle.';
  const available = allowSpectacles ? PARK_ANNOUNCEMENTS : PARK_ANNOUNCEMENTS.filter(text => !/parade|fountain show|fireworks/i.test(text));
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
