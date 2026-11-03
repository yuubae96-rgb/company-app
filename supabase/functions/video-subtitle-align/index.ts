import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const ORIGIN='https://yuubae96-rgb.github.io';
const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.headers.get('origin')!==ORIGIN)return reply({error:'Forbidden origin'},403);
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
  const base=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const bearer=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(!bearer||bearer.startsWith('sb_'))return reply({error:'ログインが必要です'},401);
  const ur=await fetch(base+'/auth/v1/user',{headers:{apikey:service,Authorization:'Bearer '+bearer}});
  if(!ur.ok)return reply({error:'ログインし直してください'},401);
  const user=await ur.json();if(!user.id||!user.email_confirmed_at||user.is_anonymous)return reply({error:'利用権限がありません'},403);
  const pr=await fetch(base+'/rest/v1/app_users?user_id=eq.'+encodeURIComponent(user.id)+'&select=role,active',{headers:{apikey:service,Authorization:'Bearer '+service}});
  if(!pr.ok)return reply({error:'権限を確認できませんでした'},503);
  const profiles=await pr.json();if(!profiles[0]?.active||!['owner','office','manager'].includes(profiles[0].role))return reply({error:'利用権限がありません'},403);
  if(Number(req.headers.get('content-length'))>28000000)return reply({error:'音声が大きすぎます。場面を短く分けてください'},413);
  const raw=await req.text();if(raw.length>28000000)return reply({error:'音声が大きすぎます'},413);
  const body=JSON.parse(raw),audio=String(body.audio||''),mime=String(body.mime||'audio/wav');
  if(!audio||audio.length>27000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(audio))return reply({error:'音声データを確認してください'},400);
  const extensions:Record<string,string>={'audio/wav':'wav','audio/x-wav':'wav','audio/mpeg':'mp3','audio/mp3':'mp3','audio/mp4':'mp4','audio/x-m4a':'m4a','audio/webm':'webm'};
  const ext=extensions[mime];if(!ext)return reply({error:'対応していない音声形式です'},400);
  const key=Deno.env.get('OPENAI_API_KEY');if(!key)return reply({error:'字幕同期用のOPENAI_API_KEYが未設定です'},503);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(audio));
  const signature='subtitle-align:'+Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
  const guard=await fetch(base+'/rest/v1/rpc/youtube_api_guard',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({p_kind:'tts',p_signature:signature})});
  if(!guard.ok)return reply({error:'字幕同期の利用回数を確認できませんでした'},503);
  const allowed=await guard.json();if(!allowed?.allowed)return reply({error:allowed?.reason==='duplicate'?'同じ音声の解析中です。90秒後に再試行してください':'字幕同期の利用回数制限です。しばらく待って再試行してください'},429);
  const bin=atob(audio),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  const form=new FormData();form.append('file',new Blob([bytes],{type:mime}),'narration.'+ext);form.append('model','whisper-1');form.append('language','ja');form.append('response_format','verbose_json');form.append('timestamp_granularities[]','word');form.append('temperature','0');
  // No transcript prompt: supplied text must not be hallucinated into silent audio.
  const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:AbortSignal.timeout(90000)});
  const d=await r.json();if(!r.ok)return reply({error:'音声解析に失敗しました（OpenAI HTTP '+r.status+'）。'+String(d?.error?.message||'').slice(0,180)},502);
  const words=(Array.isArray(d.words)?d.words:[]).map((x:any)=>({text:String(x.word||''),start:Number(x.start),end:Number(x.end)})).filter((x:any)=>x.text.trim()&&Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.start>=0&&x.end>x.start);
  if(!words.length)return reply({error:'音声から発話時刻を取得できませんでした'},422);
  return reply({alignment:words,source:'audio-transcription-v1',duration:Number(d.duration)||words[words.length-1].end});
 }catch(e){return reply({error:'字幕同期に失敗しました：'+String((e as Error)?.message||e).slice(0,200)},500)}
});
