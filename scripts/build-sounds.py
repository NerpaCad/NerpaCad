"""
Cut, level and encode the heroes' sounds into src/renderer/assets/sounds/*.ogg.

    python3 scripts/build-sounds.py <folder with Animals_soubs.wav and the unpacked Kenney sets>

The animal recordings are freesound.org CC0 (see sounds/SOURCES.txt); the common sounds are
Kenney CC0 packs. «Плюх» is made here from noise and a chirp, no recording needed.
Each clip: mono 44.1 kHz, 8 ms fade-in, 60 ms fade-out, leading/trailing silence cut,
loudness levelled to about -18 dBFS RMS (peaks kept under -1 dBFS), Vorbis q4.
"""
import json, os, subprocess, sys
import numpy as np

SR = 44100
SRC = sys.argv[1] if len(sys.argv) > 1 else 'Assets/Sounds'
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'renderer', 'assets', 'sounds')
ANIMALS = os.path.join(SRC, 'Animals_soubs.wav')


def kenney(pack, name):
    for root, _, files in os.walk(SRC):
        if pack in root and name in files:
            return os.path.join(root, name)
    raise SystemExit(f'not found: {pack}/{name}')


def load(path, start=None, end=None, rate=1.0):
    args = ['ffmpeg', '-v', 'error']
    if start is not None:
        args += ['-ss', str(start), '-to', str(end)]
    args += ['-i', path]
    af = []
    if rate != 1.0:  # pitch up (and shorten) like a faster tape
        af.append(f'asetrate={int(SR * rate)},aresample={SR}')
    if af:
        args += ['-af', ','.join(af)]
    args += ['-ac', '1', '-ar', str(SR), '-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(args, capture_output=True, check=True).stdout, np.float32).copy()


def trim(x, thr_db=-42):
    """Cut quiet head and tail (relative to the clip's peak)."""
    win = int(0.01 * SR)
    n = len(x) // win
    if n == 0:
        return x
    rms = np.sqrt((x[: n * win].reshape(n, win) ** 2).mean(axis=1) + 1e-12)
    db = 20 * np.log10(rms / (np.abs(x).max() + 1e-9))
    on = np.where(db > thr_db)[0]
    if not len(on):
        return x
    a = max(0, on[0] - 1) * win
    b = min(len(x), (on[-1] + 3) * win)
    return x[a:b]


def level(x, target_db=-18.0, peak_db=-1.0):
    win = int(0.05 * SR)
    n = max(1, len(x) // win)
    rms = np.sqrt((x[: n * win].reshape(n, -1) ** 2).mean(axis=1) + 1e-12) if len(x) >= win else np.array([np.sqrt((x**2).mean())])
    loud = rms[rms > rms.max() * 0.25]  # the sounding part, not the gaps
    cur = 20 * np.log10(np.sqrt((loud**2).mean()) + 1e-9)
    g = 10 ** ((target_db - cur) / 20)
    pk = np.abs(x).max() * g
    lim = 10 ** (peak_db / 20)
    if pk > lim:
        g *= lim / pk
    return x * g


def fade(x, fin=0.008, fout=0.06):
    x = x.copy()
    a = min(len(x) // 4, int(fin * SR))
    b = min(len(x) // 3, int(fout * SR))
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b) ** 2
    return x


def splash():
    """A cartoon «плюх»: a short bubbly chirp over a burst of filtered noise, then two drops."""
    rng = np.random.default_rng(7)
    t = np.arange(int(0.55 * SR)) / SR
    noise = rng.standard_normal(len(t))
    # band-limit the noise (simple one-pole low-pass, then high-pass)
    lp = np.empty_like(noise)
    acc = 0.0
    for i, v in enumerate(noise):
        acc += 0.25 * (v - acc)
        lp[i] = acc
    hp = lp - np.convolve(lp, np.ones(40) / 40, mode='same')
    body = hp * np.exp(-t / 0.09) * (1 - np.exp(-t / 0.004))
    f = 260 + 900 * (t / 0.12).clip(0, 1) ** 0.6
    chirp = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.05) * 0.6
    out = body * 1.6 + chirp
    for at, f0 in ((0.2, 1400), (0.31, 1900)):
        tt = t - at
        m = tt >= 0
        ff = f0 + 2500 * tt[m].clip(0, 0.04)
        out[m] += 0.35 * np.sin(2 * np.pi * np.cumsum(ff) / SR) * np.exp(-tt[m] / 0.025)
    return out.astype(np.float32)


# id: (source, args)  — times are seconds in Animals_soubs.wav
CLIPS = {
    # Нерпа
    'seal_voice': ('a', 14.7, 15.8),
    'seal_bark': ('a', 49.3, 50.0),
    'seal_roar': ('a', 66.1, 67.4),
    'seal_splash': ('synth', splash),
    # Геннадий
    'pigeon_coo': ('a', 107.4, 109.0),
    'pigeon_gugu': ('a', 83.3, 84.1),
    'pigeon_wings': ('a', 120.9, 121.95),
    # Читик
    'cheetah_purr': ('a', 192.0, 194.4),
    'cheetah_meow': ('a', 206.65, 207.35),
    'cheetah_chirp': ('a', 216.1, 216.95, 2 ** (5 / 12)),
    # общие
    'hooray': ('k', 'music-jingles', 'jingles_PIZZI02.ogg'),
    'oops': ('k', 'music-jingles', 'jingles_PIZZI09.ogg'),
    'bell': ('k', 'impact-sounds', 'impactBell_heavy_000.ogg'),
    'drum': ('k', 'impact-sounds', 'impactPunch_heavy_000.ogg'),
    'click': ('k', 'interface-sounds', 'click_001.ogg'),
    'jump': ('k', 'digital-audio', 'phaseJump1.ogg'),
    'pew': ('k', 'digital-audio', 'laser4.ogg'),
    'bonus': ('k', 'digital-audio', 'powerUp4.ogg'),
    'step': ('k', 'impact-sounds', 'footstep_grass_000.ogg'),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    durs = {}
    for cid, spec in CLIPS.items():
        if spec[0] == 'a':
            x = load(ANIMALS, spec[1], spec[2], spec[3] if len(spec) > 3 else 1.0)
        elif spec[0] == 'k':
            x = load(kenney(spec[1], spec[2]))
        else:
            x = spec[1]()
        x = fade(level(trim(x)))
        dst = os.path.join(OUT, cid + '.ogg')
        subprocess.run(
            ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libvorbis', '-q:a', '4', dst],
            input=x.astype(np.float32).tobytes(), check=True)
        durs[cid] = round(len(x) / SR, 2)
        print(f'{cid:15s} {durs[cid]:5.2f} s  {os.path.getsize(dst) // 1024} KB')
    print(json.dumps(durs))


if __name__ == '__main__':
    main()
