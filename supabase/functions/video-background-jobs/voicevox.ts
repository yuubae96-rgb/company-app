function splitVoicevoxText(text:string,limit:number){
 const chars=[...String(text||'').trim()],parts=[];
 for(let offset=0;offset<chars.length;){
  let end=Math.min(offset+limit,chars.length);
  if(end<chars.length){
   for(let i=end-1;i>=offset+Math.floor(limit/2);i--){
    if(/[。！？!?、\n]/u.test(chars[i])){end=i+1;break}
   }
  }
  const part=chars.slice(offset,end).join('').trim();
  if(part)parts.push(part);
  offset=end;
 }
 return parts;
}
async function synthesizePart(text:string,speaker:number,deadline:number,fetcher:typeof fetch,pause:(ms:number)=>Promise<unknown>,preferWav:boolean){
 async function json(url:string,options:any={}){
  const r=await fetcher(url,{...options,signal:AbortSignal.timeout(20000)});
  if(r.status===413)throw Object.assign(Error('VOICEVOX HTTP 413：文章が長すぎます'),{permanent:true,tooLong:true});
  let d:any;try{d=await r.json()}catch{throw Error('VOICEVOXの応答を読み取れませんでした（HTTP '+r.status+'）');}
  if(!r.ok&&r.status!==429)throw Error('VOICEVOX通信エラー（HTTP '+r.status+'）');
  return d;
 }
 let job:any,last='VOICEVOXが混雑しています';
 for(let attempt=0;attempt<4;attempt++){
  try{
   job=await json('https://api.tts.quest/v3/voicevox/synthesis',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({text,speaker:String(speaker)})});
   if(job.success)break;
   const detail=job.error?.message||job.error||job.message||'外部サービスが生成を受け付けませんでした';
   last=typeof detail==='string'?detail:JSON.stringify(detail);
   if(/textRequired|textTooLong|invalidSpeaker|invalidText/i.test(last))throw Object.assign(Error(last),{permanent:true,tooLong:/textTooLong/i.test(last)});
  }catch(e){if((e as any).permanent)throw e;last=String((e as Error).message);}
  const retryAfter=Number(job?.retryAfter||0);job=null;
  if(attempt<3)await pause(Math.min(15000,Math.max(3000,retryAfter*1000,3000*(attempt+1))));
 }
 if(!job?.success)throw Error('VOICEVOXの受付に失敗しました：'+last+'（自動再試行済み）');
 if(!job.audioStatusUrl)throw Error('VOICEVOXの処理状況URLがありません');
 let failures=0;
 while(Date.now()<deadline){
  let status:any;
  try{status=await json(job.audioStatusUrl,{cache:'no-store'});failures=0}
  catch(e){if(++failures>=3)throw e;await pause(2000);continue}
  if(status.isAudioError)throw Error('外部VOICEVOXサービスが音声合成に失敗しました');
  if(status.isAudioReady){
   const url=preferWav?job.wavDownloadUrl:job.mp3DownloadUrl||job.wavDownloadUrl;if(!url)throw Error('完成音声のURLがありません');
   const r=await fetcher(url,{signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('完成音声の取得に失敗しました（HTTP '+r.status+'）');
   const bytes=new Uint8Array(await r.arrayBuffer());if(!bytes.length)throw Error('完成音声が空でした');
   return {bytes,mimeType:preferWav?'audio/wav':r.headers.get('content-type')||(job.mp3DownloadUrl?'audio/mpeg':'audio/wav')};
  }
  await pause(1500);
 }
 throw Error('VOICEVOXの生成待ちが180秒を超えました。時間を置いて再試行してください');
}

function joinWav(parts:Uint8Array[]){
 const samples:Uint8Array[]=[];
 let format:Uint8Array|undefined;
 for(const bytes of parts){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<12||view.getUint32(0)!==0x52494646||view.getUint32(8)!==0x57415645)throw Error('VOICEVOXのWAV形式が不正です');
  let partFormat:Uint8Array|undefined,partSamples:Uint8Array|undefined;
  for(let offset=12;offset+8<=bytes.length;){
   const size=view.getUint32(offset+4,true),end=offset+8+size;
   if(end>bytes.length)throw Error('VOICEVOXのWAVが途中で切れています');
   const id=view.getUint32(offset);
   if(id===0x666d7420)partFormat=bytes.subarray(offset+8,end);
   if(id===0x64617461)partSamples=bytes.subarray(offset+8,end);
   offset=end+(size%2);
  }
  if(!partFormat||partFormat.length!==16||partFormat[0]!==1||partFormat[1]!==0||!partSamples?.length)throw Error('VOICEVOXのPCM音声を読み込めません');
  format ??= partFormat;
  if(!partFormat.every((value,i)=>value===format![i]))throw Error('VOICEVOXの分割音声で形式が一致しません');
  samples.push(partSamples);
 }
 const length=samples.reduce((total,part)=>total+part.length,0);
 const bytes=new Uint8Array(44+length+(length%2)),view=new DataView(bytes.buffer);
 view.setUint32(0,0x52494646);
 view.setUint32(4,bytes.length-8,true);
 view.setUint32(8,0x57415645);
 view.setUint32(12,0x666d7420);
 view.setUint32(16,16,true);
 bytes.set(format!,20);
 view.setUint32(36,0x64617461);
 view.setUint32(40,length,true);
 let offset=44;
 for(const part of samples){bytes.set(part,offset);offset+=part.length}
 return bytes;
}

export async function voicevox(b:any,fetcher:typeof fetch=fetch,pause=(ms:number)=>new Promise(r=>setTimeout(r,ms))){
 const parts=splitVoicevoxText(b.text,120),speaker=Number(b.speaker??13);
 if(!parts.length)throw Error('読み上げる文章を入力してください');
 if(!Number.isInteger(speaker)||speaker<0)throw Error('VOICEVOXの話者指定が不正です');
 const deadline=Date.now()+180000;
 const audio:Awaited<ReturnType<typeof synthesizePart>>[]=[];
 async function append(text:string,preferWav:boolean){
  try{audio.push(await synthesizePart(text,speaker,deadline,fetcher,pause,preferWav))}
  catch(e){
   if(!(e as {tooLong?:boolean}).tooLong||[...text].length<2)throw e;
   for(const part of splitVoicevoxText(text,Math.ceil([...text].length/2)))await append(part,true);
  }
 }
 for(const part of parts)await append(part,parts.length>1);
 const bytes=audio.length===1?audio[0].bytes:joinWav(audio.map(part=>part.bytes));
 let encoded='';
 for(let i=0;i<bytes.length;i+=32768)encoded+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return {data:btoa(encoded),mimeType:audio.length===1?audio[0].mimeType:'audio/wav',provider:'voicevox',alignment:[]};
}
