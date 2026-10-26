"""Deepgram TTS. Credential stays in memory, loaded from the original local .env."""
from pathlib import Path
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import time
import wave
import requests
from production import ROOT, PROJECT, OUT as PRODUCTION_OUT

OUT = PRODUCTION_OUT / 'audio'
ALIASES = ('DEEPGRAM_API_KEY', 'DEEPGRAM_TTS_KEY', 'DEEPGRAM_KEY', 'DEEPGRAM_API', 'TTS')

def load_key():
    source = ROOT.parent / 'Appwrite'
    for path in sorted(source.rglob('.env*')):
        if not path.is_file() or any(p in path.parts for p in ('node_modules', '.git', '.venv', 'venv')):
            continue
        for line in path.read_text().splitlines():
            match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$', line)
            if match and match[1] in ALIASES:
                value = match[2].strip().strip('"\'')
                value = re.sub(r'^Token\s+', '', value, flags=re.I)
                if value and not path.name.endswith('example'):
                    return value
    raise RuntimeError('No configured Deepgram credential found in the authorized Appwrite folder.')

def normalize_wave(dest):
    normalized = dest.with_name(dest.stem + '.normalized.wav')
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(dest),'-ac','1','-ar','48000','-c:a','pcm_s16le',str(normalized)],check=True,capture_output=True)
    normalized.replace(dest)
    with wave.open(str(dest)) as audio:
        return audio.getnframes() / audio.getframerate()

def synthesize(item, key):
    name, text = item
    dest = OUT / f'{name}.wav'
    digest = hashlib.sha256((PROJECT['voice'] + text).encode()).hexdigest()
    sidecar = dest.with_suffix('.json')
    if dest.exists() and sidecar.exists() and json.loads(sidecar.read_text()).get('text_hash') == digest:
        old=json.loads(sidecar.read_text())
        if old.get('duration',0)>180:
            old['duration']=normalize_wave(dest);sidecar.write_text(json.dumps(old,indent=2))
        return name, 'cached'
    for attempt in range(3):
        try:
            response = requests.post('https://api.deepgram.com/v1/speak',
                params={'model': PROJECT['voice'], 'encoding': 'linear16', 'container': 'wav', 'sample_rate': 48000, 'speed': 0.98},
                headers={'Authorization': 'Token ' + key, 'Content-Type': 'application/json'},
                json={'text': text}, timeout=65)
            if response.status_code == 429 or response.status_code >= 500:
                time.sleep(2 ** attempt); continue
            if response.status_code != 200:
                raise RuntimeError(f'Deepgram returned HTTP {response.status_code}; response body and headers suppressed.')
            dest.write_bytes(response.content)
            duration = normalize_wave(dest)
            sidecar.write_text(json.dumps({'provider': 'Deepgram', 'model': PROJECT['voice'], 'text': text, 'text_hash': digest, 'duration': duration, 'sample_rate': 48000}, indent=2))
            return name, f'{duration:.2f}s'
        except requests.RequestException:
            if attempt == 2:
                raise RuntimeError('Deepgram network request failed; credential and request details suppressed.') from None
            time.sleep(2 ** attempt)
    raise RuntimeError('Deepgram retry limit reached; details suppressed.')

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    key = load_key()
    items = [(f"{scene['id']}_{i+1:02d}", text) for scene in PROJECT['scenes'] for i, text in enumerate(scene['sentences'])]
    if os.environ.get('HEIST_TTS_SAMPLE'):
        items = items[:2]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for name, status in pool.map(lambda item: synthesize(item, key), items):
            print(f'Narration {name}: {status}', flush=True)
    del key
