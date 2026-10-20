const {readFileSync}=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=readFileSync(require('path').join(__dirname,'../youtube-character-animation.js'),'utf8');
function setup(fail=false){
 const el=()=>({style:{},dataset:{},value:'',getAttribute(){return this.src||''},insertAdjacentElement(){}});
 const nodes={makeAllFromTopic:el(),characterAnimationMode:{checked:true},topic:{value:'ライト兄弟'},protagonistRefPreview:el(),protagonistRefState:el(),status:el(),pic0:el(),pic1:el()};
 const scenes=[0,1].map(i=>({dataset:{animatedExplainer:'old'},querySelector:s=>s==='.nar'?{value:'兄弟が実験する'}:el()}));let calls=[];
 const w={api:async b=>{calls.push(b);if(fail)throw Error('生成失敗');return {mimeType:'image/png',data:'YWJj'}},setSceneImage:(i,src)=>nodes['pic'+i].dataset.image=src,updateExportReadiness(){}};
 const d={getElementById:id=>nodes[id],createElement:el,querySelector:()=>scenes[0],querySelectorAll:()=>scenes};
 vm.runInNewContext(source,{window:w,document:d,Error});return {w,nodes,scenes,calls};
}
(async()=>{
 const {w,nodes,scenes,calls}=setup();
 await Promise.all([w.ensureStoryCharacters(),w.ensureStoryCharacters()]);assert.equal(calls.length,1,'concurrent calls share one cast generation');
 await w.buildCharacterStory();assert.equal(calls.length,3);assert.match(calls[0].prompt,/ライト兄弟/);
 for(const call of calls.slice(1)){assert.equal(call.protagonistReference,nodes.protagonistRefPreview.src);assert.equal(call.style,'教科書図解風');assert.match(call.prompt,/2D/)}
 assert.equal(scenes[0].dataset.animatedExplainer,undefined);await w.buildCharacterStory();assert.equal(calls.length,3,'reuse completed illustrated scenes');
 nodes.characterAnimationMode.checked=false;assert.deepEqual(w.characterIllustrationRequest({prompt:'original'}),{prompt:'original'});
 const bad=setup(true);await assert.rejects(bad.w.ensureStoryCharacters(),/生成失敗/);assert.equal(bad.nodes.protagonistRefPreview.src,undefined);await assert.rejects(bad.w.ensureStoryCharacters(),/生成失敗/);assert.equal(bad.calls.length,2,'failure can retry');
 console.log('PASS shared cast reference, distinct scenes, retry, reuse, opt out');
})().catch(e=>{console.error(e);process.exit(1)});
