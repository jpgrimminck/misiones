// === Constantes de layout y selectores ===
// Valores iniciales; luego se leerán desde el DOM para respuesta fluida
let COL_MISSION_W = 480; // px
let COL_REWARD_W = 720;  // px
let GAP = 20;            // px
let PEEK_LEFT = 84;      // px ~20%

const track = document.getElementById('carouselTrack');
const viewport = document.getElementById('carouselViewport');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const progressTicks = document.getElementById('progressTicks');
const avatarImg = document.getElementById('avatarImg');
const avatarNameEl = document.querySelector('.avatar__name');
let avatarInitialEl = null;
let currentUserName = 'Mateo';
// DB alumno usado para escribir en la tabla `missions` (inicializado en init desde usuarios.json)
let DB_ALUMNO = null;
// Supabase client (read-only for mission titles)
const supabase = (window.supabase && window.SUPABASE_URL)
  ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
  : null;

// Avatar temporal (royalty-free) con fallback
avatarImg.src = 'https://source.unsplash.com/100x100/?kid,avatar';
avatarImg.onerror = () => { avatarImg.src = 'https://picsum.photos/seed/mateo/100/100'; };

// Estado
let missions = []; // { numero, titulo }
let rewards = [];  // { id, premio, titulo, condicion }
// Estrellas adquiridas por misión: Map<num, estrellas>
let acquired = new Map();
let selectedMission = null; // numero de misión seleccionado (primer clic solo selecciona)
let colIndex = 0; // índice de columna visible en el carrusel
// Track de desbloqueo previo por premio para animación
let rewardUnlockedPrev = [false,false,false,false,false];
// Valor mostrado actualmente en cada contador de premio (0..5)
let rewardDisplay = [0,0,0,0,0];
// Timers por premio para animar conteo progresivo
let rewardTimers = [null,null,null,null,null];
// Estado de revelado visual y timers por premio
let rewardRevealDone = [false,false,false,false,false];
let rewardRevealTimers = [null,null,null,null,null];
// Misión que debe animar relleno en este render
let lastAnimMission = null;
// Datos para animar relleno parcial tras render
let fillAnim = null; // { n, from, to }
// Misiones COMPLETAS “visibles” (se agregan 1.5s después de completarse)
const visibleCompleted = new Set(); // números de misión
// Timers por misión para aplicar el retardo de visibilidad
const completionTimers = new Map(); // n -> timeoutId

// === Utilidades ===
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function calcStars(num){
  const pos = ((num - 1) % 10) + 1;
  if (pos <= 3) return 1;
  if (pos <= 7) return 2;
  return 3;
}
// === Persistencia de progreso en la tabla `missions` ===
// Lee las columnas de progreso (estrellas/estado) y rellena `acquired` y `visibleCompleted`.
async function loadMissionProgressFromDB(alumno){
  if(!supabase) return;
  try{
    // Intentamos columnas en inglés (number) y en español (numero)
    let { data, error } = await supabase.from('missions').select('number,estrellas,estado').limit(1000);
    if(error || !data || data.length===0){
      ({ data, error } = await supabase.from('missions').select('numero,estrellas,estado').limit(1000));
    }
    if(error || !data) return;
    data.forEach(row=>{
      const n = (row.number ?? row.numero);
      const s = (typeof row.estrellas === 'number') ? row.estrellas : 0;
      if(typeof n === 'number'){
        acquired.set(n, s);
        const req = calcStars(n);
        if(s >= req){ visibleCompleted.add(n); }
      }
    });
    calcProgress();
    render();
  }catch(e){ console.warn('loadMissionProgressFromDB error', e); }
}

// Actualiza las columnas `estrellas` y `estado` en la tabla `missions` para la fila indicada.
// Hacemos una actualización optimista en la UI; esta función intenta update por `number` o `numero`.
async function upsertMissionProgress(alumno, missionNumber, stars){
  if(!supabase) return;
  const required = calcStars(missionNumber);
  const completed = stars >= required;
  // Intentar update por columna `number`
  try{
    let { data, error } = await supabase.from('missions').update({ estrellas: stars, estado: completed, alumno }).eq('number', missionNumber).select();
    if(error) {
      // intentar por `numero`
      ({ data, error } = await supabase.from('missions').update({ estrellas: stars, estado: completed, alumno }).eq('numero', missionNumber).select());
    }
    // Si no existe row (data length 0) intentamos insertar como fallback
    if(!error && data && data.length===0){
      // Intentar insert sencillo (puede fallar si otras columnas son NOT NULL)
      await supabase.from('missions').insert({ number: missionNumber, estrellas: stars, estado: completed, alumno }).select();
    }
    if(error) throw error;
    return true;
  }catch(err){
    console.error('upsertMissionProgress error', err);
    throw err;
  }
}
function highestCompletedBlock(){
  // Devuelve el índice del bloque más alto completamente completado (0..4), o -1 si ninguno
  let highest = -1;
  for(let b=0;b<5;b++){
    const start = b*10 + 1;
    const end = b*10 + 10;
    let all = true;
    for(let n=start;n<=end;n++){
  const maxS = calcStars(n);
  const got = acquired.get(n) || 0;
  if(got < maxS) { all = false; break; }
    }
    if(all) highest = b; else break; // se requiere secuencia: si un bloque no está completo, se detiene
  }
  return highest;
}
function isLocked(num){
  const highest = highestCompletedBlock();
  const activeBlock = Math.min(highest + 1, 4); // bloque actualmente habilitado
  const maxMissionEnabled = (activeBlock + 1) * 10; // límite superior inclusivo
  return num > maxMissionEnabled;
}
function blockForMission(num){
  return Math.floor((num - 1) / 10); // 0..4
}

function calcProgress(){
  const stars = totalStars();
  const pct = Math.max(0, Math.min(100, (stars / 100) * 100));
  progressFill.style.width = pct + '%';
  progressLabel.textContent = String(stars);
}

// Estrellas totales visibles: contar solo misiones COMPLETAS ya visibles (parciales no suman)
function totalStars(){
  let sum = 0;
  visibleCompleted.forEach((n)=>{ sum += calcStars(n); });
  return sum;
}

function buildTicks(){
  // Ticks 0..100 cada 10; mayor en 0,20,40,60,80,100 con etiquetas arriba
  const total = 11;
  const frag = document.createDocumentFragment();
  for(let i=0;i<total;i++){
    const t = document.createElement('div');
    const isMajor = i % 2 === 0; // 0,2,4,6,8,10 => 0/20/40/60/80/100
    t.style.position = 'absolute';
    const left = (i/10)*100;
    t.style.left = left + '%';
    t.style.top = '0';
    t.style.width = '2px';
    t.style.height = isMajor ? '24px' : '12px';
    t.style.background = 'rgba(255,255,255,' + (isMajor ? '0.6' : '0.3') + ')';
    t.style.transform = 'translateX(-1px)';
    frag.appendChild(t);

    // Etiquetas solo para 20,40,60,80,100 (i=2,4,6,8,10)
    if(i>0 && isMajor){
      const label = document.createElement('div');
      label.className = 'progress__tick-label';
      const value = i*10; // 20..100
      label.textContent = `${value}\u2605`; // ★
      label.style.left = left + '%';
      frag.appendChild(label);
    }
  }
  progressTicks.appendChild(frag);
}

// === Construcción de columnas ===
// Secuencia de columnas: [M1,M2,P1, M3,M4,P2, ... M9,M10,P5]
function makeColumnsOrder(){
  const order = [];
  for(let b=0;b<5;b++){
    const mA = b*10 + 1; // 1,11,21,31,41
    const mB = b*10 + 6; // 6,16,26,36,46
    order.push({type:'missions', from:mA, to:mA+4});
    order.push({type:'missions', from:mB, to:mB+4});
    order.push({type:'reward', index:b}); // 0..4
  }
  return order;
}

function render(){
  track.innerHTML = '';
  const order = makeColumnsOrder();
  order.forEach((col)=>{
  if(col.type==='missions'){
      const c = document.createElement('div');
      c.className = 'col col--mission';
      for(let n=col.from; n<=col.to; n++){
  const data = missions.find(m=>m.numero===n);
  const card = document.createElement('div');
    const locked = isLocked(n);
    const maxS = calcStars(n);
    const got = acquired.get(n) || 0;
    const done = got >= maxS;
    const isSelected = selectedMission === n && !locked;
    card.className = 'm-card'
      + (done ? ' m-card--done' : '')
      + (locked ? ' m-card--locked' : '')
      + (isSelected ? ' m-card--selected' : '');
    const fill = maxS > 0 ? (got / maxS) : 0;
    // Si esta tarjeta es la que debe animar, iniciar en "from" para permitir transición hacia "to"
    if (fillAnim && fillAnim.n === n) {
      card.style.setProperty('--fill', String(fillAnim.from));
      // Guardamos el destino en dataset para aplicarlo post-render
      card.dataset.animTo = String(fillAnim.to);
    } else {
      card.style.setProperty('--fill', String(fill));
    }
        card.setAttribute('data-num', String(n));
        // número
        const num = document.createElement('div');
        num.className = 'm-card__num';
        num.textContent = String(n);
        // título
        const title = document.createElement('div');
        title.className = 'm-card__title';
        title.textContent = data ? data.titulo : 'Misión ' + n;
        // estrellas
  const stars = document.createElement('div');
  stars.className = 'm-card__stars';
  const starCount = calcStars(n);
  let starText = '★';
  if (starCount === 2) starText = '★★';
  else if (starCount > 2) starText = '3★';
  stars.textContent = starText;
  stars.setAttribute('aria-label', `${starCount} estrellas`);
        // lock icon si aplica
        if(locked){
          const lock = document.createElement('span');
          lock.className = 'm-card__lock';
          lock.innerHTML = '🔒';
          title.appendChild(lock);
        }
        card.appendChild(num);
        card.appendChild(title);
        card.appendChild(stars);
        // interacción:
        // - Primer clic: solo selecciona y muestra borde verde (sin cambiar progreso)
        // - Segundo clic sobre la misión seleccionada: avanza 1 paso; si está al máximo, reinicia a 0
        card.addEventListener('click', ()=>{
          if(isLocked(n)) return;
          // Selección en primer clic
          if(selectedMission !== n){
            selectedMission = n;
            fillAnim = null; // no animación en selección
            render();
            return;
          }
          const prev = acquired.get(n) || 0;
          const next = prev >= maxS ? 0 : Math.min(maxS, prev + 1);
          const fromFill = maxS > 0 ? (prev / maxS) : 0;
          const toFill = maxS > 0 ? (next / maxS) : 0;
          acquired.set(n, next);
          // Persistir cambio optimista en la tabla `missions`
          if(supabase){
            upsertMissionProgress(DB_ALUMNO, n, next).catch(err=>{ console.error('Error guardando progreso en DB', err); });
          }
          // Guardar animación para aplicar post-render y re-renderizar
          fillAnim = { n, from: fromFill, to: toFill };
          render();
          // Gestionar visibilidad diferida para progreso y premios
          const prevComplete = prev >= maxS;
          const nextComplete = next >= maxS;
          // Si pasa a COMPLETA: agendar visibilidad en 1.5s
          if (!prevComplete && nextComplete) {
            if (completionTimers.has(n)) { clearTimeout(completionTimers.get(n)); }
            const tid = setTimeout(()=>{
              const curr = acquired.get(n) || 0;
              if (curr >= maxS) {
                visibleCompleted.add(n);
                calcProgress();
                render();
              }
              completionTimers.delete(n);
            }, 1500);
            completionTimers.set(n, tid);
          }
          // Si sale de COMPLETA: cancelar timer y ocultar inmediatamente
          if (prevComplete && !nextComplete) {
            if (completionTimers.has(n)) { clearTimeout(completionTimers.get(n)); completionTimers.delete(n); }
            if (visibleCompleted.has(n)) { visibleCompleted.delete(n); }
            calcProgress();
            render();
          }
        });
        c.appendChild(card);
      }
      track.appendChild(c);
    } else {
      const idx = col.index; // 0..4
      const reward = rewards[idx] || {titulo:'Premio', condicion:'', premio: idx+1, id: 'default'};
  console.log('[DEBUG] rendering reward', idx, reward && reward.titulo);
  const c = document.createElement('div');
      c.className = 'col col--reward';
      const wrap = document.createElement('div');
  wrap.setAttribute('data-reward-index', String(idx));
      // Premio por bloque: contador 0/20 del bloque correspondiente.
      // Solo cuenta cuando el bloque está habilitado; se desbloquea al llegar a 20/20 de su bloque.
      const start = idx * 10 + 1;
          const end = idx * 10 + 10;
          const activeIdx = Math.min(highestCompletedBlock() + 1, 4); // bloque actualmente habilitado (0..4)
          const blockActive = idx <= activeIdx;
          let blockStars = 0;
          if (blockActive) {
            // Contamos estrellas acumuladas desde la misión 1 hasta el final de este bloque
            for (let n = 1; n <= end; n++) {
              if (visibleCompleted.has(n)) blockStars += calcStars(n);
            }
          }
      // Umbrales crecientes por premio: 20,40,60,80,100
      const thresholds = [20,40,60,80,100];
      const threshold = thresholds[idx] || 20;
      const blockComplete = blockActive && blockStars >= threshold;
  // Desbloqueo visual: solo cuando el conteo mostrado llegó a 20 y pasó 1s
  const wasUnlocked = rewardUnlockedPrev[idx] === true;
  const nowUnlocked = blockComplete && (rewardRevealDone[idx] === true);
  rewardUnlockedPrev[idx] = nowUnlocked;
  wrap.className = 'reward' + (nowUnlocked ? '' : ' reward--locked') + (!wasUnlocked && nowUnlocked ? ' reward--reveal' : '');
  const imgBox = document.createElement('div');
      imgBox.className = 'reward__image';
  const img = document.createElement('img');
  img.alt = reward.titulo;
  const imageIndex = (typeof reward.premio === 'number' ? reward.premio : (idx+1));
  img.src = rewardImageUrlFor(reward.id, imageIndex);
  img.onerror = () => { img.src = 'https://picsum.photos/seed/reward'+(imageIndex)+'/1600/900'; };
  if(!nowUnlocked){
        const lock = document.createElement('div');
        lock.className = 'reward__lock';
        imgBox.appendChild(lock);
      }
  imgBox.appendChild(img);
  const body = document.createElement('div');
      body.className = 'reward__body';
  // Encabezado: título + contador de estrellas 0/20 (por bloque)
  const header = document.createElement('div');
  header.className = 'reward__header';
  const tt = document.createElement('div');
  tt.className = 'reward__title';
  tt.textContent = reward.titulo;
  const starCounter = document.createElement('div');
  starCounter.className = 'reward__stars' + (blockComplete ? ' is-complete' : '');
  const target = blockActive ? Math.min(blockStars, threshold) : 0;
  // Inicializar valor mostrado si no está definido
  if (typeof rewardDisplay[idx] !== 'number') rewardDisplay[idx] = target;
  // Si el objetivo bajó, ajustamos inmediatamente el mostrado
  if (rewardDisplay[idx] > target) {
    rewardDisplay[idx] = target;
  }
  // Si el objetivo sube más de 1 y no hay animación en curso, iniciamos conteo progresivo
  const diff = target - rewardDisplay[idx];
  if (diff > 1 && !rewardTimers[idx]) {
    const step = () => {
      // Avanzar de a 1 hasta el objetivo de este render
      const currentTarget = target;
      if (rewardDisplay[idx] >= currentTarget) { 
        rewardTimers[idx] = null; 
        // Si alcanzó el umbral y está completo, programar revelado 1s después
        if (blockComplete && rewardDisplay[idx] >= threshold && !rewardRevealDone[idx] && !rewardRevealTimers[idx]) {
          rewardRevealTimers[idx] = setTimeout(()=>{
            if (blockComplete && rewardDisplay[idx] >= threshold) {
              rewardRevealDone[idx] = true;
              render();
            }
            rewardRevealTimers[idx] = null;
          }, 1000);
        }
        return; 
      }
      rewardDisplay[idx] = rewardDisplay[idx] + 1;
      const el = track.querySelector(`.col--reward [data-reward-index="${idx}"] .reward__stars`);
      if (el) { el.textContent = `${rewardDisplay[idx]}/${threshold}`; }
      if (rewardDisplay[idx] < currentTarget) {
        rewardTimers[idx] = setTimeout(step, 300);
      } else {
        rewardTimers[idx] = null;
        // Programar revelado si corresponde
        if (blockComplete && rewardDisplay[idx] >= threshold && !rewardRevealDone[idx] && !rewardRevealTimers[idx]) {
          rewardRevealTimers[idx] = setTimeout(()=>{
            if (blockComplete && rewardDisplay[idx] >= threshold) {
              rewardRevealDone[idx] = true;
              render();
            }
            rewardRevealTimers[idx] = null;
          }, 1000);
        }
      }
    };
    rewardTimers[idx] = setTimeout(step, 300);
  } else if (diff === 1 && !rewardTimers[idx]) {
    // Incremento de 1: actualizamos directamente
    rewardDisplay[idx] = target;
  } else if (diff <= 0 && !rewardTimers[idx]) {
    rewardDisplay[idx] = target;
  }
  starCounter.textContent = `${rewardDisplay[idx]}/${threshold}`;
  // Si ya llegó al umbral sin animación pendiente, preparar revelado con 1s
  if (blockComplete) {
    if (rewardDisplay[idx] >= threshold) {
      if (!rewardRevealDone[idx] && !rewardRevealTimers[idx]) {
        rewardRevealTimers[idx] = setTimeout(()=>{
          if (blockComplete && rewardDisplay[idx] >= threshold) {
            rewardRevealDone[idx] = true;
            render();
          }
          rewardRevealTimers[idx] = null;
        }, 1000);
      }
    } else {
      // Aún no llega: cancelar cualquier revelado pendiente
      if (rewardRevealTimers[idx]) { clearTimeout(rewardRevealTimers[idx]); rewardRevealTimers[idx] = null; }
    }
  } else {
    // Si dejó de estar completo, cancelar revelado y resetear estado
    if (rewardRevealTimers[idx]) { clearTimeout(rewardRevealTimers[idx]); rewardRevealTimers[idx] = null; }
    rewardRevealDone[idx] = false;
  }
  header.appendChild(tt);
  header.appendChild(starCounter);
      const cond = document.createElement('div');
      cond.className = 'reward__cond';
      cond.textContent = reward.condicion || '';
  body.appendChild(header);
      body.appendChild(cond);
      wrap.appendChild(imgBox);
      wrap.appendChild(body);
      c.appendChild(wrap);
      track.appendChild(c);
    }
  });
  // ajustar ancho del track
  const cols = Array.from(track.children);
  let totalW = 0;
  cols.forEach((el,i)=>{
    const isReward = el.classList.contains('col--reward');
    totalW += (isReward?COL_REWARD_W:COL_MISSION_W);
    if(i<cols.length-1) totalW += GAP;
  });
  track.style.width = totalW + 'px';
  applyTransform();
  // Si hay una animación pendiente, aplicarla tras montar el DOM
  if (fillAnim) {
    const n = fillAnim.n;
    requestAnimationFrame(() => {
      const el = track.querySelector(`.m-card[data-num="${n}"]`);
      if (!el) { fillAnim = null; return; }
      // Forzar un reflow para confirmar el estado inicial (from)
      void el.offsetWidth;
      // En el siguiente frame, transicionar hacia el destino (to)
      requestAnimationFrame(() => {
        const to = el.dataset.animTo || String(fillAnim.to);
        el.style.setProperty('--fill', String(to));
        // Limpiar
        delete el.dataset.animTo;
        fillAnim = null;
      });
    });
  }
}

function viewportWidth(){
  // Lee el ancho del viewport actual (contenido visible)
  return viewport.clientWidth;
}

function colWidthAt(i){
  const el = track.children[i];
  if(!el) return 0;
  return el.classList.contains('col--reward') ? COL_REWARD_W : COL_MISSION_W;
}
function translateForIndex(idx){
  // Queremos que al estar en índice idx, se vea completamente esa columna y la(s) siguientes
  // dejando ~20% de la columna anterior (si existe) a la izquierda.
  let x = 0;
  for(let i=0;i<idx;i++){
    x += colWidthAt(i) + GAP;
  }
  // restamos el peek de la columna anterior si existe
  if(idx>0){
    x -= PEEK_LEFT;
  }
  return -x; // hacia la izquierda
}
function applyTransform(){
  let x = translateForIndex(colIndex);
  const trackW = track.getBoundingClientRect().width;
  const vpW = viewportWidth();
  const maxLeft = vpW - trackW; // valor mínimo permitido (más negativo)
  // Clamp: 0 = inicio; maxLeft = final
  x = Math.min(0, Math.max(maxLeft, x));
  track.style.transform = `translateX(${x}px)`;
}

function rewardImageUrlFor(userId, n){
  const safeId = encodeURIComponent(userId || 'default');
  const safeN = String(n).replace(/[^0-9]/g, '');
  // Ruta local: ./premios/<ID>/<n>.jpeg
  return `../premios/${safeId}/${safeN}.jpeg`;
}

// === Navegación ===
btnPrev.addEventListener('click', ()=>{
  colIndex = clamp(colIndex-1, 0, track.children.length-1);
  applyTransform();
});
btnNext.addEventListener('click', ()=>{
  colIndex = clamp(colIndex+1, 0, track.children.length-1);
  applyTransform();
});
window.addEventListener('keydown', (e)=>{
  if(e.key==='ArrowLeft'){ btnPrev.click(); }
  else if(e.key==='ArrowRight'){ btnNext.click(); }
});

// === Carga de datos ===
async function loadJSON(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error('No se pudo cargar '+path);
  return res.json();
}

// Carga tolerante: si falla, devuelve null sin romper el flujo
async function safeLoad(path){
  try { return await loadJSON(path); }
  catch(e){ console.warn('[WARN] No se pudo cargar', path, e); return null; }
}

async function init(){
  buildTicks();
  try{
  const uData = await safeLoad('../usuarios.json');
  const pData = await safeLoad('../premios/premios.json');
    // Misiones desde Supabase (independiente de JSON locales)
    let missionsDB = null;
    if (supabase) {
      // Cargar desde la tabla confirmada "missions" con fallbacks de esquema/columnas.
      let data = null, error = null;
      // Intentos con columnas en inglés (number,title)
      ({ data, error } = await supabase.from('missions').select('number,title'));
      if (error) {
        ({ data, error } = await supabase.from('public.missions').select('number,title'));
      }
      if (error && supabase.schema) {
        ({ data, error } = await supabase.schema('public').from('missions').select('number,title'));
      }
      // Fallback a columnas en español (numero,titulo)
      if (error) {
        ({ data, error } = await supabase.from('missions').select('numero,titulo'));
      }
      if (error) {
        ({ data, error } = await supabase.from('public.missions').select('numero,titulo'));
      }
      if (error && supabase.schema) {
        ({ data, error } = await supabase.schema('public').from('missions').select('numero,titulo'));
      }
      if (!error) {
        const rows = (data||[])
          .map(r=>({ numero: (r.number ?? r.numero), titulo: (r.title ?? r.titulo) }))
          .filter(r=> typeof r.numero === 'number' && r.titulo)
          .sort((a,b)=> a.numero - b.numero);
        missionsDB = rows;
        console.log(`[Supabase] missions cargadas: ${rows.length}`);
      } else {
        const e = error || {};
        console.error('[Supabase] Error cargando missions:', {
          code: e.code,
          message: e.message,
          details: e.details,
          hint: e.hint
        });
      }
    }
  currentUserName = (uData && (uData.nombre || uData.id)) || 'Mateo';
  // Usar el usuario leído desde usuarios.json como alumno de DB
  DB_ALUMNO = currentUserName;
  if(avatarNameEl){ avatarNameEl.textContent = currentUserName; }
    // Crear avatar por inicial
    const initial = (currentUserName || 'M').charAt(0).toUpperCase();
    const avatarContainer = document.querySelector('.avatar');
    if(avatarContainer){
      // Ocultar imagen si existe
      if(avatarImg){ avatarImg.style.display = 'none'; }
      if(!avatarInitialEl){
        avatarInitialEl = document.createElement('div');
        avatarInitialEl.className = 'avatar__circle';
        avatarContainer.insertBefore(avatarInitialEl, avatarContainer.firstChild);
      }
      avatarInitialEl.textContent = initial;
    }
    if (Array.isArray(missionsDB) && missionsDB.length > 0) {
      missions = missionsDB;
    } else {
      // Fallback: no usar misiones.json para títulos; placeholder "Misión n"
      missions = Array.from({length:50}, (_,i)=>({numero:i+1, titulo:'Misión '+(i+1)}));
    }
    // Procesar datos de premios de forma defensiva: puede venir como {premios: [...]} o como array en raíz
    let parsedRewards = null;
    if (pData) {
      if (Array.isArray(pData.premios)) parsedRewards = pData.premios;
      else if (Array.isArray(pData)) parsedRewards = pData;
    }
    if (parsedRewards && parsedRewards.length>0) {
      rewards = parsedRewards;
    } else {
      rewards = [1,2,3,4,5].map(n=>({id:'Mateo', premio:n, titulo:'Premio '+n, condicion:''}));
    }
    console.log('[DEBUG] premios raw:', pData);
    console.log('[DEBUG] rewards used:', rewards);
      // Cargar progreso desde la tabla `missions` (si existen columnas estrellas/estado)
      if (supabase) {
        try { await loadMissionProgressFromDB(DB_ALUMNO); } catch(e){ console.warn('No se pudo cargar progreso desde DB', e); }
      }
    // Realtime: reflejar cambios de títulos
  if (supabase) {
      supabase
        .channel('rt-missions')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'missions' }, (payload)=>{
          const row = payload.new || payload.old;
          if(!row) return;
          const num = (row.number ?? row.numero);
          const title = (row.title ?? row.titulo);
          const estrellas = (typeof row.estrellas === 'number') ? row.estrellas : undefined;
          const estado = (typeof row.estado === 'boolean') ? row.estado : undefined;
          const i = missions.findIndex(m=>m.numero===num);
          if (payload.eventType === 'DELETE') {
            if (i>=0) missions.splice(i,1);
            // remove any local progress
            acquired.delete(num);
            visibleCompleted.delete(num);
          } else {
            if (i>=0) {
              // update title if present
              if (typeof title !== 'undefined') missions[i].titulo = title;
            } else if (typeof num === 'number') {
              missions.push({ numero: num, titulo: title || `Misión ${num}` });
              missions.sort((a,b)=>a.numero-b.numero);
            }
            // Update progress map if estrellas present
            if (typeof estrellas === 'number'){
              acquired.set(num, estrellas);
              const req = calcStars(num);
              if (estrellas >= req) visibleCompleted.add(num);
              else visibleCompleted.delete(num);
            }
            // If estado provided but not estrellas, use estado to toggle visibleCompleted
            else if (typeof estado === 'boolean'){
              if (estado) visibleCompleted.add(num);
              else visibleCompleted.delete(num);
            }
          }
          // Recalculate progress and re-render
          calcProgress();
          render();
        })
        .subscribe();
    }
    // Subscribe to user_meta for selection changes (so TV highlights selected mission)
    if (supabase) {
      try{
        supabase
          .channel('rt-user-meta-tv')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'user_meta' }, (payload)=>{
            const row = payload.new || payload.old;
            if(!row) return;
            const alumnoRow = row.alumno;
            // Only react to the current DB_ALUMNO if defined
            if(DB_ALUMNO && alumnoRow !== DB_ALUMNO) return;
            const sel = row.selected_mission;
            if(typeof sel === 'number'){
              selectedMission = sel;
            } else {
              selectedMission = null;
            }
            render();
          })
          .subscribe();
      }catch(e){ console.warn('user_meta realtime (TV) failed', e); }
    }
  }catch(err){
    console.error(err);
    // fallback mínimo
    missions = Array.from({length:50}, (_,i)=>({numero:i+1, titulo:'Misión '+(i+1)}));
  // Mantener premios por defecto si algo falla por completo
  rewards = [1,2,3,4,5].map(n=>({id:'Mateo', premio:n, titulo:'Premio '+n, condicion:''}));
    if(avatarNameEl){ avatarNameEl.textContent = currentUserName; }
    const avatarContainer = document.querySelector('.avatar');
    if(avatarContainer){
      if(avatarImg){ avatarImg.style.display = 'none'; }
      if(!avatarInitialEl){
        avatarInitialEl = document.createElement('div');
        avatarInitialEl.className = 'avatar__circle';
        avatarContainer.insertBefore(avatarInitialEl, avatarContainer.firstChild);
      }
      avatarInitialEl.textContent = (currentUserName||'M').charAt(0).toUpperCase();
    }
  }
  render();
  calcProgress();
  // Medir tamaños reales ya en DOM
  requestAnimationFrame(()=>{
    // Si hay columnas, medir la primera misión y primera de premio para ajustar constantes
    const firstMission = track.querySelector('.col--mission');
    const firstReward = track.querySelector('.col--reward');
    if(firstMission) COL_MISSION_W = firstMission.getBoundingClientRect().width;
    if(firstReward) COL_REWARD_W = firstReward.getBoundingClientRect().width;
    // GAP como distancia entre columnas
    const cols = track.querySelectorAll('.col');
    if(cols.length>=2){
      const a = cols[0].getBoundingClientRect();
      const b = cols[1].getBoundingClientRect();
      GAP = Math.max(0, Math.round(b.left - (a.right)));
    }
    // PEEK_LEFT ≈ 20% de una columna de misión
    PEEK_LEFT = Math.round(COL_MISSION_W * 0.2);
    applyTransform();
  });
}

// Recalcular medidas al redimensionar
window.addEventListener('resize', ()=>{
  const firstMission = track.querySelector('.col--mission');
  const firstReward = track.querySelector('.col--reward');
  if(firstMission) COL_MISSION_W = firstMission.getBoundingClientRect().width;
  if(firstReward) COL_REWARD_W = firstReward.getBoundingClientRect().width;
  const cols = track.querySelectorAll('.col');
  if(cols.length>=2){
    const a = cols[0].getBoundingClientRect();
    const b = cols[1].getBoundingClientRect();
    GAP = Math.max(0, Math.round(b.left - (a.right)));
  }
  PEEK_LEFT = Math.round(COL_MISSION_W * 0.2);
  applyTransform();
});

init();
