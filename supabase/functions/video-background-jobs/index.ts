import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { generate } from './generator.ts';
import { createMediaStore } from './media-storage.ts';
import { planExplainer } from './explainer-plan.ts';
const ORIGIN='https://yuubae96-rgb.github.io';
const BASE=Deno.env.get('SUPABASE_URL')!;
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const mediaStore=createMediaStore(BASE,KEY);
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Vary':'Origin'}});
async function db(path:string,body?:unknown,method?:string){const r=await fetch(BASE+'/rest/v1/'+path,{method:method||(body===undefined?'GET':'POST'),headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});const txt=await r.text();if(!r.ok){console.error('video job database error',r.status);throw Error('生成状態を保存できませんでした。もう一度確認してください。')}return txt?JSON.parse(txt):null;}
const rpc=(name:string,body={})=>db('rpc/'+name,body);
async function hash(token:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function workerToken(){return String(await rpc('video_jobs_worker_token'));}
async function kick(){const token=await workerToken();await fetch(BASE+'/functions/v1/video-background-jobs',{method:'POST',headers:{'Content-Type':'application/json','x-video-worker-token':token},body:'{"action":"work"}',signal:AbortSignal.timeout(10000)}).then(r=>r.body?.cancel()).catch(e=>console.error('worker kickoff failed',e.name));}
async function kickParallel(count=2){await Promise.allSettled(Array.from({length:count},()=>kick()));}
function background(p:Promise<unknown>){EdgeRuntime.waitUntil(p.catch(e=>console.error('video background task',String(e.message).slice(0,200))));}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function voicevox(b:any){const r=await fetch('https://api.tts.quest/v3/voicevox/synthesis',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({text:b.text,speaker:String(b.speaker||13)}),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!d.success)throw Error(d.message||'VOICEVOXの生成開始に失敗しました');const deadline=Date.now()+90000;while(Date.now()<deadline){const s=await fetch(d.audioStatusUrl,{signal:AbortSignal.timeout(10000)}).then(r=>r.json());if(s.isAudioError)throw Error('VOICEVOXの音声生成に失敗しました');if(s.isAudioReady){const r=await fetch(d.mp3DownloadUrl||d.wavDownloadUrl,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('完成音声を保存できませんでした');const a=new Uint8Array(await r.arrayBuffer());let text='';for(let i=0;i<a.length;i+=32768)text+=String.fromCharCode(...a.subarray(i,i+32768));return {data:btoa(text),mimeType:r.headers.get('content-type')||'audio/mpeg',provider:'voicevox',alignment:[]};}await sleep(1500);}throw Error('VOICEVOXの生成が時間内に完了しませんでした。再試行してください');}
async function work(){const item=await rpc('video_jobs_claim');if(!item)return;let result=null,error=null;try{const request=await mediaStore.readRequest(item.job_id,item.request);if(request.action==='generateVoicevoxTts')result=await voicevox(request);else{const response=await generate(new Request(BASE+'/functions/v1/video-ai-gemini',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify(request)}));result=await response.json();if(!response.ok)throw Error(result.error||'生成に失敗しました');}if(!result?.data)throw Error('生成結果が空でした');result=await mediaStore.saveResult(item.job_id,item.id,item.lease,result);}catch(e){result=null;error=String((e as Error).message||e).slice(0,800);}const finished=await rpc('video_jobs_finish',{p_id:item.id,p_lease:item.lease,p_result:result,p_error:error});if(finished===false&&result?.media)await mediaStore.remove([result.media.path]);if(finished===true&&item.request?.mediaRequest){await mediaStore.remove([item.request.mediaRequest.path]);await db('video_background_items?id=eq.'+item.id,{request:{archived:true}},'PATCH');}await kick();}
async function cleanup(){
 const legacy=await db('video_background_items?status=eq.done&result->>data=not.is.null&select=id,job_id,result&limit=5');
 for(const item of legacy||[]){const stored=await mediaStore.saveResult(item.job_id,item.id,crypto.randomUUID(),item.result);const replaced=await rpc('video_jobs_archive_result',{p_id:item.id,p_result:stored});if(!replaced)await mediaStore.remove([stored.media.path]);}
 const expired=await rpc('video_jobs_expired_media');await mediaStore.remove((expired||[]).map((x:any)=>x.name));
 return await rpc('video_jobs_prune_metadata');
}

function validate(items:any[]){if(!Array.isArray(items)||!items.length||items.length>120)throw Error('生成の件数を確認してください');return items.map((x:any)=>{if(!Number.isInteger(x.sceneIndex)||x.sceneIndex<0||x.sceneIndex>59||!['image','audio'].includes(x.kind))throw Error('場面の指定が不正です');const b=x.request||{};if(x.kind==='image'){if(b.action!=='generateImage'||!String(b.prompt||'').trim()||String(b.prompt).length>50000)throw Error('画像指示を確認してください');if(!['gemini','openai','auto'].includes(b.imageProvider||'auto'))throw Error('画像AIの指定を確認してください');}else if(!['generateFishTts','generateTts','generateVoicevoxTts'].includes(b.action)||!String(b.text||'').trim()||String(b.text).length>12000)throw Error('音声の文章を確認してください');return {sceneIndex:x.sceneIndex,kind:x.kind,request:b};});}
securityServe(async req=>{if(req.method==='OPTIONS')return reply({});try{if(req.method!=='POST')return reply({error:'Method not allowed'},405);const b=await req.json();if(b.action==='animationPlan'){const supplied=req.headers.get('x-video-worker-token');if(supplied&&supplied!==await workerToken())return reply({error:'Forbidden'},403);return reply(await planExplainer(b.scenes,(name:string)=>Deno.env.get(name)));}if(b.action==='storage-check'){const supplied=req.headers.get('x-video-worker-token');if(!supplied||supplied!==await workerToken())return reply({error:'Forbidden'},403);const job=crypto.randomUUID(),item=crypto.randomUUID();const stored=await mediaStore.saveResult(job,item,crypto.randomUUID(),{data:'AAECAwQF',mimeType:'audio/wav',provider:'storage-check'});let checked=false;try{const restored=await mediaStore.readResult(job,item,stored);checked=restored.data==='AAECAwQF';}finally{await mediaStore.remove([stored.media.path]);}return reply({roundTrip:checked,metadataOnly:!('data' in stored),metadataBytes:new TextEncoder().encode(JSON.stringify(stored)).length,deleted:true});}if(b.action==='cleanup'){const supplied=req.headers.get('x-video-worker-token');if(!supplied||supplied!==await workerToken())return reply({error:'Forbidden'},403);background(cleanup());return reply({accepted:true});}if(b.action==='work'){const supplied=req.headers.get('x-video-worker-token');if(!supplied||supplied!==await workerToken())return reply({error:'Forbidden'},403);background(work());return reply({accepted:true});}if(req.headers.get('origin')!==ORIGIN)return reply({error:'Forbidden origin'},403);if(!/^[a-f0-9]{64}$/.test(b.token||'')||!/^[-a-f0-9]{36}$/.test(b.jobId||''))return reply({error:'Invalid session'},401);const owner=await hash(b.token);if(b.action==='create'){const items=validate(b.items);for(const item of items)item.request=await mediaStore.saveRequest(b.jobId,item.request);if(JSON.stringify(b.snapshot||{}).length>250000)throw Error('構成が大きすぎます');await rpc('video_jobs_enqueue',{p_id:b.jobId,p_owner:owner,p_snapshot:b.snapshot||{},p_items:items});background(kickParallel(2));return reply({jobId:b.jobId,accepted:true});}
const jobs=await db('video_background_jobs?id=eq.'+encodeURIComponent(b.jobId)+'&owner_hash=eq.'+owner+'&select=id,snapshot,cancelled,created_at');if(!jobs?.length)return reply({error:'この生成結果は見つかりません。保存期間は30日です。'},404);
if(b.action==='status'){const items=await db('video_background_items?job_id=eq.'+b.jobId+'&select=id,scene_index,kind,status,error,ordinal&order=ordinal.asc');return reply({job:jobs[0],items});}
if(b.action==='ackResults'){if(!Array.isArray(b.itemIds)||b.itemIds.length>120||b.itemIds.some((x:any)=>!/^[-a-f0-9]{36}$/.test(x)))return reply({error:'Invalid items'},400);if(!b.itemIds.length)return reply({archived:0});const rows=await db('video_background_items?job_id=eq.'+b.jobId+'&id=in.('+b.itemIds.join(',')+')&status=eq.done&select=id,result');let archived=0;for(const item of rows){if(item.result?.archivedToDevice){archived++;continue;}if(item.result?.media)await mediaStore.remove([item.result.media.path]);const {data,media,...meta}=item.result||{};await db('video_background_items?id=eq.'+item.id+'&job_id=eq.'+b.jobId,{result:{...meta,archivedToDevice:true}},'PATCH');archived++;}return reply({archived});}
if(b.action==='result'){if(!/^[-a-f0-9]{36}$/.test(b.itemId||''))return reply({error:'Invalid item'},400);const rows=await db('video_background_items?id=eq.'+b.itemId+'&job_id=eq.'+b.jobId+'&status=eq.done&select=result');if(rows[0]?.result?.archivedToDevice)return reply({error:'この結果は端末へ保存済みです。「保存再開」または自動保存から再開してください。'},410);return rows.length?reply(await mediaStore.readResult(b.jobId,b.itemId,rows[0].result)):reply({error:'まだ完成していません'},409);}
if(b.action==='cancel'){await db('video_background_jobs?id=eq.'+b.jobId,{cancelled:true},'PATCH');await db('video_background_items?job_id=eq.'+b.jobId+'&status=eq.queued',{status:'cancelled'},'PATCH');return reply({cancelled:true});}
return reply({error:'Unknown action'},400);}catch(e){return reply({error:String((e as Error).message||e)},400);}});

const SECURITY_ROLES=['owner','office','manager'];

function securityServe(handler: (req: Request, info?: any) => Response | Promise<Response>) {
 const securityHeaders = {'Access-Control-Allow-Origin':'https://yuubae96-rgb.github.io','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type, x-video-upload-url','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Cache-Control':'no-store','Vary':'Origin','Content-Type':'application/json'};
 const deny=(status:number,error:string)=>new Response(JSON.stringify({error}),{status,headers:securityHeaders});
 Deno.serve(async (req:Request, info:any) => {
  if(req.method==='OPTIONS')return new Response('ok',{headers:securityHeaders});
  try {
   if(req.headers.get('x-video-worker-token'))return await handler(req,info);
   const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
   const base=Deno.env.get('SUPABASE_URL')||'';
   const bearer=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
   if(service && bearer===service)return await handler(req,info);
   if(!bearer || bearer.startsWith('sb_'))return deny(401,'ログインが必要です');
   const ur=await fetch(base+'/auth/v1/user',{headers:{apikey:service,Authorization:'Bearer '+bearer}});
   if(!ur.ok)return deny(401,'ログインし直してください');
   const user=await ur.json();
   if(!user.id || !user.email_confirmed_at || user.is_anonymous)return deny(403,'利用権限がありません');
   const pr=await fetch(base+'/rest/v1/app_users?user_id=eq.'+encodeURIComponent(user.id)+'&select=role,active',{headers:{apikey:service,Authorization:'Bearer '+service}});
   if(!pr.ok)return deny(503,'権限の確認に失敗しました');
   const profiles=await pr.json(),p=profiles[0];
   if(!p?.active || !SECURITY_ROLES.includes(p.role))return deny(403,'利用権限がありません');
   const response=await handler(req,info);
   const headers=new Headers(response.headers);
   for(const [k,v] of Object.entries(securityHeaders))if(k!=='Content-Type')headers.set(k,v);
   return new Response(response.body,{status:response.status,headers});
  } catch { return deny(503,'認証の確認に失敗しました'); }
 });
}
