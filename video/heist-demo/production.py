"""Select an editable cut while preserving the original rehearsal production."""
from pathlib import Path
import json
import os

ROOT = Path(__file__).resolve().parents[2]
PROJECT_PATH = Path(os.environ.get('HEIST_DEMO_PROJECT', Path(__file__).with_name('project.json'))).resolve()
PROJECT = json.loads(PROJECT_PATH.read_text())
OUT = (ROOT / os.environ.get('HEIST_DEMO_OUTPUT', 'artifacts/heist-demo')).resolve()
EXPORT_NAME = PROJECT.get('export_name', 'HEIST-Rehearsal-Demo.mp4')
if Path(EXPORT_NAME).name != EXPORT_NAME or not EXPORT_NAME.endswith('.mp4'):
    raise ValueError('The export name must be a plain MP4 filename.')
