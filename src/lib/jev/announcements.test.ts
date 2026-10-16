import { afterEach, expect, it, vi } from 'vitest';
import { announcementDelay, nextParkAnnouncement, PARK_ANNOUNCEMENTS, isCurrentRadioReaction } from './announcements';
afterEach(() => vi.restoreAllMocks());
it('randomizes timing and avoids repeating the previous announcement', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  expect(announcementDelay(true)).toBe(20000);
  expect(announcementDelay()).toBe(60000);
  expect(nextParkAnnouncement(PARK_ANNOUNCEMENTS[0])).not.toBe(PARK_ANNOUNCEMENTS[0]);
  vi.mocked(Math.random).mockReturnValue(.99999);
  expect(announcementDelay(true)).toBeLessThan(35000);
  expect(announcementDelay()).toBeLessThan(100000);
});

it('only shows radio tags while their own announcement is visible and fresh', () => {
  const reaction = { id: 3, text: 'The parade is starting.', at: 1000 };
  expect(isCurrentRadioReaction(reaction, { id: 3 }, true, 2000)).toBe(true);
  expect(isCurrentRadioReaction(reaction, { id: 3 }, false, 2000)).toBe(false);
  expect(isCurrentRadioReaction(reaction, { id: 4 }, true, 2000)).toBe(false);
  expect(isCurrentRadioReaction(reaction, { id: 3 }, true, 46000)).toBe(false);
  expect(isCurrentRadioReaction(undefined, { id: 3 }, true, 2000)).toBe(false);
});
