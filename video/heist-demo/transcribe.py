"""Check generated narration with Deepgram ASR; key remains in process memory."""
from pathlib import Path
import argparse,json,re
import requests
from narrate import load_key
from production import ROOT, OUT

parser=argparse.ArgumentParser();parser.add_argument('--mix',action='store_true');args=parser.parse_args()
prefix='mix-' if args.mix else ''
key=load_key()
with (OUT/('audio/final-mix.wav' if args.mix else 'audio/narration.wav')).open('rb') as audio:
    response=requests.post('https://api.deepgram.com/v1/listen',params={'model':'nova-3','smart_format':'true','punctuate':'true','utterances':'true'},headers={'Authorization':'Token '+key,'Content-Type':'audio/wav'},data=audio,timeout=100)
del key
if response.status_code!=200:raise RuntimeError(f'Audio verification returned HTTP {response.status_code}; response details suppressed.')
data=response.json();(OUT/f'qa/{prefix}narration-asr.json').write_text(json.dumps(data,indent=2))
alternative=data['results']['channels'][0]['alternatives'][0]
(OUT/f'qa/{prefix}heard-transcript.txt').write_text(alternative['transcript'])
print(json.dumps({'source':'final mix' if args.mix else 'narration stem','asr_duration':data.get('metadata',{}).get('duration'),'words':len(alternative.get('words',[])),'confidence':alternative.get('confidence'),'model':'nova-3','secret_logged':False}))
