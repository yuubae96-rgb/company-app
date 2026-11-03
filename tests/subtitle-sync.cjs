const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const sandbox={window:{makeAudio:async()=>{},subtitleAt:()=> 'fallback'},document:{addEventListener(){},createElement:()=>({style:{},append(){}}),getElementById:()=>null},console,WeakMap};vm.createContext(sandbox);vm.runInContext(fs.readFileSync('video-subtitle-sync.js','utf8'),sandbox);
const {captionCues,cueAt}=sandbox.window.subtitleSyncInternals;
let count=0;const check=(chunks,words,expected)=>{const cues=captionCues(chunks,words);assert.deepEqual(Array.from(cues,c=>c.start),expected);for(let i=1;i<cues.length;i++){assert.equal(cueAt(cues,cues[i].start-.001),chunks[i-1]);assert.equal(cueAt(cues,cues[i].start),chunks[i])}count++};
const words=Array.from('あいうえおかきく',(text,i)=>({text,start:i,end:i+.5}));check(['あい','うえ','おか','きく'],words,[0,2,4,6]);
check(['あい','うえ'],[{text:'あい',start:.5,end:1.5},{text:'うえ',start:4,end:5}],[0,4]); // hold across silence
check(['アイ。','ウエ！'],[{text:'あい',start:.5,end:1.5},{text:'うえ',start:4,end:5}],[0,4]);
check(['あい','うえ'],[{text:'あいうえ',start:1,end:5}],[0,3]); // boundary inside recognized word
check(['あい','うえ'],[{text:'あいの',start:0,end:3},{text:'うえ',start:4,end:5}],[0,4]); // ASR insertion
assert.throws(()=>captionCues(['工場の安全確認'],[{text:'まったく別の発言',start:0,end:2}]),/一致度/);count++;
assert.equal(sandbox.window.subtitleAt('',2,5,[]),'fallback');count++;
const chunks=['あい','うえ'],cues=captionCues(chunks,[{text:'あい',start:0,end:1},{text:'うえ',start:3,end:4}]);sandbox.subtitleChunks=()=>chunks;
const alignment=[{source:'audio-transcription-v1',captionKey:JSON.stringify(chunks),cues}];assert.equal(sandbox.window.subtitleAt('あいうえ',2.9,4,alignment),'あい');assert.equal(sandbox.window.subtitleAt('あいうえ',3,4,alignment),'うえ');count++;
for(const path of ['youtube-video-maker.html','youtube-video-maker-core.html']){const html=fs.readFileSync(path,'utf8');for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1],{filename:path});count++}
console.log(count+' subtitle regression checks passed');
