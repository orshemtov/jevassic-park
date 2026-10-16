// One owner across visible park tabs, with UI state taken from the media element.
export function connectParkAudio(audio: HTMLAudioElement, enabled: boolean, running: boolean,
  onPlaying: (playing: boolean) => void, onBlocked: (blocked: boolean) => void, onRelinquish: () => void) {
    let disposed = false;
    audio.volume = .22;
    let starting = false;
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('jevassic-park-audio') : null;
    const play = () => {
      if (!enabled || !running || document.hidden || starting || !audio.paused) return;
      starting = true;
      void audio.play().then(() => {
        if (!disposed) { onBlocked(false); onPlaying(!audio.paused && !audio.muted); }
      }).catch(() => { if (!disposed) onBlocked(true); }).finally(() => { starting = false; });
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
    const playing = () => { onPlaying(!audio.paused && !audio.muted); channel?.postMessage('playing'); };
    const paused = () => onPlaying(false);
    audio.addEventListener('playing', playing);
    audio.addEventListener('pause', paused);
    syncAudio();
    document.addEventListener('visibilitychange', syncAudio);
    document.addEventListener('pointerdown', play);
    document.addEventListener('keydown', play);
    return () => {
      disposed = true;
      channel?.close();
      audio.pause();
      audio.removeEventListener('playing', playing);
      audio.removeEventListener('pause', paused);
      document.removeEventListener('visibilitychange', syncAudio);
      document.removeEventListener('pointerdown', play);
      document.removeEventListener('keydown', play);
    };
}
