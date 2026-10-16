import { afterEach, expect, it, vi } from 'vitest';
import { announcementDelay, nextParkAnnouncement, PARK_ANNOUNCEMENTS } from './announcements';
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
