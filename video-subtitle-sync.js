/* Completed-audio subtitle timing. Shared by preview, local and server exports. */
(()=>{
'use strict';
const VERSION='local-whisper-v1',endpoint='https://vnnvuxccazkdzwqjmntz.supabase.co/functions/v1/video-subtitle-align';
const clean=s=>Array.from(String(s||'').normalize('NFKC').toLowerCase().replace(/[\u30a1-\u30f6]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).replace(/[\s\p{P}\p{S}]/gu,''));
function captionCues(chunks,words){
 const target=chunks.flatMap(clean),spoken=[],times=[];
 for(const word of words){const chars=clean(word.text),start=Number(word.start),end=Number(word.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)continue;chars.forEach((c,i)=>{spoken.push(c);times.push(start+(end-start)*i/chars.length)})}
 const n=target.length,m=spoken.length;if(!n||!m||n*m>16000000)throw Error('原稿と音声を照合できません。場面を短く分けてください');
 const width=m+1,dp=new Uint16Array((n+1)*width);for(let i=0;i<=n;i++)dp[i*width]=i;for(let j=0;j<=m;j++)dp[j]=j;
 for(let i=1;i<=n;i++)for(let j=1;j<=m;j++)dp[i*width+j]=Math.min(dp[(i-1)*width+j]+1,dp[i*width+j-1]+1,dp[(i-1)*width+j-1]+(target[i-1]===spoken[j-1]?0:1));
 if(dp[n*width+m]/Math.max(n,m)>.45)throw Error('原稿と認識した音声の一致度が不足しています。原稿と音声を確認してください');
 const mapping=new Array(n);let i=n,j=m;
 while(i||j){if(i&&j&&dp[i*width+j]===dp[(i-1)*width+j-1]+(target[i-1]===spoken[j-1]?0:1)){mapping[--i]=--j}else if(i&&dp[i*width+j]===dp[(i-1)*width+j]+1){mapping[--i]=Math.min(j,m-1)}else j--}
 let offset=0,last=0;const cues=chunks.map((text,index)=>{const k=mapping[Math.min(offset,n-1)];const start=index?Math.max(last,times[k]):0;last=start;offset+=clean(text).length;return{text,start}});
 // Empty or collapsed captions cannot be presented as synchronized.
 if(cues.some((c,k)=>k&&c.start<=cues[k-1].start))throw Error('字幕の区切り時刻を確定できませんでした。文章を確認してください');
 return cues;
}
function cueAt(cues,time){let index=0;while(index+1<cues.length&&time>=cues[index+1].start)index++;return cues[index]?.text||''}
window.subtitleSyncInternals={captionCues,cueAt,clean};
const inflight=new WeakMap();
let localTranscriberPromise=null;
async function localWhisper(blob){
 if(!localTranscriberPromise){
  localTranscriberPromise=(async()=>{
   const {pipeline}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
   return pipeline('automatic-speech-recognition','Xenova/whisper-tiny',{device:'wasm',dtype:'q8'});
  })().catch(e=>{localTranscriberPromise=null;throw e});
 }
 const buffer=await blob.arrayBuffer();
 const context=new (window.AudioContext||window.webkitAudioContext)();
 let decoded;
 try{decoded=await context.decodeAudioData(buffer)}finally{await context.close()}
 const mono=new Float32Array(Math.ceil(decoded.duration*16000));
 const source=decoded.getChannelData(0),ratio=decoded.sampleRate/16000;
 for(let i=0;i<mono.length;i++){const p=i*ratio,j=Math.floor(p),t=p-j;mono[i]=(source[j]||0)*(1-t)+(source[j+1]||source[j]||0)*t}
 const transcriber=await localTranscriberPromise;
 const result=await transcriber(mono,{language:'japanese',task:'transcribe',return_timestamps:'word',chunk_length_s:30,stride_length_s:5});
 const alignment=(result.chunks||[]).map(c=>({text:c.text,start:c.timestamp?.[0],end:c.timestamp?.[1]})).filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start);
 if(!alignment.length)throw Error('端末内で発話時刻を取得できませんでした');
 return alignment;
}
async function alignAudio(audio,text,state){
 const src=audio.getAttribute('src');if(!src)return;
 const chunks=subtitleChunks(String(text).replace(/\[間:[0-9]+(?:\.[0-9]+)?\]/g,'')),key=JSON.stringify(chunks);
 const ready=audio._alignment?.[0];if(ready?.source===VERSION&&ready.captionKey===key&&ready.audioSrc===audio.src)return;
 if(ready?.source===VERSION&&ready.audioSrc===audio.src){const cues=captionCues(chunks,audio._alignment.slice(1));audio._alignment=[{...ready,captionKey:key,cues},...audio._alignment.slice(1)];return}
 if(inflight.has(audio)){await inflight.get(audio);return alignAudio(audio,text,state)}
 const task=(async()=>{
  if(state)state.textContent='字幕を完成音声に合わせています…';
  try{
   const response=await fetch(src);if(!response.ok)throw Error('音声を読み込めませんでした');
   const blob=await response.blob();if(blob.size>20000000)throw Error('音声が大きすぎます。場面を短く分けてください');
   let alignment;
   try{alignment=await localWhisper(blob)}
   catch(e){throw Error('無料の端末内音声解析に失敗しました（端末のメモリ・通信環境を確認してください）：'+e.message)}
   const cues=captionCues(chunks,alignment);
   if(audio.getAttribute('src')!==src)throw Error('音声が変更されました。もう一度同期してください');
   audio._alignment=[{source:VERSION,captionKey:key,audioSrc:audio.src,cues},...alignment];
   if(state)state.textContent='字幕同期済み：完成音声の発話時刻を使用';
  }catch(e){if(state)state.textContent='字幕未同期：'+e.message;throw e}
 })();inflight.set(audio,task);try{await task}finally{inflight.delete(audio)}
}
window.ensureVideoSubtitleSync=async()=>{for(const [i,row]of [...document.querySelectorAll('.scene')].entries()){const audio=document.getElementById('audio'+i);if(audio?.getAttribute('src'))await alignAudio(audio,row.querySelector('.nar')?.value||'',document.getElementById('audioState'+i))}};
const original=window.subtitleAt;
window.subtitleAt=function(text,elapsed,duration,alignment){const meta=alignment?.[0];if(meta?.source===VERSION){const key=JSON.stringify(subtitleChunks(String(text).replace(/\[間:[0-9]+(?:\.[0-9]+)?\]/g,'')));if(meta.captionKey===key)return cueAt(meta.cues,elapsed);return ''}return original(text,elapsed,duration,alignment)};
const panel=document.createElement('div');panel.style.cssText='margin:12px 0;padding:12px;background:#f5f7fa;border-radius:10px;font-size:13px';
const button=document.createElement('button');button.type='button';button.className='subbtn';button.textContent='字幕を完成音声に合わせる';
const note=document.createElement('div');note.style.cssText='margin-top:6px;line-height:1.6';note.textContent='さとる・青山龍星など全音声共通。完成音声を解析して字幕を合わせます。OpenAI APIの追加料金は不要です。初回は音声認識モデルのダウンロードが必要で、端末によっては処理に時間がかかります。保存済みの音声にも使えます。';
panel.append(button,note);document.getElementById('result')?.insertAdjacentElement('beforebegin',panel);
button.onclick=async()=>{button.disabled=true;note.textContent='字幕を完成音声に合わせています…';try{const audios=[...document.querySelectorAll('.scene audio')].filter(a=>a.getAttribute('src'));if(!audios.length)throw Error('先にナレーションを作成してください');await window.ensureVideoSubtitleSync();note.textContent='字幕同期が完了しました。プレビューと完成動画に同じ発話時刻を使います。'}catch(e){note.textContent='字幕未同期：'+e.message}finally{button.disabled=false}};
const make=window.makeAudio;
window.makeAudio=async function(i,...args){await make.call(this,i,...args);const audio=document.getElementById('audio'+i),row=document.querySelectorAll('.scene')[i];if(audio?.getAttribute('src'))try{await alignAudio(audio,row.querySelector('.nar')?.value||'',document.getElementById('audioState'+i))}catch(e){console.warn('字幕同期未完了',e.message)}};
// Capture also protects export handlers installed by other modules after this script.
let preparing=false;
document.addEventListener('click',async event=>{const b=event.target.closest?.('#playPreview,#exportVideo,#startServerExport');if(!b||b.dataset.subtitleSyncReady==='1')return;event.preventDefault();event.stopImmediatePropagation();if(preparing)return;preparing=true;const disabled=b.disabled;b.disabled=true;try{await window.ensureVideoSubtitleSync();b.disabled=disabled;b.dataset.subtitleSyncReady='1';b.click()}catch(e){const state=document.getElementById(b.id==='playPreview'?'status':'exportStatus');if(state)state.textContent='字幕同期が完了していません：'+e.message}finally{delete b.dataset.subtitleSyncReady;b.disabled=disabled;preparing=false}},true);
})();
