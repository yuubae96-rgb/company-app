import {encryptToken,decryptToken,checkToken,dispatchExport} from './launcher.mjs';
import { createRemoteJWKSet,jwtVerify } from 'npm:jose@5.9.6';
const BASE=Deno.env.get('SUPABASE_URL')!,KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ORIGIN='https://yuubae96-rgb.github.io',BUCKET='video-exports',AUD='video-export-vnnvuxccazkdzwqjmntz';
const JWKS=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'content-type,authorization,apikey,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
async function rest(path:string,body?:unknown){const r=await fetch(BASE+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const d=await r.json();if(!r.ok)throw Error(d.message||'書き出し状態を保存できませんでした');return d}
const rpc=(b:any)=>rest('rpc/video_export_job',b);
async function storage(path:string,body:any){const r=await fetch(BASE+'/storage/v1/'+path,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.message||d.error||'書き出し素材を保存できませんでした');return d}
async function upload(path:string){const d=await storage('object/upload/sign/'+BUCKET+'/'+path,{});return BASE+'/storage/v1'+d.url}
async function download(path:string){const d=await storage('object/sign/'+BUCKET+'/'+path,{expiresIn:7200});return BASE+'/storage/v1'+d.signedURL}
async function auth(req:Request,worker:boolean){const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(worker){const {payload}=await jwtVerify(token,JWKS,{issuer:'https://token.actions.githubusercontent.com',audience:AUD});if(payload.repository!=='yuubae96-rgb/company-app'||String(payload.repository_id)!=='1335537186'||String(payload.repository_owner_id)!=='317107313'||payload.ref!=='refs/heads/main'||payload.workflow_ref!=='yuubae96-rgb/company-app/.github/workflows/video-export.yml@refs/heads/main'||!['schedule','push','workflow_dispatch'].includes(String(payload.event_name)))throw Error('Forbidden worker');return null}
 if(req.headers.get('origin')!==ORIGIN)throw Error('Forbidden origin');
 const r=await fetch(BASE+'/auth/v1/user',{headers:{apikey:KEY,Authorization:'Bearer '+token}});if(!r.ok)throw Error('ログインし直してください');const u=await r.json();if(!u.id||!u.email_confirmed_at||u.is_anonymous)throw Error('利用権限がありません');
 const profiles=await rest('app_users?user_id=eq.'+encodeURIComponent(u.id)+'&select=role,active');if(!profiles[0]?.active||!['owner','office','manager'].includes(profiles[0].role))throw Error('利用権限がありません');return {id:u.id,role:profiles[0].role};
}


async function removeJobFiles(job:any,includeOutput=false){
 const paths=(job.assets||[]).map((a:any)=>a.path);
 if(includeOutput&&job.output_path)paths.push(job.output_path);
 if(paths.some((p:any)=>typeof p!=='string'||!p.startsWith(job.id+'/')||p.includes('..')))throw Error('Invalid cleanup path');
 if(!paths.length)return;
 const r=await fetch(BASE+'/storage/v1/object/'+BUCKET,{method:'DELETE',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify({prefixes:paths})});
 if(!r.ok)throw Error('一時ファイルを整理できませんでした。再試行してください。');
}

async function launcherKey(){const env=Deno.env.get('VIDEO_EXPORT_GITHUB_TOKEN');if(env)return env;const config=await rest('rpc/video_export_launcher_config',{});return config?.cipher?await decryptToken(config.cipher,KEY):''}

Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response('ok',{headers});if(req.method!=='POST')return reply({error:'Method not allowed'},405);try{
 const b=await req.json();const worker=['selftest','claim','progress','done','failed'].includes(b.action);const actor=await auth(req,worker);const user=actor?.id;

 if(b.action==='launcherStatus'){let ready=false;try{ready=!!await launcherKey()}catch{}return reply({ready,canConfigure:actor?.role==='owner'});}
 if(b.action==='configureLauncher'){
  if(actor?.role!=='owner')return reply({error:'この設定は管理者だけが変更できます。'},403);
  const token=String(b.token||'').trim();if(!token.startsWith('github_pat_')||token.length>1024||/\\s/.test(token))throw Error('GitHubのFine-grained起動キーを入力してください。');
  await checkToken(token);await dispatchExport(token);
  await rest('rpc/video_export_launcher_config',{p_cipher:await encryptToken(token,KEY)});
  return reply({ready:true,requested:true});
 }

 if(b.action==='selftest'){
  const id=crypto.randomUUID(),assets=[{key:'media-0',path:id+'/media-0'},{key:'audio-0',path:id+'/audio-0'}];
  const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRuoAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
  const wav=new Uint8Array(44+24000*2*2),v=new DataView(wav.buffer),word=(p:number,s:string)=>[...s].forEach((c,i)=>wav[p+i]=c.charCodeAt(0));word(0,'RIFF');v.setUint32(4,wav.length-8,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,24000,true);v.setUint32(28,48000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,wav.length-44,true);
  for(const [i,data] of [png,wav].entries()){const r=await fetch(BASE+'/storage/v1/object/'+BUCKET+'/'+assets[i].path,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':i===0?'image/png':'audio/wav'},body:data});if(!r.ok)throw Error('Test asset upload failed');}
  await rpc({p_action:'create',p_id:id,p_user:'00000000-0000-0000-0000-000000000000',p_manifest:{width:1280,height:720,showTitle:true,titleColor:'#682635',subtitlePosition:'bottom',motion:'none',endingHold:1,selftest:true,scenes:[{title:'書き出し確認',mediaType:'image',duration:2,captions:[{start:0,end:2,text:'別のサイトを見ていても\nサーバーで動画を作ります'}]}]},p_assets:assets});await rpc({p_action:'queue',p_id:id,p_user:'00000000-0000-0000-0000-000000000000'});return reply({accepted:true});
 }
 if(b.action==='prepare'){
  if(!await launcherKey())throw Error('即時起動キーが未設定です。画面の「書き出しの即時起動設定」で管理者が1回設定してください。');
  const m=b.manifest;if(!m||!Array.isArray(m.scenes)||m.scenes.length<1||m.scenes.length>60||![720,1080,1920].includes(m.height)||![720,1080,1280,1920].includes(m.width)||JSON.stringify(m).length>750000)throw Error('動画構成・解像度を確認してください');
  const assets:any[]=[];let duration=0;
  m.scenes.forEach((s:any,i:number)=>{if(!Number.isFinite(s.duration)||s.duration<=0||s.duration>1800||!['image','video'].includes(s.mediaType)||!Array.isArray(s.captions)||s.captions.length>2000||String(s.title||'').length>300)throw Error('場面の素材を確認してください');duration+=s.duration;for(const c of s.captions)if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<c.start||c.end>s.duration+10||String(c.text||'').length>300)throw Error('字幕の形式を確認してください');assets.push({key:'media-'+i,path:'media-'+i,mime:s.mediaType==='video'?'video/mp4':'image/jpeg'},{key:'audio-'+i,path:'audio-'+i,mime:'audio/wav'});});if(duration>7200)throw Error('動画は2時間以内にしてください');
  const id=crypto.randomUUID();assets.forEach(a=>a.path=id+'/'+a.path);await rpc({p_action:'create',p_id:id,p_user:user,p_manifest:m,p_assets:assets});
  return reply({id,uploads:await Promise.all(assets.map(async a=>({...a,url:await upload(a.path)})))});
 }
 if(worker){
  if(b.action==='claim'){if(b.id&&!/^[-a-f0-9]{36}$/.test(b.id))throw Error('Invalid job');const job=await rpc({p_action:'claim',p_id:b.id||null});if(!job)return reply({job:null});const assets=await Promise.all(job.assets.map(async(a:any)=>({...a,url:await download(a.path)})));return reply({job:{id:job.id,lease:job.lease,manifest:job.manifest,assets,outputUpload:await upload(job.id+'/video.mp4')}})}
  if(!/^[-a-f0-9]{36}$/.test(b.id||'')||!/^[-a-f0-9]{36}$/.test(b.lease||''))throw Error('Invalid worker job');const job=await rpc({p_action:b.action,p_id:b.id,p_lease:b.lease,p_progress:Number(b.progress)||0,p_error:String(b.error||'').slice(0,500)||null});if(b.action==='done'){try{await removeJobFiles(job)}catch{console.warn('Export input cleanup pending')}}return reply({status:job.status});
 }
 if(!/^[-a-f0-9]{36}$/.test(b.id||''))throw Error('Invalid job');let job=await rpc({p_action:'status',p_id:b.id,p_user:user});if(!job)return reply({error:'書き出しが見つかりません'},404);
 if(b.action==='saved'){
 if(job.status!=='done')throw Error('完成した動画だけ整理できます');
 await removeJobFiles(job,true);
 await rpc({p_action:'cancel',p_id:b.id,p_user:user});
 return reply({removed:true});
 }
 if(b.action==='status'&&job.status==='done'){try{await removeJobFiles(job)}catch{console.warn('Export input cleanup pending')}}
 if(b.action==='queue'){for(const a of job.assets){const r=await fetch(await download(a.path),{method:'GET',headers:{Range:'bytes=0-0'}});if(!r.ok)throw Error('素材の送信が完了していません。');await r.body?.cancel();}job=await rpc({p_action:'queue',p_id:b.id,p_user:user});const token=await launcherKey();if(!token)throw Error('即時起動キーを設定してください。');await dispatchExport(token,b.id);}
 else if(b.action==='cancel')job=await rpc({p_action:'cancel',p_id:b.id,p_user:user});else if(b.action!=='status')throw Error('Unknown action');
 return reply({id:job.id,status:job.status,progress:job.progress,error:job.error,launchMode:'immediate',...(job.status==='done'?{url:await download(job.output_path)}:{})});
}catch(e){return reply({error:String((e as Error).message||e)},400)}});
