const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const background=fs.readFileSync(path.join(root,'video-background-jobs.js'),'utf8');
const core=fs.readFileSync(path.join(root,'youtube-video-maker-core.html'),'utf8');
function between(text,from,to){return text.slice(text.indexOf(from),text.indexOf(to,text.indexOf(from)))}
function harness(){
 const nar={value:'「チャールズ・リンドバーグ」です。'},reading={value:'「チャールズ・リンドバーグ」です。'};
 const audio={dataset:{subtitle:nar.value,ttsText:'チャールズリンドバーグです。'},getAttribute:()=> 'saved-audio'};
 const row={dataset:{},querySelector:q=>q==='.nar'?nar:q==='.ttsNar'?reading:null};
 const box={textContent:'',innerHTML:'',querySelectorAll:()=>[],prepend(){},scrollIntoView(){}};
 const elements={audio0:audio,exportVideo:{setAttribute(){}},exportReadiness:{textContent:''},audioState0:{textContent:''},readingResults:box,checkReadings:{},readingDictionary:{open:false}};
 const calls=[];
 const ctx=vm.createContext({rows:()=>[row],$:id=>elements[id],narrationBreaths:x=>String(x),updateExportReadiness(){},document:{querySelectorAll:q=>q==='.scene'?[row]:[],createElement:()=>({})},esc:x=>x,readingAsKatakana:x=>x,Event:class {},window:{},api:async()=>{calls.push('check');return {items:[]}},failureNotice:x=>calls.push('error'),message(){},itemsFor:()=>{calls.push('items');return []},start:async()=>{calls.push('start');return true}});
 vm.runInContext(between(background,'function speechIdentity','function imageRequest'),ctx);
 vm.runInContext(between(background,'const originalUpdateReadiness','const oldRender'),ctx);
 vm.runInContext(between(core,'async function checkReadings','function getScenesReady').split('function subtitleChunks')[0].split('function updateExportReadiness')[0],ctx);
 // Only the preflight declarations are needed after the original check function.
 return {ctx,row,nar,reading,audio,calls,elements};
}
test('regenerated speech with ignored punctuation is current; real reading edits are stale',()=>{
 const h=harness();vm.runInContext('updateExportReadiness()',h.ctx);assert.equal(h.row.dataset.audioOutdated,'');
 h.reading.value='チャールズリンドバーグでした。';vm.runInContext('updateExportReadiness()',h.ctx);assert.equal(h.row.dataset.audioOutdated,'1');
 h.audio.dataset.ttsText=h.reading.value;vm.runInContext('updateExportReadiness()',h.ctx);assert.equal(h.row.dataset.audioOutdated,'');
 h.nar.value='変更した字幕';vm.runInContext('updateExportReadiness()',h.ctx);assert.equal(h.row.dataset.audioOutdated,'1');
});
test('bulk requests await a shared check and recheck changed narration',async()=>{
 const h=harness();vm.runInContext(between(background,'let readingPreflight','function bindButtons'),h.ctx);
 await Promise.all([vm.runInContext("launchGeneration(['image'])",h.ctx),vm.runInContext("launchGeneration(['audio'])",h.ctx)]);
 assert.deepEqual(h.calls,['check','items','start','items','start']);
 h.nar.value+='変更';await vm.runInContext("launchGeneration(['audio'])",h.ctx);assert.equal(h.calls.filter(x=>x==='check').length,2);
});
test('candidates pause all generation until reviewed; failed check cannot launch',async()=>{
 const h=harness();h.ctx.api=async()=>({items:[{term:'室戸市',reading:'ムロトシ'}]});
 vm.runInContext(between(background,'let readingPreflight','function bindButtons'),h.ctx);
 assert.equal(await vm.runInContext("launchGeneration(['image','audio'])",h.ctx),false);assert.ok(!h.calls.includes('start'));assert.equal(h.elements.readingDictionary.open,true);
 assert.equal(await vm.runInContext("launchGeneration(['image','audio'])",h.ctx),true);
 h.nar.value+='変更';h.ctx.api=async()=>{throw Error('offline')};h.calls.length=0;
 assert.equal(await vm.runInContext("launchGeneration(['audio'])",h.ctx),false);assert.ok(!h.calls.includes('start'));
});
test('an edit while AI checks is rejected rather than certifying unchecked narration',async()=>{
 const h=harness();h.ctx.api=async()=>{h.nar.value='チェック中の変更';return {items:[]}};
 assert.equal(await vm.runInContext('ensureVideoReadingsChecked()',h.ctx),false);
 assert.match(h.elements.readingResults.textContent,/確認中に原稿が変更/);
});
