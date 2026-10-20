/* AI illustrated cast, shared identity reference, and narrated scene stills. */
(()=>{
  'use strict';
  const d=document,$=id=>d.getElementById(id),batch=$('makeAllFromTopic');
  if(!batch)return;
  const box=d.createElement('div');box.id='animationModeControl';
  box.style.cssText='margin:10px 0;padding:12px;border:1px solid #e4b6cb;border-radius:12px;background:#fff4f8';
  box.innerHTML='<label><input id="characterAnimationMode" type="checkbox" checked> AIキャラクターで物語を描く（標準）</label><div style="font-size:12px;margin-top:7px">登場人物の基準画像をAIで作り、同じキャラが実験・作業・成功などの場面に登場します。静止画に音声・字幕とズームを付けます。画像生成のAPIを使用します。画面を開いたままお待ちください。</div>';
  batch.insertAdjacentElement('beforebegin',box);
  window.characterAnimationEnabled=()=>$('characterAnimationMode').checked;
  const STYLE='親しみやすい2Dキャラクターイラスト。丸みのある人物、明瞭な輪郭線、落ち着いた暖色、平面的で簡潔な絵本風。実写・3Dにしない。';
  const text=()=>[$('topic')?.value,...[...d.querySelectorAll('.scene')].map(r=>r.querySelector('.nar')?.value)].filter(Boolean).join('\n');
  let pending=null;
  function reference(){return $('protagonistRefPreview')?.getAttribute('src')||''}
  function request(body){return {...body,style:'教科書図解風',imageProvider:$('imageProvider')?.value||'auto',aspectRatio:$('videoFormat')?.value||'16:9'}}
  window.characterIllustrationRequest=body=>!window.characterAnimationEnabled()?body:request({...body,protagonistReference:reference(),prompt:STYLE+'\n'+body.prompt+'\n添付の登場人物一覧を基準に、各人物の顔・髪型・衣服・体格の特徴を維持する。原稿に登場する人物だけを描く。兄弟など複数の人物は区別する。この場面で誰が何をしているかが伝わる構図にし、背景と小道具も描く。画像内に文字・字幕・名前・記号を描かない。'});
  window.ensureStoryCharacters=async()=>{
    if(!window.characterAnimationEnabled())return '';
    if(reference())return reference();
    if(pending)return pending;
    pending=(async()=>{
      if(!d.querySelector('.scene'))throw Error('先に動画の構成を作ってください。');
      const st=$('status');if(st)st.textContent='物語の登場人物をAIで作成中…';
      const result=await window.api(request({action:'generateImage',prompt:STYLE+'\n次の原稿から主要な登場人物を選び、人物ごとに区別できるキャラクターの全身像を一枚に並べる。ライト兄弟なら二人を別々に描く。時代に合う服装・髪型。物語に人物がなければ対象物を擬人化せず共通の説明役を一人描く。無地の背景。文字・名前・字幕は一切描かない。\n原稿：\n'+text().slice(0,22000)}));
      if(!result?.data)throw Error('キャラクターの基準画像を取得できませんでした。');
      const src='data:'+(result.mimeType||'image/png')+';base64,'+result.data;
      const preview=$('protagonistRefPreview');if(!preview)throw Error('基準画像の欄を読み込めませんでした。ページを再読込してください。');
      preview.src=src;preview.style.display='block';
      const state=$('protagonistRefState');if(state)state.textContent='AIで作成した共通キャラクター。この画像を各場面の参照に使います。';
      return src;
    })().finally(()=>{pending=null});
    return pending;
  };
  window.prepareCharacterScene=async i=>{
    await window.ensureStoryCharacters();
    const row=d.querySelectorAll('.scene')[i],pic=$('pic'+i);if(!row||!pic)throw Error('場面が見つかりません。');
    if(pic.dataset.characterIllustration==='1'&&pic.dataset.image)return true;
    const button=row.querySelector('.imgBtn');if(button)button.disabled=true;
    try{
      const prompt=typeof window.imageContextPrompt==='function'?window.imageContextPrompt(i):row.querySelector('.nar').value;
      const result=await window.api(window.characterIllustrationRequest({action:'generateImage',prompt}));
      if(!result?.data)throw Error('場面'+(i+1)+'の画像を取得できませんでした。');
      window.setSceneImage(i,'data:'+(result.mimeType||'image/png')+';base64,'+result.data);
      delete pic.dataset.animationCharacter;delete row.dataset.animatedExplainer;delete row.dataset.animatedExplainerAudio;
      pic.dataset.characterIllustration='1';if(button)button.textContent='画像を作り直す';
      return true;
    }finally{if(button)button.disabled=false;window.updateExportReadiness?.()}
  };
  window.buildCharacterStory=async()=>{
    await window.ensureStoryCharacters();
    for(let i=0;i<d.querySelectorAll('.scene').length;i++){
      if($('status'))$('status').textContent='共通キャラクターで場面 '+(i+1)+' / '+d.querySelectorAll('.scene').length+' を作成中…';
      await window.prepareCharacterScene(i);
    }
  };
})();
