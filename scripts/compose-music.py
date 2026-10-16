"""Compose original fantasy park scores and cues; requires NumPy and ffmpeg.

Usage: python scripts/compose-music.py [public/assets/music]
Melodies are original; no samples, downloads, or model calls are used.
"""
from pathlib import Path
import subprocess
import sys
import tempfile
import wave
import numpy as np

RATE = 22050
SCALE = [0, 2, 4, 5, 7, 9, 11]
PROGRESSIONS = [
    [0, 5, 3, 4, 2, 5, 1, 4],
    [0, 2, 3, 4, 5, 3, 1, 4],
    [0, 3, 5, 4, 2, 3, 1, 4],
    [5, 3, 0, 4, 5, 1, 3, 4],
]
# Scale degrees, each row one four-beat measure. Every piece has its own theme.
THEMES = [
    [[0, 2, 4, 5], [4, 2, 1, 2], [3, 5, 4, 2], [1, 0, -1, 1],
     [2, 4, 6, 7], [5, 4, 2, 3], [1, 3, 2, 0], [-1, 1, 4, 1]],
    [[4, 7, 6, 4], [2, 4, 3, 1], [5, 4, 3, 5], [6, 4, 1, 2],
     [7, 6, 4, 2], [3, 5, 7, 6], [4, 2, 1, 3], [2, 1, -1, 1]],
    [[2, 0, 1, 4], [5, 4, 2, 0], [3, 2, 0, -2], [1, 2, 4, 1],
     [4, 5, 7, 4], [2, 3, 5, 2], [0, 2, 3, 1], [-1, 1, 2, 4]],
    [[5, 7, 6, 2], [3, 5, 4, 0], [2, 4, 3, -1], [1, 2, 4, 3],
     [7, 5, 4, 6], [5, 3, 2, 4], [3, 1, 0, 2], [1, -1, 1, 4]],
]
TRACKS = [
    ('lantern-lane', 62, 96, 'flute', 0),
    ('cloud-carousel', 65, 108, 'celesta', 1),
    ('lagoon-breeze', 67, 92, 'reed', 2),
    ('starlight-gardens', 60, 88, 'celesta', 3),
]


def degree(root, value):
    octave, index = divmod(value, 7)
    return root + SCALE[index] + octave * 12


class Score:
    def __init__(self, seconds, seed):
        self.mix = np.zeros((int(RATE * seconds), 2), dtype=np.float64)
        self.rng = np.random.default_rng(seed)

    def note(self, pitch, start, duration, volume, voice='harp', pan=0):
        first = int(start * RATE)
        count = min(int(duration * RATE), len(self.mix) - first)
        if count <= 0:
            return
        t = np.arange(count) / RATE
        phase = 2 * np.pi * 440 * 2 ** ((pitch - 69) / 12) * t
        release = np.clip((duration - t) / min(.16, duration / 3), 0, 1)
        attack = np.minimum(1, t / .012)
        if voice in ('flute', 'reed'):
            phase += .025 * np.sin(2 * np.pi * 5.2 * t)
            harmonics = (.22, .06) if voice == 'flute' else (.1, .2)
            sound = np.sin(phase) + harmonics[0] * np.sin(2 * phase) + harmonics[1] * np.sin(3 * phase)
            envelope = np.minimum(1, t / .065) * release
        elif voice == 'strings':
            sound = np.sin(phase) + .17 * np.sin(2.002 * phase) + .07 * np.sin(3 * phase)
            envelope = np.minimum(1, t / .38) * np.minimum(1, (duration - t) / .4)
        elif voice == 'celesta':
            sound = np.sin(phase) + .3 * np.sin(2.01 * phase) + .065 * np.sin(4.01 * phase)
            envelope = attack * release * np.exp(-2.7 * t)
        elif voice == 'brass':
            sound = np.sin(phase) + .3 * np.sin(2 * phase) + .12 * np.sin(3 * phase)
            envelope = np.minimum(1, t / .045) * release
        else:
            sound = np.sin(phase) + .23 * np.sin(2 * phase) + .1 * np.sin(3 * phase)
            envelope = attack * release * np.exp(-(4 if voice == 'harp' else 1.8) * t)
        audio = sound * np.maximum(0, envelope) * volume
        self.mix[first:first + count, 0] += audio * np.sqrt((1 - pan) / 2)
        self.mix[first:first + count, 1] += audio * np.sqrt((1 + pan) / 2)

    def brush(self, start, volume):
        first = int(start * RATE)
        count = min(int(.06 * RATE), len(self.mix) - first)
        if count > 0:
            sound = self.rng.normal(0, volume, count) * np.exp(-np.arange(count) / (RATE * .014))
            self.mix[first:first + count] += sound[:, None]

    def save(self, target):
        # A short stereo room, with gentle boundaries for playlist transitions.
        dry = self.mix.copy()
        for seconds, volume in [(.13, .13), (.29, .09), (.43, .06)]:
            shift = int(seconds * RATE)
            self.mix[shift:] += dry[:-shift, ::-1] * volume
        t = np.arange(len(self.mix)) / RATE
        fade = np.minimum(1, t / .28) * np.minimum(1, (len(self.mix) / RATE - t) / .75)
        self.mix *= fade[:, None]
        peak = float(np.max(np.abs(self.mix)))
        assert np.isfinite(self.mix).all() and peak > .01
        self.mix *= .72 / peak
        # Catch accidental empty measures without rejecting the intentional tail.
        windows = self.mix[:len(self.mix) // RATE * RATE].reshape(-1, RATE, 2)
        assert np.min(np.sqrt(np.mean(windows[:-1] ** 2, axis=(1, 2)))) > .003
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'score.wav'
            with wave.open(str(source), 'wb') as output:
                output.setnchannels(2)
                output.setsampwidth(2)
                output.setframerate(RATE)
                output.writeframes((self.mix * 32767).astype('<i2').tobytes())
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-af',
                            'loudnorm=I=-20:TP=-2:LRA=7', '-ar', '44100', '-c:a', 'aac',
                            '-b:a', '128k', '-movflags', '+faststart', str(target)], check=True)
        print(f'{target.name}: {len(self.mix) / RATE:.2f}s, stereo, original composition')


def background(name, root, bpm, lead, theme, output):
    beat = 60 / bpm
    # 48 bars: A / B / A / C / B / A, with changing orchestration.
    score = Score(48 * 4 * beat + .6, theme + 174)
    for bar in range(48):
        start = bar * 4 * beat
        section = bar // 8
        chord_root = PROGRESSIONS[theme][bar % 8]
        chord = [degree(root - 24, chord_root + interval) for interval in (0, 2, 4, 6)]
        for index, pitch in enumerate(chord):
            score.note(pitch, start, 4.1 * beat, .038, 'strings', (index - 1.5) / 2)
        for pulse in range(4):
            score.note(chord[0] - 12, start + pulse * beat, .8 * beat, .085 if pulse % 2 == 0 else .045, 'bass')
        for step, index in enumerate(([0, 2, 1, 3, 1, 2, 3, 2] if theme % 2 else [0, 1, 2, 3, 2, 1, 3, 2])):
            score.note(chord[index] + 12, start + step * beat / 2, 1.2 * beat, .055, 'harp', -.45)
        melody = THEMES[theme][bar % 8]
        # Answer phrases vary the theme while keeping every note in the key.
        if section in (1, 4):
            melody = [pitch + (2 if index < 2 else 0) for index, pitch in enumerate(reversed(melody))]
        elif section == 3:
            melody = [pitch - 2 for pitch in melody]
        lengths = [1.5, .5, 1, 1] if bar % 2 else [1, .5, .5, 2]
        cursor = 0
        for index, (pitch, length) in enumerate(zip(melody, lengths)):
            note_pitch = degree(root, pitch)
            score.note(note_pitch, start + cursor * beat, length * beat * .9, .12, lead, .12)
            if section in (2, 4, 5) and index in (0, 2):
                score.note(note_pitch + 12, start + cursor * beat, length * beat, .025, 'celesta', .6)
            cursor += length
        if section in (1, 3, 5):
            score.note(chord[2] + 24, start + 2.5 * beat, 1.3 * beat, .045, 'flute' if lead == 'celesta' else 'celesta', -.25)
        for pulse in range(8):
            score.brush(start + pulse * beat / 2, .007 if theme == 3 else .011)
    score.save(output / f'{name}.m4a')


def cue(name, seconds, notes, voice, output):
    score = Score(seconds, 791)
    step = (seconds - 1.1) / len(notes)
    for index, pitch in enumerate(notes):
        start = index * step
        score.note(pitch, start, step * 1.5, .13, voice, .12)
        score.note(pitch - 12, start, step * 1.4, .045, 'harp', -.4)
        if index % 2 == 0:
            score.note(pitch + 7, start, step, .035, 'celesta', .5)
        score.brush(start, .012)
    for pitch in (48, 52, 55):
        score.note(pitch, 0, seconds - .1, .04, 'strings', -.2)
    score.save(output / f'{name}.m4a')


def main():
    output = Path(sys.argv[1] if len(sys.argv) > 1 else 'public/assets/music')
    for track in TRACKS:
        background(*track, output)
    cue('parade-fanfare', 8, [67, 72, 76, 79, 76, 74, 76, 79, 84], 'brass', output)
    cue('snack-time', 5, [76, 79, 81, 79, 84, 83, 79, 76], 'celesta', output)
    cue('ride-fanfare', 6, [72, 74, 76, 79, 81, 84, 83, 84], 'flute', output)


if __name__ == '__main__':
    main()
