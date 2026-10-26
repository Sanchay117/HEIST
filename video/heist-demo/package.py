from pathlib import Path
import json, shutil, zipfile
from production import ROOT, OUT, PROJECT as P, PROJECT_PATH, EXPORT_NAME

EXPORT=OUT/'exports';EXPORT.mkdir(exist_ok=True)

def tc(seconds):
    frames=round(seconds*P['fps']);h,frames=divmod(frames,P['fps']*3600);m,frames=divmod(frames,P['fps']*60);s,f=divmod(frames,P['fps'])
    return f'{h:02}:{m:02}:{s:02}:{f:02}'

edl=[f"TITLE: HEIST - THE MERIDIAN JOB - {P['version'].upper()}",'FCM: NON-DROP FRAME','']
for i,s in enumerate(P['scenes'],1):
    edl.extend([f"{i:03}  HEIST{s['id']}  V  C  {tc(0)} {tc(s['duration'])} {tc(s['start'])} {tc(s['start']+s['duration'])}",f"* FROM CLIP NAME: scene_{s['id']}.mp4",''])
(OUT/'HEIST-edit.edl').write_text('\n'.join(edl))
for name,source in [('HEIST-Transcript.txt','transcript.txt'),('HEIST-Captions.srt','captions.srt'),('HEIST-edit.edl','HEIST-edit.edl')]:shutil.copy2(OUT/source,EXPORT/name)
shutil.copy2(PROJECT_PATH,OUT/'project.json')

target=EXPORT/'HEIST-Production.zip'
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=5) as archive:
    source_files=[]
    for folder in ['video/heist-demo','public','lib','test','docs']:
        for p in (ROOT/folder).rglob('*'):
            if p.is_file() and '__pycache__' not in p.parts and p.suffix not in ('.pyc','.pyo'):source_files.append(p)
    source_files.extend(ROOT/name for name in ['README.md','server.mjs','package.json','LICENSE','.env.example','.gitignore'])
    archive.writestr('HEIST-Production/README-PRODUCTION.md',f'''# HEIST editable production

Cut: {P['version']}. Export: {EXPORT_NAME}. Duration: {P['duration']} seconds.

The app source is at this folder's root. Video scripts, script/storyboard, and both editable cut configurations are under video/heist-demo/.
Media, separate audio stems, captions, scene precomps, original footage and QA are under {OUT.relative_to(ROOT)}.

To rebuild this bundled cut from this root folder, select:

```sh
export HEIST_DEMO_PROJECT=video/heist-demo/{PROJECT_PATH.name}
export HEIST_DEMO_OUTPUT={OUT.relative_to(ROOT)}
python3 video/heist-demo/audio.py
python3 video/heist-demo/render.py
```

Cached narration is included. New narration needs your own authorized Deepgram credential in the original local Appwrite .env; no credential files are bundled. Read video/heist-demo/README.md for dependencies, narration, verification and edit instructions.

The escape story is labeled rehearsal. The revised cut's real Twitch insert is a single broadcaster account check, not a three-account live escape or OBS recording.
''')
    for p in source_files:
        # The example has no credentials; actual env files are never included.
        if p.name.startswith('.env') and p.name!='.env.example':continue
        archive.write(p,'HEIST-Production/'+str(p.relative_to(ROOT)))
    for p in OUT.rglob('*'):
        if not p.is_file() or (p.name.startswith('.env') and p.name!='.env.example') or p==target or 'python-deps' in p.parts or p.name in ['audition.mp3','failure.png'] or 'raw' in p.parts:continue
        if p==EXPORT/EXPORT_NAME:continue # Final MP4 is delivered separately; precomps are included.
        archive.write(p,'HEIST-Production/'+str(p.relative_to(ROOT)))
print(json.dumps({'bundle':str(target),'bytes':target.stat().st_size,'credential_files_included':False}))
