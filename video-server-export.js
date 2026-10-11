(()=>{
if(window.__videoServerExport)return;window.__videoServerExport=true;
const $=id=>document.getElementById(id),second=!!$('makeScript'),ENDPOINT='https://vnnvuxccazkdzwqjmntz.supabase.co/functions/v1/video-export',KEY='videoServerExportV1-'+(second?'2':'1');let pending=false,timer=null,current=null;
try{current=JSON.parse(localStorage.getItem(KEY)||'null')}catch{}
const status=()=>$(second?'videoStatus':'exportStatus'),button=()=>$(second?'makeVideo':'exportVideo');
function message(text){const el=status();if(el)el.textContent=text}
function cancelState(show){const b=$('cancelServerExport');if(b)b.hidden=!show}
async function api(action,extra={}){
 let s=null,w=window;for(let i=0;i<5;i++){if(typeof w.securityRequireSession==='function'){s=await w.securityRequireSession('vnnvuxccazkdzwqjmntz');break}if(w===w.parent)break;w=w.parent}
 if(!s){try{s=JSON.parse(localStorage.getItem('sb-vnnvuxccazkdzwqjmntz-auth-token')||'null')}catch{}}
 if(!s?.access_token)throw Error('ログインしてから書き出してください。');
 const r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify({action,...extra})});const d=await r.json();if(!r.ok)throw Error(d.error||'書き出しを開始できませんでした');return d;
}

const tokenTemplate='https://github.com/settings/personal-access-tokens/new?name=VideoExportStart&description=Start%20company-app%20video%20exports&target_name=yuubae96-rgb&expires_in=90&actions=write';
function launcherPanel(){
 if($('videoLauncherPanel'))return;
 const panel=document.createElement('details');panel.id='videoLauncherPanel';panel.hidden=true;panel.className='card';panel.style.cssText='margin:12px;padding:14px;border:1px solid #dce1e8;border-radius:12px;background:#f7f9fc';
 panel.innerHTML='<summary style="font-weight:800;cursor:pointer">書き出しの即時起動設定（管理者・1回のみ）</summary><div style="font-size:13px;line-height:1.7;margin-top:10px">専用キーを設定すると、受付後すぐに書き出しサーバーへ起動を要求します。定期チェックを待つ方式は使いません。<br><a id="videoLauncherTokenLink" target="_blank" rel="noopener">① GitHubで専用キーを作る</a><br>Repository access は「Only select repositories」→「company-app」だけを選び、Actions は「Read and write」にしてください。Generate token の後に表示されるキーを下へ貼り付けます。<br>キーはこの画面の保存ボタンでサーバーに暗号化して保存します。チャットへ貼り付ける必要はありません。</div><label for="videoLauncherToken">② 専用キー（github_pat_ で始まる文字列）</label><input id="videoLauncherToken" type="password" autocomplete="off" spellcheck="false" placeholder="専用キーを貼り付け"><button type="button" id="saveVideoLauncher" style="padding:12px;margin-top:9px;border:0;border-radius:10px;background:#263b6a;color:white;font-weight:800;width:100%">③ 保存して起動権限を確認</button><div id="videoLauncherStatus" style="font-size:13px;line-height:1.6;margin-top:8px"></div>';
 $('topic')?.closest('.card')?.insertAdjacentElement('afterend',panel);if(!panel.isConnected)document.body.prepend(panel);
 $('videoLauncherTokenLink').href=tokenTemplate;
 $('saveVideoLauncher').onclick=async()=>{const field=$('videoLauncherToken'),b=$('saveVideoLauncher'),st=$('videoLauncherStatus');const token=field.value.trim();if(!token)return;field.value='';b.disabled=true;st.textContent='起動権限を確認しています…';try{const d=await api('configureLauncher',{token});st.textContent=d.ready?'設定完了。今後は受付時に直接サーバーへ起動を要求します。':'設定できませんでした。'}catch(e){st.textContent=e.message}finally{b.disabled=false}};
 api('launcherStatus').then(d=>{panel.hidden=!d.canConfigure;if(d.canConfigure){$('videoLauncherStatus').textContent=d.ready?'専用キーは設定済みです。受付時に直接起動を要求します。':'専用キーの設定が必要です。';panel.open=!d.ready}}).catch(()=>{});
}

function save(){if(current)localStorage.setItem(KEY,JSON.stringify(current));else localStorage.removeItem(KEY)}
function captionList(s,duration){const out=[];let start=0,last='';const caption=t=>second?speechCaption(s,t,duration):subtitleAt(s.text,t,duration,s.alignment||[]);for(let t=0;t<duration;t+=.1){const text=String(caption(t)||'');if(text!==last){if(last)out.push({start,end:Math.min(duration,t),text:last});start=t;last=text;}}if(last)out.push({start,end:duration,text:last});return out;}
async function start(){
 if(pending||current&&['uploading','queued','running'].includes(current.status))return message('書き出しを受付済みです。戻ると進捗を確認できます。');
 if(second){if(!project?.scenes?.length)return;project.scenes.forEach((_,i)=>sync(i))}
 const scenes=second?project.scenes:getScenesReady();if(!scenes.length||scenes.some(s=>!(s.image||s.video)||!s.audio))return message('全シーンの画像・映像と音声を先に完成させてください。');
 if(document.querySelector('.scene[data-audio-outdated="1"],.scene[data-audio-generating="1"],.scene[data-image-generating="1"]'))return message('変更した文章の音声を作り直し、生成が終わってから書き出してください。');
 pending=true;button().disabled=true;document.querySelectorAll('audio,video').forEach(a=>a.pause());window.stopPreview?.();let context=null;
 try{
  message('書き出し素材を準備しています。サーバー受付完了と表示されるまで、この画面を開いておいてください。');
  const format=$('videoFormat')?.value||'16:9';let width,height;if(format==='9:16'){width=1080;height=1920}else{[width,height]=($('exportSize')?.value||'1280x720').split('x').map(Number)}
  const koala=second&&$('narrationStyle')?.value==='koala';
  const manifest={width,height,showTitle:!koala&&$('titleDisplay')?.value!=='none',titleColor:second?'#8f1d24':(typeof videoTitleColor==='function'?videoTitleColor():'#682635'),subtitlePosition:second?'bottom':$('subtitlePosition')?.value||'center',motion:second?(koala?'none':'gentle'):$('imageMotion')?.value||'none',endingHold:second?0:Number($('endingHold')?.value||0),scenes:[]};
  context=new (window.AudioContext||window.webkitAudioContext)();const blobs=[];
  for(let i=0;i<scenes.length;i++){
   const s=scenes[i],ar=await fetch(s.audio);if(!ar.ok)throw Error('SCENE '+(i+1)+'の音声を読み込めません');const audio=await ar.blob();const decoded=await context.decodeAudioData(await audio.arrayBuffer());const mr=await fetch(s.video||s.image);if(!mr.ok)throw Error('SCENE '+(i+1)+'の画像・映像を読み込めません');const media=await mr.blob();
   if(media.size>500*1024*1024||audio.size>500*1024*1024)throw Error('1つの素材は500MB以内にしてください。');
   manifest.scenes.push({title:s.title,mediaType:s.video?'video':'image',duration:decoded.duration,captions:captionList(s,decoded.duration)});blobs.push({key:'media-'+i,blob:media},{key:'audio-'+i,blob:audio});
   message('素材を準備中… '+(i+1)+'/'+scenes.length+'。受付完了まで画面を開いておいてください。');
  }
  const job=await api('prepare',{manifest});current={id:job.id,status:'uploading'};save();
  for(let i=0;i<blobs.length;i++){const a=blobs[i],u=job.uploads.find(x=>x.key===a.key);const r=await fetch(u.url,{method:'PUT',headers:{'Content-Type':a.blob.type||'application/octet-stream'},body:a.blob});if(!r.ok)throw Error('素材を送信できませんでした。通信を確認して再試行してください。');message('素材をサーバーへ送信中… '+(i+1)+'/'+blobs.length+'。受付完了まで画面を開いておいてください。');}
  const queued=await api('queue',{id:current.id});current.status=queued.status;save();cancelState(true);message('サーバー受付完了。ほかのサイトやYouTubeへ移っても書き出しは続きます。サーバーを起動しています。定期チェック待ちはありません。');schedule();
 }catch(e){if(current?.status==='uploading'){try{await api('cancel',{id:current.id})}catch{}current=null;save()}message('書き出しエラー：'+e.message);if(/起動キー/.test(e.message)){const panel=$('videoLauncherPanel');if(panel){panel.hidden=false;panel.open=true;panel.scrollIntoView?.({behavior:'smooth',block:'center'})}}}finally{pending=false;button().disabled=false;if(context)await context.close()}
}
function schedule(){clearTimeout(timer);timer=setTimeout(poll,5000)}
async function poll(){if(!current||pending)return;const card=$(second?'videoCard':'previewWrap');if(card)card.style.display='block';try{const d=await api('status',{id:current.id});current.status=d.status;save();if(d.status==='done'){
 const dl=$(second?'saveLink':'downloadVideo');dl.href=d.url;dl.download='youtube-video.mp4';dl.textContent='完成した動画を保存（MP4）';dl.style.display='block';dl.onclick=async e=>{e.preventDefault();const win=window.open('about:blank','_blank');try{const fresh=await api('status',{id:current.id});if(win)win.location.href=fresh.url;else location.href=fresh.url}catch(err){win?.close();message(err.message)}};
 let player=$(second?'resultVideo':'completedVideo');if(!player){player=document.createElement('video');player.id='completedVideo';player.controls=true;player.playsInline=true;player.style.cssText='display:block;width:100%;margin-top:12px;border-radius:12px';dl.after(player)}if(player.getAttribute('src')!==d.url)player.src=d.url;player.style.display='block';cancelState(false);message('サーバーで動画が完成しました。MP4を保存できます。');const bar=$('exportBar');if(bar)bar.style.width='100%';return;
 }if(d.status==='failed'||d.status==='cancelled'){cancelState(false);message(d.status==='failed'?'書き出しエラー：'+(d.error||'もう一度書き出してください。'):'書き出しを中止しました。');return}
 if(d.status==='uploading'){await api('cancel',{id:current.id});current=null;save();message('素材の送信途中で画面を離れたため、もう一度書き出してください。');return}
 cancelState(true);const bar=$('exportBar');if(bar)bar.style.width=d.progress+'%';message(d.status==='queued'?'受付完了・サーバーの起動を要求済み。ほかのサイトへ移動できます。開始待ちには数分かかる場合があります。':'サーバーで動画を書き出し中… '+d.progress+'%。ほかのサイトやYouTubeへ移動できます。');schedule();
 }catch(e){message('書き出し状況を確認できません：'+e.message+'。サーバーの処理は画面と独立しています。');schedule()}}
function bind(){const b=button();if(!b||b.dataset.serverExportBound)return;b.dataset.serverExportBound='1';b.textContent=second?'サーバーで字幕付き動画を書き出す':'サーバーで動画を書き出す';b.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();start()},true);
 const note=document.createElement('div');note.style.cssText='font-size:12px;line-height:1.6;margin-top:8px;color:#6d7788';note.textContent='受付後すぐにサーバーへ起動を要求します。受付完了後は、ほかのサイトを見ても書き出しを継続します。受付時の構成で作成します。この画面へ戻ると完成した動画を保存できます。';b.after(note);
 const cancel=document.createElement('button');cancel.id='cancelServerExport';cancel.type='button';cancel.className=second?'btn':'subbtn';cancel.textContent='サーバー書き出しを中止';cancel.hidden=true;cancel.style.cssText='margin-top:8px;background:#8f1d24;color:white;padding:10px;border-radius:10px';cancel.onclick=async()=>{if(!current||!confirm('サーバーでの書き出しを中止しますか？'))return;try{await api('cancel',{id:current.id});current.status='cancelled';save();clearTimeout(timer);cancel.hidden=true;message('書き出しを中止しました。')}catch(e){message('中止できませんでした：'+e.message)}};note.after(cancel);
}
launcherPanel();new MutationObserver(bind).observe(document.body,{childList:true,subtree:true});bind();if(current)setTimeout(poll,1000);window.addEventListener('pageshow',()=>{if(current)poll()});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&current)poll()});
})();
