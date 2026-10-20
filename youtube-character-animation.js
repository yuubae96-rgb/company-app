/* Reusable, deterministic 2D character animation. No per-scene AI image calls. */
(()=>{
  'use strict';
  const topic=document.getElementById('topic'), batch=document.getElementById('makeAllFromTopic');
  if(!topic||!batch)return;
  const control=document.createElement('div');
  control.id='animationModeControl';
  control.style.cssText='margin:10px 0;padding:12px;border:1px solid #e4b6cb;border-radius:12px;background:#fff4f8;color:#382538;font-size:14px;';
  control.innerHTML='<label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-weight:800"><input id="characterAnimationMode" type="checkbox" checked style="width:22px;height:22px;accent-color:#c35780">キャラありアニメーション（標準・AI画像不要）</label><div style="margin-top:7px;font-size:12px;line-height:1.5">共通の2D人物・背景・図形を動かし、ナレーションに同期して動画を書き出します。チェックを外すと従来のAI画像方式です。※初期版は汎用キャラクターです。</div>';
  batch.insertAdjacentElement('beforebegin',control);
  const toggle=control.querySelector('input');
  window.characterAnimationEnabled=()=>toggle.checked;
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#fff9ed"/><path d="M0 555 Q640 530 1280 555 L1280 720 L0 720Z" fill="#e9ddc4"/><circle cx="1060" cy="125" r="72" fill="#fff0b4" opacity=".65"/></svg>';
  const bg='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  window.prepareCharacterScene=(i)=>{
    const pic=document.getElementById('pic'+i);if(!pic)return;
    delete pic.dataset.video;
    pic.dataset.image=bg;pic.dataset.animationCharacter='1';
    const img=document.createElement('img');img.src=bg;img.alt='キャラクターアニメーション背景';img.style.width='100%';
    pic.replaceChildren(img);
    const label=document.createElement('span');label.className='sceneLabel';
    label.textContent=pic.closest('.scene')?.querySelector('.sceneTitleInput')?.value||'';
    pic.appendChild(label);
    window.updateExportReadiness?.();
  };
  function line(ctx,x1,y1,x2,y2,width,color){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.lineWidth=width;ctx.strokeStyle=color;ctx.lineCap='round';ctx.stroke()}
  function character(ctx,x,y,s,t,variant,action){
    ctx.save();ctx.translate(x,y+Math.sin(t*3+variant)*4*s);ctx.scale(s,s);
    const coat=variant?'#648a94':'#ad7056',skin='#e8b88f',stroke='#514b49';
    const walk=action==='walk'?Math.sin(t*7+variant)*15:Math.sin(t*2+variant)*3;
    const arm=action==='point'? -37 : action==='work'? 18+Math.sin(t*5)*12 : Math.sin(t*4)*9;
    line(ctx,-12,26,-17-walk,80,11,stroke);line(ctx,12,26,16+walk,80,11,stroke);
    line(ctx,-19,-55,-31,-3,14,coat);line(ctx,18,-55,38,-9+arm*.55,13,coat);
    ctx.fillStyle=coat;ctx.beginPath();ctx.roundRect(-25,-62,50,90,12);ctx.fill();
    ctx.fillStyle=skin;ctx.beginPath();ctx.arc(0,-93,29,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#715c4d';ctx.beginPath();ctx.ellipse(0,-113,29,14,-.06,Math.PI,Math.PI*2);ctx.fill();
    ctx.fillStyle=stroke;ctx.beginPath();ctx.arc(-9,-95,2.5,0,7);ctx.arc(10,-95,2.5,0,7);ctx.fill();
    ctx.beginPath();ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.arc(0,-86,8,.1,Math.PI-.1);ctx.stroke();
    if(action==='point'){line(ctx,36,-9+arm*.55,82,-55,8,skin)}
    ctx.restore();
  }
  function arrow(ctx,x,y,t,scale){
    ctx.save();ctx.translate(x,y);ctx.strokeStyle='#4f9cab';ctx.fillStyle='#4f9cab';ctx.lineWidth=7*scale;ctx.lineCap='round';
    const length=140*scale,dx=25*Math.sin(t*2);
    ctx.beginPath();ctx.moveTo(-length/2+dx,0);ctx.bezierCurveTo(-30*scale+dx,-40*scale,30*scale+dx,40*scale,length/2+dx,0);ctx.stroke();
    ctx.beginPath();ctx.moveTo(length/2+dx,0);ctx.lineTo(length/2-24*scale+dx,-12*scale);ctx.lineTo(length/2-22*scale+dx,13*scale);ctx.fill();ctx.restore();
  }
  function plane(ctx,x,y,s,angle){
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.scale(s,s);
    ctx.fillStyle='#b27749';ctx.strokeStyle='#684b37';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(-90,5);ctx.lineTo(65,-2);ctx.lineTo(94,5);ctx.lineTo(65,13);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle='#f0dfb7';ctx.fillRect(-34,-36,62,70);ctx.strokeRect(-34,-36,62,70);
    ctx.fillStyle='#d49f6a';ctx.beginPath();ctx.moveTo(-52,0);ctx.lineTo(-80,-22);ctx.lineTo(-80,25);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.restore();
  }
  function drawOverlay(ctx,w,h,elapsed,duration,index){
    if(!toggle.checked)return;
    const scene=document.getElementById('pic'+index);
    if(scene?.dataset.animationCharacter!=='1')return;
    const t=elapsed,phase=(index%4),scale=Math.min(w/1280,h/720);
    ctx.save();ctx.translate((w-1280*scale)/2,(h-720*scale)/2);ctx.scale(scale,scale);
    // Two stable, drawn-on-canvas characters, never regenerated per scene.
    const entering=Math.min(1,Math.max(0,t/0.85));
    const slide=(1-entering)*360;
    character(ctx,330-slide,480,1.58,t,0,phase===0?'point':phase===2?'work':'walk');
    character(ctx,530+slide,480,1.47,t,1,phase===1?'point':phase===3?'work':'walk');
    ctx.fillStyle='#ded0b6';ctx.fillRect(630,520,460,18);
    ctx.fillStyle='#ab8a63';ctx.fillRect(645,538,20,85);ctx.fillRect(1050,538,20,85);
    const travel=phase===3?(Math.min(1,t/Math.max(1,duration))):0;
    plane(ctx,880+travel*235,410-travel*260,1.05,.04-travel*.22);
    if(phase===1||phase===2){arrow(ctx,900,250+Math.sin(t)*12,t,1.1);arrow(ctx,980,335+Math.sin(t+1)*10,t+1,.8)}
    ctx.restore();
  }
  const original=window.drawCover;
  if(typeof original==='function'){
    window.drawCover=function(ctx,img,w,h,elapsed,duration,index){original(ctx,img,w,h,elapsed,duration,index);drawOverlay(ctx,w,h,elapsed,duration,index)};
  }
  // Previews use the same drawing instructions as exported frames.
  const preview=document.getElementById('previewScreen');
  if(preview){
    const overlay=document.createElement('canvas');overlay.id='characterPreviewOverlay';overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';preview.style.position='relative';preview.appendChild(overlay);
    let began=performance.now();
    function loop(now){
      if(!overlay.isConnected){preview.appendChild(overlay)}
      const rect=preview.getBoundingClientRect();if(rect.width&&rect.height){
        overlay.width=Math.max(1,Math.round(rect.width*devicePixelRatio));overlay.height=Math.max(1,Math.round(rect.height*devicePixelRatio));
        const ctx=overlay.getContext('2d');const label=document.getElementById('previewScene')?.textContent||'';const match=label.match(/(?:SCENE|場面)\s*(\d+)/i);const ix=match?Number(match[1])-1:0;
        drawOverlay(ctx,overlay.width,overlay.height,(now-began)/1000,8,ix);
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
})();