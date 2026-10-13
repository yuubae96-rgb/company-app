const ORIGIN='https://yuubae96-rgb.github.io';
const RULE='文字を完全に除去してください。日本語、英語、数字、年号、ラベル、見出し、文字に見える模様、吹き出し、ロゴ、方位文字を残さない。文字の領域は背景や絵の自然な続きで埋める。人物、建物、車、風景、構図、画風を保持する。説明を別の文字に置き換えない。NO TEXT, LETTERS, NUMERALS OR PSEUDO-TEXT.';
async function google(key:string,model:string,body:unknown,timeout:number){
 const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
 const d=await r.json();if(!r.ok)throw Error(d?.error?.message||'画像の文字検査・修正に失敗しました');return d;
}
async function detectGeminiText(image:any,key:string){
 const d=await google(key,'gemini-3.8-flash',{contents:[{parts:[{text:'Inspect the entire supplied image, including all small panels and background. Does it contain ANY visible lettering, readable text, Japanese/Chinese characters, English letters, words, numbers, percentages, years, labels, logos, or glyph-like pseudo-text? Ignore ordinary pictorial arrows, geometric shapes, and the invisible SynthID watermark. Return JSON only: {"hasText":true or false,"examples":["brief examples of visible lettering"]}. If unsure about visible glyphs, return true.'},{inlineData:{mimeType:image.mimeType||'image/png',data:image.data}}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}},60000);
 const text=(d.candidates?.[0]?.content?.parts||[]).map((p:any)=>p.text||'').join('');
 const parsed=JSON.parse(text);if(typeof parsed.hasText!=='boolean')throw Error('画像の文字検査結果を確認できませんでした');return parsed;
}
export async function detectImageText(image:any,key:string){
 try{return await detectGeminiText(image,key)}catch(geminiError){
  const openaiKey=Deno.env.get('OPENAI_API_KEY');if(!openaiKey)throw geminiError;
  const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+openaiKey},body:JSON.stringify({model:'gpt-4.1-mini',temperature:0,response_format:{type:'json_object'},messages:[{role:'user',content:[{type:'text',text:'Inspect the ENTIRE image including small panels for any visible text, letters, numbers, percentages, labels, logos or pseudo-text glyphs in ANY language. Ignore ordinary pictorial arrows and geometric shapes. If uncertain about lettering, flag it. Return JSON only: {"hasText":true or false,"examples":[]}'},{type:'image_url',image_url:{url:'data:'+(image.mimeType||'image/png')+';base64,'+image.data,detail:'high'}}]}]}),signal:AbortSignal.timeout(60000)});
  const d=await r.json();if(!r.ok)throw Error('Gemini・ChatGPTとも画像の文字検査を完了できませんでした');const parsed=JSON.parse(d.choices?.[0]?.message?.content||'');if(typeof parsed.hasText!=='boolean')throw Error('画像の文字検査結果を確認できませんでした');return parsed;
 }
}
async function eraseText(image:any,key:string,aspectRatio:string){
 try{return await eraseGeminiText(image,key,aspectRatio)}catch(geminiError){
  const openaiKey=Deno.env.get('OPENAI_API_KEY');if(!openaiKey)throw geminiError;
  const bin=atob(image.data),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  const form=new FormData();form.set('model','gpt-image-2');form.set('prompt',RULE);form.set('size',aspectRatio==='9:16'?'1024x1536':'1536x1024');form.set('quality','medium');form.set('output_format','png');form.append('image[]',new Blob([bytes],{type:image.mimeType||'image/png'}),'image.png');
  const r=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:{Authorization:'Bearer '+openaiKey},body:form,signal:AbortSignal.timeout(120000)});const d=await r.json();if(!r.ok||!d.data?.[0]?.b64_json)throw Error('画像内の文字を自動で消せませんでした。この画像は完成扱いにしていません。');return {...image,data:d.data[0].b64_json,mimeType:'image/png',provider:'openai',text:''};
 }
}
async function eraseGeminiText(image:any,key:string,aspectRatio:string){
 const d=await google(key,'gemini-3.1-flash-image',{contents:[{parts:[{text:RULE},{inlineData:{mimeType:image.mimeType||'image/png',data:image.data}},{text:RULE}]}],generationConfig:{responseModalities:['IMAGE','TEXT'],imageConfig:{aspectRatio}}},120000);
 const parts=(d.candidates||[]).flatMap((c:any)=>c.content?.parts||[]),raw=parts.find((p:any)=>p.inlineData?.data||p.inline_data?.data),out=raw?.inlineData||raw?.inline_data;
 if(!out?.data)throw Error('画像から文字を消した結果を取得できませんでした');return {...image,data:out.data,mimeType:out.mimeType||out.mime_type||'image/png',provider:'gemini',text:''};
}
export async function ensureTextFreeImage(image:any,key:string,aspectRatio='16:9',detect=detectImageText,erase=eraseText){
 if(!key)throw Error('画像の文字検査用Gemini設定を確認できませんでした');
 for(let attempt=0;attempt<=1;attempt++){
  const check=await detect(image,key);
  if(!check.hasText)return {...image,textCheck:{version:'20261014-v1',passed:true,repairs:attempt}};
  if(attempt===1)throw Error('画像内の文字を検出し、自動修正後も残っていました。この画像は完成扱いにしていません。「画像を作り直す」で再試行してください。');
  image=await erase(image,key,aspectRatio);
 }
 throw Error('画像の文字検査を完了できませんでした');
}
export function guardImageGeneration(raw:(r:Request)=>Promise<Response>){return async(req:Request)=>{
 let body:any;try{if(req.method==='POST'&&req.headers.get('origin')===ORIGIN)body=await req.clone().json()}catch{}
 const response=await raw(req);if(body?.action!=='generateImage'||!response.ok)return response;
 try{const image=await response.json();if(!image?.data)throw Error('生成画像を検査できませんでした');const checked=await ensureTextFreeImage(image,Deno.env.get('GEMINI_API_KEY')||'',body.aspectRatio==='9:16'?'9:16':'16:9');return new Response(JSON.stringify(checked),{status:200,headers:response.headers});}
 catch(e){return new Response(JSON.stringify({error:String((e as Error).message||e)}),{status:502,headers:response.headers});}
};}
