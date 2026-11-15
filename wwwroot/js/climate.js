(() => {
  const $ = id => document.getElementById(id);
  if (!$('climateSection')) return;

  // ====== CONFIGURACIÓN AGRONÓMICA DEL TRIGO (orientativa, editable) ======
  const WHEAT = {
    // Ventanas generales de siembra por macrozona (meses 0=ene ... 11=dic)
    windows: { norte: { months:[4,5],   text:'mayo a junio' },
               centro:{ months:[4,5,6], text:'mayo a julio' },
               sur:   { months:[5,6,7], text:'junio a agosto' } },
    tempMeanOk: [8, 20],        // °C medios diarios ideales
    tempMeanLimit: [4, 25],     // fuera de este rango: no apto
    frostNo: -5,                // mínima <= este valor: helada fuerte
    frostWarn: -2,              // mínima <= este valor: helada leve
    rainNo: 25,                 // mm en el día: no se puede sembrar / anegamiento
    rainWarn: 10,               // mm en el día: precaución
    moisture30Min: 20,          // mm acumulados en los 30 días previos: menos = poca humedad
    okShare: 0.70,              // % de días aptos para veredicto "Apto"
    warnShare: 0.50             // % de días aptos + con precaución para "Apto con precaución"
  };
  const MAX_RANGE_DAYS = 366;
  const FORECAST_DAYS = 15;     // Open-Meteo: pronóstico diario hasta 16 días
  const ARCHIVE_DELAY = 6;      // el archivo histórico tiene unos días de retraso
  const CLIM_YEARS = 5;         // años usados para el promedio climático

  const charts = { history: null, future: null };
  let busy = false, pending = false;
  let fpHistory = null, fpFuture = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v, d = 1) => Number.isFinite(Number(v)) && v !== null ? Number(v).toFixed(d) : '—';
  const toNum = v => (v === null || v === undefined || !Number.isFinite(Number(v))) ? null : Number(v);
  const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const parseKey = k => new Date(`${k}T12:00:00`);
  const shiftDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
  const shiftYearsKey = (k, n) => { const x = parseKey(k); x.setFullYear(x.getFullYear()+n); return dateKey(x); };
  const fmt = k => parseKey(k).toLocaleDateString('es-AR');
  const eachDay = (a, b) => { const out = []; for (let d = parseKey(a); d <= parseKey(b); d = shiftDays(d,1)) out.push(dateKey(d)); return out; };
  const avg = arr => { const v = arr.filter(x => x !== null && Number.isFinite(x)); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; };
  const sum = arr => arr.reduce((a,b)=>a+(b||0),0);
  const sky = c => ({0:'Despejado',1:'Mayormente despejado',2:'Parcialmente nublado',3:'Nublado',45:'Niebla',48:'Niebla',51:'Llovizna',53:'Llovizna',55:'Llovizna intensa',61:'Lluvia',63:'Lluvia moderada',65:'Lluvia intensa',80:'Chaparrones',81:'Chaparrones',82:'Chaparrones intensos',95:'Tormenta',96:'Tormenta con granizo',99:'Tormenta intensa'})[Number(c)] || 'Condición variable';
  const SRC = { historico:'Dato histórico', pronostico:'Pronóstico', climatologia:'Promedio climático (no es pronóstico)', sindato:'Sin dato' };

  async function get(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Servicio meteorológico: error ${response.status}`);
    return response.json();
  }
  function parcel() {
    const id = Number($('analysisParcelSelect')?.value);
    return (window.agroParcels || []).find(p => Number(p.id) === id);
  }

  async function loadCurrent(p) {
    const d = await get(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code&timezone=auto`);
    const c = d.current;
    const cards = [['Estado del cielo',sky(c.weather_code),'Código meteorológico'],['Temperatura',num(c.temperature_2m)+' °C','A 2 metros'],['Humedad',num(c.relative_humidity_2m,0)+' %','Humedad relativa'],['Viento',num(c.wind_speed_10m)+' km/h','Velocidad a 10 metros'],['Precipitación',num(c.precipitation)+' mm','Dato actual del modelo']];
    $('currentWeather').innerHTML = cards.map(x=>`<div class="weather-current-card"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong><small>${esc(x[2])}</small></div>`).join('');
  }

  // ====== OBTENCIÓN DE DATOS DIARIOS PARA CUALQUIER RANGO DE FECHAS ======
  const DAILY = 'precipitation_sum,temperature_2m_max,temperature_2m_min';
  function putRows(map, d, sourceFn) {
    (d?.time || []).forEach((t, i) => map.set(t, {
      date: t, rain: toNum(d.precipitation_sum?.[i]), max: toNum(d.temperature_2m_max?.[i]), min: toNum(d.temperature_2m_min?.[i]), source: sourceFn(t)
    }));
  }
  async function fetchClimatology(days, p) {
    const first = days[0], last = days[days.length-1];
    const results = await Promise.all(Array.from({length:CLIM_YEARS}, (_, i) => i+1).map(async y => {
      const s = shiftYearsKey(first, -y), e = shiftYearsKey(last, -y);
      const d = (await get(`https://archive-api.open-meteo.com/v1/archive?latitude=${p.lat}&longitude=${p.lon}&start_date=${s}&end_date=${e}&daily=${DAILY}&timezone=auto`)).daily;
      return { y, d };
    }));
    const acc = new Map();
    results.forEach(({ y, d }) => (d?.time || []).forEach((t, i) => {
      const key = `${Number(t.slice(0,4)) + y}${t.slice(4)}`;
      if (!acc.has(key)) acc.set(key, { rain:[], max:[], min:[] });
      const o = acc.get(key);
      o.rain.push(toNum(d.precipitation_sum?.[i])); o.max.push(toNum(d.temperature_2m_max?.[i])); o.min.push(toNum(d.temperature_2m_min?.[i]));
    }));
    return new Map(days.map(k => {
      const o = acc.get(k);
      return [k, { date:k, rain:o ? avg(o.rain) : null, max:o ? avg(o.max) : null, min:o ? avg(o.min) : null, source:'climatologia' }];
    }));
  }
  // Devuelve [{date, rain, max, min, source}] para todos los días entre startKey y endKey (inclusive)
  async function fetchDaily(startKey, endKey, p) {
    const today = new Date(), todayKey = dateKey(today);
    const archiveLast = dateKey(shiftDays(today, -ARCHIVE_DELAY));
    const forecastLast = dateKey(shiftDays(today, FORECAST_DAYS));
    const days = eachDay(startKey, endKey);
    const arch = days.filter(k => k <= archiveLast);
    const fore = days.filter(k => k > archiveLast && k <= forecastLast);
    const clim = days.filter(k => k > forecastLast);
    const map = new Map();
    await Promise.all([
      arch.length ? get(`https://archive-api.open-meteo.com/v1/archive?latitude=${p.lat}&longitude=${p.lon}&start_date=${arch[0]}&end_date=${arch[arch.length-1]}&daily=${DAILY}&timezone=auto`).then(r => putRows(map, r.daily, () => 'historico')) : null,
      fore.length ? get(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&start_date=${fore[0]}&end_date=${fore[fore.length-1]}&daily=${DAILY}&timezone=auto`).then(r => putRows(map, r.daily, k => k < todayKey ? 'historico' : 'pronostico')) : null,
      clim.length ? fetchClimatology(clim, p).then(m => m.forEach((v, k) => map.set(k, v))) : null
    ]);
    return days.map(k => map.get(k) || { date:k, rain:null, max:null, min:null, source:'sindato' });
  }

  // ====== GRÁFICOS ======
  function renderChart(key, canvasId, rows) {
    if (typeof Chart === 'undefined') throw new Error('No se pudo cargar Chart.js. Comprobá tu conexión a Internet.');
    if (charts[key]) charts[key].destroy();
    const crossYear = rows.length && rows[0].date.slice(0,4) !== rows[rows.length-1].date.slice(0,4);
    const labels = rows.map(r => parseKey(r.date).toLocaleDateString('es-AR', crossYear ? {day:'2-digit',month:'2-digit',year:'2-digit'} : {day:'2-digit',month:'2-digit'}));
    const isClim = i => rows[i]?.source === 'climatologia';
    const dash = ctx => isClim(ctx.p1DataIndex) ? [5,4] : undefined;
    const small = labels.length > 45 ? 0 : 2;
    charts[key] = new Chart($(canvasId), {
      data: { labels, datasets: [
        { type:'bar', label:'Precipitación (mm)', data:rows.map(r=>r.rain), yAxisID:'rain', backgroundColor:rows.map((r,i)=>isClim(i)?'rgba(138,123,76,.22)':'rgba(138,123,76,.55)'), borderColor:'#8A7B4C', borderWidth:1, borderRadius:3, maxBarThickness:18 },
        { type:'line', label:'Temperatura máxima (°C)', data:rows.map(r=>r.max), yAxisID:'temp', borderColor:'#C78B59', backgroundColor:'#C78B59', pointRadius:small, pointHoverRadius:5, borderWidth:2, tension:.25, spanGaps:true, segment:{borderDash:dash} },
        { type:'line', label:'Temperatura mínima (°C)', data:rows.map(r=>r.min), yAxisID:'temp', borderColor:'#3C3327', backgroundColor:'#3C3327', pointRadius:small, pointHoverRadius:5, borderWidth:2, tension:.25, spanGaps:true, segment:{borderDash:dash} }
      ]},
      options: {
        responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
        plugins:{ legend:{position:'bottom', labels:{usePointStyle:true, padding:14}},
          tooltip:{callbacks:{
            title:items => `Fecha: ${fmt(rows[items[0].dataIndex].date)}`,
            label:item => `${item.dataset.label}: ${item.parsed.y == null ? 'sin dato' : `${num(item.parsed.y)} ${item.dataset.yAxisID === 'rain' ? 'mm' : '°C'}`}`,
            footer:items => SRC[rows[items[0].dataIndex].source] }}},
        scales:{
          x:{ticks:{autoSkip:true, maxTicksLimit:labels.length > 60 ? 10 : 14, maxRotation:0}, grid:{display:false}},
          rain:{type:'linear', position:'left', beginAtZero:true, title:{display:true,text:'Precipitación (mm)'}, ticks:{callback:v=>`${v} mm`}},
          temp:{type:'linear', position:'right', title:{display:true,text:'Temperatura (°C)'}, grid:{drawOnChartArea:false}, ticks:{callback:v=>`${v} °C`}}
        }
      }
    });
  }

 const crops={trigo:{name:'Trigo',norte:'Mayo a junio',centro:'Mayo a julio',sur:'Junio a agosto',months:[4,5,6],desc:'Cultivo de invierno; ajustar por ciclo, variedad y riesgo de heladas.'},soja:{name:'Soja',norte:'Noviembre a diciembre',centro:'Octubre a diciembre',sur:'Octubre a diciembre',months:[9,10,11],desc:'La fecha depende del grupo de madurez, ambiente y régimen hídrico.'},maiz:{name:'Maíz',norte:'Diciembre a enero (tardío)',centro:'Septiembre a enero según planteo',sur:'Septiembre a diciembre',months:[8,9,10,11,0],desc:'Hay planteos tempranos y tardíos; considerar agua disponible e híbrido.'},sorgo:{name:'Sorgo',norte:'Noviembre a enero',centro:'Octubre a diciembre',sur:'Octubre a diciembre',months:[9,10,11,0],desc:'Tolera mejor algunos períodos secos, pero requiere humedad para implantación.'},girasol:{name:'Girasol',norte:'Julio a septiembre',centro:'Agosto a octubre',sur:'Septiembre a noviembre',months:[6,7,8,9,10],desc:'Ajustar por híbrido, zona, heladas y agua disponible.'},algodon:{name:'Algodón',norte:'Octubre a noviembre',centro:'Octubre a noviembre',sur:'Consultar calendario regional',months:[9,10],desc:'Confirmar temperatura del suelo y calendario algodonero provincial.'}};
 function macro(p){let s=String(p.province||'').toLowerCase();if(/santiago|tucum|salta|chaco|formosa|corrientes|misiones|catamarca|la rioja/.test(s))return'norte';if(/rio negro|neuquen|chubut|santa cruz|tierra del fuego|la pampa/.test(s))return'sur';return'centro';}
 function evaluate(){let p=parcel();if(!p){$('sowingResult').innerHTML='<p class="error-message">Seleccioná una parcela guardada.</p>';return;}let c=crops[$('sowingCrop').value],window=c[macro(p)],inside=c.months.includes(new Date().getMonth());let text=inside?`El mes actual coincide con la ventana general (${window}) para esta macrozona. Esto no confirma que el lote esté listo para sembrar.`:`El mes actual está fuera de la ventana general (${window}) para esta macrozona. Planificá la próxima ventana y verificá el calendario local.`;$('sowingResult').innerHTML=`<div class="sowing-verdict"><span class="risk-pill ${inside?'risk-moderado':'risk-bajo'}">${inside?'Dentro de ventana general':'Fuera de ventana general'}</span><h3>${esc(c.name)} · ${esc(window)}</h3><p>${esc(text)}</p><p>${esc(c.desc)}</p></div><div class="sowing-checklist"><b>Antes de sembrar, verificá:</b><ul><li>Humedad del suelo a profundidad de siembra y reserva del perfil.</li><li>Pronóstico actualizado de lluvia y temperatura de 7 a 10 días.</li><li>Textura, drenaje, antecesor, malezas y estado del lote.</li><li>Variedad/híbrido, ciclo, densidad y fecha óptima regional.</li><li>Calendario provincial y recomendaciones del INTA.</li></ul></div><p class="data-source-note">Ventana general por macrozona, no fecha exacta calculada para el lote. No se puede recomendar plantar solo con temperatura del aire o lluvia pronosticada; hace falta evaluar humedad del suelo y asesoramiento local.</p>`;}


  // ====== COMPARATIVA ======
  function stats(rows) {
    const rain = rows.map(r => r.rain);
    const known = rain.filter(v => v !== null);
    const src = {}; rows.forEach(r => src[r.source] = (src[r.source] || 0) + 1);
    return { days: rows.length, total: sum(rain), perDay: known.length ? sum(rain)/known.length : null, wet: rain.filter(v => v !== null && v >= 1).length,
             max: avg(rows.map(r => r.max)), min: avg(rows.map(r => r.min)), src };
  }
  const srcText = s => Object.entries(s.src).map(([k, n]) => `${SRC[k].replace(' (no es pronóstico)','')}: ${n} d`).join(' · ');
  const diff = (a, b, unit, d = 1) => (a === null || b === null) ? '—' : `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(d)} ${unit}`;
  function renderComparison(h, f) {
    const cell = (s, fn) => s ? fn(s) : '—';
    const rows = [
      ['Fechas', s => `${fmt(s.start)} – ${fmt(s.end)}`, null],
      ['Cantidad de días', s => String(s.days), (a,b) => diff(a.days, b.days, 'd', 0)],
      ['Precipitación acumulada', s => `${num(s.total)} mm`, (a,b) => diff(a.total, b.total, 'mm')],
      ['Precipitación media diaria', s => `${num(s.perDay, 2)} mm/día`, (a,b) => diff(a.perDay, b.perDay, 'mm/día', 2)],
      ['Días con ≥ 1 mm', s => `${s.wet} de ${s.days}`, (a,b) => diff(a.wet, b.wet, 'd', 0)],
      ['Temperatura máxima media', s => `${num(s.max)} °C`, (a,b) => diff(a.max, b.max, '°C')],
      ['Temperatura mínima media', s => `${num(s.min)} °C`, (a,b) => diff(a.min, b.min, '°C')],
      ['Origen de los datos', s => srcText(s), null]
    ];
    const body = rows.map(([label, fn, df]) => `<tr><th scope="row">${esc(label)}</th><td>${cell(h, fn)}</td><td>${cell(f, fn)}</td><td>${h && f && df ? df(h, f) : '—'}</td></tr>`).join('');
    $('climateComparison').innerHTML = `<h3>Comparativa: período histórico vs. perspectiva futura</h3><div class="compare-table-wrap"><table class="compare-table"><thead><tr><th>Indicador</th><th>Histórico</th><th>Futuro</th><th>Futuro − Histórico</th></tr></thead><tbody>${body}</tbody></table></div>${(h && f) ? '<p class="data-source-note">Si los rangos tienen distinta cantidad de días, conviene comparar los valores medios diarios y no los acumulados.</p>' : '<p class="data-source-note">Elegí también el otro rango para ver la comparación completa.</p>'}`;
  }

  // ====== APTITUD PARA SEMBRAR TRIGO ======
  function evalWheatDay(row, prior30, zone) {
    if (row.max === null || row.min === null) return { level:'nd', reasons:['Sin datos para este día'] };
    const reasons = []; let level = 'ok';
    const bump = (lv, text) => { reasons.push(text); if (lv === 'no' || (lv === 'warn' && level === 'ok')) level = lv; };
    const m = parseKey(row.date).getMonth(), w = WHEAT.windows[zone].months;
    if (!w.includes(m)) {
      const dist = Math.min(...w.map(x => Math.min(Math.abs(m - x), 12 - Math.abs(m - x))));
      if (dist <= 1) bump('warn', 'Mes fuera de la ventana general, pero adyacente');
      else bump('no', 'Fuera de la ventana de siembra recomendada');
    }
    const mean = (row.max + row.min) / 2;
    if (mean < WHEAT.tempMeanLimit[0]) bump('no', 'Temperatura media demasiado baja para implantar');
    else if (mean > WHEAT.tempMeanLimit[1]) bump('no', 'Temperatura media demasiado alta para trigo');
    else if (mean < WHEAT.tempMeanOk[0]) bump('warn', 'Temperatura media baja (emergencia lenta)');
    else if (mean > WHEAT.tempMeanOk[1]) bump('warn', 'Temperatura media alta');
    if (row.min <= WHEAT.frostNo) bump('no', 'Helada fuerte');
    else if (row.min <= WHEAT.frostWarn) bump('warn', 'Helada leve');
    if (row.rain !== null) {
      if (row.rain >= WHEAT.rainNo) bump('no', 'Lluvia muy intensa: anegamiento / sin piso para sembrar');
      else if (row.rain >= WHEAT.rainWarn) bump('warn', 'Lluvia relevante: labor posiblemente demorada');
    }
    if (prior30 !== null && prior30 < WHEAT.moisture30Min) bump('warn', 'Poca lluvia en los 30 días previos (humedad de suelo a verificar)');
    return { level, reasons };
  }
  function wheatRange(label, rows, ctxRows, zone) {
    // ctxRows = 30 días previos + rango; calcula lluvia previa de 30 días por cada día del rango
    const all = ctxRows;
    const offset = all.length - rows.length;
    const evals = rows.map((r, i) => {
      const prev = all.slice(Math.max(0, offset + i - 30), offset + i).map(x => x.rain).filter(v => v !== null);
      return { row: r, ...evalWheatDay(r, prev.length >= 15 ? sum(prev) : null, zone) };
    });
    const valid = evals.filter(e => e.level !== 'nd');
    const n = valid.length, ok = valid.filter(e => e.level === 'ok').length, warn = valid.filter(e => e.level === 'warn').length, no = valid.filter(e => e.level === 'no').length;
    let verdict, cls;
    if (!n) { verdict = 'Sin datos suficientes'; cls = 'apt-nd'; }
    else if (ok / n >= WHEAT.okShare) { verdict = 'Apto'; cls = 'apt-ok'; }
    else if ((ok + warn) / n >= WHEAT.warnShare) { verdict = 'Apto con precaución'; cls = 'apt-warn'; }
    else { verdict = 'No apto'; cls = 'apt-no'; }
    const tally = new Map();
    valid.forEach(e => { if (e.level !== 'ok') e.reasons.forEach(t => tally.set(t, (tally.get(t) || 0) + 1)); });
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const strip = evals.map(e => `<span class="day-cell day-${e.level}" title="${esc(fmt(e.row.date))}: ${esc(e.level === 'ok' ? 'Apto' : e.reasons.join(' · '))}"></span>`).join('');
    const single = rows.length === 1 && rows[0].max !== null
      ? `<p class="wheat-single">Ese día: máx. ${num(rows[0].max)} °C · mín. ${num(rows[0].min)} °C · lluvia ${num(rows[0].rain)} mm · ${esc(SRC[rows[0].source])}.</p>` : '';
    return `<article class="wheat-card"><div class="wheat-head"><span class="apt-pill ${cls}">${verdict}</span><div><h3>Trigo · ${esc(label)}</h3><small>${fmt(rows[0].date)} – ${fmt(rows[rows.length-1].date)}</small></div></div>
      <p>${n ? `<b>${ok}</b> de ${n} días aptos · <b>${warn}</b> con precaución · <b>${no}</b> no aptos.` : 'No hay datos meteorológicos para evaluar estas fechas.'}</p>${single}
      ${top.length ? `<ul class="wheat-reasons">${top.map(([t, c]) => `<li>${esc(t)} <small>(${c} ${c === 1 ? 'día' : 'días'})</small></li>`).join('')}</ul>` : ''}
      <div class="day-strip" aria-label="Aptitud día por día">${strip}</div>
      <div class="day-legend"><span><i class="day-cell day-ok"></i>Apto</span><span><i class="day-cell day-warn"></i>Precaución</span><span><i class="day-cell day-no"></i>No apto</span><span><i class="day-cell day-nd"></i>Sin dato</span></div></article>`;
  }
  async function renderWheat(p, parts) {
    const zone = macro(p);
    const cards = [];
    for (const part of parts) {
      const ctxStart = dateKey(shiftDays(parseKey(part.start), -30));
      const ctx = await fetchDaily(ctxStart, part.end, p);
      cards.push(wheatRange(part.label, part.rows, ctx, zone));
    }
    $('wheatSection').innerHTML = `<div class="wheat-title"><h3>🌾 ¿Es apto para plantar trigo en «${esc(p.name)}»?</h3><p>Ventana general para esta zona: <b>${esc(WHEAT.windows[zone].text)}</b>. Se evalúa cada día según temperatura media, heladas, lluvia del día y lluvia de los 30 días previos.</p></div><div class="wheat-grid">${cards.join('')}</div><p class="data-source-note">Evaluación orientativa basada solo en datos de clima (modelo), no mide la humedad real del suelo. Los días con promedio climático no son un pronóstico. Validá siempre con el calendario provincial/INTA, la variedad, el ciclo y un asesor local.</p>`;
  }

  // ====== CALENDARIOS ======
  function selected(fp) {
    const d = fp?.selectedDates || [];
    if (!d.length) return null;
    const a = d[0], b = d[1] || d[0];
    return { start: dateKey(a), end: dateKey(b) };
  }
  function initCalendars() {
    if (typeof flatpickr === 'undefined') {
      $('climateLocationNote').textContent = 'No se pudo cargar el calendario (flatpickr). Comprobá tu conexión a Internet.';
      return false;
    }
    const today = new Date(), yesterday = shiftDays(today, -1);
    const common = { mode:'range', locale:document.documentElement.lang === 'es' ? ((flatpickr.l10ns && flatpickr.l10ns.es) || 'default') : 'default', dateFormat:'Y-m-d', altInput:true, altFormat:'d/m/Y', altInputClass:'feature-select', allowInput:false, showMonths: window.innerWidth > 900 ? 2 : 1, onChange: (dates) => { if (dates.length === 2) refresh(); } };
    fpHistory = flatpickr($('historyRange'), { ...common, maxDate: yesterday, defaultDate: [shiftDays(today, -30), yesterday] });
    fpFuture  = flatpickr($('futureRange'),  { ...common, minDate: today, maxDate: shiftDays(today, 365), defaultDate: [today, shiftDays(today, 14)] });
    document.addEventListener('agro:language-changed', () => { const locale = document.documentElement.lang === 'es' ? ((flatpickr.l10ns && flatpickr.l10ns.es) || 'default') : 'default'; fpHistory?.set('locale',locale); fpFuture?.set('locale',locale); });
    return true;
  }
  function validRange(r, name) {
    if (!r) return true;
    const days = eachDay(r.start, r.end).length;
    if (days > MAX_RANGE_DAYS) { alert(`El rango de ${name} no puede superar ${MAX_RANGE_DAYS} días (elegiste ${days}).`); return false; }
    return true;
  }


  async function refresh() {
    if (busy) { pending = true; return; }
    const p = parcel();
    if (!p) { $('climateLocationNote').textContent = 'Elegí una parcela en el selector de análisis.'; return; }
    const h = selected(fpHistory), f = selected(fpFuture);
    $('climateLocationNote').textContent = `${p.name} · ${p.locality || ''} ${p.province || ''} · ${Number(p.lat).toFixed(4)}, ${Number(p.lon).toFixed(4)}`;
    if (!h && !f) { $('climateComparison').innerHTML = '<h3>Comparativa</h3><p>Elegí al menos un rango de fechas en los calendarios.</p>'; return; }
    if (!validRange(h, 'período histórico') || !validRange(f, 'perspectiva futura')) return;
    busy = true;
    $('climateComparison').innerHTML = '<h3>Comparativa</h3><p class="muted">Consultando datos meteorológicos…</p>';
    $('wheatSection').innerHTML = '';
    try {
      loadCurrent(p).catch(() => {});
      const [hRows, fRows] = await Promise.all([h ? fetchDaily(h.start, h.end, p) : null, f ? fetchDaily(f.start, f.end, p) : null]);
      $('historyCol').hidden = !hRows; $('futureCol').hidden = !fRows;
      $('compareGrid').classList.toggle('single', !(hRows && fRows));
      const parts = [];
      if (hRows) {
        renderChart('history', 'historyChart', hRows);
        $('historyChartTitle').textContent = 'Período histórico';
        $('historyChartSubtitle').textContent = `Del ${fmt(h.start)} al ${fmt(h.end)} · ${hRows.length} ${hRows.length === 1 ? 'día' : 'días'}`;
        parts.push({ label:'período histórico', start:h.start, end:h.end, rows:hRows });
      }
      if (fRows) {
        renderChart('future', 'futureChart', fRows);
        $('futureChartTitle').textContent = 'Perspectiva futura';
        $('futureChartSubtitle').textContent = `Del ${fmt(f.start)} al ${fmt(f.end)} · ${fRows.length} ${fRows.length === 1 ? 'día' : 'días'}`;
        parts.push({ label:'perspectiva futura', start:f.start, end:f.end, rows:fRows });
      }
      const sh = hRows && { ...stats(hRows), start:h.start, end:h.end }, sf = fRows && { ...stats(fRows), start:f.start, end:f.end };
      renderComparison(sh, sf);
      $('climateSourceNote').textContent = 'Fuentes: Open-Meteo (archivo histórico y pronóstico). Más allá de 15 días se muestra el promedio de los últimos 5 años, que NO es un pronóstico. Son datos de modelo y pueden diferir de una estación dentro del lote.';
      await renderWheat(p, parts);
    } catch (e) {
      $('climateSourceNote').textContent = e.message;
      $('climateComparison').innerHTML = `<p class="error-message">${esc(e.message)}</p>`;
    } finally {
      busy = false;
      if (pending) { pending = false; refresh(); }
    }
  }

  $('compareBtn').addEventListener('click', refresh);
  $('clearRangesBtn').addEventListener('click', () => {
    fpHistory?.clear(); fpFuture?.clear();
    ['history','future'].forEach(k => { if (charts[k]) { charts[k].destroy(); charts[k] = null; } });
    $('historyCol').hidden = true; $('futureCol').hidden = true; $('wheatSection').innerHTML = '';
    $('climateComparison').innerHTML = '<h3>Comparativa</h3><p>Elegí al menos un rango de fechas en los calendarios.</p>';
  });
  $('analysisParcelSelect').addEventListener('change', refresh);
  $('evaluateSowingBtn').addEventListener('click', evaluate);
  $('sowingCrop').addEventListener('change', evaluate);
  document.addEventListener('agro:parcels-changed', refresh);
  window.addEventListener('load', () => setTimeout(refresh, 900));
  initCalendars();
  const select = $('analysisParcelSelect');
  if (select) new MutationObserver(() => { if (select.value) refresh(); }).observe(select, { childList:true });
})();
