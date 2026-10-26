"""Check generated narration with Deepgram ASR; key remains in process memory."""
from pathlib import Path
import json,re
import requests
from narrate import load_key

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/heist-demo'
key=load_key()
with (OUT/'audio/narration.wav').open('rb') as audio:
    response=requests.post('https://api.deepgram.com/v1/listen',params={'model':'nova-3','smart_format':'true','punctuate':'true','utterances':'true'},headers={'Authorization':'Token '+key,'Content-Type':'audio/wav'},data=audio,timeout=100)
del key
if response.status_code!=200:raise RuntimeError(f'Audio verification returned HTTP {response.status_code}; response details suppressed.')
data=response.json();(OUT/'qa/narration-asr.json').write_text(json.dumps(data,indent=2))
alternative=data['results']['channels'][0]['alternatives'][0]
(OUT/'qa/heard-transcript.txt').write_text(alternative['transcript'])
print(json.dumps({'asr_duration':data.get('metadata',{}).get('duration'),'words':len(alternative.get('words',[])),'confidence':alternative.get('confidence'),'model':'nova-3','secret_logged':False}))
