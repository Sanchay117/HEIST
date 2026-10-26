"""Decode the full export; inspect timing, loudness, captions, OCR and secret exposure."""
from pathlib import Path
import concurrent.futures,json,math,re,subprocess,struct
import cv2
from PIL import Image,ImageDraw
from narrate import load_key
from production import ROOT, OUT, PROJECT as P, EXPORT_NAME

QA=OUT/'qa';VIDEO=OUT/'exports'/EXPORT_NAME
report={'version':P['version'],'real_twitch_transport_verified':P.get('real_twitch_transport_verified',False),'full_live_mission_verified':False,'obs_broadcast_verified':False,'checks':{},'limits':['No subjective audio listening was available; speech content and mix were checked with transcription and loudness analysis.',P.get('verification_limit','Real Twitch and OBS capture require user credentials/interaction.')]}

def run(args):return subprocess.run(args,check=True,capture_output=True,text=True)
probe=json.loads(run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(VIDEO)]).stdout)
v=next(s for s in probe['streams'] if s['codec_type']=='video');a=next(s for s in probe['streams'] if s['codec_type']=='audio')
duration=float(probe['format']['duration']);assert duration<180 and abs(duration-P['duration'])<.1
assert (v['width'],v['height'],v['r_frame_rate'])==(1920,1080,'30/1')
assert v['codec_name']=='h264' and a['codec_name']=='aac'
report['checks']['format']={'duration_seconds':duration,'width':v['width'],'height':v['height'],'fps':v['r_frame_rate'],'video_codec':v['codec_name'],'audio_codec':a['codec_name'],'size_bytes':int(probe['format']['size'])}
run(['ffmpeg','-v','error','-i',str(VIDEO),'-f','null','-'])
report['checks']['full_decode']='passed, no audio/video decode errors'

atoms=[]
with VIDEO.open('rb') as f:
    while True:
        header=f.read(8)
        if len(header)<8:break
        size,kind=struct.unpack('>I4s',header)
        if size==1:size=struct.unpack('>Q',f.read(8))[0];size-=8
        if size<8:break
        atoms.append(kind.decode('ascii','replace'));f.seek(size-8,1)
assert atoms.index('moov')<atoms.index('mdat');report['checks']['fast_start']=True

timing=json.loads((OUT/'narration-timing.json').read_text());cues=json.loads((OUT/'captions.json').read_text())
last=0
for cue in cues:
    assert cue['start']>=last and cue['end']>cue['start'] and cue['end']<=duration
    last=cue['end']
for i,item in enumerate(timing):
    assert 0<=item['start']<item['end']<=duration
    if i:assert item['start']>=timing[i-1]['end']
report['checks']['captions']={'cues':len(cues),'non_overlapping':True,'within_export':True,'max_characters_per_second':round(max(len(c['text'])/(c['end']-c['start']) for c in cues),1)}
report['checks']['narration']={'segments':len(timing),'overlap':False,'within_scene_windows':all(P['scenes'][int(x['scene'])-1]['start']<=x['start'] and x['end']<=P['scenes'][int(x['scene'])-1]['start']+P['scenes'][int(x['scene'])-1]['duration'] for x in timing)}

measure=run(['ffmpeg','-hide_banner','-i',str(VIDEO),'-af','loudnorm=I=-16:TP=-1.5:LRA=8:print_format=json','-f','null','-']).stderr
stats=json.loads(measure[measure.rfind('{'):measure.rfind('}')+1]);report['checks']['final_audio']={k:stats[k] for k in ['input_i','input_tp','input_lra']}
assert -18<=float(stats['input_i'])<=-14 and float(stats['input_tp'])<=-1
mix=json.loads((QA/'audio-mix.json').read_text());assert mix['narration_to_music_db_during_speech']>=14
report['checks']['voice_above_music_db']=mix['narration_to_music_db_during_speech']

# A full sequential visual review set, sampled once per second.
frames=QA/'review-frames';frames.mkdir(exist_ok=True)
cap=cv2.VideoCapture(str(VIDEO));count=0;images=[]
while True:
    ok,frame=cap.read()
    if not ok:break
    if count%P['fps']==0:
        image=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB));path=frames/f'{count//P["fps"]:03}.jpg';image.save(path,quality=91);images.append(path)
    count+=1
cap.release();assert count==P['duration']*P['fps']
for page in range(math.ceil(len(images)/36)):
    sheet=Image.new('RGB',(1920,1200),'#0b130e');draw=ImageDraw.Draw(sheet)
    for j,path in enumerate(images[page*36:(page+1)*36]):
        img=Image.open(path).resize((320,180));x=(j%6)*320;y=(j//6)*200;sheet.paste(img,(x,y));draw.text((x+6,y+181),f'{int(path.stem)//60:02}:{int(path.stem)%60:02}',fill='white')
    sheet.save(QA/f'full-review-{page+1:02}.jpg',quality=94)
report['checks']['frame_review']={'decoded_frames':count,'one_second_review_images':len(images),'contact_sheets':math.ceil(len(images)/36)}

# The key is compared in memory. Never print it, include it in reports, or copy its source file.
keys=[load_key()]
for line in (ROOT/'.env').read_text().splitlines() if (ROOT/'.env').exists() else []:
    if '=' not in line or line.lstrip().startswith('#'):continue
    name,value=line.split('=',1)
    if name.strip() in ('TWITCH_ACCESS_TOKEN','TWITCH_CLIENT_SECRET') and value.strip():keys.append(value.strip().strip('\"\''))
needles=[key.encode() for key in keys];matches=[]
for folder in [OUT,ROOT/'video/heist-demo']:
    for path in folder.rglob('*'):
        if not path.is_file() or 'python-deps' in path.parts or path.suffix=='.zip':continue
        with path.open('rb') as stream:
            tail=b''
            while chunk:=stream.read(1024*1024):
                data=tail+chunk
                if any(needle in data for needle in needles):matches.append(str(path.relative_to(ROOT)));break
                tail=data[-max(map(len,needles)):]
def ocr(path):
    result=subprocess.run(['tesseract',str(path),'stdout','--psm','11'],capture_output=True,text=True)
    return result.stdout
sample=[path for i,path in enumerate(images) if i%3==1]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for path,text in zip(sample,pool.map(ocr,sample)):
        if any(key in text or re.sub(r'\W','',key) in re.sub(r'\W','',text) for key in keys):matches.append(str(path.relative_to(ROOT)))
del keys,needles
assert not matches,'Credential match found. Export must not be delivered.'
report['checks']['credential_scan']={'production_files_checked':True,'ocr_frames_checked':len(sample),'matches':0,'environment_files_recorded_or_bundled':False}
capture=json.loads((OUT/'capture.json').read_text());assert capture['result']['phase']=='escaped' and not capture['runtimeErrors']
report['checks']['app_capture']={'outcome':capture['result'],'runtime_errors':capture['runtimeErrors'],'vote_source':'automated local browser, real HTTP request; not a Twitch viewer'}
if P.get('real_twitch_transport_verified'):
    live=json.loads((OUT/'live-evidence/vote-result.json').read_text())
    votes=[m for m in live['comms'] if m['text'].startswith('!vote ')]
    assert [(m['source'],m['text']) for m in votes]==[('crew','!vote 1234'),('twitch','!vote 5678')]
    assert live['votes']==[{'optionId':'5678','count':1}] and len(live['members'])==1 and live['members'][0]['role']=='cipher'
    report['checks']['real_twitch_account_check']={'source':'Human broadcaster account through actual Twitch and companion','role':'cipher','member_count':1,'accepted_votes':votes,'final_votes':live['votes'],'full_live_escape':False,'note':'The test mission later timed out. The successful escape elsewhere is labeled rehearsal.'}
report['passed']=True
(QA/'verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
