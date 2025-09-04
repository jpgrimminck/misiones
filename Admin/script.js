// Admin mobile UI for missions management
// Setup Supabase client if available
const supabaseAdmin = (window.supabase && window.SUPABASE_URL)
  ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
  : null;

// State
let alumno = null;
let missions = []; // { number, title, estrellas?, estado? }
let rewards = [];  // { id, premio, titulo, condicion }
let objetivo = null;
let selected = { type: null, number: null };

// Utils
function calcStars(n){
  const pos = ((n - 1) % 10) + 1;
  if (pos <= 3) return 1;
  if (pos <= 7) return 2;
  return 3;
}
function sumCompletedStars(){
  let total = 0;
  for(const m of missions){
    const req = calcStars(m.number);
    const got = typeof m.estrellas === 'number' ? m.estrellas : 0;
    if(got >= req) total += req;
  }
  return total;
}
function rewardImageUrl(userId, n){
  const safeId = encodeURIComponent(userId || 'default');
  const safeN = String(n).replace(/[^0-9]/g, '');
  return `../premios/${safeId}/${safeN}.jpeg`;
}

// Fetchers
async function fetchUser(){
  try{
    const res = await fetch('../usuarios.json');
    if(!res.ok) throw new Error('usuarios.json');
    const data = await res.json();
    const name = data && (data.nombre || data.id) || 'Alumno';
    return name;
  }catch(e){ return 'Alumno'; }
}

async function fetchMissions(){
  let rows = [];
  if(supabaseAdmin){
    try{
      // Try english columns
      let { data, error } = await supabaseAdmin.from('missions').select('number,title,estrellas,estado');
      if(error){ ({ data, error } = await supabaseAdmin.from('missions').select('numero,titulo,estrellas,estado')); }
      if(!error && data){
        rows = data.map(r=>({
          number: (r.number ?? r.numero),
          title: (r.title ?? r.titulo) || `Misión ${(r.number ?? r.numero)}`,
          estrellas: r.estrellas,
          estado: r.estado
        })).filter(r=> typeof r.number === 'number').sort((a,b)=>a.number-b.number);
      }
    }catch(e){ /* ignore; fallback below */ }
  }
  if(rows.length===0){
    // Fallback 1..100 with placeholders
    rows = Array.from({length:100}, (_,i)=>({ number:i+1, title:`Misión ${i+1}`, estrellas:0, estado:false }));
  }
  return rows;
}

async function fetchObjective(){
  if(!supabaseAdmin || !alumno) return null;
  try{
    const { data, error } = await supabaseAdmin.from('user_meta').select('objetivo').eq('alumno', alumno).limit(1).maybeSingle();
    if(!error && data) return data.objetivo || null;
  }catch(e){ /* ignore */ }
  return null;
}

// Read selected mission for this alumno from user_meta
async function fetchSelected(){
  if(!supabaseAdmin || !alumno) return null;
  try{
    const { data, error } = await supabaseAdmin.from('user_meta').select('selected_mission').eq('alumno', alumno).limit(1).maybeSingle();
    if(!error && data && typeof data.selected_mission !== 'undefined'){
      return data.selected_mission;
    }
  }catch(e){ /* ignore */ }
  return null;
}

async function upsertSelected(missionNumber){
  if(!supabaseAdmin || !alumno) return;
  try{
  // Include `objetivo` in the upsert payload to avoid inserting NULL
  // when the DB schema declares objetivo NOT NULL.
  const res = await supabaseAdmin.from('user_meta').upsert({ alumno, objetivo: (typeof objetivo !== 'undefined' && objetivo !== null) ? objetivo : '', selected_mission: missionNumber, updated_at: new Date().toISOString() }, { onConflict: ['alumno'] }).select();
  return res;
  }catch(e){ console.warn('upsertSelected', e); }
}

async function upsertObjective(newText){
  if(!supabaseAdmin || !alumno) return;
  try{
    await supabaseAdmin.from('user_meta').upsert({ alumno, objetivo: newText, updated_at: new Date().toISOString() }, { onConflict:['alumno'] });
  }catch(e){ console.warn('upsertObjective', e); }
}

async function fetchRewards(){
  try{
    const res = await fetch('../premios/premios.json');
    if(!res.ok) throw new Error('premios');
    const data = await res.json();
    if(Array.isArray(data?.premios)) return data.premios;
    if(Array.isArray(data)) return data;
  }catch(e){ /* ignore */ }
  // fallback
  return [1,2,3,4,5].map(n=>({ id:'Mateo', premio:n, titulo:`Premio ${n}`, condicion:'' }));
}

async function updateMissionTitle(n, title){
  if(!supabaseAdmin) return;
  try{
    let { error } = await supabaseAdmin.from('missions').update({ title }).eq('number', n);
    if(error){ ({ error } = await supabaseAdmin.from('missions').update({ titulo:title }).eq('numero', n)); }
  }catch(e){ console.warn('updateMissionTitle', e); }
}

async function updateMissionStars(n, stars){
  if(!supabaseAdmin) return;
  const req = calcStars(n);
  const estado = stars >= req;
  try{
    let { error } = await supabaseAdmin.from('missions').update({ estrellas: stars, estado }).eq('number', n);
    if(error){ ({ error } = await supabaseAdmin.from('missions').update({ estrellas: stars, estado }).eq('numero', n)); }
  }catch(e){ console.warn('updateMissionStars', e); }
}

// Render
function renderHeader(){
  const total = sumCompletedStars();
  document.getElementById('totalStars').textContent = `${total}★`;
  const name = alumno || 'Alumno';
  document.getElementById('userName').textContent = name;
  const initial = name.charAt(0).toUpperCase();
  document.getElementById('userCircle').textContent = initial;
  document.getElementById('objUserCircle').textContent = initial;
}

function renderObjective(){
  const el = document.getElementById('objectiveText');
  el.textContent = objetivo || '(sin objetivo)';
}

function missionCardHTML(m){
  const got = typeof m.estrellas === 'number' ? m.estrellas : 0;
  const req = calcStars(m.number);
  const isDone = got >= req;
  const doneClass = isDone ? ' mission-card--done' : '';
  // Render placeholders according to required stars for this mission (1..3)
  const reqStars = req; // calcStars(m.number)
  const gotCapped = Math.max(0, Math.min(got, reqStars));
  let starsHtml = '';
  for(let i=1;i<=reqStars;i++){
    const filled = i <= gotCapped ? 'star--filled' : 'star--empty';
    starsHtml += `<span class="mission-card__star ${filled}" aria-hidden="true">★</span>`;
  }
  return `
  <article class="mission-card${doneClass}" tabindex="0" data-type="mission" data-number="${m.number}">
    <div class="mission-card__left">
      <div class="mission-card__num">${m.number}</div>
  <div class="mission-card__stars" aria-label="${gotCapped}/${reqStars} estrellas">${starsHtml}</div>
    </div>
    <div class="mission-card__body">
      <div class="mission-card__title">${m.title || ''}</div>
    </div>
  </article>`;
}

function rewardCardHTML(blockIdx){
  const n = blockIdx + 1; // premio 1..5
  const reward = rewards[blockIdx] || { id:'Mateo', premio:n, titulo:`Premio ${n}`, condicion:'' };
  // Acumulado
  const thresholds = [20,40,60,80,100];
  const threshold = thresholds[blockIdx] || 20;
  // estrellas completadas acumuladas hasta fin del bloque
  const end = (blockIdx*10) + 10;
  let acc = 0;
  for(let i=1;i<=end;i++){
    const m = missions.find(x=>x.number===i);
    if(!m) continue;
    const req = calcStars(i);
    const got = typeof m.estrellas === 'number' ? m.estrellas : 0;
    if(got >= req) acc += req;
  }
  const img = rewardImageUrl(reward.id, n);
  return `
  <article class="reward-card" data-type="reward" data-block="${blockIdx}">
    <img class="reward-card__img" alt="${reward.titulo||''}" src="${img}" onerror="this.src='https://picsum.photos/seed/reward${n}/1200/675'" />
    <div class="reward-card__header">
      <div class="reward-card__title">${reward.titulo || `Premio ${n}`}</div>
      <div class="reward-card__stars">${acc}/${threshold}</div>
    </div>
    <div class="reward-card__cond">${reward.condicion || ''}</div>
  </article>`;
}

function renderMissions(){
  const list = document.getElementById('missionsList');
  const frag = [];
  for(let b=0;b<5;b++){
    const start = b*10 + 1;
    const end = b*10 + 10;
    for(let n=start; n<=end; n++){
      const m = missions.find(x=>x.number===n) || { number:n, title:`Misión ${n}`, estrellas:0 };
      frag.push(missionCardHTML(m));
    }
    frag.push(rewardCardHTML(b));
  }
  list.innerHTML = frag.join('\n');
  // Selection handlers
  list.querySelectorAll('[data-type="mission"]').forEach(el=>{
    el.addEventListener('click', async ()=>{
      const num = Number(el.dataset.number);
      selected = { type:'mission', number: num };
      // keep selection state persistent
      list.querySelectorAll('.mission-card').forEach(c=>c.classList.remove('is-selected'));
      el.classList.add('is-selected');
      // Persist selection to DB for this alumno
      if(supabaseAdmin){
        try{
          const r = await upsertSelected(num);
          console.log('upsertSelected result', r);
        }catch(e){ console.error('upsertSelected failed', e); }
      }
    });
  });
  document.getElementById('objectiveCard').addEventListener('click', ()=>{
    selected = { type:'objective', number:null };
    list.querySelectorAll('.mission-card').forEach(c=>c.classList.remove('is-selected'));
  });
  // Re-apply visual selection after render (preserve selection across re-renders)
  if(selected && selected.type === 'mission' && typeof selected.number === 'number'){
    const selEl = list.querySelector(`.mission-card[data-number="${selected.number}"]`);
    if(selEl) selEl.classList.add('is-selected');
  }
  
}

// Actions
async function onEdit(){
  // Show floating modal to edit selected mission title
  if(selected.type === 'mission' && selected.number){
    const m = missions.find(x=>x.number===selected.number);
    const current = m?.title || '';
    const modal = document.getElementById('editModal');
    const input = document.getElementById('editModalInput');
    const btnChange = document.getElementById('btnChange');
    const btnBack = document.getElementById('btnBack');
    if(!modal || !input || !btnChange || !btnBack) return;
    // populate and show
    input.value = current;
    modal.setAttribute('aria-hidden', 'false');
    // focus and place caret at the end of the text so user can append immediately
    // Ensure caret is collapsed at the end and prevent a first click/tap from re-selecting the text
    let mouseUpHandler = null;
    let touchEndHandler = null;
    const placeCaretCollapsedAtEnd = ()=>{
      try{
        const len = input.value ? input.value.length : 0;
        input.focus();
        // place caret collapsed at end
        input.setSelectionRange(len, len);

        // If the user releases mouse/touch immediately some browsers may change selection.
        // Prevent that by intercepting the first mouseup/touchend and forcing caret to stay at end.
        mouseUpHandler = function onMouseUp(e){
          // do not prevent default here, allow browser to handle focus/keyboard
          try{ input.setSelectionRange(len,len); }catch(err){}
          input.removeEventListener('mouseup', mouseUpHandler);
          input.removeEventListener('touchend', touchEndHandler);
        };
        touchEndHandler = function onTouchEnd(e){
          // do not prevent default here, allow browser to handle focus/keyboard
          try{ input.setSelectionRange(len,len); }catch(err){}
          input.removeEventListener('touchend', touchEndHandler);
          input.removeEventListener('mouseup', mouseUpHandler);
        };
        input.addEventListener('mouseup', mouseUpHandler);
        input.addEventListener('touchend', touchEndHandler);
        // As a robust fallback, re-focus and set caret at the end shortly after opening
        // then remove the temporary handlers so they don't interfere with typing.
        setTimeout(()=>{
          try{ input.focus(); input.setSelectionRange(len,len); }catch(e){}
          try{ input.removeEventListener('mouseup', mouseUpHandler); }catch(e){}
          try{ input.removeEventListener('touchend', touchEndHandler); }catch(e){}
        }, 50);
      }catch(e){
        input.focus();
      }
    };
    // For touch devices, try another focus/click after a short delay to coax the virtual keyboard
    if('ontouchstart' in window || navigator.maxTouchPoints > 0){
      setTimeout(()=>{
        try{ input.focus(); input.setSelectionRange(input.value.length, input.value.length); input.click(); }catch(e){}
      }, 120);
    }
    // Run on next frame to ensure element is visible and focusable
    requestAnimationFrame(placeCaretCollapsedAtEnd);

    // Handlers
    const closeModal = ()=>{ modal.setAttribute('aria-hidden','true'); cleanup(); };
    const cleanup = ()=>{
      btnChange.removeEventListener('click', onChange);
      btnBack.removeEventListener('click', onBack);
      modal.querySelector('[data-close]')?.removeEventListener('click', onBack);
    };
    const onBack = (e)=>{ e && e.preventDefault(); closeModal(); };
    const onChange = async (e)=>{
      e && e.preventDefault();
      const next = input.value || '';
      // update local model and UI
      if(m){ m.title = next; }
      renderMissions();
      // persist
      await updateMissionTitle(m.number, next);
      closeModal();
    };
    btnChange.addEventListener('click', onChange);
    btnBack.addEventListener('click', onBack);
    modal.querySelector('[data-close]')?.addEventListener('click', onBack);

    // allow Esc to close
    const onKey = (ev)=>{ if(ev.key==='Escape') { closeModal(); window.removeEventListener('keydown', onKey); } };
    window.addEventListener('keydown', onKey);

  } else if(selected.type === 'objective'){
    const current = objetivo || '';
    const next = window.prompt('Editar objetivo', current);
    if(next!=null){
      objetivo = next;
      renderObjective();
      await upsertObjective(next);
    }
  }
}

async function onDec(){
  if(selected.type !== 'mission' || !selected.number) return;
  const m = missions.find(x=>x.number===selected.number);
  const got = Math.max(0, (m?.estrellas||0) - 1);
  m.estrellas = got;
  renderHeader();
  renderMissions();
  await updateMissionStars(m.number, got);
}

async function onInc(){
  if(selected.type !== 'mission' || !selected.number) return;
  const m = missions.find(x=>x.number===selected.number);
  const req = calcStars(m.number);
  const current = Math.max(0, m?.estrellas || 0);
  const next = Math.min(req, current + 1);
  m.estrellas = next;
  renderHeader();
  renderMissions();
  await updateMissionStars(m.number, m.estrellas);
}

// Init
async function init(){
  alumno = await fetchUser();
  missions = await fetchMissions();
  objetivo = await fetchObjective();
  rewards = await fetchRewards();
  renderHeader();
  renderObjective();
  renderMissions();
  // buttons
  document.getElementById('btnEdit').addEventListener('click', onEdit);
  document.getElementById('btnDec').addEventListener('click', onDec);
  document.getElementById('btnInc').addEventListener('click', onInc);

  // Realtime: suscribirse a cambios en la tabla `missions` para actualizar UI en tiempo real
  if(supabaseAdmin){
    try{
      await supabaseAdmin
        .channel('realtime-missions-admin')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'missions' }, (payload) => {
          const row = payload.new || payload.old;
          if(!row) return;
          const num = (row.number ?? row.numero);
          const title = (row.title ?? row.titulo);
          const estrellas = (typeof row.estrellas === 'number') ? row.estrellas : undefined;
          const estado = (typeof row.estado === 'boolean') ? row.estado : undefined;
          // Find existing mission and update fields, or insert if missing
          const idx = missions.findIndex(m => m.number === num);
          if(idx >= 0){
            const m = missions[idx];
            if(typeof title !== 'undefined') m.title = title;
            if(typeof estrellas !== 'undefined') m.estrellas = estrellas;
            if(typeof estado !== 'undefined') m.estado = estado;
          } else if(typeof num === 'number'){
            missions.push({ number: num, title: title || `Misión ${num}`, estrellas: (typeof estrellas === 'number' ? estrellas : 0), estado: !!estado });
            missions.sort((a,b)=>a.number-b.number);
          }
          // Actualizar UI
          renderHeader();
          renderMissions();
        })
        .subscribe();
    }catch(e){ console.warn('Realtime subscription (Admin) failed', e); }
  }

  // Load initial selected mission for this alumno and subscribe to changes
  if(supabaseAdmin && alumno){
    try{
      const sel = await fetchSelected();
      if(typeof sel === 'number'){
        selected = { type:'mission', number: sel };
        // apply visual selection after render
        const list = document.getElementById('missionsList');
        list.querySelectorAll('.mission-card').forEach(c=>c.classList.remove('is-selected'));
        const el = list.querySelector(`.mission-card[data-number="${sel}"]`);
        if(el) el.classList.add('is-selected');
      }
      supabaseAdmin
        .channel('rt-user-meta-'+alumno)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_meta' }, (payload)=>{
          const row = payload.new || payload.old;
          if(!row) return;
          if(row.alumno !== alumno) return;
          const sel2 = row.selected_mission;
          const list2 = document.getElementById('missionsList');
          if(typeof sel2 === 'number'){
            selected = { type:'mission', number: sel2 };
            list2.querySelectorAll('.mission-card').forEach(c=>c.classList.remove('is-selected'));
            const el2 = list2.querySelector(`.mission-card[data-number="${sel2}"]`);
            if(el2) el2.classList.add('is-selected');
          } else {
            selected = { type:null, number:null };
            list2.querySelectorAll('.mission-card').forEach(c=>c.classList.remove('is-selected'));
          }
        })
        .subscribe();
    }catch(e){ console.warn('user_meta init/subscribe failed', e); }
  }
}

init();
