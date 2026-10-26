from pathlib import Path
import json, shutil, zipfile

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/heist-demo';P=json.loads((Path(__file__).parent/'project.json').read_text())
EXPORT=OUT/'exports';EXPORT.mkdir(exist_ok=True)

def tc(seconds):
    frames=round(seconds*P['fps']);h,frames=divmod(frames,P['fps']*3600);m,frames=divmod(frames,P['fps']*60);s,f=divmod(frames,P['fps'])
    return f'{h:02}:{m:02}:{s:02}:{f:02}'

edl=['TITLE: HEIST - THE MERIDIAN JOB - REHEARSAL CUT','FCM: NON-DROP FRAME','']
for i,s in enumerate(P['scenes'],1):
    edl.extend([f"{i:03}  HEIST{s['id']}  V  C  {tc(0)} {tc(s['duration'])} {tc(s['start'])} {tc(s['start']+s['duration'])}",f"* FROM CLIP NAME: scene_{s['id']}.mp4",''])
(OUT/'HEIST-edit.edl').write_text('\n'.join(edl))
for name,source in [('HEIST-Transcript.txt','transcript.txt'),('HEIST-Captions.srt','captions.srt'),('HEIST-edit.edl','HEIST-edit.edl')]:shutil.copy2(OUT/source,EXPORT/name)
shutil.copy2(Path(__file__).parent/'project.json',OUT/'project.json')

target=EXPORT/'HEIST-Production.zip'
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=5) as archive:
    source_files=[]
    for folder in ['video/heist-demo','public','lib','test','docs']:
        for p in (ROOT/folder).rglob('*'):
            if p.is_file() and '__pycache__' not in p.parts and p.suffix not in ('.pyc','.pyo'):source_files.append(p)
    source_files.extend(ROOT/name for name in ['server.mjs','package.json','LICENSE','.env.example','.gitignore'])
    for p in source_files:
        # The example has no credentials; actual env files are never included.
        if p.name.startswith('.env') and p.name!='.env.example':continue
        archive.write(p,'HEIST-Production/'+str(p.relative_to(ROOT)))
    for p in OUT.rglob('*'):
        if not p.is_file() or (p.name.startswith('.env') and p.name!='.env.example') or p==target or 'python-deps' in p.parts or p.name in ['audition.mp3','failure.png'] or 'raw' in p.parts:continue
        if p.name=='HEIST-Rehearsal-Demo.mp4':continue # Final MP4 is delivered separately; precomps are included.
        archive.write(p,'HEIST-Production/'+str(p.relative_to(ROOT)))
print(json.dumps({'bundle':str(target),'bytes':target.stat().st_size,'credential_files_included':False}))
