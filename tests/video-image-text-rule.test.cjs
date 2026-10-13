const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const core=fs.readFileSync(path.join(__dirname,'../youtube-video-maker-core.html'),'utf8');
const ctx=vm.createContext({});
vm.runInContext(core.slice(core.indexOf('const IMAGE_NO_TEXT_RULE='),core.indexOf('async function api')),ctx);
test('image requests prohibit readable and pseudo text, including metadata and references',()=>{
 ctx.request={action:'generateImage',prompt:'1972年開業、400人収容の建物の図解。見出しを入れる。',imageProvider:'gemini'};
 const result=vm.runInContext('japaneseImageRequest(request)',ctx);
 assert.match(result.prompt,/文字に見える模様/);assert.match(result.prompt,/数字、年号/);assert.match(result.prompt,/参考画像に文字があっても写さない/);
 assert.match(result.prompt,/背景情報であり、画像に書く文字ではありません/);
 assert.match(result.prompt,/この文字なし指定を優先/);
 assert.equal(result.imageProvider,'gemini');
 ctx.request=result;assert.equal(vm.runInContext('japaneseImageRequest(request).prompt',ctx),result.prompt);
 assert.ok(!result.prompt.includes('すべて日本語（漢字・ひらがな・カタカナ）で描いてください'));
});
test('non-image requests remain unchanged',()=>{
 ctx.request={action:'generateTts',text:'「室戸市」の説明。'};
 assert.equal(vm.runInContext('japaneseImageRequest(request)',ctx),ctx.request);
});
test('background and direct generation use the same text rule',()=>{
 const background=fs.readFileSync(path.join(__dirname,'../video-background-jobs.js'),'utf8');
 assert.match(background,/return japaneseImageRequest\(\{action:'generateImage'/);
 assert.match(core,/async function api\(body,attempt=0\)\{body=japaneseImageRequest\(body\)/);
});
