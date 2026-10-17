const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/video-storage-manager/index.ts'),'utf8'));
let handler,deletes=[],active=false;
const file={name:'media-0',id:'object-a',created_at:'2026-10-17T00:00:00Z',updated_at:'2026-10-17T00:00:00Z',metadata:{size:1000,mimetype:'image/png'}};
const fetch=async(url,o={})=>{
 if(url.endsWith('/auth/v1/user'))return Response.json({id:'user',email_confirmed_at:'yes'});
 if(url.includes('/app_users?'))return Response.json([{role:'owner',active:true}]);
 if(url.endsWith('/rpc/video_storage_context'))return Response.json([{id:'job-a',source:'export',title:'安全確認',scenes:[{title:'最初の場面'}],active}]);
 if(url.includes('/object/list/')){const b=JSON.parse(o.body);return Response.json(url.endsWith('video-exports')?(b.prefix===''?[{name:'job-a',id:null}]:[file]):[])}
 if(o.method==='DELETE'){deletes.push({url,body:JSON.parse(o.body)});return Response.json([])}
 if(url.includes('/object/sign/'))return Response.json({signedURL:'/object/sign/example?token=x'});
 throw Error('Unexpected URL '+url);
};
const ctx={Deno:{env:{get:n=>n==='SUPABASE_URL'?'https://example.invalid':'service-key'},serve:f=>handler=f},fetch,Response,AbortSignal,Map,Set,encodeURIComponent,console};vm.createContext(ctx);vm.runInContext(source,ctx);
const request=(body,headers={})=>handler(new Request('https://example.invalid/function',{method:'POST',headers:{Origin:'https://yuubae96-rgb.github.io',Authorization:'Bearer user-token',...headers},body:JSON.stringify(body)}));
(async()=>{
 let r=await request({action:'list'});assert.equal(r.status,200);let d=await r.json();assert.equal(d.items.length,1);assert.equal(d.items[0].detail,'最初の場面');assert.equal(d.totalBytes,1000);const x=d.items[0];
 r=await request({action:'list'},{Origin:'https://evil.invalid'});assert.equal(r.status,403);
 r=await request({action:'delete',items:[{...x,bucket:'drawings'}]});assert.equal(r.status,400);assert.equal(deletes.length,0);
 r=await request({action:'delete',items:[{...x,id:'different'}]});assert.equal(r.status,400);assert.equal(deletes.length,0);
 active=true;r=await request({action:'delete',items:[x]});assert.equal(r.status,400);assert.equal(deletes.length,0);active=false;
 r=await request({action:'preview',item:x});assert.equal(r.status,200);assert((await r.json()).url.includes('/object/sign/'));
 r=await request({action:'delete',items:[x]});assert.equal(r.status,200);assert.deepEqual(deletes[0].body.prefixes,['job-a/media-0']);assert.equal((await r.json()).deleted,1);
 console.log('PASS: listing, details, origin check, bucket boundary, identity check, active-job guard, preview, selected deletion');
})();
