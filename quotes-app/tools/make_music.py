"""퍼블릭 도메인 클래식 곡을 피아노풍 소리로 직접 합성해 OGG 파일을 만듭니다.

녹음 저작권 문제가 없도록 악보(작곡가 사후 수백 년, 퍼블릭 도메인)를 코드로 옮겨 렌더링합니다.
사용법: python3 make_music.py <출력 폴더>   (numpy, ffmpeg 필요)
"""
import os
import subprocess
import sys

import numpy as np

SR = 44100
NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi(name):
    """'C#4', 'Bb3' 같은 음이름 → MIDI 번호."""
    pitch = NOTE[name[0]]
    rest = name[1:]
    while rest and rest[0] in "#b":
        pitch += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    return pitch + 12 * (int(rest) + 1)


def piano(note, dur, vel=0.6):
    """배음 합성 + 감쇠 엔벨로프로 만든 부드러운 피아노 음."""
    f = 440.0 * 2 ** ((midi(note) - 69) / 12)
    length = dur + 1.2
    t = np.arange(int(length * SR)) / SR
    tone = np.zeros_like(t)
    for h, amp in enumerate([1.0, 0.45, 0.22, 0.12, 0.06, 0.03], start=1):
        fh = f * h * (1 + 0.0004 * h * h)
        if fh > SR / 2.2:
            break
        tone += amp * np.sin(2 * np.pi * fh * t) * np.exp(-t * (1.2 + 0.9 * h) * (f / 440) ** 0.35)
    attack = np.minimum(t / 0.006, 1.0)
    release = np.clip(1 - (t - dur) / 1.2, 0, 1) ** 2
    return tone * attack * release * vel


class Track:
    def __init__(self, seconds):
        self.buf = np.zeros(int((seconds + 4) * SR))

    def add(self, note, start, dur, vel=0.6):
        s = piano(note, dur, vel)
        i = int(start * SR)
        end = min(i + len(s), len(self.buf))
        self.buf[i:end] += s[: end - i]

    def render(self, path):
        # 짧은 홀 잔향(지수 감쇠 노이즈 임펄스 응답)을 FFT 컨볼루션으로 입힘
        rng = np.random.default_rng(7)
        ir_t = np.arange(int(1.8 * SR)) / SR
        ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.2)
        ir[0] = 0
        ir /= np.sqrt(np.sum(ir**2))
        n = len(self.buf) + len(ir)
        nfft = 1 << (n - 1).bit_length()
        wet = np.fft.irfft(np.fft.rfft(self.buf, nfft) * np.fft.rfft(ir, nfft), nfft)[: len(self.buf)]
        mix = self.buf * 0.8 + wet * 0.35
        # 끝부분 무음 정리 + 페이드아웃 + 정규화
        nz = np.nonzero(np.abs(mix) > 1e-4)[0]
        mix = mix[: nz[-1] + 1] if len(nz) else mix
        fade = int(1.5 * SR)
        mix[-fade:] *= np.linspace(1, 0, fade)
        mix = mix / np.max(np.abs(mix)) * 0.85
        pcm = (mix * 32767).astype("<i2").tobytes()
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-",
             "-c:a", "libvorbis", "-q:a", "3", path],
            input=pcm, check=True)


def bach_prelude():
    """J.S. 바흐 – 평균율 클라비어곡집 1권, 프렐류드 C장조 BWV 846."""
    bars = [
        "C4 E4 G4 C5 E5", "C4 D4 A4 D5 F5", "B3 D4 G4 D5 F5", "C4 E4 G4 C5 E5",
        "C4 E4 A4 E5 A5", "C4 D4 F#4 A4 D5", "B3 D4 G4 D5 G5", "B3 C4 E4 G4 C5",
        "A3 C4 E4 G4 C5", "D3 A3 D4 F#4 C5", "G3 B3 D4 G4 B4", "G3 Bb3 E4 G4 C#5",
        "F3 A3 D4 A4 D5", "F3 Ab3 D4 F4 B4", "E3 G3 C4 G4 C5", "E3 F3 A3 C4 F4",
        "D3 F3 A3 C4 F4", "G2 D3 G3 B3 F4", "C3 E3 G3 C4 E4", "C3 G3 Bb3 C4 E4",
        "F2 F3 A3 C4 E4", "F#2 C3 A3 C4 Eb4", "Ab2 F3 B3 C4 D4", "G2 F3 G3 B3 D4",
        "G2 E3 G3 C4 E4", "G2 D3 G3 C4 F4", "G2 D3 G3 B3 F4", "G2 Eb3 A3 C4 F#4",
        "G2 E3 G3 C4 G4", "G2 D3 G3 C4 F4", "G2 D3 G3 B3 F4", "C2 C3 G3 Bb3 E4",
        "C2 C3 F3 A3 Eb4", "C2 B2 G3 B3 D4",
    ]
    step = 0.24  # 16분음표 길이(초)
    track = Track(len(bars) * 16 * step + 6)
    t = 0.0
    for bar in bars:
        n = bar.split()
        for _ in range(2):
            track.add(n[0], t, step * 8, 0.55)            # 베이스는 반마디 지속
            track.add(n[1], t + step, step * 7, 0.45)
            for k, idx in enumerate([2, 3, 4, 2, 3, 4]):
                track.add(n[idx], t + step * (2 + k), step * 1.6, 0.42)
            t += step * 8
    for note in ["C2", "C3", "E4", "G4", "C5"]:          # 마지막 으뜸화음
        track.add(note, t, 4.0, 0.5)
    return track


def pachelbel_canon():
    """J. 파헬벨 – 캐논 D장조 (피아노 편곡)."""
    chords = [("D3", "D4 F#4 A4"), ("A2", "C#4 E4 A4"), ("B2", "D4 F#4 B4"), ("F#2", "C#4 F#4 A4"),
              ("G2", "D4 G4 B4"), ("D3", "D4 F#4 A4"), ("G2", "D4 G4 B4"), ("A2", "C#4 E4 A4")]
    mel_a = "F#5 E5 D5 C#5 B4 A4 B4 C#5"
    mel_b = "D5 C#5 B4 A4 G4 F#4 G4 E4"
    mel_c = "D5 F#5 A5 G5 F#5 D5 F#5 E5 D5 B4 D5 A5 G5 B5 A5 G5"
    mel_d = "D5 E5 F#5 D5 C#5 D5 E5 C#5 B4 C#5 D5 B4 A4 B4 C#5 A4 G4 A4 B4 G4 F#4 G4 A4 F#4 G4 A4 B4 G4 A4 B4 C#5 A4"
    beat = 0.9
    cycle = len(chords) * 2 * beat
    plan = [[], [mel_a], [mel_b, mel_a], [mel_c], [mel_c, mel_b], [mel_d], [mel_d, mel_a], [mel_a]]
    track = Track(len(plan) * cycle + 6)

    for c, melodies in enumerate(plan):
        base = c * cycle
        for i, (bass, triad) in enumerate(chords):
            t = base + i * 2 * beat
            track.add(bass, t, 2 * beat, 0.6)
            track.add(bass[:-1] + str(int(bass[-1]) + 1), t, 2 * beat, 0.3)
            for k, note in enumerate(triad.split() + triad.split()[1:2]):
                track.add(note, t + k * beat / 2, beat * 0.9, 0.22)
        for m, mel in enumerate(melodies):
            notes = mel.split()
            dur = cycle / len(notes)
            vel = 0.5 if m == 0 else 0.32
            for k, note in enumerate(notes):
                track.add(note, base + k * dur, dur * 1.05, vel)
    end = len(plan) * cycle
    for note in ["D2", "D3", "F#4", "A4", "D5"]:
        track.add(note, end, 4.0, 0.45)
    return track


def fur_elise():
    """L.v. 베토벤 – 엘리제를 위하여 WoO 59 (A 부분)."""
    e = 0.3  # 8분음표
    phrase1 = [  # (오른손 음, 왼손 음 or None)
        ("E5", None), ("D#5", None),
        ("E5", None), ("D#5", None), ("E5", None), ("B4", None), ("D5", None), ("C5", None),
        ("A4", "A2"), ("-", "E3"), ("C4", "A3"), ("E4", None), ("A4", None),
        ("B4", "E2"), ("-", "E3"), ("E4", "G#3"), ("G#4", None), ("B4", None),
        ("C5", "A2"), ("-", "E3"), ("E4", "A3"), ("E5", None), ("D#5", None),
        ("E5", None), ("D#5", None), ("E5", None), ("B4", None), ("D5", None), ("C5", None),
        ("A4", "A2"), ("-", "E3"), ("C4", "A3"), ("E4", None), ("A4", None),
        ("B4", "E2"), ("-", "E3"), ("E4", "G#3"), ("C5", None), ("B4", None),
    ]
    ending1 = [("A4", "A2"), ("-", "E3"), ("-", "A3"), ("-", None)]
    ending2 = [("A4", "A2"), ("-", "E3"), ("B4", "A3"), ("C5", None), ("D5", None)]
    middle = [
        ("E5", "C3"), ("-", "G3"), ("-", "C4"), ("G4", None), ("F5", None), ("E5", None),
        ("D5", "G2"), ("-", "G3"), ("-", "B3"), ("F4", None), ("E5", None), ("D5", None),
        ("C5", "A2"), ("-", "E3"), ("-", "A3"), ("E4", None), ("D5", None), ("C5", None),
        ("B4", "E2"), ("-", "E3"), ("-", "E4"), ("E4", None), ("E5", None), ("E4", None),
        ("E5", None), ("E6", None), ("D#5", None), ("E5", None), ("D#5", None), ("E5", None),
    ]
    events = phrase1 + ending1 + phrase1[2:] + ending2 + middle + phrase1[2:] + ending1 + phrase1 + ending1
    track = Track(len(events) * e * 1.3 + 8)
    t = 0.0
    for right, left in events:
        if right != "-":
            track.add(right, t, e * 1.5, 0.5)
        if left:
            track.add(left, t, e * 2.5, 0.35)
        t += e
    track.add("A2", t, 3, 0.4)
    track.add("A4", t, 3, 0.45)
    return track


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    for name, fn in [("bach_prelude", bach_prelude), ("pachelbel_canon", pachelbel_canon), ("fur_elise", fur_elise)]:
        fn().render(os.path.join(out, name + ".ogg"))
        print("wrote", name)
