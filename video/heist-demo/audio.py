"""Editable original score, foley, narration mix and sample-accurate subtitle schedule."""
from pathlib import Path
import json, math, subprocess, textwrap
import numpy as np
import soundfile as sf

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/heist-demo'
P=json.loads((Path(__file__).parent/'project.json').read_text())
SR=48000
N=int(P['duration']*SR)

def stamp(t,ass=False):
    h=int(t//3600);m=int(t%3600//60);s=t%60
    return f'{h}:{m:02}:{s:05.2f}' if ass else f'{h:02}:{m:02}:{s:06.3f}'.replace('.',',')

voice=np.zeros(N,dtype=np.float32);music=np.zeros(N,dtype=np.float32);fx=np.zeros(N,dtype=np.float32)
cues=[];schedule=[]
for scene in P['scenes']:
    clips=[]
    for i,text in enumerate(scene['sentences']):
        path=OUT/f"audio/{scene['id']}_{i+1:02}.wav"
        if scene.get('voice_tempo',1)!=1:
            converted=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-af',f"atempo={scene['voice_tempo']}",'-ac','1','-ar',str(SR),'-f','f32le','-'],check=True,capture_output=True)
            x=np.frombuffer(converted.stdout,dtype=np.float32).copy();rate=SR
        else:x,rate=sf.read(path,dtype='float32')
        assert rate==SR
        if x.ndim>1:x=x.mean(axis=1)
        rms=float(np.sqrt(np.mean(x*x)+1e-12));gain=min(10**(-21/20)/rms,10**(-4/20)/max(float(np.max(np.abs(x))),1e-6))
        x=x*gain
        clips.append((text,x))
    speech=sum(len(x)/SR for _,x in clips)
    lead=0.7 if scene['style'] not in ('opening','outro') else 1.0
    usable=scene['duration']-lead-0.45
    gap=min(1.0,max(0.18,(usable-speech)/max(1,len(clips)-1)))
    if speech+gap*(len(clips)-1)>usable+.01:
        raise RuntimeError(f"Narration exceeds scene {scene['id']} window")
    cursor=scene['start']+lead
    for text,x in clips:
        start=int(round(cursor*SR));voice[start:start+len(x)]+=x
        duration=len(x)/SR
        words=text.split();groups=[];group=[]
        for word in words:
            if group and (len(' '.join(group+[word]))>88 or len(group)>=12):groups.append(group);group=[]
            group.append(word)
        if group:groups.append(group)
        total=sum(len(w)+1 for w in words);pos=0
        for group in groups:
            weight=sum(len(w)+1 for w in group)
            a=cursor+duration*pos/total;b=cursor+duration*(pos+weight)/total
            cues.append({'start':round(a+0.025,3),'end':round(max(a+0.1,b-0.035),3),'text':' '.join(group),'scene':scene['id']})
            pos+=weight
        schedule.append({'start':round(cursor,3),'end':round(cursor+duration,3),'text':text,'scene':scene['id']})
        cursor+=duration+gap

rng=np.random.default_rng(20261026)
def add(bus,at,x,gain=1):
    i=int(at*SR)
    if i<0:return
    length=min(len(x),len(bus)-i)
    if length>0:bus[i:i+length]+=x[:length]*gain

def tone(freq,duration,decay=3):
    t=np.arange(int(duration*SR),dtype=np.float32)/SR
    return np.sin(2*np.pi*freq*t)*np.exp(-t*decay)*np.minimum(t*35,1)

# An original D-minor electronic cue. No third-party music or sampled recordings.
chords=[[146.832,174.614,220.0,261.626],[116.541,146.832,174.614,220.0],[97.999,116.541,146.832,174.614],[110.0,130.813,164.814,220.0]]
for at in np.arange(0,P['duration'],8):
    chord=chords[int(at//8)%4];t=np.arange(int(9*SR),dtype=np.float32)/SR
    env=np.minimum(t/1.8,1)*np.minimum((9-t)/2.5,1)*.012
    pad=sum(np.sin(2*np.pi*f*t+0.012*np.sin(2*np.pi*.17*t)) for f in chord)/4
    add(music,float(at),pad*env)
beat=0.0;idx=0
while beat<P['duration']:
    bpm=84 if beat<76 else 98 if beat<108 else 112 if beat<126 else 132 if beat<139 else 80
    note=[73.416,73.416,110.0,87.307][idx%4]
    pulse=tone(note,.46,9)+.2*tone(note*2,.46,13)
    add(music,beat,pulse,.035 if beat<126 else .05)
    if idx%2==0:
        t=np.arange(int(.16*SR))/SR
        kick=np.sin(2*np.pi*(45*t+65*(1-np.exp(-t*30))/30))*np.exp(-t*30)
        add(music,beat,kick,.035)
    if idx%2:
        noise=rng.standard_normal(int(.06*SR)).astype(np.float32)
        noise=np.diff(noise,prepend=0)*np.exp(-np.arange(len(noise))/SR*85)
        add(music,beat,noise,.003)
    beat+=60/bpm;idx+=1

for scene in P['scenes'][1:]:
    t=np.arange(int(.4*SR))/SR
    click=rng.standard_normal(len(t))*np.exp(-t*18)
    click=np.diff(click,prepend=0)*.012+tone(125,.4,9)*.04
    add(fx,scene['start'],click)
for at in [61.5,63,64.5,66,74.6,89,94,108,137.7]:
    add(fx,at,tone(1850,.16,70)*.055+tone(430,.16,25)*.055)
for at in [75.2,137.9,139]:
    add(fx,at,tone(48,1.8,3)*.11+tone(96,1.8,5)*.035)
for at in np.arange(126,138,.64):
    add(fx,float(at),tone(55,.19,18),.035)
for at in [140.0,140.3,140.6]:
    add(fx,at,tone([293.664,349.228,440.0][int(round((at-140)*10))//3],1.5,2),.023)

# Narration-driven ducking and a brief pre-extraction music dropout.
blocks=np.max(np.abs(voice).reshape(-1,480),axis=1)
padded=np.pad(blocks,(8,8),mode='edge')
envelope=np.max(np.lib.stride_tricks.sliding_window_view(padded,17),axis=1)
kernel=np.exp(-.5*(np.arange(-24,25)/6)**2);kernel/=kernel.sum()
envelope=np.convolve(envelope,kernel,mode='same')
env=np.interp(np.arange(N),np.arange(len(envelope))*480,envelope)
music*=np.where(env>.008,.32,1).astype(np.float32)
music[int(137.5*SR):int(138.5*SR)]*=.06
fade_in=np.minimum(np.arange(N)/(SR*1.3),1);fade_out=np.minimum((N-1-np.arange(N))/(SR*2.0),1)
music*=fade_in*fade_out*3.1;fx*=fade_out
mix=voice+music+fx
peak=float(np.max(np.abs(mix)))
if peak>.93:mix*=.93/peak
for name,x in [('narration',voice),('music',music),('effects',fx),('premix',mix)]:
    stereo=np.stack([x,x],axis=1)
    if name=='music':stereo[:,1]=np.roll(stereo[:,1],int(.003*SR))
    sf.write(OUT/f'audio/{name}.wav',stereo,SR,subtype='PCM_24')
subprocess.run(['ffmpeg','-v','error','-y','-i',str(OUT/'audio/premix.wav'),'-af','loudnorm=I=-16:TP=-1.5:LRA=8','-ar',str(SR),str(OUT/'audio/final-mix.wav')],check=True)
(OUT/'captions.srt').write_text('\n\n'.join(f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n"+'\n'.join(textwrap.wrap(c['text'],width=52)) for i,c in enumerate(cues))+'\n')
(OUT/'captions.json').write_text(json.dumps(cues,indent=2))
(OUT/'narration-timing.json').write_text(json.dumps(schedule,indent=2))
(OUT/'transcript.txt').write_text('HEIST — The Meridian Job\nRehearsal cut. Automated browser crew; identity insert uses simulated Twitch transport.\n\n'+'\n\n'.join(f"{stamp(s['start'])}  {s['title']}\n"+' '.join(s['sentences']) for s in P['scenes'])+'\n\nNarration: Deepgram Aura-2 Draco. Music and sound effects: original synthesis. Real Twitch footage remains pending.\n')
active=np.abs(voice)>.01
ratio=20*np.log10(np.sqrt(np.mean(voice[active]**2))/max(np.sqrt(np.mean(music[active]**2)),1e-9))
(OUT/'qa/audio-mix.json').write_text(json.dumps({'duration_seconds':P['duration'],'narration_seconds':sum(x['end']-x['start'] for x in schedule),'narration_to_music_db_during_speech':float(ratio),'premix_peak_dbfs':20*math.log10(max(peak,1e-9)),'target_integrated_lufs':-16,'target_true_peak_dbtp':-1.5,'score':'original deterministic electronic composition, no third-party recordings'},indent=2))
print(json.dumps({'duration':P['duration'],'caption_cues':len(cues),'voice_over_music_db':round(float(ratio),1)}))
