/* AgroAlerta · Región y subregión del punto seleccionado en el mapa.
   Escucha 'agro:location-selected' (lo emite map.js), completa la tarjeta de ubicación
   y emite 'agro:region-detected' para que otros módulos (suelo.js) lo usen.
   La región sale de la provincia (dato oficial de Georef). La subregión es una ESTIMACIÓN
   según provincia, posición y altitud (Open-Meteo Elevation): hay que confirmarla con el INTA local. */
(() => {
  const $ = id => document.getElementById(id);
  const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  const REGIONS = {
    noa:       { id: 'noa',       nombre: 'NOA – Noroeste Argentino' },
    nea:       { id: 'nea',       nombre: 'NEA – Noreste Argentino' },
    cuyo:      { id: 'cuyo',      nombre: 'Cuyo' },
    pampeana:  { id: 'pampeana',  nombre: 'Región Pampeana' },
    patagonia: { id: 'patagonia', nombre: 'Patagonia' }
  };

  // Provincia (normalizada) -> región. NOA incluye La Rioja, igual que el resto del proyecto.
  const PROVINCE_REGION = {
    'jujuy': 'noa', 'salta': 'noa', 'tucuman': 'noa', 'catamarca': 'noa', 'santiago del estero': 'noa', 'la rioja': 'noa',
    'formosa': 'nea', 'chaco': 'nea', 'corrientes': 'nea', 'misiones': 'nea',
    'mendoza': 'cuyo', 'san juan': 'cuyo', 'san luis': 'cuyo',
    'buenos aires': 'pampeana', 'ciudad autonoma de buenos aires': 'pampeana', 'cordoba': 'pampeana', 'santa fe': 'pampeana', 'entre rios': 'pampeana', 'la pampa': 'pampeana',
    'neuquen': 'patagonia', 'rio negro': 'patagonia', 'chubut': 'patagonia', 'santa cruz': 'patagonia', 'tierra del fuego': 'patagonia'
  };
  function provinceKey(name) {
    const n = norm(name);
    if (!n) return null;
    if (n === 'caba' || n.includes('capital federal')) return 'ciudad autonoma de buenos aires';
    return Object.keys(PROVINCE_REGION).find(k => n === k || n.includes(k)) || null;
  }

  // Subregiones del NOA (mismos ids que wwwroot/data/noa-aptitud.json).
  const NOA_SUBS = {
    puna:      'Puna y Alto Andino',
    quebrada:  'Valles y Bolsones Áridos',
    templados: 'Valles Templados',
    yungas:    'Yungas y Pedemonte',
    umbral:    'Umbral al Chaco',
    chaco:     'Chaco Semiárido'
  };
  // Lista de subregiones por región (para el selector manual de suelo.js).
  const SUBS = {
    noa: Object.entries(NOA_SUBS).map(([id, nombre]) => ({ id, nombre })),
    nea: [
      { id: 'selva-paranaense', nombre: 'Selva Paranaense (Misiones)' },
      { id: 'mesopotamia-corrientes', nombre: 'Mesopotamia – Corrientes (Esteros y lomadas)' },
      { id: 'chaco-humedo', nombre: 'Chaco Húmedo' },
      { id: 'chaco-seco', nombre: 'Chaco Semiárido (Chaco Seco)' }
    ],
    cuyo: [
      { id: 'oasis', nombre: 'Oasis irrigados' },
      { id: 'monte-arido', nombre: 'Monte árido (travesías y piedemonte)' },
      { id: 'alta-montana', nombre: 'Alta montaña y precordillera' },
      { id: 'sierras-san-luis', nombre: 'Sierras y llanuras de San Luis' }
    ],
    pampeana: [
      { id: 'pampa-ondulada', nombre: 'Pampa Ondulada' },
      { id: 'pampa-llana', nombre: 'Pampa Llana' },
      { id: 'pampa-deprimida', nombre: 'Pampa Deprimida (cuenca del Salado)' },
      { id: 'pampa-austral', nombre: 'Pampa Austral (sudeste bonaerense)' },
      { id: 'pampa-semiarida', nombre: 'Pampa Semiárida' },
      { id: 'caldenal', nombre: 'Caldenal y Monte (oeste de La Pampa)' },
      { id: 'chaco-humedo-sf', nombre: 'Chaco Húmedo (norte de Santa Fe)' },
      { id: 'chaco-arido-cba', nombre: 'Chaco Árido (norte de Córdoba)' },
      { id: 'sierras-cordoba', nombre: 'Sierras de Córdoba' },
      { id: 'mesopotamia-er', nombre: 'Mesopotamia – Entre Ríos (Espinal y lomadas)' }
    ],
    patagonia: [
      { id: 'valles-irrigados', nombre: 'Valles irrigados (Alto Valle, Valle Medio/Inferior, Chubut)' },
      { id: 'estepa', nombre: 'Estepa patagónica y Monte' },
      { id: 'cordillera', nombre: 'Cordillera y bosques andino-patagónicos' },
      { id: 'fueguina', nombre: 'Tierra del Fuego (estepa y bosque fueguino)' }
    ]
  };
  const subName = (region, id) => SUBS[region].find(s => s.id === id)?.nombre || id;

  function km(lat1, lon1, lat2, lon2) {
    const R = 6371, r = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const nearest = (lat, lon, anchors) => anchors.map(a => ({ ...a, d: km(lat, lon, a.lat, a.lon) })).sort((x, y) => x.d - y.d)[0];

  // Puntos de referencia [lon, lat] de localidades representativas de cada subregión del NOA.
  const NOA_ANCHORS = [
    ...[[-65.41, -24.79], [-65.30, -24.19], [-65.11, -24.38], [-65.58, -24.98], [-64.83, -24.69], [-65.48, -24.90]].map(([lon, lat]) => ({ id: 'templados', lat, lon })),
    ...[[-64.79, -23.81], [-64.46, -23.64], [-65.21, -26.83], [-65.50, -27.17], [-65.35, -27.43]].map(([lon, lat]) => ({ id: 'yungas', lat, lon })),
    ...[[-64.32, -23.13], [-65.05, -24.67], [-64.20, -24.72], [-64.22, -23.31], [-64.97, -25.50], [-63.80, -22.52], [-64.97, -25.80], [-64.00, -25.13]].map(([lon, lat]) => ({ id: 'umbral', lat, lon })),
    ...[[-64.26, -27.79], [-62.83, -28.46], [-65.00, -28.65], [-64.10, -23.21], [-62.83, -25.80], [-62.42, -27.63], [-66.86, -29.41], [-65.78, -28.47], [-67.50, -29.16]].map(([lon, lat]) => ({ id: 'chaco', lat, lon }))
  ];
  const CUYO_OASIS = [[-68.84, -32.89], [-68.33, -34.62], [-69.00, -33.57], [-68.53, -31.54], [-67.47, -32.89]].map(([lon, lat]) => ({ lat, lon }));
  const PAT_VALLEYS = [[-68.06, -38.95], [-67.58, -39.03], [-67.07, -39.10], [-65.66, -39.28], [-62.98, -40.81], [-65.31, -43.25], [-65.49, -43.29], [-69.07, -45.59], [-71.62, -46.55]].map(([lon, lat]) => ({ lat, lon }));

  function classifyNOA(prov, lat, lon, elev) {
    if (prov === 'santiago del estero') return 'chaco';
    if (elev != null) {
      if (elev >= 3000) return 'puna';
      if (elev >= 1500) return 'quebrada';
    }
    const a = nearest(lat, lon, NOA_ANCHORS);
    return a.id;
  }
  function classifyOther(region, prov, lat, lon, elev) {
    switch (region) {
      case 'nea':
        if (prov === 'misiones') return 'selva-paranaense';
        if (prov === 'corrientes') return 'mesopotamia-corrientes';
        return lon > -60.2 ? 'chaco-humedo' : 'chaco-seco';
      case 'cuyo':
        if (prov === 'san luis') return 'sierras-san-luis';
        if (elev != null && elev >= 2500) return 'alta-montana';
        return nearest(lat, lon, CUYO_OASIS).d <= 60 ? 'oasis' : 'monte-arido';
      case 'pampeana':
        if (prov === 'entre rios') return 'mesopotamia-er';
        if (prov === 'la pampa') return lon > -64.5 ? 'pampa-semiarida' : 'caldenal';
        if (prov === 'cordoba') {
          if (lon > -65.3 && lon < -64.0 && lat > -33.5 && lat < -29.5 && (elev == null || elev >= 500)) return 'sierras-cordoba';
          if (lat > -30.8 && lon < -63.0) return 'chaco-arido-cba';
          if (lon < -64.5 && lat < -33.0) return 'pampa-semiarida';
          return 'pampa-llana';
        }
        if (prov === 'santa fe') {
          if (lat > -30.0) return 'chaco-humedo-sf';
          return (lat <= -32.7 && lon > -61.8) ? 'pampa-ondulada' : 'pampa-llana';
        }
        // Buenos Aires y CABA
        if (lon < -62.0) return lat > -36.3 ? 'pampa-llana' : 'pampa-semiarida';
        if (lat > -35.0 && lon > -61.0) return 'pampa-ondulada';
        if (lat < -37.3) return 'pampa-austral';
        if (lon > -60.5) return 'pampa-deprimida';
        return 'pampa-llana';
      case 'patagonia': {
        if (prov === 'tierra del fuego') return 'fueguina';
        if (nearest(lat, lon, PAT_VALLEYS).d <= 45) return 'valles-irrigados';
        const boundary = lat > -46 ? -70.9 : -71.5;
        return lon < boundary ? 'cordillera' : 'estepa';
      }
    }
    return null;
  }

  function classify({ lat, lon, province, country }, elev) {
    const key = provinceKey(province);
    const argentina = !!key || norm(country) === 'argentina';
    if (!argentina) return { argentina: false };
    if (!key) return { argentina: true, region: null };
    const region = PROVINCE_REGION[key];
    const subId = region === 'noa' ? classifyNOA(key, lat, lon, elev) : classifyOther(region, key, lat, lon, elev);
    return {
      argentina: true,
      region: REGIONS[region],
      sub: { id: subId, nombre: region === 'noa' ? NOA_SUBS[subId] : subName(region, subId) },
      approx: true,
      usedElevation: elev != null
    };
  }

  async function fetchElevation(lat, lon) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, { signal: ctrl.signal });
      if (!r.ok) return null;
      const d = await r.json();
      const v = Array.isArray(d.elevation) ? d.elevation[0] : d.elevation;
      return Number.isFinite(v) ? Math.round(v) : null;
    } catch { return null; } finally { clearTimeout(t); }
  }

  function setCard(elevText, regionText, subText) {
    if ($('selectedElevation')) $('selectedElevation').textContent = elevText;
    if ($('selectedMacroRegion')) $('selectedMacroRegion').textContent = regionText;
    if ($('selectedSubRegion')) $('selectedSubRegion').textContent = subText;
  }

  let token = 0;
  async function onSelected(event) {
    const loc = event.detail;
    if (!loc || !Number.isFinite(loc.lat)) return;
    const mine = ++token;
    setCard('Consultando…', 'Calculando…', 'Calculando…');
    const key = provinceKey(loc.province);
    const maybeArgentina = !!key || norm(loc.country) === 'argentina';
    const elev = await fetchElevation(loc.lat, loc.lon);
    if (mine !== token) return; // el usuario ya eligió otro punto
    const elevText = elev != null ? `${elev.toLocaleString('es-AR')} m s. n. m.` : 'No disponible';
    const res = maybeArgentina ? classify(loc, elev) : { argentina: false };
    let detail;
    if (!res.argentina && !loc.country) {
      setCard(elevText, 'No determinada', '—');
      detail = { ...loc, elevation: elev, argentina: null };
    } else if (!res.argentina) {
      setCard(elevText, 'Fuera de Argentina', 'Sin clasificación INTA');
      detail = { ...loc, elevation: elev, argentina: false };
    } else if (!res.region) {
      setCard(elevText, 'No se pudo determinar la provincia', '—');
      detail = { ...loc, elevation: elev, argentina: true, region: null, sub: null };
    } else {
      setCard(elevText, res.region.nombre, `${res.sub.nombre} (estimada)`);
      detail = { ...loc, elevation: elev, argentina: true, region: res.region, sub: res.sub, approx: true };
    }
    window.AgroRegiones.last = detail;
    document.dispatchEvent(new CustomEvent('agro:region-detected', { detail }));
  }

  window.AgroRegiones = { REGIONS, SUBS, classify, last: null };
  document.addEventListener('agro:location-selected', onSelected);

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('goToSoilBtn');
    if (btn) btn.addEventListener('click', () => $('sueloSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });
})();
