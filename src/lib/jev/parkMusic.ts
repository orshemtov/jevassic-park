export const PARK_TRACKS = [
  '/assets/park-score.m4a?v=3',
  '/assets/music/lantern-lane.m4a',
  '/assets/music/cloud-carousel.m4a',
  '/assets/music/lagoon-breeze.m4a',
  '/assets/music/starlight-gardens.m4a',
];

export type ParkMusicState = {
  track: number; remaining: number[]; cue: { returnTime: number } | null; resumeAt: number; lastEventAt: number;
};

export function nextParkTrack(current: number, remaining: number[]): number {
  if (!remaining.length) {
    remaining.push(...PARK_TRACKS.map((_, index) => index).filter(index => index !== current));
    for (let index = remaining.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [remaining[index], remaining[other]] = [remaining[other], remaining[index]];
    }
  }
  return remaining.shift()!;
}

export function parkEventMusic(text: string): string | null {
  if (/parade|fireworks/i.test(text)) return '/assets/music/parade-fanfare.m4a';
  if (/free\s+hot\s*dogs?/i.test(text)) return '/assets/music/snack-time.m4a';
  if (/carousel|ferris wheel|sky swing|fountain show/i.test(text)) return '/assets/music/ride-fanfare.m4a';
  return null;
}
