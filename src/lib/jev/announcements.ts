export const PARK_ANNOUNCEMENTS = [
  'The hotdog stand is giving away free hot dogs!',
  'The parade is starting. Front-row enthusiasm encouraged.',
  'The Sky Swing is boarding. Bags down, bravery up.',
  'The Ferris wheel offers excellent views of your questionable decisions.',
  'The carousel is boarding. Pick your noble steed.',
];

export function nextParkAnnouncement(previous?: string): string {
  const choices = PARK_ANNOUNCEMENTS.filter(text => text !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}

export function announcementDelay(first = false): number {
  return first ? 20_000 + Math.floor(Math.random() * 15_000) : 60_000 + Math.floor(Math.random() * 40_000);
}
