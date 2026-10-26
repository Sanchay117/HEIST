"""HEIST motion compositor. Real captured UI + editable original motion graphics."""
from pathlib import Path
import argparse, functools, json, math, subprocess, textwrap, sys
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageFilter
from production import ROOT, OUT, PROJECT as P, EXPORT_NAME
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'artifacts/heist-demo/python-deps'))
from fontTools.ttLib import TTFont

SRC=Path(__file__).parent
W,H=P['width'],P['height'];FPS=P['fps']
CAP=json.loads((OUT/('capture.json' if (OUT/'capture.json').exists() else 'capture-progress.json')).read_text())
ORANGE='#ff7950';WHITE='#e9eee6';MUTED='#a1ac9c';GREEN='#b5d58d';BG='#0c120f'
ROLES=[('cipher','CIPHER','INTERCEPTED SIGNALS','#b5d58d'),('architect','ARCHITECT','BLUEPRINTS & ROUTES','#e1c392'),('lookout','LOOKOUT','EYES ON THE INSIDE','#a4c6bb')]
FONTDIR=OUT/'fonts';FONTDIR.mkdir(exist_ok=True)
for name in ['barlow-condensed-600-latin','barlow-condensed-800-latin','ibm-plex-mono-400-latin','dm-sans-400-700-latin']:
    target=FONTDIR/(name+'.ttf')
    if not target.exists():
        f=TTFont(ROOT/f'public/fonts/{name}.woff2');f.flavor=None;f.save(target)

@functools.lru_cache(None)
def font(size,kind='sans'):
    name={'display':'barlow-condensed-800-latin','narrow':'barlow-condensed-600-latin','mono':'ibm-plex-mono-400-latin','sans':'dm-sans-400-700-latin'}[kind]
    return ImageFont.truetype(str(FONTDIR/(name+'.ttf')),int(size))

def txt(im,xy,text,size=24,fill=WHITE,kind='sans',anchor=None):
    ImageDraw.Draw(im).text(xy,str(text),font=font(size,kind),fill=fill,anchor=anchor,stroke_width=0)

def box(im,rect,fill='#172118',outline='#3b4935',radius=9):ImageDraw.Draw(im).rounded_rectangle(rect,radius,fill=fill,outline=outline,width=1)
def ease(t):return 1-(1-max(0,min(1,t)))**3

class Video:
    def __init__(self,path):
        self.cap=cv2.VideoCapture(str(path));self.fps=self.cap.get(cv2.CAP_PROP_FPS) or 25;self.pos=-1;self.last=None
    def frame(self,t):
        n=max(0,int(t*self.fps))
        if n<self.pos or n-self.pos>self.fps*2:self.cap.set(cv2.CAP_PROP_POS_FRAMES,n);self.pos=n-1
        while self.pos<n:
            ok,frame=self.cap.read()
            if not ok:break
            self.last=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB));self.pos+=1
        return self.last.copy() if self.last else Image.new('RGB',(1440,1000),BG)

VIDEOS={}
def still(name):return Image.open(OUT/f'stills/{name}.png').convert('RGB')
def footage(name,t,fallback):
    path=OUT/f'footage/{name}.webm'
    if not path.exists():return still(fallback)
    if name not in VIDEOS:VIDEOS[name]=Video(path)
    return VIDEOS[name].frame(t)

def paste(im,source,rect,crop=None,cover=False,opacity=1):
    if crop:source=source.crop(crop)
    x,y,x2,y2=[int(v) for v in rect];w=x2-x;h=y2-y
    scale=(max if cover else min)(w/source.width,h/source.height)
    source=source.resize((max(1,int(source.width*scale)),max(1,int(source.height*scale))),Image.Resampling.LANCZOS)
    if cover:
        left=(source.width-w)//2;top=(source.height-h)//2;source=source.crop((left,top,left+w,top+h))
    px=x+(w-source.width)//2;py=y+(h-source.height)//2
    if opacity<1:
        layer=Image.new('RGB',(source.width,source.height),BG);source=Image.blend(layer,source,opacity)
    im.paste(source,(px,py))

BASE=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(BASE)
for x in range(0,W,80):d.line((x,0,x,H),fill='#142019',width=1)
for y in range(0,H,80):d.line((0,y,W,y),fill='#142019',width=1)
for x in [40,W-40]:
    for y in [110,H-140]:d.line((x-9,y,x+9,y),fill='#48533e');d.line((x,y-9,x,y+9),fill='#48533e')
CAPTIONS=json.loads((OUT/'captions.json').read_text()) if (OUT/'captions.json').exists() else []

def header(im,s,t):
    txt(im,(48,25),'HEIST',52,kind='display');txt(im,(197,46),'OP / 001',18,MUTED,'mono')
    label='REAL TWITCH / BROADCASTER ACCOUNT TEST' if s['style']=='live-check' else 'SIMULATED TWITCH / IDENTITY CHECK' if s['style']=='pairing' else 'SOURCE + EXECUTED CHECKS' if s['style']=='codex' else 'LOCAL REHEARSAL / AUTOMATED CREW'
    txt(im,(1872,43),label,18,ORANGE if s['style']=='pairing' else MUTED,'mono','ra')
    d=ImageDraw.Draw(im);d.line((48,94,1872,94),fill='#35402f',width=2);d.line((48,94,48+1824*t/P['duration'],94),fill=ORANGE,width=3)
    if s['style'] not in ('opening','outro'):
        txt(im,(48,112),s['title'],68,kind='display');txt(im,(50,196),s['subtitle'],20,MUTED,'mono')

def captions(im,t):
    layer=Image.new('RGBA',(W,H),(0,0,0,0));d=ImageDraw.Draw(layer)
    d.rectangle((0,971,W,H),fill=(6,11,8,237));d.line((48,971,W-48,971),fill=(77,91,66,255),width=1)
    active=next((c for c in CAPTIONS if c['start']<=t<c['end']),None)
    if active:
        lines=textwrap.wrap(active['text'],width=69)
        y=1000 if len(lines)==1 else 986
        for line in lines: d.text((W//2,y),line,font=font(34),fill=WHITE,anchor='mt');y+=39
    return Image.alpha_composite(im.convert('RGBA'),layer).convert('RGB')

def role_card(im,role,index,t,stage='lock',y=300,w=550):
    name,label,detail,color=ROLES[index];x=60+index*610
    progress=ease((t-index*.45)/.8);offset=int((1-progress)*620)
    source=still(f'{stage}-{name}');height=int(source.height*w/source.width)
    box(im,(x-5,y-10+offset,x+w+5,y+height+10+offset),fill='#10190f',outline=color)
    paste(im,source,(x,y+offset,x+w,y+height+offset))
    if offset<200:
        txt(im,(x,y-96),f'0{index+1} / {label}',45,color,'display');txt(im,(x,y-38),detail,17,MUTED,'mono')

def marktime(key,default=0):return CAP.get('markers',{}).get(key,{}).get('t',default)

def render_scene(s,u):
    t=s['start']+u;im=BASE.copy();style=s['style'];duration=s['duration']
    if style in ('opening','outro'):
        source=footage('host',marktime('missionStart')+min(u,5),'host-lock')
        paste(im,source,(0,96,W,971),crop=(250,255,1100,612),cover=True)
        im=ImageEnhance.Brightness(im).enhance(.42)
        d=ImageDraw.Draw(im);d.rectangle((0,96,W,971),fill=None,outline='#48573d',width=1)
        scale=ease(u/1.2);title='HEIST';size=int(155+scale*23)
        txt(im,(960,355),title,size,WHITE,'display','mt')
        txt(im,(960,566),'THE MERIDIAN JOB' if style=='opening' else 'TRUST YOUR CREW.',30,ORANGE,'mono','mt')
        txt(im,(960,650),'THE STREAMER HAS THE CONTROLS.',34,WHITE,'sans','mt')
        txt(im,(960,701),'CHAT HAS THE BLUEPRINTS.',34,WHITE,'sans','mt')
        if style=='outro':txt(im,(960,830),P.get('outro_disclosure','REHEARSAL CUT / REAL TWITCH CAPTURE PENDING'),22,MUTED,'mono','mt')
        d.line((720,620,1200,620),fill=ORANGE,width=2)
    elif style=='briefing':
        source=footage('host',marktime('missionStart')+u*.55,'host-lock')
        paste(im,source,(560,242,1890,960),crop=(220,75,1440,1000))
        for i,(big,small) in enumerate([('03','LOCKS TO CLEAR'),('08:00','TO LOCKDOWN'),('03','STRIKES END THE RUN')]):
            yy=280+i*205;txt(im,(65,yy),big,98,ORANGE if i==1 else WHITE,'display');txt(im,(70,yy+117),small,20,MUTED,'mono')
    elif style=='roles':
        for i,role in enumerate(ROLES):role_card(im,role,i,u,stage='lock',y=337)
        txt(im,(960,886),'THREE PRIVATE VIEWS. ONE SHARED OBJECTIVE.',24,MUTED,'mono','mt')
    elif style=='split':
        src=footage('host',marktime('cluesStart')+min(u*.55,10),'host-lock')
        paste(im,src,(50,262,1190,700),crop=(250,250,1100,615))
        paste(im,src,(50,721,1190,947),crop=(250,740,1100,1000))
        i=min(2,int(u/6));role=ROLES[i]
        source=still('lock-'+role[0]);paste(im,source,(1255,310,1835,890))
        txt(im,(1260,257),role[1]+' / PRIVATE',27,role[3],'mono')
        txt(im,(65,259),'OPERATOR / PUBLIC CONTROLS',18,ORANGE,'mono')
    elif style=='combine':
        order=CAP.get('lock',{}).get('order',['EYE','MOON','CROWN','STAR']);mapping=CAP.get('lock',{}).get('mappings',{})
        for i,symbol in enumerate(order):
            x=130+i*435;box(im,(x,270,x+350,525),outline='#5b694b')
            txt(im,(x+175,298),symbol,27,MUTED,'mono','mt')
            if u>i*1.1:txt(im,(x+175,347),mapping.get(symbol,'?'),112,ORANGE,'mono','mt')
            if i<3:
                dd=ImageDraw.Draw(im);dd.line((x+370,395,x+410,395),fill=MUTED,width=3);dd.polygon([(x+410,395),(x+398,386),(x+398,404)],fill=MUTED)
        source=footage('host',marktime('codeStart')+min(5.5,u*.4),'host-lock')
        paste(im,source,(60,585,1860,952),crop=(250,735,1100,1000))
        txt(im,(960,547),'ACTUAL CLUES / ACTUAL OPERATOR INPUT',19,MUTED,'mono','mt')
    elif style=='vote':
        rel=(marktime('wireStart')+u*.65) if u<5 else (marktime('voteStart')+(u-5)*.7) if u<12 else (marktime('voteReceived')+1.4+(u-12))
        host=footage('host',rel,'host-vote')
        crew=footage('cipher',max(0,rel-.5),'host-vote')
        paste(im,crew,(55,250,555,950),crop=(15,295,425,995))
        txt(im,(620,265),'A RECOMMENDATION,',64,WHITE,'display');txt(im,(620,337),'NOT AN AUTO-SOLVE.',64,ORANGE,'display')
        wire=CAP.get('wire',{});txt(im,(625,455),f"TERMINAL {wire.get('terminal','?')}  /  {wire.get('pulse','?')}  /  {wire.get('seal','?')}",23,MUTED,'mono')
        paste(im,host,(610,548,1865,945),crop=(250,746,1100,1000))
        txt(im,(625,506),'COMPANION REQUEST / HOST VOTE COUNT',20,WHITE,'mono')
    elif style=='pairing':
        for i,label in enumerate(['ACCOUNT','ROLE','VOTE']):
            txt(im,(80,260+i*190),'01',112,ORANGE if i==2 else WHITE,'mono');txt(im,(290,302+i*190),label,45,MUTED,'display')
        src=footage('pairing',u*.82,'pairing-confirm')
        paste(im,src,(670,240,1870,950),crop=(150,145,960,850))
        txt(im,(75,893),'LOCAL IDENTITY TEST',21,ORANGE,'mono')
        txt(im,(75,925),'REAL TWITCH CAPTURE PENDING',18,MUTED,'mono')
    elif style=='live-check':
        if 'live-chat' not in VIDEOS:VIDEOS['live-chat']=Video(OUT/'live-evidence/footage/vote-chat.mp4')
        actual=VIDEOS['live-chat'].frame(min(u,13.5))
        txt(im,(65,250),'ACTUAL TWITCH CHAT / HUMAN ACCOUNT',22,ORANGE,'mono')
        box(im,(55,294,1865,511),fill='#151515',outline='#76533f')
        crop=(0,205,1120,275) if u<4.3 else (0,274,1120,337)
        paste(im,actual,(65,306,1855,500),crop=crop)
        txt(im,(65,536),'ACTUAL GAME COMMS / SAME CIPHER',21,MUTED,'mono')
        game=Image.open(OUT/'live-evidence/game-vote-comms.png').convert('RGB')
        box(im,(55,576,958,947),fill='#111710')
        paste(im,game,(75,591,938,931),crop=(945,543,1230,706))
        box(im,(995,576,1865,947),fill='#131c11',outline='#657149')
        txt(im,(1030,600),'VERIFIED SERVER STATE',21,GREEN,'mono')
        txt(im,(1030,657),'1234',68,'#6d7765','mono')
        draw=ImageDraw.Draw(im);draw.line((1030,703,1198,703),fill=ORANGE,width=4)
        draw.line((1232,698,1322,698),fill=ORANGE,width=3);draw.line((1309,687,1322,698,1309,709),fill=ORANGE,width=3)
        txt(im,(1360,657),'5678',68,WHITE,'mono')
        txt(im,(1030,756),'01',110,GREEN,'mono');txt(im,(1220,798),'FINAL VOTE',44,WHITE,'display')
        txt(im,(1034,898),'ONE ACCOUNT / ONE ROLE',21,MUTED,'mono')
    elif style=='escape':
        for i,role in enumerate(ROLES):role_card(im,role,i,u,stage='exit',y=335,w=550)
        ring=CAP.get('escape',{}).get('ring',['iris','echo','nova']);slot=CAP.get('escape',{}).get('slot',1);shift=CAP.get('escape',{}).get('shift',1)
        txt(im,(960,872),' > '.join(x.upper() for x in ring)+' > LOOP',32,ORANGE,'mono','mt')
        txt(im,(960,923),f'ORIGINAL SLOT {slot}  +  CLOCKWISE SHIFT {shift}',20,MUTED,'mono','mt')
    elif style=='climax':
        at=marktime('climaxStart',460)+(marktime('escaped',478)-marktime('climaxStart',460))*min(1,u/(duration-1.2))
        src=footage('host',at,'host-exit')
        paste(im,src,(55,262,1220,688),crop=(250,250,1100,620))
        paste(im,src,(1250,260,1860,650),crop=(1230,90,1410,200))
        paste(im,src,(60,690,1860,951),crop=(250,745,1100,1000))
        if u>duration-3:txt(im,(960,580),'TAKE THE EXIT.',80,ORANGE,'display','mt')
    elif style=='success':
        src=footage('host',marktime('escaped',478)+min(u,5),'host-success')
        paste(im,src,(50,240,1870,960),crop=(250,210,1100,1000))
        txt(im,(1340,385),'CREW',100,WHITE,'display');txt(im,(1340,495),'EXTRACTED.',100,GREEN,'display')
        txt(im,(1345,690),'00 STRIKES',25,MUTED,'mono');txt(im,(1345,740),'03 SPECIALISTS',25,MUTED,'mono')
    elif style=='codex':
        box(im,(55,260,1120,935));box(im,(1160,260,1865,935))
        txt(im,(80,285),'lib/pairing.mjs / ACTUAL SOURCE',22,ORANGE,'mono')
        lines=(ROOT/'lib/pairing.mjs').read_text().splitlines();start=next(i for i,l in enumerate(lines) if 'function confirm(' in l)
        for i,line in enumerate(lines[start:start+12]):
            y=355+i*42;txt(im,(82,y),f'{start+i+1:02}',18,'#607153','mono');txt(im,(136,y),line[:66],22,GREEN if 'session.playerId =' in line else WHITE,'mono')
        txt(im,(1190,295),'EXECUTED LOCAL CHECKS',22,ORANGE,'mono')
        for y,n,desc in [(380,'29','AUTOMATED TESTS'),(560,'40','BROWSER CHECKS')]:
            txt(im,(1190,y),n,110,GREEN,'mono');txt(im,(1195,y+125),desc,21,MUTED,'mono')
        txt(im,(1195,793),'npm test: 29 pass / 0 fail',21,WHITE,'mono')
        txt(im,(1195,837),'GIT bc9cc99 / PAIRING FIX',19,MUTED,'mono')
        txt(im,(1195,875),P.get('codex_evidence_label','REAL TWITCH STILL PENDING'),19,ORANGE,'mono')
    header(im,s,t)
    # A restrained camera-shutter transition, with no rapid flashes.
    fade=min(1,u/.35,(duration-u)/.3)
    if fade<1:im=Image.blend(Image.new('RGB',(W,H),BG),im,max(0,fade))
    return captions(im,t)

def thumb():
    im=Image.new('RGB',(W,H),BG);src=still('host-lock');paste(im,src,(620,0,W,H),crop=(250,250,1100,620),cover=True)
    # Dark editorial panel keeps the title readable at thumbnail size.
    overlay=Image.new('RGBA',(W,H),(0,0,0,0));od=ImageDraw.Draw(overlay);od.polygon([(0,0),(1120,0),(880,H),(0,H)],fill=(9,17,11,245));im=Image.alpha_composite(im.convert('RGBA'),overlay).convert('RGB')
    txt(im,(95,130),'HEIST',230,WHITE,'display');txt(im,(105,407),'THE STREAMER HAS',50,WHITE,'display');txt(im,(105,468),'THE CONTROLS.',65,ORANGE,'display');txt(im,(105,576),'CHAT HAS',50,WHITE,'display');txt(im,(105,637),'THE BLUEPRINTS.',65,ORANGE,'display')
    box(im,(100,862,665,930),fill='#252a1c',outline='#657149');txt(im,(125,882),P.get('thumbnail_badge','CINEMATIC REHEARSAL DEMO'),24,GREEN,'mono')
    im.save(OUT/'exports/HEIST-Thumbnail.png');im.resize((1280,720),Image.Resampling.LANCZOS).save(OUT/'exports/HEIST-Thumbnail.jpg',quality=95)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--preview',action='store_true');parser.add_argument('--scene');parser.add_argument('--assemble',action='store_true');args=parser.parse_args()
    (OUT/'exports').mkdir(exist_ok=True);thumb()
    if args.preview:
        for s in P['scenes']:
            render_scene(s,s['duration']*.55).save(OUT/f"qa/preview-{s['id']}.jpg",quality=92)
        print('12 storyboard previews and thumbnail rendered.');return
    target=OUT/'exports/scenes';target.mkdir(exist_ok=True)
    scenes=[] if args.assemble else [s for s in P['scenes'] if not args.scene or s['id']==args.scene]
    for s in scenes:
        path=target/f"scene_{s['id']}.mp4"
        process=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(path)],stdin=subprocess.PIPE)
        for n in range(int(s['duration']*FPS)):
            process.stdin.write(render_scene(s,n/FPS).tobytes())
        process.stdin.close();assert process.wait()==0
        print(f"Rendered scene {s['id']} / {s['style']}",flush=True)
    if not args.scene:
        listing=OUT/'exports/concat.txt';listing.write_text('\n'.join(f"file 'scenes/scene_{s['id']}.mp4'" for s in P['scenes']))
        dest=OUT/'exports'/EXPORT_NAME
        subprocess.run(['ffmpeg','-v','error','-y','-f','concat','-safe','0','-i',str(listing),'-i',str(OUT/'audio/final-mix.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t',str(P['duration']),'-map_metadata','-1','-metadata',f"title={P['title']} ({P['version']})",'-movflags','+faststart',str(dest)],check=True)
        print(f'Exported {dest}',flush=True)
if __name__=='__main__':main()
