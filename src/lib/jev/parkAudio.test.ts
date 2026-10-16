import { afterEach, expect, it, vi } from 'vitest';
import { connectParkAudio } from './parkAudio';

class AudioStub extends EventTarget {
  paused = true;
  muted = false;
  volume = 1;
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
  return { doc, audio, playing, blocked, relinquish,
    connect: (enabled = true) => connectParkAudio(audio as unknown as HTMLAudioElement, enabled, true, playing, blocked, relinquish) };
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
