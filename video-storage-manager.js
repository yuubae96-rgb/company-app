(()=>{
if(window.__videoStorageManager)return;window.__videoStorageManager=true;
const ENDPOINT='https://vnnvuxccazkdzwqjmntz.supabase.co/functions/v1/video-storage-manager';
const host=document.createElement('div');host.id='video-storage-manager-host';document.body.append(host);
const root=host.attachShadow({mode:'open'});
root.innerHTML=`<style>
:host{font:15px -apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif;color:#26313e}*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;border:1px solid #d6dce4;border-radius:10px;background:white;color:#26313e;padding:10px 13px;min-height:42px}button:disabled{opacity:.5;cursor:default}.open{position:fixed;right:12px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:2147483000;background:#263b50;color:white;box-shadow:0 3px 14px #0003;font-weight:700}dialog{padding:0;border:0;border-radius:16px;width:min(920px,96vw);max-height:90dvh;background:#f7f8fa;color:#26313e}dialog::backdrop{background:#15203099}.head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px;background:white;border-bottom:1px solid #e1e5ea}.head h2{font-size:19px;margin:0}.content{padding:16px;overflow:auto;max-height:calc(90dvh - 80px)}p{line-height:1.6;margin:0 0 12px}.muted{font-size:12px;color:#697483}.summary{background:white;border-radius:12px;border:1px solid #e0e5eb;padding:14px;margin-bottom:12px;font-size:17px;font-weight:700}.tools{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.tools input,.tools select{padding:9px;border:1px solid #d6dce4;border-radius:9px;background:white;min-width:0}.tools input{flex:1}.row{display:grid;grid-template-columns:28px 1fr auto;gap:10px;align-items:start;background:white;border:1px solid #e0e5eb;border-radius:12px;padding:12px;margin:8px 0}.row input{width:21px;height:21px;accent-color:#7c263f}.title{font-weight:700;overflow-wrap:anywhere}.detail{font-size:13px;margin:5px 0;overflow-wrap:anywhere}.meta{font-size:12px;color:#697483;line-height:1.6}.pill{display:inline-block;background:#eef1f5;padding:2px 7px;border-radius:5px;margin-right:6px;font-size:12px}.empty{text-align:center;padding:35px 10px;background:white;border:1px dashed #d6dce4;border-radius:12px}.delete{background:#8f243d;color:white;border:0}.status{white-space:pre-line;line-height:1.6;margin:10px 0}.footer{position:sticky;bottom:-16px;background:#f7f8fa;padding:12px 0 16px;border-top:1px solid #d6dce4}.preview{max-width:100%;max-height:50dvh;display:block;margin:10px auto}audio.preview{width:100%}@media(max-width:500px){.row{grid-template-columns:25px 1fr}.row button{grid-column:2;justify-self:start}.content{padding:12px}.open{font-size:13px}}
</style><button class="open" type="button">保存データ管理</button><dialog aria-labelledby="vsm-title"><div class="head"><h2 id="vsm-title">動画の保存データ管理</h2><button type="button" data-close>閉じる</button></div><div class="content"><p>4動画アプリ共通の、サーバーに残っている動画・画像・音声です。</p><p class="muted">iPhoneなどの端末内データは含みません。削除しても端末の保存済みデータは消えません。サーバー側は他の端末からも使えなくなり、再編集には素材の作り直しが必要になる場合があります。</p><div class="summary" aria-live="polite">まだ読み込んでいません</div><div class="tools"><input type="search" placeholder="内容で検索" aria-label="内容で検索"><select aria-label="種類"><option value="all">すべての種類</option><option value="video">完成動画</option><option value="image">画像</option><option value="audio">音声</option><option value="other">その他の素材</option></select><button type="button" data-refresh>更新</button></div><div class="tools"><button type="button" data-select>表示中を選択（最大200件）</button><button type="button" data-clear>選択を解除</button></div><div class="status" role="status" aria-live="polite"></div><div class="list"></div><div class="footer"><p class="selected">選択なし</p><button type="button" class="delete" disabled>選んだデータを削除</button></div></div></dialog><dialog class="preview-dialog"><div class="head"><strong>保存データの確認</strong><button type="button" data-preview-close>閉じる</button></div><div class="content preview-content"></div></dialog>`;
const $=s=>root.querySelector(s),dialog=$('dialog'),list=$('.list'),status=$('.status'),remove=$('.delete'),selected=new Set();
let items=[],busy=false,loaded=false;
const key=x=>x.bucket+'\0'+x.name;
const labels={video:'完成動画',image:'画像',audio:'音声',other:'その他'};
const size=n=>n<1000000?(n/1000).toFixed(1)+'KB':(n/1000000).toFixed(1)+'MB';
function setBusy(v){busy=v;root.querySelectorAll('button:not([data-close]):not([data-preview-close]),input,select').forEach(e=>e.disabled=v||e.dataset.active==='1');if(!v)updateSelection()}
async function session(){
 const queue=[window],seen=new Set();
 while(queue.length){const w=queue.shift();if(seen.has(w))continue;seen.add(w);try{if(typeof w.securityRequireSession==='function')return await w.securityRequireSession('vnnvuxccazkdzwqjmntz');for(const f of w.document.querySelectorAll('iframe'))if(f.contentWindow)queue.push(f.contentWindow)}catch{}}
 try{return JSON.parse(localStorage.getItem('sb-vnnvuxccazkdzwqjmntz-auth-token')||'null')}catch{return null}
}
async function api(action,extra={}){
 const s=await session();if(!s?.access_token)throw Error('動画アプリにログインしてから、もう一度開いてください。');
 const r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify({action,...extra}),signal:AbortSignal.timeout(60000)});
 const d=await r.json();if(!r.ok)throw Error(d.error||'処理できませんでした。');return d;
}
function visible(){const q=$('input[type=search]').value.trim().toLowerCase(),kind=$('select').value;return items.filter(x=>(kind==='all'||kind===x.kind)&&(!q||(x.title+' '+x.detail).toLowerCase().includes(q)))}
function updateSelection(){const chosen=items.filter(x=>selected.has(key(x)));$('.selected').textContent=chosen.length?chosen.length+'件を選択・'+size(chosen.reduce((s,x)=>s+x.bytes,0)):'選択なし';remove.disabled=busy||!chosen.length}
function render(){
 list.replaceChildren();const rows=visible();
 if(!rows.length){const e=document.createElement('div');e.className='empty';e.textContent=!loaded?'「更新」で保存状況を確認してください。':items.length?'条件に合うデータはありません。':'サーバーに動画・画像・音声は残っていません。';list.append(e)}
 for(const x of rows){
  const row=document.createElement('div');row.className='row';const cb=document.createElement('input');cb.type='checkbox';cb.checked=selected.has(key(x));cb.dataset.active=x.active?'1':'0';cb.disabled=busy||x.active;cb.setAttribute('aria-label',x.title+' '+labels[x.kind]+'を選択');cb.onchange=()=>{if(cb.checked&&selected.size>=200){cb.checked=false;status.textContent='1回に選べるのは200件までです。';return}cb.checked?selected.add(key(x)):selected.delete(key(x));updateSelection()};
  const body=document.createElement('div'),title=document.createElement('div'),detail=document.createElement('div'),meta=document.createElement('div'),pill=document.createElement('span');title.className='title';title.textContent=x.title;detail.className='detail';detail.textContent=x.detail;meta.className='meta';pill.className='pill';pill.textContent=labels[x.kind];meta.append(pill,document.createTextNode(size(x.bytes)+' ・ '+new Date(x.createdAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})));if(x.active)meta.append(document.createTextNode(' ・ 生成中／状態未確認のため削除不可'));body.append(title,detail,meta);row.append(cb,body);
  if(x.kind!=='other'){const b=document.createElement('button');b.type='button';b.textContent=x.kind==='audio'?'試聴':'内容を見る';b.onclick=()=>preview(x,b);row.append(b)}list.append(row);
 }
 updateSelection();
}
async function refresh(message=''){
 setBusy(true);status.textContent='保存データを確認しています…';
 try{const d=await api('list');items=d.items;loaded=true;selected.clear();$('.summary').textContent='合計 '+items.length+'件 ・ '+size(d.totalBytes)+'（動画 '+items.filter(x=>x.kind==='video').length+'／画像 '+items.filter(x=>x.kind==='image').length+'／音声 '+items.filter(x=>x.kind==='audio').length+'）';status.textContent=message||'読み込み完了。不要なデータを選んで削除できます。';render()}catch(e){$('.summary').textContent='最新の保存状況は未確認です';status.textContent='確認できませんでした：'+e.message}finally{setBusy(false);render()}
}
async function preview(x,b){b.disabled=true;status.textContent='内容を読み込んでいます…';try{const d=await api('preview',{item:{bucket:x.bucket,name:x.name,id:x.id,updatedAt:x.updatedAt}});const p=$('.preview-content');p.replaceChildren();const title=document.createElement('p');title.textContent=x.title+'／'+x.detail;const el=document.createElement(x.kind==='image'?'img':x.kind==='audio'?'audio':'video');el.className='preview';if(x.kind==='image')el.alt=x.detail;else{el.controls=true;el.playsInline=true}el.src=d.url;p.append(title,el);$('.preview-dialog').showModal();status.textContent='内容を表示しました。'}catch(e){status.textContent='内容を表示できません：'+e.message}finally{b.disabled=false}}
$('.open').onclick=()=>{dialog.showModal();refresh()};$('[data-close]').onclick=()=>dialog.close();$('[data-refresh]').onclick=()=>refresh();$('input[type=search]').oninput=render;$('select').onchange=render;
$('[data-clear]').onclick=()=>{selected.clear();render()};$('[data-select]').onclick=()=>{selected.clear();for(const x of visible().filter(x=>!x.active).slice(0,200))selected.add(key(x));render()};
remove.onclick=async()=>{
 const chosen=items.filter(x=>selected.has(key(x)));if(!chosen.length||busy)return;
 const text=chosen.slice(0,5).map(x=>'・'+x.title+'／'+labels[x.kind]).join('\n');
 if(!confirm(chosen.length+'件（'+size(chosen.reduce((s,x)=>s+x.bytes,0))+'）をサーバーから削除します。\n'+text+(chosen.length>5?'\nほか '+(chosen.length-5)+'件':'')+'\n\n削除後は元に戻せません。削除しますか？'))return;
 setBusy(true);status.textContent='選んだデータを削除しています…';
 try{const d=await api('delete',{items:chosen.map(x=>({bucket:x.bucket,name:x.name,id:x.id,updatedAt:x.updatedAt}))});await refresh(d.deleted+'件を削除しました。'+size(d.freedBytes)+'減りました。')}catch(e){await refresh('削除結果を確認してください：'+e.message)}finally{setBusy(false)}
};
const closePreview=()=>{$('.preview-content').querySelectorAll('audio,video').forEach(x=>{x.pause();x.removeAttribute('src');x.load()});$('.preview-content').replaceChildren()};$('[data-preview-close]').onclick=()=>$('.preview-dialog').close();$('.preview-dialog').addEventListener('close',closePreview);
})();
