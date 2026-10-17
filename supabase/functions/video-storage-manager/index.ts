const BASE=Deno.env.get('SUPABASE_URL')!, KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ORIGIN='https://yuubae96-rgb.github.io';
const BUCKETS=['video-exports','video-background-media'];
const HEADERS={'Content-Type':'application/json','Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,content-type,apikey,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:HEADERS});
async function service(path:string,body?:unknown,method?:string){
 const r=await fetch(BASE+path,{method:method||(body===undefined?'GET':'POST'),headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('保存データを確認できませんでした。再読み込みしてください。');
 return r.json();
}
async function authorize(req:Request){
 if(req.headers.get('origin')!==ORIGIN)throw Error('Forbidden');
 const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(!token||token===KEY)throw Error('ログインしてください。');
 const r=await fetch(BASE+'/auth/v1/user',{headers:{apikey:KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('ログインし直してください。');
 const u=await r.json();if(!u.id||!u.email_confirmed_at||u.is_anonymous)throw Error('利用権限がありません。');
 const p=await service('/rest/v1/app_users?user_id=eq.'+encodeURIComponent(u.id)+'&select=role,active');
 if(!p[0]?.active||!['owner','office','manager'].includes(p[0].role))throw Error('利用権限がありません。');
 return u;
}
const itemKey=(x:any)=>x.bucket+'\0'+x.name;
async function inventory(){
 const context=await service('/rest/v1/rpc/video_storage_context',{});
 const jobs=new Map(context.map((x:any)=>[x.source+':'+x.id,x]));
 const items:any[]=[];let folders=0;
 for(const bucket of BUCKETS){
  const queue=[''];
  while(queue.length){
   const prefix=queue.shift()!;if(++folders>10000)throw Error('保存件数が多いため一覧を取得できません。');
   for(let offset=0;;offset+=1000){
    const page=await service('/storage/v1/object/list/'+bucket,{prefix,offset,limit:1000,sortBy:{column:'name',order:'asc'}});
    if(!Array.isArray(page))throw Error('保存データの一覧を確認できません。');
    for(const o of page){
     const name=prefix?prefix+'/'+o.name:o.name;
     if(!o.id){queue.push(name);continue;}
     const jobId=name.split('/')[0],source=bucket==='video-exports'?'export':'background';
     const job:any=jobs.get(source+':'+jobId);
     const mime=String(o.metadata?.mimetype||'');
     const kind=mime.startsWith('video/')?'video':mime.startsWith('image/')?'image':mime.startsWith('audio/')?'audio':'other';
     const match=name.match(/\/(?:media|audio)-(\d+)$/),scene=match?Number(match[1]):null;
     const sceneTitle=scene!==null?job?.scenes?.[scene]?.title:'';
     items.push({bucket,name,id:o.id,updatedAt:o.updated_at||o.created_at,createdAt:o.created_at,bytes:Number(o.metadata?.size)||0,mime,kind,title:job?.title||(source==='export'?'動画書き出し':'画像・音声生成'),detail:sceneTitle|| (scene!==null?'シーン '+(scene+1):kind==='video'?'完成動画':'生成素材'),active:job?.active??true});
     if(items.length>10000)throw Error('保存件数が多いため一覧を取得できません。');
    }
    if(page.length<1000)break;
   }
  }
 }
 return items.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
function validateSelection(selected:any[],items:any[]){
 if(!Array.isArray(selected)||!selected.length||selected.length>200)throw Error('1回に1〜200件を選んでください。');
 const current=new Map(items.map(x=>[itemKey(x),x])),seen=new Set();
 return selected.map(s=>{
  if(!BUCKETS.includes(s?.bucket)||typeof s.name!=='string'||s.name.includes('..'))throw Error('削除対象が不正です。');
  const k=itemKey(s),x=current.get(k);if(seen.has(k))throw Error('削除対象が重複しています。');seen.add(k);
  if(!x||x.id!==s.id||x.updatedAt!==s.updatedAt)throw Error('データが変わりました。一覧を更新して選び直してください。');
  if(x.active)throw Error('生成中、または状態を確認できないデータは削除できません。');
  return x;
 });
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:HEADERS});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{await authorize(req);}catch(e){return reply({error:(e as Error).message},403);}
 try{
  const b=await req.json();if(!['list','delete','preview'].includes(b.action))return reply({error:'Unknown action'},400);
  const items=await inventory();
  if(b.action==='list')return reply({items,totalBytes:items.reduce((s,x)=>s+x.bytes,0)});
  if(b.action==='preview'){
   const [x]=validateSelection([b.item],items);
   const path=x.name.split('/').map(encodeURIComponent).join('/');
   const d=await service('/storage/v1/object/sign/'+x.bucket+'/'+path,{expiresIn:300});
   return reply({url:BASE+'/storage/v1'+d.signedURL});
  }
  const selected=validateSelection(b.items,items);let deleted=0,freedBytes=0;
  for(const bucket of BUCKETS){const files=selected.filter(x=>x.bucket===bucket);if(!files.length)continue;
   try{await service('/storage/v1/object/'+bucket,{prefixes:files.map(x=>x.name)},'DELETE');deleted+=files.length;freedBytes+=files.reduce((s,x)=>s+x.bytes,0);}
   catch{return reply({error:'一部を削除できませんでした。一覧を更新して確認してください。',deleted,freedBytes},500);}
  }
  return reply({deleted,freedBytes});
 }catch(e){return reply({error:(e as Error).message},400);}
});
