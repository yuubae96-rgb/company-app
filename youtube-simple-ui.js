(()=>{
  const style=document.createElement('style');
  style.textContent=`
    .usageBox{display:none!important}
    #saveJson,.speak,.del,#characterLockBox,.lockCharacter{display:none!important}
    .simpleFlow{margin-top:10px;padding:10px 12px;border:1px solid #dce1e8;border-radius:10px;background:#f8fafc;color:#596578;font-size:12px;line-height:1.6}
    @media(max-width:560px){.row{grid-template-columns:1fr!important}}
  `;
  document.head.appendChild(style);

  const head=document.querySelector('.head p');
  if(head) head.textContent='テーマ → 構成 → Gemini画像 → ナレーション → 動画の順に作ります。';
  const state=document.getElementById('voicePreviewState');
  if(state) state.textContent='「こんにちは。」で12種類の声を聞き比べできます。';
  const status=document.getElementById('status');
  if(status&&!document.getElementById('simpleFlow')){
    const box=document.createElement('div');
    box.id='simpleFlow'; box.className='simpleFlow';
    box.innerHTML='<b>作り方</b><br>① 動画構成を作る → ② 全シーンの画像を作る → ③ 全シーンのナレーションを作る → ④ 動画を確認・書き出す';
    status.insertAdjacentElement('afterend',box);
  }

  let previewOpened=false;
  const nativeFetch=window.fetch.bind(window);
  window.fetch=(input,init={})=>{
    const url=typeof input==='string'?input:(input&&input.url)||'';
    if(url.includes('/functions/v1/video-ai-gemini')&&String(init.method||'GET').toUpperCase()==='POST'&&!init.signal){
      const ctrl=new AbortController();
      const timer=setTimeout(()=>ctrl.abort(),45000);
      return nativeFetch(input,{...init,signal:ctrl.signal}).finally(()=>clearTimeout(timer));
    }
    return nativeFetch(input,init);
  };

  function tidy(){
    const make=document.getElementById('make');
    if(make&&!make.disabled) make.textContent='動画構成を作る';
    const allImages=document.getElementById('allImages');
    if(allImages&&!allImages.disabled) allImages.textContent='② 全シーンのGemini画像を作る';
    const allTts=document.getElementById('allTts');
    if(allTts&&!allTts.disabled) allTts.textContent='③ 全シーンのナレーションを作る';
    const open=document.getElementById('openPreview');
    if(open){
      open.textContent='④ 動画を確認・書き出す';
      open.onclick=()=>{previewOpened=true;const w=document.getElementById('previewWrap');if(w){w.style.display='block';w.scrollIntoView({behavior:'smooth'})}};
    }
    const wrap=document.getElementById('previewWrap');
    if(wrap&&!previewOpened&&document.querySelectorAll('.scene').length) wrap.style.display='none';
    document.querySelectorAll('.makeImg').forEach(b=>{if(!b.disabled)b.textContent='Gemini画像を作る'});
    document.querySelectorAll('.makeTts').forEach(b=>{if(!b.disabled)b.textContent='ナレーションを作る'});
  }
  new MutationObserver(()=>setTimeout(tidy,0)).observe(document.body,{childList:true,subtree:true,characterData:true});
  tidy();
})();