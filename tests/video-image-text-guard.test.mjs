import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ensureTextFreeImage,guardImageGeneration} from '../supabase/functions/video-background-jobs/image-text-guard.ts';
test('text-free result is accepted after inspection',async()=>{
 let repairs=0;const r=await ensureTextFreeImage({data:'clean'},'test','16:9',async()=>({hasText:false}),async()=>{repairs++;});assert.equal(repairs,0);assert.equal(r.textCheck.passed,true);
});
test('lettered image must be repaired and reinspected',async()=>{
 const inspected=[];const r=await ensureTextFreeImage({data:'letters'},'test','16:9',async i=>{inspected.push(i.data);return {hasText:i.data==='letters'}},async()=>({data:'clean'}));assert.deepEqual(inspected,['letters','clean']);assert.equal(r.data,'clean');assert.equal(r.textCheck.repairs,1);
});
test('persistent text and inspection failure fail closed',async()=>{
 await assert.rejects(ensureTextFreeImage({data:'letters'},'test','16:9',async()=>({hasText:true}),async()=>({data:'still letters'})),/完成扱い/);
 await assert.rejects(ensureTextFreeImage({data:'letters'},'test','16:9',async()=>{throw Error('inspection unavailable')}),/inspection unavailable/);
});
test('non-image and failed responses bypass image processing',async()=>{
 const original=new Response('failed',{status:401});const wrapped=guardImageGeneration(async()=>original);assert.equal(await wrapped(new Request('https://test',{method:'POST',headers:{Origin:'https://yuubae96-rgb.github.io','Content-Type':'application/json'},body:JSON.stringify({action:'generateImage'})})),original);
});
test('live wrapper uses OpenAI when Gemini inspection is unavailable',async()=>{
 const previousFetch=globalThis.fetch,previousDeno=globalThis.Deno;globalThis.Deno={env:{get:n=>n==='GEMINI_API_KEY'?'gemini-test':'openai-test'}};
 const calls=[];globalThis.fetch=async(url,options)=>{calls.push(url);if(url.includes('googleapis'))return Response.json({error:{message:'credits depleted'}},{status:429});return Response.json({choices:[{message:{content:'{"hasText":false,"examples":[]}'}}]});};
 try{const wrapped=guardImageGeneration(async()=>Response.json({data:'AA==',mimeType:'image/png'}));const response=await wrapped(new Request('https://test',{method:'POST',headers:{Origin:'https://yuubae96-rgb.github.io','Content-Type':'application/json'},body:JSON.stringify({action:'generateImage'})}));assert.equal(response.status,200);assert.equal((await response.json()).textCheck.passed,true);assert.ok(calls.some(u=>u.includes('api.openai.com')));}finally{globalThis.fetch=previousFetch;globalThis.Deno=previousDeno}
});
