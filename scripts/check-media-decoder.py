"""Offline worker regression. Cached FFmpeg/FATE vectors only; no devices.
Use --download once to populate the four hash-pinned public test vectors.
They stay in .tools and are never distributed with the application.
"""
import concurrent.futures
import hashlib
import json
import math
import pathlib
import struct
import subprocess
import sys
import threading
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / '.tools/media-build/fixtures'
EXE = ROOT / 'src-tauri/media-decoder/mijia-media-decoder.exe'
VECTORS = json.loads((ROOT / 'native/test-vectors.json').read_text('utf8'))
CACHE.mkdir(parents=True, exist_ok=True)
for name, vector in VECTORS.items():
    target = CACHE / name
    if not target.exists() and '--download' in sys.argv:
        with urllib.request.urlopen(vector['url'], timeout=60) as response:
            target.write_bytes(response.read(2*1024*1024))
    if hashlib.sha256(target.read_bytes()).hexdigest() != vector['sha256']:
        raise RuntimeError('Offline vector hash mismatch: ' + name)


def crc(raw):
    value = 0xffffffff
    for byte in raw:
        value ^= byte << 24
        for _ in range(8):
            value = ((value << 1) ^ (0x04c11db7 if value & 0x80000000 else 0)) & 0xffffffff
    return value.to_bytes(4, 'big')


def packet(pid, start, raw, count):
    header = bytearray([0x47, (0x40 if start else 0) | ((pid >> 8) & 31), pid & 255, 0x10 | (count & 15)])
    if len(raw) < 184:
        header[3] |= 0x20
        padding = 183 - len(raw)
        header += bytes([padding])
        header += (b'\0' + b'\xff'*(padding-1)) if padding else b''
    return bytes(header) + raw


def transport(raw, hevc):
    pat = bytes([0, 0xb0, 0x0d, 0, 1, 0xc1, 0, 0, 0, 1, 0xe1, 0])
    pmt = bytes([2, 0xb0, 0x12, 0, 1, 0xc1, 0, 0, 0xe1, 1, 0xf0, 0, 0x24 if hevc else 0x1b, 0xe1, 1, 0xf0, 0])
    result = packet(0, True, b'\0'+pat+crc(pat), 0) + packet(256, True, b'\0'+pmt+crc(pmt), 0)
    pts = 90000
    pes = bytes([0, 0, 1, 0xe0, 0, 0, 0x84, 0x80, 5, 0x21 | ((pts >> 29) & 14), (pts >> 22) & 255, ((pts >> 14) & 254) | 1, (pts >> 7) & 255, ((pts << 1) & 254) | 1]) + raw
    return result + b''.join(packet(257, offset == 0, pes[offset:offset+184], offset//184) for offset in range(0, len(pes), 184))


def run(name, seek=0, damaged=False):
    raw = (CACHE / name).read_bytes()
    file = name.endswith('.mp4')
    data = raw if file else transport(raw, name.startswith('hevc'))
    if damaged:
        data = b'not-a-video-stream'
    started = time.perf_counter()
    process = subprocess.Popen([str(EXE), 'mp4' if file else 'mpegts', '640', str(seek), str(len(data)) if file else '0'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    timeout = threading.Timer(20, process.kill)
    timeout.start()
    def feed():
        try:
            process.stdin.write(data)
            process.stdin.close()
        except (BrokenPipeError, OSError):
            pass
    writer = threading.Thread(target=feed, daemon=True)
    writer.start()
    count = 0
    audio = 0
    last = -1
    alpha = True
    try:
        def exact(size):
            parts = bytearray()
            while len(parts) < size:
                part = process.stdout.read(size-len(parts))
                if not part:
                    break
                parts.extend(part)
            return parts
        while True:
            header = exact(40)
            if not header:
                break
            assert len(header) == 40
            magic, kind, width, height, stamp, duration, size, rate = struct.unpack('<4sIIIddII', header)
            assert magic == b'MJFR' and size <= 1920*1080*4 and math.isfinite(stamp)
            pixels = exact(size)
            assert len(pixels) == size
            if kind == 1:
                assert 0 < width <= 640 and 0 < height <= 1080 and size == width*height*4
                assert stamp >= last and stamp >= seek-.001
                assert rate & 65535 >= width and rate >> 16 >= height
                alpha = alpha and pixels[3] == 255
                count += 1
                last = stamp
            elif kind == 2:
                assert rate == 48000 and width == 2 and size % 8 == 0
                audio += 1
        code = process.wait(timeout=3)
        writer.join(timeout=2)
        if damaged:
            assert code != 0 and count == 0
        else:
            assert code == 0 and count > 0 and alpha
        return {'vector': name, 'seek': seek, 'damaged': damaged, 'frames': count, 'audioBlocks': audio, 'exit': code, 'elapsedMs': round((time.perf_counter()-started)*1000)}
    finally:
        timeout.cancel()
        if process.poll() is None:
            process.kill()
            process.wait()


results = [run(name) for name in VECTORS]
assert results[1]['frames'] >= 100 and results[1]['audioBlocks'] > 0
results += [run('h264.mp4', seek=3), run('h264.mp4', damaged=True)]
with concurrent.futures.ThreadPoolExecutor(4) as pool:
    parallel = list(pool.map(lambda _: run('h264.mp4'), range(4)))
with concurrent.futures.ThreadPoolExecutor(4) as pool:
    repeated = list(pool.map(lambda _: run('hevc8.bit'), range(20)))
invalid = subprocess.run([str(EXE), 'https://invalid.example/', '640', '0', '0'], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, timeout=5)
assert invalid.returncode == 2 and not invalid.stdout
assert not any('mijia-media-decoder' in line.lower() for line in subprocess.check_output(['tasklist', '/fo', 'csv', '/nh'], text=True).splitlines())
report = {'passed': True, 'offlineOnly': True, 'deviceWrites': 0, 'results': results, 'parallel': parallel, 'repeatedCycles': len(repeated), 'invalidEndpointRejected': True, 'orphanWorkers': 0}
(ROOT / '.tools/media-build/decoder-regression.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report))
