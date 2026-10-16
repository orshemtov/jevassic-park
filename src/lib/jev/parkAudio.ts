import { PARK_TRACKS, nextParkTrack, parkEventMusic, type ParkMusicState } from './parkMusic';

// One owner across visible park tabs, with UI state taken from the media element.
export function connectParkAudio(audio: HTMLAudioElement, enabled: boolean, running: boolean,
  onPlaying: (playing: boolean) => void, onBlocked: (blocked: boolean) => void, onRelinquish: () => void,
  music: ParkMusicState = { track: 0, remaining: [], cue: null, resumeAt: 0, lastEventAt: 0 }) {
    let disposed = false;
    audio.volume = .22;
    if (!audio.src) audio.src = PARK_TRACKS[music.track];
    let starting = false;
    let playVersion = 0;
    let failures = 0;
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('jevassic-park-audio') : null;
    const play = () => {
      if (!enabled || !running || document.hidden || starting || !audio.paused) return;
      starting = true;
      const version = ++playVersion;
      void audio.play().then(() => {
        if (!disposed && version === playVersion) { onBlocked(false); onPlaying(!audio.paused && !audio.muted); }
      }).catch(() => { if (!disposed && version === playVersion) onBlocked(true); }).finally(() => { if (version === playVersion) starting = false; });
    };
    const seek = () => {
      if (music.resumeAt > 0 && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.max(0, Math.min(music.resumeAt, audio.duration - .1));
        music.resumeAt = 0;
      }
    };
    const changeTrack = (src: string, position = 0) => {
      music.resumeAt = position;
      playVersion++;
      starting = false;
      audio.src = src;
      audio.load();
      play();
    };
    const ended = () => {
      if (!enabled || !running || document.hidden) return;
      if (music.cue) {
        const position = music.cue.returnTime;
        music.cue = null;
        changeTrack(PARK_TRACKS[music.track], position);
      } else {
        music.track = nextParkTrack(music.track, music.remaining);
        changeTrack(PARK_TRACKS[music.track]);
      }
    };
    const eventMusic = (event: Event) => {
      const src = parkEventMusic(String((event as CustomEvent).detail ?? ''));
      if (!src || !enabled || !running || audio.paused || audio.muted || document.hidden || music.cue || Date.now() - music.lastEventAt < 20_000) return;
      music.cue = { returnTime: audio.currentTime };
      music.lastEventAt = Date.now();
      changeTrack(src);
    };
    if (channel) channel.onmessage = () => {
      audio.pause();
      onRelinquish();
      onPlaying(false);
    };
    const syncAudio = () => {
      if (enabled && running && !document.hidden) play();
      else { audio.pause(); onPlaying(false); }
    };
    const failed = () => { if (++failures <= PARK_TRACKS.length) ended(); else onPlaying(false); };
    const playing = () => { failures = 0; onPlaying(!audio.paused && !audio.muted); channel?.postMessage('playing'); };
    const paused = () => onPlaying(false);
    audio.addEventListener('playing', playing);
    audio.addEventListener('ended', ended);
    audio.addEventListener('error', failed);
    audio.addEventListener('loadedmetadata', seek);
    audio.addEventListener('park-music-event', eventMusic);
    audio.addEventListener('pause', paused);
    syncAudio();
    document.addEventListener('visibilitychange', syncAudio);
    document.addEventListener('pointerdown', play);
    document.addEventListener('keydown', play);
    return () => {
      disposed = true;
      channel?.close();
      audio.pause();
      if (music.cue) {
        music.resumeAt = music.cue.returnTime;
        music.cue = null;
        audio.src = PARK_TRACKS[music.track];
        audio.load();
      }
      audio.removeEventListener('ended', ended);
      audio.removeEventListener('error', failed);
      audio.removeEventListener('loadedmetadata', seek);
      audio.removeEventListener('park-music-event', eventMusic);
      audio.removeEventListener('playing', playing);
      audio.removeEventListener('pause', paused);
      document.removeEventListener('visibilitychange', syncAudio);
      document.removeEventListener('pointerdown', play);
      document.removeEventListener('keydown', play);
    };
}
