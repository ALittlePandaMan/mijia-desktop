"""Verify live source resolution and playback sizing with local test patterns."""
import argparse
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import queue
import struct
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.tools/media-build/viewport-fixtures'
WORKER = ROOT / 'src-tauri/media-decoder/mijia-media-decoder.exe'
HEADER = struct.Struct('<4sIIIddII')


class ProcessMemory(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('faults', wintypes.DWORD)] + [
        (name, ctypes.c_size_t) for name in (
            'peak', 'working_set', 'quota_paged_peak', 'quota_paged',
            'quota_nonpaged_peak', 'quota_nonpaged', 'pagefile', 'pagefile_peak'
        )
    ]


def resources(worker):
    handle = wintypes.HANDLE(int(worker._handle))
    memory = ProcessMemory()
    memory.size = ctypes.sizeof(memory)
    if not ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(memory), memory.size):
        raise ctypes.WinError()
    created, exited, kernel, user = (ctypes.c_uint64() for _ in range(4))
    if not ctypes.windll.kernel32.GetProcessTimes(handle, *map(ctypes.byref, (created, exited, kernel, user))):
        raise ctypes.WinError()
    return {'peakWorkingSetBytes': memory.peak, 'cpuMs': (kernel.value + user.value) // 10000}


def run(encoder, codec, pix_fmt, width, height, preserve=True, low_power=False):
    fixture = WORK / f'{codec}-{pix_fmt}-{width}.ts'
    codec_args = ['-x265-params', 'pools=2:frame-threads=2:bframes=0:log-level=error'] if codec == 'libx265' else ['-threads', '2', '-bf', '0']
    if not fixture.exists():
        subprocess.run(
            [encoder, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
             '-i', f'testsrc2=size={width}x{height}:rate=24', '-t', '7', '-c:v', codec,
             '-pix_fmt', pix_fmt, '-preset', 'ultrafast', '-g', '12', *codec_args,
             '-f', 'mpegts', str(fixture)],
            check=True, timeout=100,
        )
    stream = fixture.read_bytes()
    mode = 'mpegts-low-power' if low_power else 'mpegts-source' if preserve else 'mpegts-dynamic'
    worker = subprocess.Popen(
        [str(WORKER), mode, '640', '0', '0'],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    frames = queue.SimpleQueue()
    resized = (width, height)
    stages = [(1280, 720), (853, 480), (1280, 720)] if low_power else [resized]*3 if preserve else [(640, 360), resized, (960, 540)]
    started = time.perf_counter()

    def collect():
        while header := worker.stdout.read(HEADER.size):
            magic, kind, w, h, pts, _, size, coded = HEADER.unpack(header)
            if magic != b'MJFR' or size > 3840*2160*4:
                frames.put(ValueError('Invalid decoder output'))
                break
            pixels = worker.stdout.read(size)
            if len(pixels) != size:
                frames.put(ValueError('Truncated decoder output'))
                break
            if kind == 1:
                frames.put((w, h, pts, coded, pixels[3], time.perf_counter()))

    def send(data, viewport, pressure):
        if preserve or low_power:
            worker.stdin.write(struct.pack('<II', 0xffffffff, pressure))
        if not preserve:
            worker.stdin.write(struct.pack('<III', 0, *viewport))
        for at in range(0, len(data), 32*1024):
            chunk = data[at:at+32*1024]
            worker.stdin.write(struct.pack('<I', len(chunk)))
            worker.stdin.write(chunk)
        worker.stdin.flush()

    reader = threading.Thread(target=collect, daemon=True)
    reader.start()
    results = []
    cuts = [0, len(stream)*4//10//188*188, len(stream)*7//10//188*188, len(stream)]
    last_pts = -1
    try:
        for index, size in enumerate(stages):
            pressure = int((preserve or low_power) and index == 1)
            fps = (6 if pressure else 10) if low_power else (8 if size[0]*size[1] > 1920*1080 else 15) >> pressure
            send(stream[cuts[index]:cuts[index+1]], resized if low_power else size, pressure)
            hits = []
            while True:
                raw = frames.get(timeout=12)
                if isinstance(raw, Exception):
                    raise raw
                w, h, pts, coded, alpha, at = raw
                assert coded & 65535 == width and coded >> 16 == height and alpha == 255
                assert pts > last_pts
                last_pts = pts
                if preserve:
                    assert (w,h) == resized
                if (w,h) == size:
                    if (preserve or low_power) and hits and not 1/fps-.002 <= pts-hits[-1][0] <= 1/fps+1/24+.002:
                        hits.clear()
                    hits.append((pts,at))
                    if len(hits) == 3:
                        break
            assert all(b[0]-a[0] >= 1/fps-.002 for a,b in zip(hits,hits[1:]))
            results.append({'output': size, 'firstMs': round((hits[0][1]-started)*1000), 'fpsLimit': fps})
        usage = resources(worker)
        worker.stdin.close()
        assert worker.wait(timeout=12) == 0
        reader.join(timeout=2)
        return {'codec': codec, 'format': pix_fmt, 'preserveSource': preserve, 'lowPower': low_power, 'source': resized, 'stages': results, **usage}
    finally:
        if worker.poll() is None:
            worker.kill()
            worker.wait()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ffmpeg', help='Path to offline fixture encoder with libx264 and libx265')
    args = parser.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    formats = [
        ('libx264', 'yuv420p', 1280, 720),
        ('libx264', 'yuv420p', 1920, 1080),
        ('libx265', 'yuv420p', 2560, 1440),
        ('libx265', 'yuv420p10le', 3840, 2160),
    ]
    results = [run(args.ffmpeg, *spec) for spec in formats]
    results.append(run(args.ffmpeg, *formats[1], preserve=False))
    results.extend(run(args.ffmpeg, *spec, preserve=False, low_power=True) for spec in (formats[1], formats[3]))
    report = {'offlineOnly': True, 'deviceWrites': 0, 'results': results}
    (WORK / 'source-resolution-regression.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps(report))
