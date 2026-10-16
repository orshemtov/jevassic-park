import { afterEach, expect, it, vi } from 'vitest';
import { connectParkAudio } from './parkAudio';
import { PARK_TRACKS, type ParkMusicState } from './parkMusic';

class AudioStub extends EventTarget {
  paused = true;
  muted = false;
  volume = 1;
  src = '';
  currentTime = 0;
  duration = 120;
  load = vi.fn(() => { this.paused = true; this.currentTime = 0; });
  play = vi.fn(async () => { this.paused = false; this.dispatchEvent(new Event('playing')); });
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event('pause')); });
}
class ChannelStub {
  static channels: ChannelStub[] = [];
  onmessage: (() => void) | null = null;
  constructor() { ChannelStub.channels.push(this); }
  postMessage() { for (const channel of ChannelStub.channels) if (channel !== this) channel.onmessage?.(); }
  close() { ChannelStub.channels = ChannelStub.channels.filter(channel => channel !== this); }
}
function setup() {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('BroadcastChannel', ChannelStub);
  const audio = new AudioStub();
  const playing = vi.fn();
  const blocked = vi.fn();
  const relinquish = vi.fn();
  const music: ParkMusicState = { track: 0, remaining: [], cue: null, resumeAt: 0, lastEventAt: 0 };
  return { doc, audio, playing, blocked, relinquish,
    connect: (enabled = true) => connectParkAudio(audio as unknown as HTMLAudioElement, enabled, true, playing, blocked, relinquish, music) };
}
afterEach(() => { vi.unstubAllGlobals(); ChannelStub.channels = []; });

it('starts one audio stream and updates the icon from actual playback', async () => {
  const { audio, doc, playing, connect } = setup();
  const cleanup = connect();
  doc.dispatchEvent(new Event('pointerdown'));
  doc.dispatchEvent(new Event('keydown'));
  await Promise.resolve();
  expect(audio.play).toHaveBeenCalledTimes(1);
  expect(playing).toHaveBeenLastCalledWith(true);
  cleanup();
  expect(audio.paused).toBe(true);
  expect(playing).toHaveBeenLastCalledWith(false);
});

it('mutes without the unlock handler restarting playback', () => {
  const { audio, doc, playing, connect } = setup();
  const cleanup = connect(false);
  doc.dispatchEvent(new Event('pointerdown'));
  expect(audio.play).not.toHaveBeenCalled();
  expect(playing).toHaveBeenLastCalledWith(false);
  cleanup();
});

it('a second park tab stops the previous soundtrack', () => {
  const first = setup();
  const closeFirst = first.connect();
  const second = setup();
  const closeSecond = second.connect();
  expect(first.audio.paused).toBe(true);
  expect(first.relinquish).toHaveBeenCalledTimes(1);
  expect(second.audio.paused).toBe(false);
  closeFirst(); closeSecond();
});

it('shows autoplay blocking and retries on a user gesture', async () => {
  const { audio, doc, blocked, playing, connect } = setup();
  audio.play.mockRejectedValueOnce(new Error('Autoplay blocked'));
  const cleanup = connect();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(blocked).toHaveBeenLastCalledWith(true);
  doc.dispatchEvent(new Event('pointerdown'));
  await Promise.resolve();
  expect(blocked).toHaveBeenLastCalledWith(false);
  expect(playing).toHaveBeenLastCalledWith(true);
  cleanup();
});


it('rotates tracks after playback ends without repeating the previous track', async () => {
  const { audio, connect } = setup();
  const cleanup = connect();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(audio.src).toBe(PARK_TRACKS[0]);
  audio.dispatchEvent(new Event('ended'));
  expect(PARK_TRACKS).toContain(audio.src);
  expect(audio.src).not.toBe(PARK_TRACKS[0]);
  expect(audio.paused).toBe(false);
  cleanup();
});

it('uses the same audio element for an event and resumes the interrupted song', async () => {
  const { audio, connect } = setup();
  const cleanup = connect();
  await new Promise(resolve => setTimeout(resolve, 0));
  audio.currentTime = 37;
  audio.dispatchEvent(new CustomEvent('park-music-event', { detail: 'The parade is starting.' }));
  expect(audio.src).toBe('/assets/music/parade-fanfare.m4a');
  await new Promise(resolve => setTimeout(resolve, 0));
  audio.dispatchEvent(new Event('ended'));
  audio.dispatchEvent(new Event('loadedmetadata'));
  expect(audio.src).toBe(PARK_TRACKS[0]);
  expect(audio.currentTime).toBe(37);
  expect(audio.paused).toBe(false);
  cleanup();
});

it('does not queue event music while muted and skips broken event files', async () => {
  const { audio, connect } = setup();
  const mutedCleanup = connect(false);
  audio.dispatchEvent(new CustomEvent('park-music-event', { detail: 'The parade is starting.' }));
  expect(audio.src).toBe(PARK_TRACKS[0]);
  mutedCleanup();
  const cleanup = connect();
  await new Promise(resolve => setTimeout(resolve, 0));
  audio.currentTime = 22;
  audio.dispatchEvent(new CustomEvent('park-music-event', { detail: 'Free hot dogs!' }));
  expect(audio.src).toContain('snack-time');
  await new Promise(resolve => setTimeout(resolve, 0));
  audio.dispatchEvent(new Event('error'));
  audio.dispatchEvent(new Event('loadedmetadata'));
  expect(audio.src).toBe(PARK_TRACKS[0]);
  expect(audio.currentTime).toBe(22);
  cleanup();
});


it('cancels an interrupted event on mute and preserves the background position', async () => {
  const { audio, connect } = setup();
  const cleanup = connect();
  await new Promise(resolve => setTimeout(resolve, 0));
  audio.currentTime = 41;
  audio.dispatchEvent(new CustomEvent('park-music-event', { detail: 'The parade is starting.' }));
  cleanup();
  const mutedCleanup = connect(false);
  audio.dispatchEvent(new Event('loadedmetadata'));
  expect(audio.src).toBe(PARK_TRACKS[0]);
  expect(audio.currentTime).toBe(41);
  expect(audio.paused).toBe(true);
  mutedCleanup();
});
