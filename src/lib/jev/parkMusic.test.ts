import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { nextParkTrack, PARK_TRACKS, parkEventMusic } from './parkMusic';

it('plays every background track before recycling and never repeats back to back', () => {
  const remaining: number[] = [];
  let current = 0;
  const firstRound = [current];
  for (let turn = 0; turn < 100; turn++) {
    const next = nextParkTrack(current, remaining);
    expect(next).not.toBe(current);
    expect(PARK_TRACKS[next]).toBeDefined();
    if (turn < PARK_TRACKS.length - 1) firstRound.push(next);
    current = next;
  }
  expect(new Set(firstRound).size).toBe(PARK_TRACKS.length);
});

it('matches event music to the announcement and leaves unrelated notices quiet', () => {
  expect(parkEventMusic('The parade is starting.')).toContain('parade-fanfare');
  expect(parkEventMusic('The hotdog stand is giving away free hot dogs!')).toContain('snack-time');
  expect(parkEventMusic('The carousel is boarding.')).toContain('ride-fanfare');
  expect(parkEventMusic('Jev budget is used up.')).toBeNull();
});

it('ships every playlist track and event cue', () => {
  for (const src of [...PARK_TRACKS, parkEventMusic('parade'), parkEventMusic('free hot dogs'), parkEventMusic('carousel')]) {
    expect(existsSync(`public${src!.split('?')[0]}`)).toBe(true);
  }
});
