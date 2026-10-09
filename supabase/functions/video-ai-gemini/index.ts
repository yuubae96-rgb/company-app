import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const ALLOWED_ORIGINS=new Set(["https://yuubae96-rgb.github.io"]);
function cors(req:Request){const origin=req.headers.get("origin")||"";return{"Access-Control-Allow-Origin":ALLOWED_ORIGINS.has(origin)?origin:"","Access-Control-Allow-Headers":"content-type, x-video-upload-url","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"}}
const json=(data:unknown,status:number,headers:Record<string,string>)=>new Response(JSON.stringify(data),{status,headers:{...headers,"Content-Type":"application/json"}});
function interactionText(data:any){const out:string[]=[];for(const s of data?.steps||[])if(s?.type==="model_output")for(const i of s?.content||[])if(i?.type==="text"&&i?.text)out.push(i.text);return out.join("\n\n")}
const STYLE_LOCK=`MASTER VISUAL STYLE FOR EVERY SCENE: cinematic full-color historical documentary illustration, realistic Japanese graphic-novel rendering, sophisticated muted color palette, consistent ink linework, consistent filmic lighting, consistent character proportions, detailed but clean composition matching the requested aspect ratio. ABSOLUTELY NO TEXT OR LETTERING ANYWHERE IN THE IMAGE: no captions, no speech bubbles, no manga sound effects, no Japanese/Chinese/English characters, no labels, no signs, no readable documents, no watermarks, no logos, no borders, no comic panels. Any paper, map, newspaper, banner or sign must be blank or contain only non-readable abstract marks. Do not switch to monochrome, black-and-white, sepia, anime, watercolor, photo, or another art style.`;
function visualStyleLock(style:string){
const treatments:Record<string,string>={
"実写風":"PHOTOREALISTIC LIVE-ACTION LOOK: a believable documentary photograph or live-action film still. Natural skin, real material textures, physically plausible lighting, photographic depth of field. No illustration, ink outlines, manga, anime, watercolor, drawing, or 3D-render look.",
"ドキュメンタリー風":"Photorealistic documentary photography with natural light, authentic locations and restrained colors. No illustration or manga.",
"手描き図解・歴史解説風":"Hand-drawn educational watercolor and colored-pencil illustration on warm off-white paper, navy contours, warm accents and organized scene composition. No photography or 3D rendering.",
"教科書図解風":"Clean textbook educational illustration, organized visual explanation and simple shapes. No photography or cinematic graphic-novel treatment.",
"リアルな歴史画":"Realistic full-color historical painting, painterly surface and historically grounded detail. This is a painting, not a photograph.",
"歴史漫画・YouTube解説風":"Full-color historical graphic-novel illustration, consistent ink outlines and detailed cinematic lighting. One frame only; no comic panels. No photography."
};
const treatment=treatments[style];if(!treatment)return STYLE_LOCK;
return `MASTER VISUAL STYLE FOR EVERY SCENE: ${treatment} The selected visual style takes precedence over any older style instructions inside SCENE CONTENT or a conflicting style reference. Preserve the scene subject and factual context while rendering it in this selected style. ABSOLUTELY NO READABLE TEXT, captions, lettering, logos, watermarks, borders or comic panels. Paper, maps and signs contain only non-readable abstract marks. Keep this same visual treatment across scenes.`;
}
const LIKENESS_RULE=`HISTORICAL PERSON LIKENESS: when a named real historical person appears, make that person visually recognizable from well-known surviving portraits or photographs when such sources exist. Match age for the depicted year, face shape, hairstyle, facial hair, build and period clothing. Do not render a random generic samurai or politician.`;
const CHARACTER_LOCK_RULE=`CHARACTER IDENTITY LOCK: A protagonist reference image is supplied. ONLY when the scene content calls for that protagonist, preserve the same identity: face shape, eyes, nose, mouth, hairline, hairstyle, facial hair, build and recognizable overall appearance. If the scene is in the same life stage, keep the apparent age essentially unchanged. Only age the protagonist when the scene clearly moves to a substantially different life stage. Clothing, pose, expression, camera angle, lighting and background may change. If the protagonist is not part of the scene content, DO NOT insert that person just because a reference image was supplied.`;
const STYLE_REFERENCE_RULE=`STYLE REFERENCE LOCK: A separate visual-style reference image may be supplied. Use it only for visual treatment such as color palette, contrast, line quality, lighting, texture, level of realism and overall mood. Do NOT copy the people, faces, poses, objects, scenery, text or exact composition from the style reference.`;
function parseDataUrl(s:string){const m=s.match(/^data:([^;]+);base64,(.+)$/s);return m?{mimeType:m[1],data:m[2]}:null}
function b64url(input:Uint8Array|string){const bytes=typeof input==="string"?new TextEncoder().encode(input):input;let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function pemToBytes(pem:string){const b64=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");const bin=atob(b64);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
async function googleAccessToken(){const raw=Deno.env.get("GOOGLE_TTS_SERVICE_ACCOUNT");if(!raw)throw new Error("GOOGLE_TTS_SERVICE_ACCOUNT is not configured");let sa:any;try{sa=JSON.parse(raw)}catch{throw new Error("GOOGLE_TTS_SERVICE_ACCOUNT is not valid JSON")};if(!sa?.client_email||!sa?.private_key)throw new Error("Google service account JSON is incomplete");const now=Math.floor(Date.now()/1000);const h=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));const p=b64url(JSON.stringify({iss:sa.client_email,scope:"https://www.googleapis.com/auth/cloud-platform",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));const k=await crypto.subtle.importKey("pkcs8",pemToBytes(sa.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);const sig=new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",k,new TextEncoder().encode(`${h}.${p}`)));const assertion=`${h}.${p}.${b64url(sig)}`;const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});const d=await r.json();if(!r.ok||!d?.access_token)throw new Error(d?.error_description||d?.error||`Google OAuth failed ${r.status}`);return d.access_token as string}
function wavToRawPcmBase64(b64:string){const bin=atob(b64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);if(bytes.length<12||String.fromCharCode(...bytes.subarray(0,4))!=="RIFF")return b64;const dv=new DataView(bytes.buffer);let off=12;while(off+8<=bytes.length){const id=String.fromCharCode(...bytes.subarray(off,off+4));const size=dv.getUint32(off+4,true);if(id==="data"){const raw=bytes.subarray(off+8,Math.min(bytes.length,off+8+size));let s="";for(let i=0;i<raw.length;i+=0x8000)s+=String.fromCharCode(...raw.subarray(i,i+0x8000));return btoa(s)}off+=8+size+(size%2)}return b64}
function prependSilenceToRawPcmBase64(b64:string,sampleRate=24000,channels=1,ms=900){const bin=atob(b64),raw=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)raw[i]=bin.charCodeAt(i);const silenceBytes=Math.round(sampleRate*channels*2*ms/1000);const out=new Uint8Array(silenceBytes+raw.length);out.set(raw,silenceBytes);let s="";for(let i=0;i<out.length;i+=0x8000)s+=String.fromCharCode(...out.subarray(i,i+0x8000));return btoa(s)}
securityServe(async(req:Request)=>{const headers=cors(req);if(req.method==="OPTIONS")return new Response("ok",{headers});const origin=req.headers.get("origin")||"";if(!ALLOWED_ORIGINS.has(origin))return json({error:"Forbidden origin"},403,headers);if(req.method!=="POST")return json({error:"Method not allowed"},405,headers);const key=Deno.env.get("GEMINI_API_KEY")||"";
try{const uploadUrl=req.headers.get("x-video-upload-url");if(uploadUrl){const u=new URL(uploadUrl);if(u.protocol!=="https:"||u.hostname!=="generativelanguage.googleapis.com")throw new Error("Invalid upload URL");const r=await fetch(uploadUrl,{method:"POST",headers:{"X-Goog-Upload-Offset":"0","X-Goog-Upload-Command":"upload, finalize","Content-Type":req.headers.get("content-type")||"application/octet-stream"},body:req.body});const text=await r.text();if(!r.ok)throw new Error(text||`Upload failed ${r.status}`);return new Response(text,{headers:{...headers,"Content-Type":"application/json"}})}
const body=await req.json();const action=String(body.action||"");const model=String(body.model||"gemini-3.6-flash");
if(action==="startUpload"){const size=Number(body.size||0),mime=String(body.mime||"video/mp4"),name=String(body.name||"video");if(!size||size>2*1024*1024*1024)throw new Error("Invalid file size");const r=await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files",{method:"POST",headers:{"x-goog-api-key":key,"X-Goog-Upload-Protocol":"resumable","X-Goog-Upload-Command":"start","X-Goog-Upload-Header-Content-Length":String(size),"X-Goog-Upload-Header-Content-Type":mime,"Content-Type":"application/json"},body:JSON.stringify({file:{display_name:name}})});if(!r.ok)throw new Error((await r.text())||`Upload start failed ${r.status}`);const url=r.headers.get("x-goog-upload-url");if(!url)throw new Error("Upload URL not returned");return json({uploadUrl:url},200,headers)}
if(action==="fileStatus"){const fileName=String(body.fileName||"");if(!/^files\/[A-Za-z0-9_-]+$/.test(fileName))throw new Error("Invalid file name");const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`,{headers:{"x-goog-api-key":key}});const data=await r.json();if(!r.ok)throw new Error(data?.error?.message||`File status failed ${r.status}`);return json(data,200,headers)}
if(action==="analyze"){const fileUri=String(body.fileUri||""),mime=String(body.mime||"video/mp4"),prompt=String(body.prompt||"").slice(0,20000);if(!fileUri.startsWith("https://generativelanguage.googleapis.com/"))throw new Error("Invalid file URI");if(!prompt)throw new Error("Prompt is required");const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{parts:[{file_data:{mime_type:mime,file_uri:fileUri}},{text:prompt}]}],generationConfig:{temperature:.25}})});const data=await r.json();if(!r.ok)throw new Error(data?.error?.message||`Analyze failed ${r.status}`);return json(data,200,headers)}

if(action==="generateSceneTitles"){
const scenes=Array.isArray(body.scenes)?body.scenes:[];if(!scenes.length||scenes.length>60)throw new Error("場面数は1〜60件にしてください");
const input=scenes.map((s:any,i:number)=>({id:i,text:String(s.text||"").trim().slice(0,12000)}));if(input.some((s:any)=>!s.text)||input.reduce((n:number,s:any)=>n+s.text.length,0)>120000)throw new Error("場面の文章を確認してください");
const prompt=`あなたは短く鋭い日本語の見出しを作る編集者。各場面の全文と全体の文脈を読み、その場面が一番伝えたい「結論・意外性・核心」を一撃で表す見出しを作る。冒頭の文の切り取りや主語だけは禁止。「〜について」「〜とは」「〜は」で終わる未完の見出しは禁止。一般的な「〜の紹介」「〜の背景」「〜の重要性」に逃げない。具体的な対比、数字、因果関係、転換点を優先。目安6〜16文字、最大24文字。事実を足さず煽りすぎない。本文は書き換えない。
例：NFLの説明から始まり、試合3時間のうち実際にボールが動くのが18分なのに大人気という場面→「動くのは、たった18分」「18分が生む熱狂」。父娘の経営方針の対立が決裂へ至る場面→「父娘対立、ついに決裂」。販売数が増えたのに利益が減る場面→「売るほど利益が消える」。例を別の話へ流用せず、必ず各本文の核心を判断する。
有効なJSONだけ。形式 {"titles":[{"id":0,"title":"核心を言い切る見出し"}]}。入力全件のidを一度ずつ同じ順序で返す。
入力：${JSON.stringify(input)}`;

let out="";
const openaiKey=Deno.env.get("OPENAI_API_KEY");
if(openaiKey){
const r=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${openaiKey}`},body:JSON.stringify({model:"gpt-4.1-mini",messages:[{role:"user",content:prompt}],temperature:.35,response_format:{type:"json_object"}})});
const data=await r.json();if(r.ok)out=data?.choices?.[0]?.message?.content||"";
}
if(!out){
const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.35,responseMimeType:"application/json"}})});
const data=await r.json();if(!r.ok)throw new Error(data?.error?.message||"見出し生成に失敗しました");out=(data?.candidates?.[0]?.content?.parts||[]).map((p:any)=>p?.text||"").join("");
}
const parsed=JSON.parse(out.trim().replace(/^```json\s*/i,"").replace(/```$/,"").trim());
if(!Array.isArray(parsed.titles)||parsed.titles.length!==input.length)throw new Error("見出しの件数が一致しません");
const titles=input.map((s:any)=>{const matches=parsed.titles.filter((x:any)=>x.id===s.id);const title=String(matches[0]?.title||"").trim();if(matches.length!==1||!title||[...title].length>24||/^SCENE\s*\d+$/i.test(title))throw new Error("見出しの形式を確認できませんでした");return{id:s.id,title}});
return json({titles},200,headers)}

if(action==="generateScript"){const topic=String(body.topic||"").trim().slice(0,300),extra=String(body.extra||"").slice(0,2000),urls=(Array.isArray(body.referenceUrls)?body.referenceUrls:[]).map((x:any)=>String(x).trim()).filter((x:string)=>/^https?:\/\//i.test(x)).slice(0,5),minutes=Math.min(10,Math.max(1,Number(body.minutes||1))),aspectRatio=String(body.aspectRatio)==="9:16"?"9:16":"16:9";if(!topic&&!urls.length)throw new Error("テーマまたは参考URLを入力してください。");const sceneCount=minutes<=1?6:minutes<=3?10:minutes<=5?14:18;const formatInstruction=aspectRatio==="9:16"?"YouTubeショート用の9:16縦動画。人物・重要物は中央寄りに置き、上下方向を活かす縦構図を前提に画像指示を書く。":"YouTube通常用16:9横動画。";const prompt=`あなたは日本語YouTubeドキュメンタリーの構成編集者です。テーマ「${topic||"参考資料を中心に決める"}」について、約${minutes}分、全${sceneCount}シーンで、史実に配慮した自然につながる動画構成を作ってください。${formatInstruction} 追加指示: ${extra||"なし"}。参考URLは事実把握のために使い、文章を丸写ししない。複数資料は可能な範囲で照合し、事実と推測を分け、確証が弱いことは断定しない。必ず有効なJSONだけを返してください。形式: {"title":"動画タイトル","summary":"短い概要","scenes":[{"title":"短い日本語のシーン名","narration":"日本語ナレーション","imagePrompt":"そのシーンに画像として写す内容だけを、日本語で具体的に記述。人物名、年代、場所、服装、建物、道具、行動、カメラ構図などを含める。画風の指定や画像内文字の指定はしない","factCheck":"日本語の史実メモ"}]}。ナレーション、factCheck、imagePromptは必ず日本語。シーン2以降は前の場面から自然につながる文章にする。実在人物が登場する場合はimagePromptにフルネームとその場面時点のおおよその年代・年齢を入れ、史料上知られる肖像・写真がある場合のみそれに沿った外見を指示する。全シーンは同じ一本の動画として視覚的な一貫性を保つ。画像内の文字、字幕、吹き出し、ラベル、判読できる地図・文書、漫画コマは要求しない。【動画全体の締め・必須】最後のSCENEのナレーションは、本文の内容に沿った結論や気づきを一文で回収し、その最後の一文を必ず「〜なのです。」または「〜のです。」で終える。名詞なら「なのです」、動詞・形容詞なら文法に合う「のです」を選び、機械的に語尾だけを付け足さず自然な日本語にする。例えば「小さな改善の積み重ねが、確実な仕事を支えるのです。」。この例の内容を別テーマへ流用しない。新しい未確認の事実や唐突な話題、次回予告を最後に加えない。ttsNarrationを返す場合も、読み方だけを変え同じ結論・語尾を保つ。これは動画全体の最後だけに適用し、途中のSCENEを毎回この語尾にそろえない。`;const input:any[]=[{type:"text",text:prompt}];for(const u of urls){if(/(?:youtube\.com|youtu\.be)/i.test(u))input.push({type:"video",uri:u});else input.push({type:"text",text:`参考Webページ: ${u}`})}const payload:any={model:"gemini-3.8-flash",input};if(urls.some((u:string)=>!/(?:youtube\.com|youtu\.be)/i.test(u)))payload.tools=[{type:"url_context"}];const provider=String(body.scriptProvider||"auto").toLowerCase();
if(!["auto","gemini","openai"].includes(provider))throw new Error("動画構成AIの選択が不正です");
const errors:{provider:string;message:string}[]=[];
function parseScript(text:string){let parsed:any;try{parsed=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,"").replace(/```$/i,"").trim())}catch{throw new Error("回答をJSONとして読み取れませんでした")}
if(!Array.isArray(parsed?.scenes)||!parsed.scenes.length||parsed.scenes.length>60||parsed.scenes.some((s:any)=>!s||typeof s.narration!=="string"||!s.narration.trim()))throw new Error("回答に有効なシーン・ナレーションがありません");const last=parsed.scenes[parsed.scenes.length-1];if(!/(?:なのです|のです)。$/.test(last.narration.trim())||(last.ttsNarration&&!/(?:なのです|のです)。$/.test(String(last.ttsNarration).trim())))throw new Error("最後の一文を自然な「なのです。」または「のです。」で締めたJSONを再生成してください。");return parsed}
async function requestJson(url:string,init:RequestInit,label:string,timeout:number){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{const r=await fetch(url,{...init,signal:controller.signal});let data:any;try{data=await r.json()}catch{throw new Error(`${label}: HTTP ${r.status}・回答形式が不正です`)}if(!r.ok)throw new Error(`${label}: HTTP ${r.status}・${data?.error?.message||"生成に失敗しました"}`);return data}catch(e){if((e as any)?.name==="AbortError")throw new Error(`${label}: ${timeout/1000}秒でタイムアウトしました`);throw e}finally{clearTimeout(timer)}}
for(const candidate of provider==="auto"?["gemini","openai"]:[provider]){
try{let parsed:any;
if(candidate==="gemini"){
if(!key)throw new Error("Gemini APIキーが未設定です");
const data=await requestJson("https://generativelanguage.googleapis.com/v1beta/interactions",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify(payload)},"Gemini",35000);parsed=parseScript(interactionText(data));
}else{
if(urls.length&&!topic)throw new Error("参考URLだけの作成には動画・本文を読み取れるGeminiを使用してください。Geminiで読めない場合は、参考資料の文章を手入力してください。");
const openaiKey=Deno.env.get("OPENAI_API_KEY");if(!openaiKey)throw new Error("ChatGPT APIキーが未設定です");
const referenceInstruction=urls.length?`\n参考URL一覧: ${urls.join("\n")}\nこの呼び出しではURL本文や動画を取得できません。URLの内容を読んだふりをせず、テーマと既知の事実で構成し、確認できない資料依存の事実はfactCheckに要確認と明記してください。`:"";
const data=await requestJson("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${openaiKey}`},body:JSON.stringify({model:"gpt-4.1-mini",messages:[{role:"user",content:prompt+referenceInstruction}],temperature:.4,response_format:{type:"json_object"},max_tokens:14000})},"ChatGPT",65000);parsed=parseScript(data?.choices?.[0]?.message?.content||"");
}
return json({...parsed,provider:candidate,...(errors.length?{fallbackFrom:errors[0].provider,fallbackReason:errors[0].message}:{}),...(candidate==="openai"&&urls.length?{referenceWarning:"ChatGPTでは参考URLの本文・動画を取得できないため、テーマから構成しました。資料に依存する内容は確認してください。"}:{})},200,headers);
}catch(e){errors.push({provider:candidate,message:String((e as any)?.message||e)})}
}
return json({error:errors.map(e=>`${e.provider==="openai"?"ChatGPT":"Gemini"}：${e.message}`).join(" / "),attempts:errors},502,headers)}

if(action==="checkReadings"){
const text=String(body.text||"").trim().slice(0,30000);if(!text)throw new Error("読み方チェック対象がありません");
const prompt=`次の日本語ナレーションから、読み間違えやすい人名・地名・歴史用語・固有名詞・難読語だけを抽出し、文脈に合う標準的な読みをひらがなで示してください。一般的で簡単な語は除外。必ず有効なJSONだけを返す。形式: {"items":[{"term":"表記","reading":"よみ","note":"短い確認メモ"}]}。同じ語は1回だけ。対象文:\n${text}`;
const errors:string[]=[];
for(const provider of ["gemini","openai"]){
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
try{
let url:string,init:RequestInit;
if(provider==="gemini"){
if(!key)throw new Error("Gemini APIキーが未設定です");
url="https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
init={method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.1,responseMimeType:"application/json"}})};
}else{
const openaiKey=Deno.env.get("OPENAI_API_KEY");if(!openaiKey)throw new Error("ChatGPT APIキーが未設定です");
url="https://api.openai.com/v1/chat/completions";
init={method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${openaiKey}`},body:JSON.stringify({model:"gpt-4.1-mini",messages:[{role:"user",content:prompt}],temperature:.1,response_format:{type:"json_object"}})};
}
const r=await fetch(url,{...init,signal:controller.signal}),data=await r.json();
if(!r.ok)throw new Error(data?.error?.message||`HTTP ${r.status}`);
const out=provider==="openai"?data?.choices?.[0]?.message?.content:(data?.candidates?.[0]?.content?.parts||[]).map((p:any)=>p?.text||"").join("");
const parsed=JSON.parse(String(out||"").trim().replace(/^```(?:json)?\s*/i,"").replace(/```$/,"").trim());
if(!Array.isArray(parsed?.items))throw new Error("読み方チェックの回答形式が不正です");
const seen=new Set<string>();const items=parsed.items.filter((x:any)=>typeof x?.term==="string"&&typeof x?.reading==="string"&&x.term.trim()&&x.reading.trim()&&text.includes(x.term)&&!seen.has(x.term)&&seen.add(x.term)).slice(0,100);
return json({items,provider,...(errors.length?{fallbackFrom:"gemini"}:{})},200,headers);
}catch(e){errors.push(provider+": "+((e as Error).name==="AbortError"?"タイムアウト":(e as Error).message))}finally{clearTimeout(timer)}
}
return json({items:[],provider:"dictionary",aiUnavailable:true,message:"AIを利用できないため、内蔵辞書と手入力で確認してください。"},200,headers);
}
if(action==="generateImage"){const prompt=String(body.prompt||"").trim().slice(0,36000),aspectRatio=String(body.aspectRatio)==="9:16"?"9:16":"16:9";if(!prompt)throw new Error("Image prompt is required");const continuity=typeof body.referenceImage==="string"?parseDataUrl(body.referenceImage):null;const protagonist=typeof body.protagonistReference==="string"?parseDataUrl(body.protagonistReference):null;const styleRef=typeof body.styleReference==="string"?parseDataUrl(body.styleReference):null;const identityRef=protagonist||continuity;const composition=aspectRatio==="9:16"?"OUTPUT FORMAT: vertical 9:16 portrait for YouTube Shorts. Keep the protagonist and important action inside the central safe area; use the vertical frame intentionally and avoid essential details at extreme side edges.":"OUTPUT FORMAT: horizontal 16:9 widescreen for standard YouTube.";const finalPrompt=`${visualStyleLock(String(body.style||""))}\n\n${LIKENESS_RULE}\n\n${identityRef?CHARACTER_LOCK_RULE:""}\n\n${styleRef?STYLE_REFERENCE_RULE:""}\n\n${composition}\n\nSCENE CONTENT: ${prompt}\n\nFinal check before rendering: follow the selected visual style, one frame only, historically recognizable named people, ZERO readable text or symbols.${identityRef?" Preserve protagonist identity only when that protagonist belongs in this scene.":""}${styleRef?" Match the supplied style reference for visual treatment while not copying its subject matter.":""}`;const parts:any[]=[];if(identityRef){parts.push({text:protagonist?"PROTAGONIST / CHARACTER REFERENCE IMAGE. Use for identity only when this protagonist appears in the scene.":"CONTINUITY REFERENCE IMAGE. Use only to help preserve a recurring protagonist when appropriate."});parts.push({inlineData:{mimeType:identityRef.mimeType,data:identityRef.data}})}if(styleRef){parts.push({text:"VISUAL STYLE REFERENCE IMAGE. Use only for color, lighting, texture, line quality and mood; do not copy subject matter."});parts.push({inlineData:{mimeType:styleRef.mimeType,data:styleRef.data}})}parts.push({text:finalPrompt});
const provider=String(body.imageProvider||"auto").toLowerCase();
async function openAiImage(reason:string){
const openaiKey=Deno.env.get("OPENAI_API_KEY");if(!openaiKey)throw new Error("ChatGPT画像生成のAPIキーが未設定です");
const size=aspectRatio==="9:16"?"1024x1536":"1536x1024";
let payload:BodyInit,endpoint="generations";const requestHeaders:Record<string,string>={"Authorization":`Bearer ${openaiKey}`};
if(identityRef||styleRef){
endpoint="edits";const form=new FormData();form.set("model","gpt-image-2");form.set("prompt",finalPrompt);form.set("size",size);form.set("quality","medium");form.set("output_format","png");
for(const [i,ref] of [identityRef,styleRef].filter(Boolean).entries()){
const r=ref!;const bin=atob(r.data),bytes=new Uint8Array(bin.length);for(let j=0;j<bin.length;j++)bytes[j]=bin.charCodeAt(j);
form.append("image[]",new Blob([bytes],{type:r.mimeType}),`reference-${i}.${r.mimeType==="image/jpeg"?"jpg":r.mimeType==="image/webp"?"webp":"png"}`);
}payload=form;
}else{requestHeaders["Content-Type"]="application/json";payload=JSON.stringify({model:"gpt-image-2",prompt:finalPrompt,size,quality:"medium",output_format:"png"})}
const r=await fetch(`https://api.openai.com/v1/images/${endpoint}`,{method:"POST",headers:requestHeaders,body:payload});
const data=await r.json();if(!r.ok)throw new Error(data?.error?.message||`OpenAI image generation failed ${r.status}`);
const img=data?.data?.[0];if(!img?.b64_json)throw new Error("OpenAI image data not returned");
return json({mimeType:"image/png",data:img.b64_json,provider:"openai",...(provider!=="openai"?{fallbackFrom:"gemini",fallbackReason:reason}:{}),characterLockUsed:!!identityRef,styleReferenceUsed:!!styleRef,aspectRatio},200,headers)
}
if(provider==="openai")return await openAiImage("OpenAIを指定");
const gr=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{parts}],generationConfig:{responseModalities:["TEXT","IMAGE"],imageConfig:{aspectRatio}}})});const data=await gr.json();if(!gr.ok){const reason=data?.error?.message||`Image generation failed ${gr.status}`;if(provider==="gemini"&&!/prepayment credits are depleted|insufficient (?:credits?|balance)|(?:credits?|balance) (?:are |is )?(?:depleted|exhausted)/i.test(reason))throw new Error(reason);return await openAiImage(reason)}const out=(data?.candidates||[]).flatMap((x:any)=>x?.content?.parts||[]);const img=out.find((p:any)=>p?.inlineData?.data||p?.inline_data?.data);const inline=img?.inlineData||img?.inline_data;if(!inline?.data){if(provider!=="gemini")return await openAiImage("Geminiから画像データが返りませんでした");throw new Error("Image data not returned")}return json({mimeType:inline.mimeType||inline.mime_type||"image/png",data:inline.data,text:out.map((p:any)=>p?.text||"").filter(Boolean).join("\n"),provider:"gemini",characterLockUsed:!!identityRef,styleReferenceUsed:!!styleRef,aspectRatio},200,headers)}
if(action==="generateFishTts"){const text=String(body.text||"").trim().slice(0,12000),referenceId=String(body.referenceId||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,80);if(!text)throw new Error("TTS text is required");const fishKey=Deno.env.get("FISH_API_KEY");if(!fishKey)throw new Error("Fish Audioの共通設定 FISH_API_KEY が未設定です");const payload:any={text,format:"mp3"};if(referenceId)payload.reference_id=referenceId;const r=await fetch("https://api.fish.audio/v1/tts",{method:"POST",headers:{"Authorization":`Bearer ${fishKey}`,"Content-Type":"application/json","model":"s2.1-pro-free"},body:JSON.stringify(payload)});if(!r.ok)throw new Error((await r.text())||`Fish Audio failed ${r.status}`);const bytes=new Uint8Array(await r.arrayBuffer());let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return json({mimeType:"audio/mpeg",data:btoa(s),provider:"fish-audio",referenceId:referenceId||null},200,headers)}
if(action==="generateTts"){const text=String(body.text||"").trim().slice(0,12000),voice=String(body.voice||"Kore").replace(/[^A-Za-z0-9_-]/g,"").slice(0,40);if(!text)throw new Error("TTS text is required");const allowed=new Set(["Charon","Gacrux","Sadaltager","Iapetus","Algieba","Schedar","Kore","Aoede","Sulafat","Vindemiatrix","Achernar","Puck"]);const picked=allowed.has(voice)?voice:"Kore";const accessToken=await googleAccessToken();const r=await fetch("https://texttospeech.googleapis.com/v1/text:synthesize",{method:"POST",headers:{"Authorization":`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({input:{text},voice:{languageCode:"ja-JP",name:`ja-JP-Chirp3-HD-${picked}`},audioConfig:{audioEncoding:"LINEAR16",sampleRateHertz:24000}})});const data=await r.json();if(!r.ok)throw new Error(data?.error?.message||`Cloud TTS failed ${r.status}`);if(!data?.audioContent)throw new Error("Cloud TTS audio data not returned");const raw=wavToRawPcmBase64(data.audioContent);return json({mimeType:"audio/L16;codec=pcm;rate=24000",data:prependSilenceToRawPcmBase64(raw,24000,1,900),sampleRate:24000,channels:1,provider:"google-cloud-tts",voice:`ja-JP-Chirp3-HD-${picked}`,leadingSilenceMs:900},200,headers)}
return json({error:"Unknown action"},400,headers)}catch(e){return json({error:String((e as any)?.message||e)},500,headers)}});

const SECURITY_ROLES=['owner','office','manager'];

function securityServe(handler: (req: Request, info?: any) => Response | Promise<Response>) {
 const securityHeaders = {'Access-Control-Allow-Origin':'https://yuubae96-rgb.github.io','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type, x-video-upload-url','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Cache-Control':'no-store','Vary':'Origin','Content-Type':'application/json'};
 const deny=(status:number,error:string)=>new Response(JSON.stringify({error}),{status,headers:securityHeaders});
 Deno.serve(async (req:Request, info:any) => {
  if(req.method==='OPTIONS')return new Response('ok',{headers:securityHeaders});
  try {
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

