import json,os,time,urllib.request,urllib.parse,tempfile,subprocess,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageColor

API='https://vnnvuxccazkdzwqjmntz.supabase.co/functions/v1/video-export'
AUD='video-export-vnnvuxccazkdzwqjmntz'
def request(url,data=None,headers=None,method=None):
    req=urllib.request.Request(url,data=data,headers=headers or {},method=method)
    with urllib.request.urlopen(req,timeout=120) as r:return r.read()
def api(action,**kwargs):
    url=os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']+'&audience='+urllib.parse.quote(AUD)
    token=json.loads(request(url,headers={'Authorization':'Bearer '+os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']}))['value']
    return json.loads(request(API,json.dumps({'action':action,**kwargs}).encode(),{'Content-Type':'application/json','Authorization':'Bearer '+token}))
def font(size):
    paths=['/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
    return ImageFont.truetype(next(p for p in paths if Path(p).exists()),max(1,int(size)))
def color(value):
    value=str(value)
    if value.startswith('rgba('):
        parts=[float(x.strip()) for x in value[5:-1].split(',')]
        return tuple(int(max(0,min(255,x))) for x in parts[:3])+(int(max(0,min(1,parts[3]))*255),)
    return ImageColor.getrgb(value)
def overlay(path,manifest,scene,caption):
    w,h=manifest['width'],manifest['height'];im=Image.new('RGBA',(w,h),(0,0,0,0));d=ImageDraw.Draw(im)
    title=scene.get('title','') if manifest.get('showTitle',True) else ''
    if title:
        fs=h*.045;f=font(fs);maxw=w*.72;padx=w*.012;pady=h*.01
        while d.textlength(title,font=f)>maxw-padx*2 and fs>8:fs-=1;f=font(fs)
        x,y=w*.04,h*.05;tw=min(maxw,d.textlength(title,font=f)+padx*2);th=fs*1.25+pady*2
        d.rounded_rectangle((x,y,x+tw,y+th),radius=h*.012,fill=color(manifest.get('titleColor','#682635')))
        d.text((x+padx,y+pady),title,font=f,fill='white',anchor='lt')
    lines=str(caption or '').split('\n')[:2]
    if caption and lines:
        portrait=h>w;fs=w*.043 if portrait else h*.045;f=font(fs);x=w*(.07 if portrait else .06);bw=w-2*x;px=w*.025
        widest=max(d.textlength(line,font=f) for line in lines)
        if widest>bw-px*2:fs=max(1,math.floor(fs*(bw-px*2)/widest));f=font(fs)
        lh=round(fs*1.32);py=round(fs*.34);bh=len(lines)*lh+py*2;pos=manifest.get('subtitlePosition','bottom')
        y=(h-bh)/2 if portrait and pos=='center' else h*.75-bh/2 if portrait and pos=='lowerCenter' else h*(.92 if portrait else .94)-bh
        d.rounded_rectangle((x,y,x+bw,y+bh),radius=h*.012,fill=(0,0,0,184))
        for i,line in enumerate(lines):d.text((w/2,y+py+lh*(i+.5)),line,font=f,fill='white',anchor='mm')
    im.save(path)
def run(cmd):
    p=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=1800)
    if p.returncode:raise RuntimeError('動画の組み立てに失敗しました。素材形式を確認して再試行してください。')
def render(job,root,progress=lambda n:None):
    m=job['manifest'];w,h=m['width'],m['height'];parts=[]
    for i,s in enumerate(m['scenes']):
        folder=root/str(i);folder.mkdir();duration=float(s['duration'])+(float(m.get('endingHold',0)) if i==len(m['scenes'])-1 else 0)
        boundaries={0.,duration};caps=s.get('captions',[])
        for c in caps:boundaries.add(min(duration,max(0.,float(c['start']))));boundaries.add(min(duration,max(0.,float(c['end']))))
        points=sorted(boundaries);entries=[]
        for j,(a,b) in enumerate(zip(points,points[1:])):
            if b-a<.001:continue
            caption=next((c['text'] for c in caps if c['start']<=a+.0001<c['end']),'')
            if a>=s['duration'] and caps:caption=caps[-1]['text']
            path=folder/('c'+str(j)+'.png');overlay(path,m,s,caption);entries.extend(["file '"+str(path)+"'",'duration '+str(b-a)])
        entries.append(entries[-2]);caplist=folder/'captions.txt';caplist.write_text('\n'.join(entries)+'\n')
        media=root/('media-'+str(i));audio=root/('audio-'+str(i));out=folder/'scene.mp4'
        cmd=['ffmpeg','-hide_banner','-loglevel','error','-y']
        cmd+=['-stream_loop','-1'] if s.get('mediaType')=='video' else ['-loop','1']
        cmd+=['-i',str(media),'-i',str(audio),'-f','concat','-safe','0','-i',str(caplist)]
        scale=f'scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1,fps=30'
        if m.get('motion')=='gentle' and s.get('mediaType')!='video':scale+=f",zoompan=z='1.025+0.085*on/{max(1,round(duration*30))}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={w}x{h}:fps=30"
        filt=f'[0:v]{scale}[base];[2:v]fps=30,format=rgba[cap];[base][cap]overlay=0:0:eof_action=repeat:format=auto,format=yuv420p[v];[1:a]apad,aresample=48000[a]'
        cmd+=['-filter_complex_threads','1','-filter_complex',filt,'-map','[v]','-map','[a]','-t',str(duration),'-c:v','libx264','-preset','veryfast','-crf','20','-threads','2','-c:a','aac','-b:a','192k','-ac','2','-r','30','-movflags','+faststart',str(out)]
        run(cmd);parts.append(out);progress(round((i+1)/len(m['scenes'])*90))
    cat=root/'scenes.txt';cat.write_text('\n'.join("file '"+str(p)+"'" for p in parts)+'\n');out=root/'video.mp4'
    run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(cat),'-c','copy','-movflags','+faststart',str(out)])
    return out
def main():
    if os.environ.get('GITHUB_EVENT_NAME')=='push':api('selftest')
    target=os.environ.get('VIDEO_EXPORT_JOB_ID','')
    for _ in range(1 if target else 5):
        job=api('claim',**({'id':target} if target else {})).get('job')
        if not job:return
        try:
            with tempfile.TemporaryDirectory() as td:
                root=Path(td)
                for asset in job['assets']:
                    if not asset['url'].startswith('https://vnnvuxccazkdzwqjmntz.supabase.co/storage/v1/'):raise RuntimeError('不正な素材URL')
                    (root/asset['key']).write_bytes(request(asset['url']))
                output=render(job,root,lambda p:api('progress',id=job['id'],lease=job['lease'],progress=p))
                request(job['outputUpload'],output.read_bytes(),{'Content-Type':'video/mp4'},'PUT')
                api('done',id=job['id'],lease=job['lease'],progress=100)
            print('Video export completed.',flush=True)
        except Exception:
            api('failed',id=job['id'],lease=job['lease'],error='サーバーで動画を作れませんでした。素材と音声を確認して、もう一度書き出してください。')
            print('Video export failed; the app shows retry information.',flush=True)
if __name__=='__main__':main()
