"""Convert timestamped browser screenshot captures into real-time, editable video.

Usage: python3 video/heist-demo/assemble-live-capture.py ROOM
The input is an actual CUA browser capture, never reconstructed game state.
Frames keep their recorded timing; conversion to 30 fps only repeats frames.
"""
from pathlib import Path
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
room = sys.argv[1].upper() if len(sys.argv) > 1 else ''
if not re.fullmatch(r'[A-Z0-9]{6}', room):
    raise SystemExit('Supply the six-character recorded mission ID.')
source = ROOT / 'artifacts/live-verification' / room / 'frames'
output = source.parent / 'footage'
output.mkdir(parents=True, exist_ok=True)
for timing_file in sorted(source.glob('*-timing.json')):
    timing = json.loads(timing_file.read_text())
    frames = timing['frames']
    if not frames:
        continue
    lines = []
    previous = -1
    for index, frame in enumerate(frames):
        path = source / frame['file']
        if not re.fullmatch(r'[a-z0-9_-]+\.png', frame['file']) or not path.is_file():
            raise SystemExit('Missing or invalid recorded frame.')
        start = frame['offsetSeconds']
        end = frames[index + 1]['offsetSeconds'] if index + 1 < len(frames) else timing['durationSeconds']
        if start < previous or end <= start:
            raise SystemExit('Recorded timestamps are not increasing.')
        previous = start
        lines.extend(["file '" + str(path) + "'", f'duration {end - start:.6f}'])
    lines.append("file '" + str(source / frames[-1]['file']) + "'")
    listing = output / (timing_file.stem.replace('-timing', '') + '.ffconcat')
    listing.write_text('\n'.join(lines) + '\n')
    movie = listing.with_suffix('.mp4')
    duration = timing['durationSeconds'] - frames[0]['offsetSeconds']
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
        '-i', str(listing), '-t', str(duration),
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30',
        '-an', '-c:v', 'libx264', '-crf', '17', '-preset', 'fast', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', str(movie),
    ], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(movie), '-f', 'null', '-'], check=True)
    print(f'Encoded and decoded {movie.name}: {duration:.2f}s, {len(frames)} actual captured frames.')
