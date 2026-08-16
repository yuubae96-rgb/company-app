'use strict';

/* =========================================================
   データ層（将来クラウド化しやすいよう非同期関数で統一）
   ※ ストレージキー・内部フィールド名は旧バージョン（受注管理）から
     変更していません。既存データはそのまま読み込まれます。
   ========================================================= */
const MATERIAL_OPTIONS = ['アルミ','ステンレス','真鍮','カラーアルマイト','その他'];
const RESULT_LABELS = { pending:'回答待ち', won:'受注', lost:'失注' };

function normalizeOrder(o){
  return Object.assign({
    material: '', materialOther: '', thickness: '', sizeV: '', sizeH: '',
    dueDate: '', staff: '', itemName: '', quantity: '', note: '', orderNumber: '',
    drawingPath: '', drawingName: '',
    createdBy: '', updatedBy: '', createdAt: '', updatedAt: ''
  }, o, {
    result: (o.result === 'won' || o.result === 'lost') ? o.result : 'pending'
  });
}


const RESULT_TO_DB = { pending:'回答待ち', won:'受注', lost:'失注' };
const DB_TO_RESULT = { '回答待ち':'pending', '受注':'won', '失注':'lost' };

function orderToDb(o){
  const materialValue = o.material === 'その他'
    ? (o.materialOther || 'その他')
    : (o.material || null);
  return {
    estimate_date: o.orderDate || null,
    company_name: o.company || '',
    estimate_number: o.orderNumber || null,
    product_name: o.itemName || null,
    amount: Number(o.amount) || 0,
    material: materialValue,
    thickness: (o.thickness === '' || o.thickness == null) ? null : String(o.thickness),
    width: (o.sizeH === '' || o.sizeH == null) ? null : Number(o.sizeH),
    height: (o.sizeV === '' || o.sizeV == null) ? null : Number(o.sizeV),
    quantity: (o.quantity === '' || o.quantity == null) ? null : Number(o.quantity),
    status: RESULT_TO_DB[o.result] || '回答待ち',
    person_in_charge: o.staff || null,
    delivery_date: o.dueDate || null,
    memo: o.note || null
  };
}

function dbToOrder(row){
  const rawMaterial = row.material || '';
  const knownMaterial = MATERIAL_OPTIONS.includes(rawMaterial);
  return normalizeOrder({
    id: String(row.id),
    orderDate: row.estimate_date || '',
    company: row.company_name || '',
    orderNumber: row.estimate_number || '',
    itemName: row.product_name || '',
    amount: row.amount == null ? 0 : Number(row.amount),
    material: knownMaterial ? rawMaterial : (rawMaterial ? 'その他' : ''),
    materialOther: (!knownMaterial && rawMaterial) ? rawMaterial : '',
    thickness: row.thickness == null ? '' : Number(row.thickness),
    sizeV: row.height == null ? '' : Number(row.height),
    sizeH: row.width == null ? '' : Number(row.width),
    quantity: row.quantity == null ? '' : Number(row.quantity),
    result: DB_TO_RESULT[row.status] || 'pending',
    staff: row.person_in_charge || '',
    dueDate: row.delivery_date || '',
    note: row.memo || '',
    drawingPath: row.drawing_path || '',
    drawingName: row.drawing_name || '',
    createdBy: row.created_by || '',
    updatedBy: row.updated_by || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || row.created_at || ''
  });
}

function cloudError(error){
  console.error(error);
  if(error && (error.code === 'PGRST301' || error.status === 401 || error.status === 403)){
    showAuthGate('ログインの有効期限が切れました。もう一度ログインしてください。');
  }
  throw error;
}

async function getCurrentUserEmail(){
  const { data:{ user }, error } = await supabaseClient.auth.getUser();
  if(error) return cloudError(error);
  return user && user.email ? user.email : '';
}

const DRAWING_BUCKET = 'drawings';
const MAX_DRAWING_BYTES = 20 * 1024 * 1024;

function validateDrawingFile(file){
  if(!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if(!isPdf) throw new Error('図面はPDFファイルを選んでください');
  if(file.size > MAX_DRAWING_BYTES) throw new Error('PDFは20MB以下にしてください');
}

async function uploadDrawingPdf(estimateId, file){
  validateDrawingFile(file);
  const randomPart = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  const path = `${estimateId}/${Date.now()}-${randomPart}.pdf`;

  const { error } = await supabaseClient.storage
    .from(DRAWING_BUCKET)
    .upload(path, file, {
      contentType: 'application/pdf',
      upsert: false
    });
  if(error) return cloudError(error);
  return path;
}

async function removeDrawingPdf(path){
  if(!path) return true;
  const { error } = await supabaseClient.storage
    .from(DRAWING_BUCKET)
    .remove([path]);
  if(error) return cloudError(error);
  return true;
}

async function openDrawingPdf(path){
  if(!path) return;
  const popup = window.open('', '_blank');
  try{
    const { data, error } = await supabaseClient.storage
      .from(DRAWING_BUCKET)
      .createSignedUrl(path, 600);
    if(error) return cloudError(error);
    const url = data && data.signedUrl;
    if(!url) throw new Error('PDFのURLを作成できませんでした');
    if(popup) popup.location = url;
    else window.location.href = url;
  }catch(err){
    if(popup) popup.close();
    throw err;
  }
}

const StorageAPI = {
  LEGACY_KEY: 'hotmilk_orders_v1',

  async getAll(){
    const { data, error } = await supabaseClient
      .from('estimates')
      .select('*')
      .order('created_at', { ascending:false });
    if(error) return cloudError(error);
    return (data || []).map(dbToOrder);
  },

  async add(order){
    const email = await getCurrentUserEmail();
    const now = new Date().toISOString();
    const payload = orderToDb(order);
    payload.created_by = email || null;
    payload.updated_by = email || null;
    payload.updated_at = now;

    const { data, error } = await supabaseClient
      .from('estimates')
      .insert(payload)
      .select()
      .single();
    if(error) return cloudError(error);
    return dbToOrder(data);
  },

  async addMany(orders){
    if(!orders.length) return 0;
    const email = await getCurrentUserEmail();
    const now = new Date().toISOString();
    const payload = orders.map(order=>{
      const row = orderToDb(order);
      row.created_by = email || null;
      row.updated_by = email || null;
      row.updated_at = now;
      return row;
    });
    const { data, error } = await supabaseClient
      .from('estimates')
      .insert(payload)
      .select('id');
    if(error) return cloudError(error);
    return (data || []).length;
  },

  async getOne(id){
    const { data, error } = await supabaseClient
      .from('estimates')
      .select('*')
      .eq('id', Number(id))
      .maybeSingle();
    if(error) return cloudError(error);
    return data ? dbToOrder(data) : null;
  },

  async setDrawing(id, drawingPath, drawingName, expectedUpdatedAt){
    const email = await getCurrentUserEmail();
    const payload = {
      drawing_path: drawingPath || null,
      drawing_name: drawingName || null,
      updated_by: email || null,
      updated_at: new Date().toISOString()
    };

    let query = supabaseClient
      .from('estimates')
      .update(payload)
      .eq('id', Number(id));

    if(expectedUpdatedAt){
      query = query.eq('updated_at', expectedUpdatedAt);
    }

    const { data, error } = await query.select().maybeSingle();
    if(error) return cloudError(error);
    if(!data) return { conflict:true, order:null };
    return { conflict:false, order:dbToOrder(data) };
  },

  async update(id, patch, expectedUpdatedAt){
    const email = await getCurrentUserEmail();
    const payload = orderToDb(patch);
    payload.updated_by = email || null;
    payload.updated_at = new Date().toISOString();

    let query = supabaseClient
      .from('estimates')
      .update(payload)
      .eq('id', Number(id));

    // 編集開始時点の updated_at と一致する場合だけ更新する。
    // 他の端末が先に保存していれば 0 件になり、上書きを止める。
    if(expectedUpdatedAt){
      query = query.eq('updated_at', expectedUpdatedAt);
    }

    const { data, error } = await query
      .select()
      .maybeSingle();

    if(error) return cloudError(error);
    if(!data) return { conflict:true, order:null };
    return { conflict:false, order:dbToOrder(data) };
  },

  async remove(id){
    const existing = await this.getOne(id);
    if(existing && existing.drawingPath){
      await removeDrawingPdf(existing.drawingPath);
    }
    const { error } = await supabaseClient
      .from('estimates')
      .delete()
      .eq('id', Number(id));
    if(error) return cloudError(error);
    return true;
  },

  async removeAll(){
    const paths = (await this.getAll()).map(o=>o.drawingPath).filter(Boolean);
    if(paths.length){
      const { error: storageError } = await supabaseClient.storage
        .from(DRAWING_BUCKET)
        .remove(paths);
      if(storageError) return cloudError(storageError);
    }
    const { error } = await supabaseClient
      .from('estimates')
      .delete()
      .gte('id', 0);
    if(error) return cloudError(error);
    return true;
  },

  getLegacyLocal(){
    try{
      const raw = localStorage.getItem(this.LEGACY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.map(normalizeOrder) : [];
    }catch(e){
      console.error(e);
      return [];
    }
  }
};

function uid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

/* =========================================================
   ユーティリティ
   ========================================================= */
function formatMoney(n){
  const v = Number(n) || 0;
  return v.toLocaleString('ja-JP');
}
function formatDate(iso){
  if(!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${y}/${m}/${d}`;
}
function todayISO(){
  const d = new Date();
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz*60000);
  return local.toISOString().slice(0,10);
}
function formatDateTime(iso){
  if(!iso) return '—';
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', {
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit'
  });
}
function pad2(n){ return String(n).padStart(2,'0'); }
function ymFromISO(iso){ return iso ? iso.slice(0,7) : ''; }
function showToast(msg, type){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=> t.classList.remove('show'), 2200);
}
function escHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function materialDisplay(o){
  if(!o.material) return '';
  if(o.material === 'その他') return o.materialOther ? o.materialOther : 'その他';
  return o.material;
}
function materialCategory(o){
  return MATERIAL_OPTIONS.includes(o.material) ? o.material : '';
}
function formatRate(rate){
  return rate == null ? '—' : (Math.round(rate*10)/10).toFixed(1) + '%';
}
function badgeHTML(result){
  const r = (result === 'won' || result === 'lost') ? result : 'pending';
  return `<span class="badge badge-${r}">${RESULT_LABELS[r]}</span>`;
}

/* =========================================================
   状態
   ========================================================= */
const state = {
  editingId: null,
  editingVersion: null,
  removeDrawingRequested: false,
  filters: { company:'', startDate:'', endDate:'', orderNumber:'', itemName:'', staff:'', material:'', thickness:'', sizeV:'', sizeH:'', result:'' },
  sortKey: 'date_desc',
  analysisCompany: '',
  activePeriod: 'all'
};

let ALL_ORDERS = [];

/* =========================================================
   画面切り替え
   ========================================================= */
const SCREEN_TITLES = { register:'見積もり登録', search:'見積もり検索', analysis:'見積分析', settings:'設定' };
function gotoScreen(name){
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.goto === name));
  document.getElementById('screenTitle').textContent = SCREEN_TITLES[name] || '';
  if(name === 'search') renderSearchResults();
  if(name === 'analysis') renderAnalysis();
  if(name === 'settings') renderSettings();
  if(name === 'register') renderRecentList();
}
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> gotoScreen(btn.dataset.goto));
});

/* =========================================================
   見積もり登録フォーム
   ========================================================= */
const form = document.getElementById('orderForm');
const submitBtn = document.getElementById('submitBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const formCardTitle = document.getElementById('formCardTitle');
const materialSelect = document.getElementById('f_material');
const materialOtherField = document.getElementById('materialOtherField');
const drawingInput = document.getElementById('f_drawing');
const currentDrawingBox = document.getElementById('currentDrawingBox');
const currentDrawingName = document.getElementById('currentDrawingName');
const currentDrawingOpenBtn = document.getElementById('currentDrawingOpenBtn');
const currentDrawingRemoveBtn = document.getElementById('currentDrawingRemoveBtn');

function syncMaterialOtherVisibility(){
  materialOtherField.style.display = materialSelect.value === 'その他' ? '' : 'none';
}
materialSelect.addEventListener('change', syncMaterialOtherVisibility);

function setCurrentDrawingUI(order){
  const hasDrawing = !!(order && order.drawingPath) && !state.removeDrawingRequested;
  currentDrawingBox.style.display = hasDrawing ? '' : 'none';
  currentDrawingName.textContent = hasDrawing ? (order.drawingName || '図面PDF') : '';
  currentDrawingOpenBtn.dataset.path = hasDrawing ? order.drawingPath : '';
}

currentDrawingOpenBtn.addEventListener('click', async ()=>{
  const path = currentDrawingOpenBtn.dataset.path;
  if(!path) return;
  try{
    await openDrawingPdf(path);
  }catch(err){
    console.error(err);
    showToast('PDFを開けませんでした', 'danger');
  }
});

currentDrawingRemoveBtn.addEventListener('click', ()=>{
  state.removeDrawingRequested = true;
  currentDrawingBox.style.display = 'none';
  showToast('更新すると図面の添付を外します', 'success');
});

function resetForm(){
  form.reset();
  document.getElementById('f_orderDate').value = todayISO();
  document.getElementById('f_result').value = 'pending';
  syncMaterialOtherVisibility();
  state.editingId = null;
  state.editingVersion = null;
  state.removeDrawingRequested = false;
  drawingInput.value = '';
  currentDrawingBox.style.display = 'none';
  currentDrawingOpenBtn.dataset.path = '';
  currentDrawingName.textContent = '';
  submitBtn.textContent = '登録する';
  cancelEditBtn.style.display = 'none';
  formCardTitle.textContent = '新規見積もりの登録';
}

function fillFormForEdit(order){
  document.getElementById('f_orderDate').value = order.orderDate || '';
  document.getElementById('f_dueDate').value = order.dueDate || '';
  document.getElementById('f_company').value = order.company || '';
  document.getElementById('f_orderNumber').value = order.orderNumber || '';
  document.getElementById('f_staff').value = order.staff || '';
  document.getElementById('f_itemName').value = order.itemName || '';
  document.getElementById('f_result').value = order.result || 'pending';
  document.getElementById('f_material').value = MATERIAL_OPTIONS.includes(order.material) ? order.material : '';
  document.getElementById('f_materialOther').value = order.materialOther || '';
  document.getElementById('f_thickness').value = order.thickness !== '' && order.thickness != null ? order.thickness : '';
  document.getElementById('f_sizeV').value = order.sizeV !== '' && order.sizeV != null ? order.sizeV : '';
  document.getElementById('f_sizeH').value = order.sizeH !== '' && order.sizeH != null ? order.sizeH : '';
  document.getElementById('f_amount').value = order.amount != null ? order.amount : '';
  document.getElementById('f_quantity').value = order.quantity != null ? order.quantity : '';
  document.getElementById('f_note').value = order.note || '';
  drawingInput.value = '';
  syncMaterialOtherVisibility();
  state.editingId = order.id;
  state.editingVersion = order.updatedAt || order.createdAt || null;
  state.removeDrawingRequested = false;
  setCurrentDrawingUI(order);
  submitBtn.textContent = '更新する';
  cancelEditBtn.style.display = '';
  formCardTitle.textContent = '見積データの編集';
  gotoScreen('register');
  window.scrollTo({top:0, behavior:'smooth'});
}

cancelEditBtn.addEventListener('click', resetForm);

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const orderDate = document.getElementById('f_orderDate').value;
  const company = document.getElementById('f_company').value.trim();
  const amountRaw = document.getElementById('f_amount').value;
  if(!orderDate || !company || amountRaw === ''){
    showToast('見積日・会社名・見積金額は必須です', 'danger');
    return;
  }
  const material = document.getElementById('f_material').value;
  const thicknessRaw = document.getElementById('f_thickness').value;
  const sizeVRaw = document.getElementById('f_sizeV').value;
  const sizeHRaw = document.getElementById('f_sizeH').value;
  const payload = {
    orderDate,
    dueDate: document.getElementById('f_dueDate').value || '',
    company,
    orderNumber: document.getElementById('f_orderNumber').value.trim(),
    staff: document.getElementById('f_staff').value.trim(),
    itemName: document.getElementById('f_itemName').value.trim(),
    result: document.getElementById('f_result').value || 'pending',
    material: material,
    materialOther: material === 'その他' ? document.getElementById('f_materialOther').value.trim() : '',
    thickness: thicknessRaw === '' ? '' : Number(thicknessRaw),
    sizeV: sizeVRaw === '' ? '' : Number(sizeVRaw),
    sizeH: sizeHRaw === '' ? '' : Number(sizeHRaw),
    amount: Math.round(Number(amountRaw)) || 0,
    quantity: document.getElementById('f_quantity').value === '' ? '' : Math.round(Number(document.getElementById('f_quantity').value)),
    note: document.getElementById('f_note').value.trim()
  };

  submitBtn.disabled = true;
  try{
    if(state.editingId){
      const editingId = state.editingId;
      const result = await StorageAPI.update(editingId, payload, state.editingVersion);

      if(result.conflict){
        const latest = await StorageAPI.getOne(editingId);
        const who = latest && latest.updatedBy ? latest.updatedBy : '別の利用者';
        const when = latest && latest.updatedAt ? formatDateTime(latest.updatedAt) : '不明';
        const reloadLatest = confirm(
          '⚠ この見積は、あなたが編集を始めた後に他の人が更新しました。\n\n' +
          '最終更新者：' + who + '\n' +
          '最終更新日時：' + when + '\n\n' +
          '古い内容での上書きは中止しました。\n' +
          '［OK］最新内容を読み直す\n' +
          '［キャンセル］今の入力を画面に残す'
        );

        await reloadOrders();
        renderRecentList();
        renderSearchResults();

        if(reloadLatest && latest){
          fillFormForEdit(latest);
        }
        return;
      }

      let savedOrder = result.order;
      const selectedPdf = drawingInput.files && drawingInput.files[0];

      if(selectedPdf){
        validateDrawingFile(selectedPdf);
        const oldPath = savedOrder.drawingPath || '';
        const newPath = await uploadDrawingPdf(editingId, selectedPdf);
        const drawingResult = await StorageAPI.setDrawing(
          editingId,
          newPath,
          selectedPdf.name,
          savedOrder.updatedAt
        );
        if(drawingResult.conflict){
          await removeDrawingPdf(newPath);
          throw new Error('図面保存中に他の人が更新しました。最新データを読み直してください。');
        }
        savedOrder = drawingResult.order;
        if(oldPath && oldPath !== newPath){
          await removeDrawingPdf(oldPath);
        }
      }else if(state.removeDrawingRequested && savedOrder.drawingPath){
        const oldPath = savedOrder.drawingPath;
        const drawingResult = await StorageAPI.setDrawing(
          editingId,
          '',
          '',
          savedOrder.updatedAt
        );
        if(drawingResult.conflict){
          throw new Error('図面削除中に他の人が更新しました。最新データを読み直してください。');
        }
        await removeDrawingPdf(oldPath);
        savedOrder = drawingResult.order;
      }

      showToast('見積データを更新しました', 'success');
    }else{
      const createdOrder = await StorageAPI.add(payload);
      const selectedPdf = drawingInput.files && drawingInput.files[0];

      if(selectedPdf){
        validateDrawingFile(selectedPdf);
        const newPath = await uploadDrawingPdf(createdOrder.id, selectedPdf);
        const drawingResult = await StorageAPI.setDrawing(
          createdOrder.id,
          newPath,
          selectedPdf.name,
          createdOrder.updatedAt
        );
        if(drawingResult.conflict){
          await removeDrawingPdf(newPath);
          throw new Error('図面保存中に競合が発生しました');
        }
      }

      showToast('見積もりを登録しました', 'success');
    }

    await reloadOrders();
    resetForm();
    renderRecentList();
    renderSearchResults();
  }catch(err){
    console.error(err);
    showToast(err && err.message ? err.message : '保存に失敗しました', 'danger');
  }finally{
    submitBtn.disabled = false;
  }
});

function renderRecentList(){
  const el = document.getElementById('recentList');
  const list = ALL_ORDERS.slice().sort((a,b)=> (b.createdAt||'').localeCompare(a.createdAt||'')).slice(0,5);
  if(list.length === 0){
    el.innerHTML = '<div class="empty-state"><div class="icon">🗂️</div>まだ見積データがありません</div>';
    return;
  }
  el.innerHTML = list.map(o => orderCardHTML(o)).join('');
  bindOrderCardActions(el);
}

/* =========================================================
   見積カードHTML（共通）
   ========================================================= */
function orderCardHTML(o){
  const metaParts = [];
  metaParts.push(`見積日 ${formatDate(o.orderDate)}`);
  if(o.dueDate) metaParts.push(`納期 ${formatDate(o.dueDate)}`);
  if(o.orderNumber) metaParts.push(`No. ${escHtml(o.orderNumber)}`);
  if(o.quantity !== '' && o.quantity != null) metaParts.push(`数量 ${escHtml(o.quantity)}`);
  if(o.staff) metaParts.push(`担当 ${escHtml(o.staff)}`);

  const specParts = [];
  const mat = materialDisplay(o);
  if(mat) specParts.push(`材質 ${escHtml(mat)}`);
  if(o.thickness !== '' && o.thickness != null) specParts.push(`板厚 ${escHtml(o.thickness)}mm`);
  if((o.sizeV !== '' && o.sizeV != null) || (o.sizeH !== '' && o.sizeH != null)){
    const v = (o.sizeV !== '' && o.sizeV != null) ? o.sizeV : '?';
    const h = (o.sizeH !== '' && o.sizeH != null) ? o.sizeH : '?';
    specParts.push(`サイズ 縦${escHtml(v)}×横${escHtml(h)}mm`);
  }

  const result = (o.result === 'won' || o.result === 'lost') ? o.result : 'pending';

  return `
  <div class="order-card st-${result}" data-id="${o.id}">
    <div class="top-row">
      <div class="company-wrap">
        <div class="company">${escHtml(o.company)}</div>
        ${badgeHTML(result)}
      </div>
      <div class="amount nums">${formatMoney(o.amount)}円</div>
    </div>
    ${o.itemName ? `<div class="meta" style="margin-bottom:2px;"><span>${escHtml(o.itemName)}</span></div>` : ''}
    <div class="meta">${metaParts.map(m=>`<span>${m}</span>`).join('')}</div>
    ${specParts.length ? `<div class="spec-line">${specParts.map(m=>`<span>${m}</span>`).join('')}</div>` : ''}
    ${o.note ? `<div class="note">${escHtml(o.note)}</div>` : ''}
    ${(o.createdBy || o.updatedBy || o.updatedAt) ? `<div class="meta" style="margin-top:6px;margin-bottom:8px;">
      ${o.createdBy ? `<span>登録 ${escHtml(o.createdBy)}</span>` : ''}
      ${o.updatedBy ? `<span>最終変更 ${escHtml(o.updatedBy)}</span>` : ''}
      ${o.updatedAt ? `<span>${escHtml(formatDateTime(o.updatedAt))}</span>` : ''}
    </div>` : ''}
    <div class="actions">
      ${o.drawingPath ? `<button class="btn btn-ghost btn-sm drawing-btn" data-action="drawing" data-path="${escHtml(o.drawingPath)}">📄 図面PDF</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-action="edit">編集</button>
      <button class="btn btn-ghost btn-sm" data-action="delete" style="color:var(--danger);border-color:var(--danger-bg);">削除</button>
    </div>
  </div>`;
}

function bindOrderCardActions(container){
  container.querySelectorAll('.order-card').forEach(card=>{
    const id = card.dataset.id;
    const drawingBtn = card.querySelector('[data-action="drawing"]');
    const editBtn = card.querySelector('[data-action="edit"]');
    const delBtn = card.querySelector('[data-action="delete"]');
    if(drawingBtn) drawingBtn.addEventListener('click', async ()=>{
      try{
        await openDrawingPdf(drawingBtn.dataset.path);
      }catch(err){
        console.error(err);
        showToast('PDFを開けませんでした', 'danger');
      }
    });
    if(editBtn) editBtn.addEventListener('click', ()=>{
      const order = ALL_ORDERS.find(o=>o.id===id);
      if(order) fillFormForEdit(order);
    });
    if(delBtn) delBtn.addEventListener('click', ()=> openDeleteOneModal(id));
  });
}

/* =========================================================
   個別削除モーダル
   ========================================================= */
let pendingDeleteId = null;
const deleteOneModal = document.getElementById('deleteOneModal');
function openDeleteOneModal(id){
  pendingDeleteId = id;
  const order = ALL_ORDERS.find(o=>o.id===id);
  document.getElementById('deleteOneText').innerHTML =
    order ? `<b>${escHtml(order.company)}</b>（${formatDate(order.orderDate)} / ${formatMoney(order.amount)}円）の見積データを削除します。よろしいですか？` :
    'この見積データを削除します。よろしいですか？';
  deleteOneModal.classList.add('show');
}
document.getElementById('deleteOneCancelBtn').addEventListener('click', ()=>{
  deleteOneModal.classList.remove('show'); pendingDeleteId = null;
});
document.getElementById('deleteOneConfirmBtn').addEventListener('click', async ()=>{
  if(pendingDeleteId){
    await StorageAPI.remove(pendingDeleteId);
    await reloadOrders();
    showToast('削除しました', 'danger');
    renderRecentList();
    renderSearchResults();
  }
  deleteOneModal.classList.remove('show');
  pendingDeleteId = null;
});

/* =========================================================
   検索・絞り込み
   ========================================================= */
const searchIds = ['s_company','s_orderNumber','s_startDate','s_endDate','s_itemName','s_staff','s_material','s_thickness','s_sizeV','s_sizeH'];
const filterKeyMap = { s_company:'company', s_orderNumber:'orderNumber', s_startDate:'startDate', s_endDate:'endDate', s_itemName:'itemName', s_staff:'staff', s_material:'material', s_thickness:'thickness', s_sizeV:'sizeV', s_sizeH:'sizeH' };
searchIds.forEach(id=>{
  const evt = document.getElementById(id).tagName === 'SELECT' ? 'change' : 'input';
  document.getElementById(id).addEventListener(evt, ()=>{
    state.filters[filterKeyMap[id]] = document.getElementById(id).value;
    if(id === 's_startDate' || id === 's_endDate'){ setActivePeriodChip(null); }
    renderSearchResults();
  });
});

document.getElementById('clearFilterBtn').addEventListener('click', ()=>{
  searchIds.forEach(id=> document.getElementById(id).value = '');
  state.filters = { company:'', startDate:'', endDate:'', orderNumber:'', itemName:'', staff:'', material:'', thickness:'', sizeV:'', sizeH:'', result:'' };
  setActivePeriodChip('all');
  setActiveResultChip('');
  renderSearchResults();
});

document.getElementById('sortKey').addEventListener('change', (e)=>{
  state.sortKey = e.target.value;
  renderSearchResults();
});

function setActivePeriodChip(period){
  state.activePeriod = period;
  document.querySelectorAll('#periodChips .chip').forEach(c=>{
    c.classList.toggle('active', period && c.dataset.period === period);
  });
}
function setActiveResultChip(result){
  state.filters.result = result;
  document.querySelectorAll('#resultChips .chip').forEach(c=>{
    c.classList.toggle('active', c.dataset.result === result);
  });
}

function periodRange(period){
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  function iso(dt){ return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`; }
  if(period === 'thisMonth'){
    return { start: iso(new Date(y,m,1)), end: iso(new Date(y,m+1,0)) };
  }
  if(period === 'lastMonth'){
    return { start: iso(new Date(y,m-1,1)), end: iso(new Date(y,m,0)) };
  }
  if(period === 'last30'){
    const d30 = new Date(now); d30.setDate(d30.getDate()-29);
    return { start: iso(d30), end: iso(now) };
  }
  if(period === 'thisYear'){
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  return { start:'', end:'' };
}

document.querySelectorAll('#periodChips .chip').forEach(chip=>{
  chip.addEventListener('click', ()=>{
    const period = chip.dataset.period;
    setActivePeriodChip(period);
    const r = periodRange(period);
    document.getElementById('s_startDate').value = r.start;
    document.getElementById('s_endDate').value = r.end;
    state.filters.startDate = r.start;
    state.filters.endDate = r.end;
    renderSearchResults();
  });
});

document.querySelectorAll('#resultChips .chip').forEach(chip=>{
  chip.addEventListener('click', ()=>{
    setActiveResultChip(chip.dataset.result);
    renderSearchResults();
  });
});

function filterOrders(all, f){
  return all.filter(o=>{
    if(f.company && !(o.company||'').toLowerCase().includes(f.company.toLowerCase())) return false;
    if(f.startDate && o.orderDate < f.startDate) return false;
    if(f.endDate && o.orderDate > f.endDate) return false;
    if(f.orderNumber && !(o.orderNumber||'').toLowerCase().includes(f.orderNumber.toLowerCase())) return false;
    if(f.itemName && !(o.itemName||'').toLowerCase().includes(f.itemName.toLowerCase())) return false;
    if(f.staff && !(o.staff||'').toLowerCase().includes(f.staff.toLowerCase())) return false;
    if(f.material && o.material !== f.material) return false;
    if(f.thickness !== '' && f.thickness != null && Number(o.thickness) !== Number(f.thickness)) return false;
    if(f.sizeV !== '' && f.sizeV != null && Number(o.sizeV) !== Number(f.sizeV)) return false;
    if(f.sizeH !== '' && f.sizeH != null && Number(o.sizeH) !== Number(f.sizeH)) return false;
    if(f.result){ const r = (o.result==='won'||o.result==='lost') ? o.result : 'pending'; if(r !== f.result) return false; }
    return true;
  });
}

function sortOrders(list, key){
  const arr = list.slice();
  switch(key){
    case 'date_asc': arr.sort((a,b)=> (a.orderDate||'').localeCompare(b.orderDate||'') || (a.createdAt||'').localeCompare(b.createdAt||'')); break;
    case 'amount_desc': arr.sort((a,b)=> (b.amount||0) - (a.amount||0)); break;
    case 'amount_asc': arr.sort((a,b)=> (a.amount||0) - (b.amount||0)); break;
    case 'company': arr.sort((a,b)=> (a.company||'').localeCompare(b.company||'', 'ja')); break;
    case 'date_desc':
    default: arr.sort((a,b)=> (b.orderDate||'').localeCompare(a.orderDate||'') || (b.createdAt||'').localeCompare(a.createdAt||''));
  }
  return arr;
}

function renderSearchResults(){
  const filtered = filterOrders(ALL_ORDERS, state.filters);
  const sorted = sortOrders(filtered, state.sortKey);
  const count = filtered.length;
  const total = filtered.reduce((s,o)=> s + (Number(o.amount)||0), 0);
  const avg = count ? Math.round(total / count) : 0;

  document.getElementById('sumCount').innerHTML = `${count.toLocaleString('ja-JP')}<small> 件</small>`;
  document.getElementById('sumTotal').innerHTML = `${formatMoney(total)}<small> 円</small>`;
  document.getElementById('sumAvg').innerHTML = `${formatMoney(avg)}<small> 円</small>`;

  const el = document.getElementById('searchResults');
  if(sorted.length === 0){
    el.innerHTML = '<div class="empty-state"><div class="icon">🔍</div>条件に一致する見積データが見つかりませんでした</div>';
    return;
  }
  el.innerHTML = sorted.map(o => orderCardHTML(o)).join('');
  bindOrderCardActions(el);
}

/* =========================================================
   見積分析
   ========================================================= */
function monthRangeKey(dt){ return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}`; }

function computeResultStats(list){
  let pending=0, won=0, lost=0, totalAmount=0, wonAmount=0, lostAmount=0;
  list.forEach(o=>{
    const amt = Number(o.amount)||0;
    totalAmount += amt;
    const r = (o.result==='won'||o.result==='lost') ? o.result : 'pending';
    if(r==='won'){ won++; wonAmount += amt; }
    else if(r==='lost'){ lost++; lostAmount += amt; }
    else pending++;
  });
  const denom = won + lost;
  const rate = denom ? (won/denom*100) : null;
  return { pending, won, lost, totalAmount, wonAmount, lostAmount, rate, count: list.length };
}

function renderAnalysis(){
  const now = new Date();
  const thisMonthKey = monthRangeKey(now);
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const lastMonthKey = monthRangeKey(lastMonthDate);
  const thisYear = String(now.getFullYear());

  let thisMonthTotal = 0, thisMonthCount = 0, lastMonthTotal = 0, thisYearTotal = 0;
  ALL_ORDERS.forEach(o=>{
    const ym = ymFromISO(o.orderDate);
    if(!ym) return;
    if(ym === thisMonthKey){ thisMonthTotal += Number(o.amount)||0; thisMonthCount++; }
    if(ym === lastMonthKey) lastMonthTotal += Number(o.amount)||0;
    if(ym.slice(0,4) === thisYear) thisYearTotal += Number(o.amount)||0;
  });
  document.getElementById('an_thisMonthCount').innerHTML = `${thisMonthCount.toLocaleString('ja-JP')}<small> 件</small>`;
  document.getElementById('an_thisMonth').innerHTML = `${formatMoney(thisMonthTotal)}<small> 円</small>`;
  document.getElementById('an_lastMonth').innerHTML = `${formatMoney(lastMonthTotal)}<small> 円</small>`;
  document.getElementById('an_thisYear').innerHTML = `${formatMoney(thisYearTotal)}<small> 円</small>`;

  // 見積結果の集計（全期間）
  const rs = computeResultStats(ALL_ORDERS);
  document.getElementById('an_pendingCount').textContent = rs.pending.toLocaleString('ja-JP');
  document.getElementById('an_wonCount').textContent = rs.won.toLocaleString('ja-JP');
  document.getElementById('an_lostCount').textContent = rs.lost.toLocaleString('ja-JP');
  document.getElementById('an_winRate').textContent = formatRate(rs.rate);
  document.getElementById('an_totalAmount').textContent = formatMoney(rs.totalAmount) + '円';
  document.getElementById('an_wonAmount').textContent = formatMoney(rs.wonAmount) + '円';
  document.getElementById('an_lostAmount').textContent = formatMoney(rs.lostAmount) + '円';

  // 会社別集計
  const byCompany = {};
  ALL_ORDERS.forEach(o=>{
    const key = o.company || '（会社名未設定）';
    if(!byCompany[key]) byCompany[key] = { orders: [] };
    byCompany[key].orders.push(o);
  });
  const companyEntries = Object.entries(byCompany).map(([name, v])=>{
    const stats = computeResultStats(v.orders);
    return { name, ...stats };
  });

  // 件数ランキング
  const byCount = companyEntries.slice().sort((a,b)=> b.count - a.count).slice(0,10);
  const countMax = byCount.length ? byCount[0].count : 0;
  const countEl = document.getElementById('rankingCountList');
  if(byCount.length === 0){
    countEl.innerHTML = '<div class="empty-state"><div class="icon">📊</div>まだ集計できるデータがありません</div>';
  }else{
    countEl.innerHTML = byCount.map((r,i)=>{
      const pct = countMax ? Math.max(6, Math.round(r.count/countMax*100)) : 0;
      return `
      <div class="bar-row">
        <div class="bar-rank">${i+1}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div><div class="bar-name">${escHtml(r.name)}</div></div>
        <div class="bar-value nums">${r.count}件</div>
      </div>`;
    }).join('');
  }

  // 金額ランキング
  const byAmount = companyEntries.slice().sort((a,b)=> b.totalAmount - a.totalAmount).slice(0,10);
  const amountMax = byAmount.length ? byAmount[0].totalAmount : 0;
  const amountEl = document.getElementById('rankingAmountList');
  if(byAmount.length === 0){
    amountEl.innerHTML = '<div class="empty-state"><div class="icon">📊</div>まだ集計できるデータがありません</div>';
  }else{
    amountEl.innerHTML = byAmount.map((r,i)=>{
      const pct = amountMax ? Math.max(6, Math.round(r.totalAmount/amountMax*100)) : 0;
      return `
      <div class="bar-row">
        <div class="bar-rank">${i+1}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div><div class="bar-name">${escHtml(r.name)}</div></div>
        <div class="bar-value nums">${formatMoney(r.totalAmount)}円</div>
      </div>`;
    }).join('');
  }

  // 会社別の受注状況（一覧）
  const statusList = companyEntries.slice().sort((a,b)=> b.count - a.count);
  const statusEl = document.getElementById('companyStatusList');
  if(statusList.length === 0){
    statusEl.innerHTML = '<div class="empty-state"><div class="icon">🏢</div>まだ集計できるデータがありません</div>';
  }else{
    statusEl.innerHTML = statusList.map(r => `
      <div class="company-status-card">
        <div class="name">${escHtml(r.name)}</div>
        <div class="grid">
          <div class="item"><b>${r.count}</b>見積件数</div>
          <div class="item" style="color:var(--success);"><b>${r.won}</b>受注</div>
          <div class="item" style="color:var(--danger);"><b>${r.lost}</b>失注</div>
          <div class="item" style="color:var(--pending);"><b>${r.pending}</b>回答待ち</div>
        </div>
        <div class="rate-line">受注率 ${formatRate(r.rate)}</div>
      </div>
    `).join('');
  }

  // 材質別の集計
  const materialEl = document.getElementById('materialStatsList');
  const materialRows = MATERIAL_OPTIONS.map(mat=>{
    const list = ALL_ORDERS.filter(o => materialCategory(o) === mat);
    const stats = computeResultStats(list);
    return { name: mat, ...stats };
  });
  const materialMax = Math.max(1, ...materialRows.map(r=> r.count));
  materialEl.innerHTML = materialRows.map(r=>{
    const pct = r.count ? Math.max(4, Math.round(r.count/materialMax*100)) : 0;
    return `
    <div class="material-row">
      <div class="m-name">${escHtml(r.name)}</div>
      <div class="m-stats">
        <span>見積 <b>${r.count}</b>件</span>
        <span style="color:var(--success);">受注 <b>${r.won}</b></span>
        <span style="color:var(--danger);">失注 <b>${r.lost}</b></span>
        <span>受注率 <b>${formatRate(r.rate)}</b></span>
      </div>
    </div>`;
  }).join('');

  // 会社セレクト
  const sel = document.getElementById('an_companySelect');
  const prevValue = sel.value;
  const companies = Object.keys(byCompany).sort((a,b)=> a.localeCompare(b,'ja'));
  sel.innerHTML = '<option value="">すべての会社（合計）</option>' + companies.map(c=>`<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  if(companies.includes(prevValue)) sel.value = prevValue;

  renderCompanyDetail(sel.value);
}

document.getElementById('an_companySelect').addEventListener('change', (e)=>{
  state.analysisCompany = e.target.value;
  renderCompanyDetail(e.target.value);
});

function renderCompanyDetail(companyFilter){
  const target = companyFilter ? ALL_ORDERS.filter(o=> o.company === companyFilter) : ALL_ORDERS;
  const stats = computeResultStats(target);
  const detailEl = document.getElementById('companyDetail');

  // 材質別件数（選択中の対象内）
  const matCounts = MATERIAL_OPTIONS.map(mat => ({
    name: mat, count: target.filter(o=> materialCategory(o) === mat).length
  })).filter(m => m.count > 0);

  detailEl.innerHTML = `
    <div class="result-stat-grid" style="margin-bottom:10px;">
      <div class="result-stat"><div class="n nums">${stats.count}</div><div class="l">見積件数</div></div>
      <div class="result-stat won"><div class="n nums">${stats.won}</div><div class="l">受注</div></div>
      <div class="result-stat lost"><div class="n nums">${stats.lost}</div><div class="l">失注</div></div>
      <div class="result-stat rate"><div class="n nums">${formatRate(stats.rate)}</div><div class="l">受注率</div></div>
    </div>
    <div class="amount-breakdown" style="margin-bottom:12px;">
      <div class="box"><div class="v nums">${formatMoney(stats.totalAmount)}円</div><div class="l">見積金額合計</div></div>
      <div class="box"><div class="v nums">${formatMoney(stats.wonAmount)}円</div><div class="l">受注金額合計</div></div>
      <div class="box"><div class="v nums">${formatMoney(stats.lostAmount)}円</div><div class="l">失注金額合計</div></div>
    </div>
    ${matCounts.length ? `<div class="m-stats" style="font-size:12.5px;">${matCounts.map(m=>`<span style="margin-right:12px;">${escHtml(m.name)} <b>${m.count}</b>件</span>`).join('')}</div>` : ''}
  `;

  renderMonthlyTrends(target);
}

function renderMonthlyTrends(target){
  const byMonthAmount = {};
  const byMonthCount = {};
  target.forEach(o=>{
    const ym = ymFromISO(o.orderDate);
    if(!ym) return;
    byMonthAmount[ym] = (byMonthAmount[ym]||0) + (Number(o.amount)||0);
    byMonthCount[ym] = (byMonthCount[ym]||0) + 1;
  });

  const now = new Date();
  const months = [];
  for(let i=11;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push(monthRangeKey(d));
  }
  const extraMonths = Object.keys(byMonthAmount).filter(m => !months.includes(m)).sort();
  const allMonths = extraMonths.concat(months).sort();

  const countEl = document.getElementById('monthlyCountTrend');
  const amountEl = document.getElementById('monthlyTrend');

  if(allMonths.every(m => !byMonthAmount[m] && !byMonthCount[m])){
    countEl.innerHTML = '<div class="empty-state"><div class="icon">📈</div>表示できるデータがありません</div>';
    amountEl.innerHTML = '';
    return;
  }

  const countMax = Math.max(1, ...allMonths.map(m=> byMonthCount[m]||0));
  countEl.innerHTML = allMonths.map(m=>{
    const val = byMonthCount[m] || 0;
    const pct = countMax ? Math.max(val ? 4 : 0, Math.round(val/countMax*100)) : 0;
    const [y,mm] = m.split('-');
    return `
    <div class="month-bar-row">
      <div class="month-label">${y}/${mm}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div></div>
      <div class="bar-value nums">${val}件</div>
    </div>`;
  }).join('');

  const amountMax = Math.max(1, ...allMonths.map(m=> byMonthAmount[m]||0));
  amountEl.innerHTML = allMonths.map(m=>{
    const val = byMonthAmount[m] || 0;
    const pct = amountMax ? Math.max(val ? 4 : 0, Math.round(val/amountMax*100)) : 0;
    const [y,mm] = m.split('-');
    return `
    <div class="month-bar-row">
      <div class="month-label">${y}/${mm}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div></div>
      <div class="bar-value nums">${formatMoney(val)}円</div>
    </div>`;
  }).join('');
}

/* =========================================================
   設定：件数表示
   ========================================================= */
function renderSettings(){
  document.getElementById('settingsCount').textContent = `${ALL_ORDERS.length.toLocaleString('ja-JP')} 件`;
}

/* =========================================================
   CSV 出力
   ========================================================= */
const CSV_HEADERS = ['見積日','会社名','見積番号','品名','材質','板厚','縦サイズ','横サイズ','数量','見積金額','見積結果','担当者','納期','備考'];
function csvEscape(v){
  const s = String(v == null ? '' : v);
  if(/[",\n\r]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}
document.getElementById('exportCsvBtn').addEventListener('click', ()=>{
  if(ALL_ORDERS.length === 0){
    showToast('出力できるデータがありません', 'danger');
    return;
  }
  const rows = [CSV_HEADERS.join(',')];
  ALL_ORDERS.forEach(o=>{
    const result = (o.result==='won'||o.result==='lost') ? o.result : 'pending';
    rows.push([
      o.orderDate||'', o.company||'', o.orderNumber||'', o.itemName||'',
      materialDisplay(o), o.thickness!=null?o.thickness:'', o.sizeV!=null?o.sizeV:'', o.sizeH!=null?o.sizeH:'',
      o.quantity!=null?o.quantity:'', o.amount!=null?o.amount:'', RESULT_LABELS[result],
      o.staff||'', o.dueDate||'', o.note||''
    ].map(csvEscape).join(','));
  });
  const csv = '\uFEFF' + rows.join('\r\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = todayISO().replace(/-/g,'');
  a.href = url; a.download = `見積データ_${stamp}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSVを出力しました', 'success');
});

/* =========================================================
   CSV 読込（簡易パーサ：ダブルクォート対応）
   ========================================================= */
function parseCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0;i<text.length;i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; } else { inQuotes = false; }
      }else{ field += c; }
    }else{
      if(c === '"'){ inQuotes = true; }
      else if(c === ','){ row.push(field); field=''; }
      else if(c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if(c === '\r'){ /* skip */ }
      else{ field += c; }
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length===1 && r[0] !== ''));
}

const HEADER_ALIASES = {
  '見積日':'orderDate', '受注日':'orderDate', '会社名':'company',
  '見積番号':'orderNumber', '受注番号':'orderNumber', '品名':'itemName',
  '材質':'material', '板厚':'thickness', '縦サイズ':'sizeV', '横サイズ':'sizeH',
  '見積金額':'amount', '受注金額':'amount', '数量':'quantity',
  '見積結果':'result', '納期':'dueDate', '担当者':'staff', '備考':'note'
};
const RESULT_LABEL_TO_VALUE = { '回答待ち':'pending', '受注':'won', '失注':'lost', 'pending':'pending', 'won':'won', 'lost':'lost' };

document.getElementById('importCsvInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async (ev)=>{
    try{
      const text = ev.target.result;
      const rows = parseCSV(text);
      if(rows.length < 2){ showToast('CSVにデータが見つかりません', 'danger'); return; }
      const header = rows[0].map(h=> h.trim());
      const colIndex = {};
      header.forEach((h,i)=>{
        const key = HEADER_ALIASES[h];
        if(key && colIndex[key] == null) colIndex[key] = i;
      });
      let imported = 0, skipped = 0;
      const newOrders = [];
      for(let r=1; r<rows.length; r++){
        const row = rows[r];
        if(!row || row.every(c=> c === '')) continue;
        const get = (key, fallbackIdx) => {
          const idx = colIndex[key] != null ? colIndex[key] : fallbackIdx;
          return idx != null && row[idx] != null ? row[idx].trim() : '';
        };
        const orderDate = get('orderDate', 0);
        const company = get('company', 1);
        if(!orderDate || !company){ skipped++; continue; }
        const amountStr = get('amount', 9);
        const materialRaw = get('material', 4);
        const material = MATERIAL_OPTIONS.includes(materialRaw) ? materialRaw : (materialRaw ? 'その他' : '');
        const materialOther = (material === 'その他' && materialRaw !== 'その他') ? materialRaw : '';
        const resultRaw = get('result', 10);
        const result = RESULT_LABEL_TO_VALUE[resultRaw] || 'pending';
        const thicknessStr = get('thickness', 5);
        const sizeVStr = get('sizeV', 6);
        const sizeHStr = get('sizeH', 7);
        newOrders.push({
          id: uid(),
          orderDate,
          company,
          orderNumber: get('orderNumber', 2),
          itemName: get('itemName', 3),
          material,
          materialOther,
          thickness: thicknessStr === '' ? '' : Number(thicknessStr.replace(/[^0-9.\-]/g,'')) || '',
          sizeV: sizeVStr === '' ? '' : Number(sizeVStr.replace(/[^0-9.\-]/g,'')) || '',
          sizeH: sizeHStr === '' ? '' : Number(sizeHStr.replace(/[^0-9.\-]/g,'')) || '',
          amount: Math.round(Number(amountStr.replace(/[^0-9.\-]/g,'')) || 0),
          quantity: (() => { const q = get('quantity', 8); return q === '' ? '' : Math.round(Number(q))||0; })(),
          result,
          dueDate: get('dueDate', 11),
          staff: get('staff', 12),
          note: get('note', 13),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        imported++;
      }
      if(newOrders.length){
        await StorageAPI.addMany(newOrders);
        await reloadOrders();
        renderRecentList(); renderSearchResults(); renderSettings();
      }
      showToast(`${imported}件を読み込みました${skipped ? `（${skipped}件はスキップ）` : ''}`, imported ? 'success' : 'danger');
    }catch(err){
      console.error(err);
      showToast('CSVの読み込みに失敗しました', 'danger');
    }finally{
      e.target.value = '';
    }
  };
  reader.readAsText(file, 'UTF-8');
});

/* =========================================================
   全件削除モーダル
   ========================================================= */
const deleteModal = document.getElementById('deleteModal');
const deleteConfirmInput = document.getElementById('deleteConfirmInput');
const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');

document.getElementById('deleteAllBtn').addEventListener('click', ()=>{
  deleteConfirmInput.value = '';
  deleteConfirmBtn.disabled = true;
  deleteModal.classList.add('show');
});
document.getElementById('deleteCancelBtn').addEventListener('click', ()=> deleteModal.classList.remove('show'));
deleteConfirmInput.addEventListener('input', ()=>{
  deleteConfirmBtn.disabled = deleteConfirmInput.value.trim() !== '削除する';
});
deleteConfirmBtn.addEventListener('click', async ()=>{
  await StorageAPI.removeAll();
  await reloadOrders();
  deleteModal.classList.remove('show');
  showToast('全データを削除しました', 'danger');
  renderRecentList(); renderSearchResults(); renderSettings();
});


/* =========================================================
   Supabase 認証・旧データ移行
   ========================================================= */
const authGate = document.getElementById('authGate');
const authError = document.getElementById('authError');
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');

function showAuthGate(message=''){
  authGate.classList.remove('hidden');
  authError.textContent = message;
  authError.classList.toggle('show', !!message);
}

function hideAuthGate(){
  authGate.classList.add('hidden');
  authError.classList.remove('show');
}

async function updateCloudUserLabel(){
  const { data:{ user } } = await supabaseClient.auth.getUser();
  const el = document.getElementById('cloudUserEmail');
  if(el) el.textContent = user && user.email ? user.email : '未ログイン';
}

loginForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  authError.classList.remove('show');
  loginBtn.disabled = true;
  loginBtn.textContent = 'ログイン中...';
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  loginBtn.disabled = false;
  loginBtn.textContent = 'ログイン';
  if(error){
    authError.textContent = 'メールアドレスまたはパスワードを確認してください。';
    authError.classList.add('show');
    return;
  }
  document.getElementById('loginPassword').value = '';
  hideAuthGate();
  await reloadOrders();
  await updateCloudUserLabel();
  renderRecentList();
  renderSearchResults();
  renderSettings();
  gotoScreen('register');
});

document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  await supabaseClient.auth.signOut();
  ALL_ORDERS = [];
  renderRecentList();
  renderSearchResults();
  renderSettings();
  showAuthGate();
});

document.getElementById('migrateLocalBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('migrateLocalBtn');
  const legacy = StorageAPI.getLegacyLocal();
  if(!legacy.length){
    showToast('この端末に移行できる旧データはありません', 'danger');
    return;
  }
  const marker = localStorage.getItem('hotmilk_orders_cloud_migrated_v1');
  if(marker){
    showToast('この端末の旧データは移行済みです', 'danger');
    return;
  }
  if(!confirm(`${legacy.length}件の旧データをクラウドへコピーします。よろしいですか？`)) return;
  btn.disabled = true;
  btn.textContent = '移行中...';
  try{
    const n = await StorageAPI.addMany(legacy);
    localStorage.setItem('hotmilk_orders_cloud_migrated_v1', new Date().toISOString());
    await reloadOrders();
    renderRecentList(); renderSearchResults(); renderSettings();
    showToast(`${n}件をクラウドへ移行しました`, 'success');
  }catch(e){
    showToast('旧データの移行に失敗しました', 'danger');
  }finally{
    btn.disabled = false;
    btn.textContent = '移行';
  }
});

supabaseClient.auth.onAuthStateChange((_event, session)=>{
  if(!session) showAuthGate();
  updateCloudUserLabel();
});

/* =========================================================
   初期化
   ========================================================= */
async function reloadOrders(){
  ALL_ORDERS = await StorageAPI.getAll();
}

async function init(){
  document.getElementById('f_orderDate').value = todayISO();
  document.getElementById('f_result').value = 'pending';
  syncMaterialOtherVisibility();

  const { data:{ session } } = await supabaseClient.auth.getSession();
  if(!session){
    showAuthGate();
    renderRecentList();
    renderSettings();
    return;
  }

  hideAuthGate();
  try{
    await reloadOrders();
    await updateCloudUserLabel();
    renderRecentList();
    renderSettings();
    gotoScreen('register');
  }catch(e){
    showAuthGate('クラウドへの接続に失敗しました。再ログインしてください。');
  }
}
init();
