/* Comparación orientativa de parámetros de suelo de AgroAlerta.
   Referencias: FAO https://www.fao.org/4/T0667E/t0667e07.htm (ECe en dS/m)
   FAO https://www.fao.org/4/x5871e/x5871e05.htm (sodicidad PSI >15 %)
   Penn State https://extension.psu.edu/soil-acidity-and-aglime (pH general)
   No debe utilizarse como diagnóstico definitivo ni para indicar dosis de enmiendas. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('assessmentCrop')) return;
  const fmt = (n, digits=2) => new Intl.NumberFormat('es-AR',{maximumFractionDigits:digits}).format(n);
  // ECe = umbral aproximado a partir del cual puede comenzar a reducirse el rendimiento,
  // no concentración óptima ni valor que deba alcanzarse con insumos.
  // El rango de pH es un intervalo orientativo para un cribado inicial; no una ficha varietal.
  const crops = {
    trigo: {name:'Trigo', ph:[6,7.5], ece:6},
    soja: {name:'Soja', ph:[6,7], ece:5},
    maiz: {name:'Maíz', ph:[6,7], ece:1.7},
    sorgo: {name:'Sorgo', ph:[6,7.5], ece:6.8},
    algodon: {name:'Algodón', ph:[6,7.5], ece:7.7},
    cebada: {name:'Cebada', ph:[6,7.5], ece:8},
    alfalfa: {name:'Alfalfa', ph:[6.5,7], ece:2},
    arroz: {name:'Arroz', ph:[6,7], ece:3},
    mani: {name:'Maní', ph:[6,7], ece:3.2},
    poroto: {name:'Poroto común', ph:[6,7], ece:1},
    cana: {name:'Caña de azúcar', ph:[6,7], ece:1.7},
    vid: {name:'Vid', ph:[6,7], ece:1.5},
    cebolla: {name:'Cebolla', ph:[6,7], ece:1.2},
    papa: {name:'Papa', ph:[5,6], ece:1.7},
    durazno: {name:'Duraznero', ph:[6,7], ece:1.7},
    ciruela: {name:'Ciruelo', ph:[6,7], ece:1.5},
    tomate: {name:'Tomate', ph:[6,7], ece:2.5}
  };
  // Catálogo regional ilustrativo: la presencia en una macrorregión no garantiza aptitud local.
  const regional = {
    NOA:['trigo','soja','maiz','sorgo','algodon','poroto','cana','vid','alfalfa'],
    NEA:['soja','maiz','sorgo','algodon','arroz','poroto','cana','trigo'],
    Pampeana:['trigo','soja','maiz','sorgo','cebada','alfalfa','mani','papa'],
    Cuyo:['vid','cebolla','alfalfa','trigo','cebada','durazno','ciruela','tomate'],
    Patagonia:['cebada','trigo','alfalfa','papa','manzana','pera','vid','cebolla']
  };
  // En ciertos frutales no se dispone aquí de umbral ECe numérico suficientemente
  // verificable, por lo que se incluyen como regionales, pero NO se rankean.
  const unquantified = {manzana:'Manzano',pera:'Peral'};
  const normalize = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  const knownRegion = text => Object.keys(regional).find(x=>normalize(text)===normalize(x))||null;
  const getNumber = id => {
    const control=$(id),raw=control?.value.trim();
    if(!raw) return null;
    const n=Number(raw.replace(',','.'));
    if(!Number.isFinite(n)||n<0||n>(id==='rotationPh'?14:100))return NaN;
    return n;
  };
  const getMeasurements = () => ({ph:getNumber('rotationPh'), sodium:getNumber('rotationSodium'), ece:getNumber('rotationConductivity')});
  const isReady = m => Object.values(m).every(x=>x!==null&&Number.isFinite(x));
  const labelValue = (value,units='') => Number.isFinite(value)? `${fmt(value)}${units}`:'No informado';
  const cell = (text,cl) => {const e=document.createElement('td');e.textContent=text;if(cl)e.className=cl;return e;};
  const writeRow = (target, name, actual, reference, comparison, cls) => {
    const tr=document.createElement('tr');[cell(name),cell(actual),cell(reference),cell(comparison,cls)].forEach(c=>tr.append(c));target.append(tr);
  };
  let cropSelected=null, currentRegion=null;
  function metricsFor(crop,m){
    const phDistance=m.ph<crop.ph[0] ? crop.ph[0]-m.ph : Math.max(0,m.ph-crop.ph[1]);
    const eceExcess=Math.max(0,m.ece-crop.ece);
    const sodiumExcess=Math.max(0,m.sodium-15);
    // Puntaje solo ordena compatibilidades con estas tres variables, no probabilidad de cosecha.
    const score=Math.max(0,100-18*phDistance-28*eceExcess/Math.max(1,crop.ece)-2.5*sodiumExcess);
    return {score,phDistance,eceExcess,sodiumExcess,compatible:phDistance===0&&eceExcess===0&&sodiumExcess===0};
  }
  function renderAdvice(crop, m) {
    const target=$('assessmentAdvice');if(!target)return;
    target.replaceChildren();
    const advice=[];
    const add=(title, message, specialist)=>advice.push({title,message,specialist});
    if(!crop||!isReady(m)){
      target.textContent='Enter valid pH, exchangeable sodium percentage (ESP/PSI) and saturated-paste conductivity (ECe) to display tailored management options.';
      return;
    }
    if(m.ph<crop.ph[0])add('pH — below crop range',`Measured ${fmt(m.ph)}; reference starts at ${fmt(crop.ph[0])}. A soil laboratory can assess lime requirement and buffering capacity. Agricultural limestone may be appropriate for genuinely acidic soils after laboratory dosing. Do not infer an application dose from pH alone.`, 'Consult: soil laboratory and an agronomist / soil scientist.');
    else if(m.ph>crop.ph[1])add('pH — above crop range',`Measured ${fmt(m.ph)}; reference ends at ${fmt(crop.ph[1])}. Check carbonate content, salinity and micronutrient availability. Acidifying amendments are not safe to prescribe without soil chemistry and irrigation-water assessment.`, 'Consult: agronomist specializing in alkaline/calcareous soils.');
    else add('pH — within screening range',`Measured ${fmt(m.ph)} is within the illustrative range ${fmt(crop.ph[0])}–${fmt(crop.ph[1])}. No pH correction can be justified by this comparison alone.`, 'Monitor through periodic laboratory analysis.');
    if(m.sodium>15)add('Exchangeable sodium (ESP/PSI) — elevated',`Measured ${fmt(m.sodium)}%; above general warning threshold 15% by ${fmt(m.sodium-15)} percentage points. Verify ESP, SAR, soil texture, drainage and irrigation water. Gypsum may help some sodic soils only after estimating amendment requirement and ensuring leaching/drainage.`, 'Consult: soil scientist or agronomist experienced in sodicity and irrigation; request lab confirmation.');
    else add('Exchangeable sodium — no general threshold warning',`Measured ${fmt(m.sodium)}% versus a general sodicity threshold of 15%. Low ESP is not a mineral deficiency: do not add sodium to reach 15%. Structural problems can occur below this value depending on salinity and soil type.`, 'Consult: soil testing laboratory if dispersion or infiltration problems occur.');
    if(m.ece>crop.ece)add('Salinity (ECe) — above crop threshold',`Measured ${fmt(m.ece)} dS/m; exceeds the ${crop.name} tolerance-screening threshold (${fmt(crop.ece)} dS/m) by ${fmt(m.ece-crop.ece)} dS/m. Evaluate water quality, drainage and profile salinity before any managed leaching. Avoid adding salts or changing irrigation without professional supervision.`, 'Consult: irrigation specialist, soil scientist or agronomist; check groundwater and drainage.');
    else add('Salinity (ECe) — below threshold',`Measured ${fmt(m.ece)} dS/m; below the illustrative crop yield-response threshold (${fmt(crop.ece)} dS/m). This is not a minimum target: do not add salts or fertilizer to increase electrical conductivity.`, 'Continue monitoring irrigation water and soil ECe when appropriate.');
    if(document.documentElement.lang==='es'){
      const phLow=m.ph<crop.ph[0],phHigh=m.ph>crop.ph[1];
      const ph=advice[0],na=advice[1],ce=advice[2];
      ph.title=phLow?'pH — por debajo del rango':phHigh?'pH — por encima del rango':'pH — dentro del rango orientativo';
      ph.message=phLow?`pH medido: ${fmt(m.ph)}. El rango comienza en ${fmt(crop.ph[0])}. Solicitá al laboratorio una evaluación de necesidad de encalado y capacidad tampón. La cal agrícola podría corresponder en suelos ácidos, pero la dosis no se calcula solo con pH.`:phHigh?`pH medido: ${fmt(m.ph)}. El rango termina en ${fmt(crop.ph[1])}. Revisá carbonatos, salinidad y disponibilidad de micronutrientes. No apliques azufre ni acidificantes sin evaluar el suelo y el agua de riego.`:`pH medido: ${fmt(m.ph)} dentro del intervalo orientativo ${fmt(crop.ph[0])}–${fmt(crop.ph[1])}. Estos datos no justifican por sí solos aplicar correctivos.`;
      ph.specialist=phLow?'Consultar: laboratorio de suelos e ingeniero agrónomo.':phHigh?'Consultar: ingeniero agrónomo especializado en suelos alcalinos o calcáreos.':'Realizá controles periódicos con un laboratorio de suelos.';
      na.title=m.sodium>15?'Sodio intercambiable (PSI) — elevado':'Sodio intercambiable (PSI) — sin alerta general';
      na.message=m.sodium>15?`PSI medido: ${fmt(m.sodium)} %. Supera el valor general de alerta del 15 % en ${fmt(m.sodium-15)} puntos. Confirmá PSI, RAS, textura, drenaje y agua de riego. El yeso puede servir en algunos suelos sódicos, pero requiere cálculo profesional y drenaje adecuado.`:`PSI medido: ${fmt(m.sodium)} %. No supera el umbral general del 15 %. No significa que falte sodio: no agregues sodio para llegar a ese valor. Puede haber problemas de estructura por debajo de 15 % según el suelo.`;
      na.specialist=m.sodium>15?'Consultar: ingeniero agrónomo especializado en suelos sódicos y riego; repetir o verificar laboratorio.':'Si hay problemas de infiltración o dispersión, consultá al laboratorio de suelos.';
      ce.title=m.ece>crop.ece?'Conductividad eléctrica (ECe) — elevada':'Conductividad eléctrica (ECe) — bajo el umbral';
      ce.message=m.ece>crop.ece?`ECe medida: ${fmt(m.ece)} dS/m. Supera el umbral orientativo del cultivo (${fmt(crop.ece)} dS/m) en ${fmt(m.ece-crop.ece)} dS/m. Revisá calidad del agua, drenaje y distribución de sales antes de considerar un lavado controlado. No agregues sales para corregir el valor.`:`ECe medida: ${fmt(m.ece)} dS/m, por debajo del umbral orientativo del cultivo (${fmt(crop.ece)} dS/m). No es un valor mínimo a alcanzar: no agregues sales ni fertilizantes para aumentar la conductividad.`;
      ce.specialist=m.ece>crop.ece?'Consultar: especialista en riego y drenaje, suelos o ingeniero agrónomo.':'Controlá periódicamente el agua de riego y la ECe del suelo cuando corresponda.';
    }
    advice.forEach(a=>{const card=document.createElement('article');card.className='rotation-advice-item';const h=document.createElement('strong');h.textContent=a.title;const d=document.createElement('p');d.textContent=a.message;const spec=document.createElement('small');spec.textContent=a.specialist;card.append(h,d,spec);target.append(card);});
  }
  function render(){
    const region=knownRegion($('rotationRegion')?.textContent);
    const m=getMeasurements();
    $('assessmentRegion').textContent=region?`Región ${region}`:'Región sin seleccionar';
    $('assessmentInputSummary').textContent=`pH: ${labelValue(m.ph)} · PSI: ${labelValue(m.sodium,'%')} · ECe: ${labelValue(m.ece,' dS/m')}`;
    const notice=$('assessmentNotice'), selector=$('assessmentCrop'), list=$('assessmentCropCards'), comparison=$('assessmentComparison'), result=$('assessmentResult');
    if(!region){
      currentRegion=null;cropSelected=null;selector.disabled=true;
      selector.replaceChildren(new Option('Seleccioná una parcela con provincia identificada',''));
      comparison.replaceChildren();writeRow(comparison,'—','—','—','Seleccioná una parcela argentina');
      list.replaceChildren();list.textContent='Los cultivos se mostrarán cuando identifiquemos la región de la parcela.';
      notice.textContent='Primero seleccioná una parcela guardada o cerrá un contorno para identificar su región.';
      result.textContent='Sin parcela o región identificada: no es posible recomendar un cultivo.';renderAdvice(null,m);return;
    }
    if(currentRegion!==region){
      currentRegion=region;const previous=cropSelected;
      selector.replaceChildren();
      regional[region].forEach(key=>selector.add(new Option(crops[key]?.name||unquantified[key],key)));
      cropSelected=regional[region].includes(previous)?previous:regional[region][0];selector.value=cropSelected;
    }
    selector.disabled=false;
    const invalid=Object.values(m).some(x=>Number.isNaN(x));
    const ready=!invalid&&isReady(m);
    notice.textContent=invalid?'Hay datos de análisis inválidos; corregilos antes de comparar.':
      ready?'Comparación preliminar con el análisis de suelo ingresado. Los rangos no representan una recomendación de fertilización.':
      'Completá pH, PSI (%) y ECe (dS/m) para obtener una comparación y una sugerencia preliminar. Podés consultar los cultivos aunque falten datos.';
    list.replaceChildren();
    const candidates=[];
    regional[region].forEach(key=>{
      const crop=crops[key];const item=document.createElement('button');item.type='button';item.className='rotation-crop-choice';
      item.setAttribute('aria-pressed',String(cropSelected===key));
      const label=document.createElement('strong');label.textContent=crop?.name||unquantified[key];
      const info=document.createElement('small');
      if(!crop){info.textContent='Sin umbral ECe cuantificado · no se clasifica';}
      else if(!ready){info.textContent=`pH de referencia ${fmt(crop.ph[0],1)}–${fmt(crop.ph[1],1)} · ECe ≤ ${fmt(crop.ece,1)} dS/m`;}
      else{
        const assessment=metricsFor(crop,m);candidates.push({...assessment,key,name:crop.name});
        info.textContent=assessment.compatible?'Dentro de los 3 criterios':`Fuera de criterio: ${[assessment.phDistance>0?'pH':null,assessment.eceExcess>0?'salinidad':null,assessment.sodiumExcess>0?'sodicidad':null].filter(Boolean).join(', ')}`;
        item.classList.add(assessment.compatible?'rotation-crop-good':'rotation-crop-warning');
      }
      item.append(label,info);item.addEventListener('click',()=>{cropSelected=key;selector.value=key;render();});list.append(item);
    });
    comparison.replaceChildren();
    const crop=crops[cropSelected];
    if(!crop){
      writeRow(comparison,'pH',labelValue(m.ph),'No evaluado','Sin referencia específica');
      writeRow(comparison,'Sodio PSI',labelValue(m.sodium,'%'),'Referencia general: ≤15 %','No evaluado para este cultivo');
      writeRow(comparison,'CE del suelo (ECe)',labelValue(m.ece,' dS/m'),'Sin umbral cuantificado','No evaluado');
    }else{
      const pv=m.ph,low=crop.ph[0],high=crop.ph[1];
      const phDiff=pv===null||Number.isNaN(pv)?'Dato faltante':pv<low?`Faltan ${fmt(low-pv)} unidades de pH para el límite inferior`:pv>high?`Sobran ${fmt(pv-high)} unidades de pH sobre el límite superior`:'Dentro de referencia';
      writeRow(comparison,'pH',labelValue(pv),`${fmt(low,1)} a ${fmt(high,1)} (orientativo)`,phDiff,phDiff==='Dentro de referencia'?'rotation-ok':'rotation-attention');
      const na=m.sodium,naText=na===null||Number.isNaN(na)?'Dato faltante':na>15?`Excede el umbral de sodicidad en ${fmt(na-15)} puntos porcentuales`: 'Sin alerta por umbral PSI 15 % (no implica óptimo)';
      writeRow(comparison,'Sodio intercambiable (PSI)',labelValue(na,'%'),'≤ 15 % · referencia general, no por cultivo',naText,na!==null&&na<=15?'rotation-ok':'rotation-attention');
      const ce=m.ece,ceText=ce===null||Number.isNaN(ce)?'Dato faltante':ce>crop.ece?`Excede el umbral en ${fmt(ce-crop.ece)} dS/m`:'No supera el umbral; no falta salinidad';
      writeRow(comparison,'Conductividad (ECe)',labelValue(ce,' dS/m'),`Umbral de tolerancia: ${fmt(crop.ece,1)} dS/m`,ceText,ce!==null&&ce<=crop.ece?'rotation-ok':'rotation-attention');
    }
    renderAdvice(crop,m);
    if(!ready){result.textContent='No se puede determinar el cultivo de mayor compatibilidad: completá los tres valores con unidades y métodos correctos.';return;}
    candidates.sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name,'es'));
    const good=candidates.filter(x=>x.compatible);
    if(!good.length){
      result.textContent='Con los datos ingresados, ninguno de los cultivos evaluables está dentro de los tres criterios orientativos. Revisá qué parámetro limita la parcela y consultá a un profesional antes de decidir qué sembrar.';
    }else{
      const names=good.map(x=>x.name);
      result.textContent=`Cultivos regionales que cumplen los tres criterios orientativos: ${names.join(', ')}. Como primera alternativa para estudiar: ${good[0].name}. No puede determinarse un único «mejor cultivo» solo con pH, PSI y ECe; verificá clima, agua, suelo y calendario de siembra.`;
    }
  }
  $('assessmentCrop').addEventListener('change',e=>{cropSelected=e.target.value;render();});
  ['rotationPh','rotationSodium','rotationConductivity'].forEach(id=>$(id)?.addEventListener('input',render));
  document.addEventListener('rotation:parcel-changed',render);
  document.addEventListener('agro:language-changed',render);
  render();
})();
