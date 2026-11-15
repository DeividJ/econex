(() => {
    const $ = id => document.getElementById(id);
    const fmtDate = value => new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let parcels = [];
    const agroBotHistory = [];
    async function api(url, options) {
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || data.message || 'Ocurrió un error al consultar el servidor.');
        return data;
    }
    function showError(target, error) { $(target).innerHTML = `<p class="error-message">${esc(error.message)}</p>`; }

    async function loadParcels() {
        try {
            parcels = await api('/api/parcels'); window.agroParcels = parcels;
            const cards = $('parcelCards'); cards.innerHTML = '';
            const select = $('analysisParcelSelect'); select.innerHTML = '<option value="">Seleccioná una parcela guardada</option>';
            if (!parcels.length) cards.innerHTML = '<p class="muted">Todavía no hay parcelas guardadas. Seleccioná un punto en el mapa y guardalo.</p>';
            parcels.forEach(p => {
                const article = document.createElement('article'); article.className = 'data-row';
                article.innerHTML = `<div><strong>${esc(p.name)}</strong><small>${esc([p.locality,p.province].filter(Boolean).join(', '))} · ${Number(p.lat).toFixed(4)}, ${Number(p.lon).toFixed(4)} · ${esc(p.crop)}</small></div><div class="parcel-actions"><button type="button" class="text-action" data-show="${p.id}">Ver mapa</button><button type="button" class="text-danger" data-delete="${p.id}">Eliminar</button></div>`;
                cards.appendChild(article);
                const option = document.createElement('option'); option.value = p.id; option.textContent = `${p.name} — ${p.locality || p.province}`; select.appendChild(option);
            });
            cards.querySelectorAll('[data-show]').forEach(button => button.addEventListener('click', () => { const p=parcels.find(x=>x.id===Number(button.dataset.show)); if(p && window.agroShowParcel) window.agroShowParcel(p.lat,p.lon,p.name,p.locality,p.province); }));
            cards.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => {
                if (!confirm('¿Querés quitar esta parcela de tu listado?')) return;
                try { await api(`/api/parcels/${button.dataset.delete}`, { method: 'DELETE' }); await loadParcels(); document.dispatchEvent(new CustomEvent('agro:parcels-changed')); }
                catch (e) { alert(e.message); }
            }));
        } catch (e) { showError('parcelCards', e); }
    }
    async function loadAnalyses() {
        try { const rows = await api('/api/analyses'); const target = $('analysisHistory'); target.innerHTML = '';
            if (!rows.length) target.innerHTML = '<p class="muted">Todavía no hay análisis registrados.</p>';
            rows.forEach(a => { const div=document.createElement('article');div.className='data-row';div.innerHTML=`<div><strong>${esc(a.parcel)} · ${esc(a.province)}</strong><small>${fmtDate(a.date)} · ${esc(a.source)} · ${a.alertCount} alerta(s)<br>${esc(a.summary)}</small></div><span class="tag">#${a.id}</span>`;target.appendChild(div); });
        } catch(e) { showError('analysisHistory',e); }
    }
    async function loadAlerts() {
        try { const rows=await api('/api/alerts');const target=$('alertHistory');target.innerHTML='';if(!rows.length)target.innerHTML='<p class="muted">No hay alertas guardadas. Ejecutá un análisis para comenzar.</p>';
            rows.forEach(a=>{const div=document.createElement('article');div.className='data-row alert-row';const lk=String(a.level||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,'-');div.innerHTML=`<div><strong>${esc(a.title)}</strong><small>${esc(a.parcel)} · ${fmtDate(a.date)}<br>${esc(a.description)}<br><b>Recomendación:</b> ${esc(a.recommendation)}</small></div><span class="risk-pill risk-${lk}">${esc(a.level)}</span>`;target.appendChild(div);});
        } catch(e) { showError('alertHistory',e); }
    }
    function renderRisk(result) {
        const target=$('analysisResult');const levelKey=String(result.level||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,'-');const meanings={'informativo':'No se activaron umbrales automáticos en esta consulta. No significa riesgo cero.','bajo':'Señales leves. Mantené el seguimiento habitual y revisá las próximas actualizaciones.','moderado':'Hay condiciones que merecen atención. Verificá el lote y planificá labores con precaución.','alto':'Las condiciones podrían afectar al cultivo o las labores. Evaluá medidas preventivas y consultá a un profesional.','super-alto':'Se alcanzó un umbral meteorológico extremo del sistema. Priorizá la evaluación del lote y medidas de protección.'};target.innerHTML=`<div class="risk-summary"><span class="risk-pill risk-${levelKey}">Riesgo ${esc(result.level)}</span><p>${esc(result.summary)}</p><p class="risk-meaning">${esc(meanings[levelKey]||'Nivel orientativo; revisá las variables y las alertas que lo respaldan.')}</p></div><div class="weather-facts"><div><b>${Number(result.currentTemperature).toFixed(1)} °C</b><small>Temperatura actual del modelo</small></div><div><b>${Number(result.humidity).toFixed(0)} %</b><small>Humedad relativa</small></div><div><b>${Number(result.rain7Days).toFixed(1)} mm</b><small>Lluvia prevista 7 días</small></div><div><b>${Number(result.waterBalance).toFixed(1)} mm</b><small>ET₀ menos lluvia</small></div><div><b>${Number(result.maxTemperature).toFixed(1)} °C</b><small>Máxima prevista</small></div><div><b>${Number(result.minTemperature).toFixed(1)} °C</b><small>Mínima prevista</small></div></div><p class="save-note">Fuente: ${esc(result.source)}. Pronóstico de modelo, no medición directa de la parcela. Los umbrales son orientativos y deben ajustarse al cultivo, suelo y etapa fenológica.</p>${result.alerts.length?result.alerts.map(a=>`<article class="risk-alert"><b>${esc(a.title)} · ${esc(a.level)}</b><p>${esc(a.description)}</p><small>${esc(a.recommendation)}</small></article>`).join(''):'<p class="success-message">No se activaron umbrales de alerta en esta consulta. Esto no garantiza ausencia de riesgo.</p>'}`;
    }
    $('dashboardAnalyzeBtn')?.addEventListener('click', () => $('riskSection').scrollIntoView({behavior:'smooth',block:'start'}));
    $('analyzeBtn')?.addEventListener('click', async () => {
        const id=Number($('analysisParcelSelect').value);const parcel=parcels.find(p=>p.id===id);if(!parcel){alert('Primero seleccioná una parcela guardada.');return;}
        const button=$('analyzeBtn');button.disabled=true;button.textContent='Consultando pronóstico…';$('analysisResult').innerHTML='<p class="muted">Consultando Open-Meteo, calculando indicadores y guardando el análisis…</p>';
        try{const result=await api('/api/risk/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:parcel.lat,lon:parcel.lon,parcelId:parcel.id})});renderRisk(result);}
        catch(e){showError('analysisResult',e);}finally{button.disabled=false;button.textContent='✧ Analizar riesgos climáticos';}
    });
    $('chatForm')?.addEventListener('submit', async event => {
        event.preventDefault();const input=$('chatInput');const message=input.value.trim();if(!message)return;
        const target=$('chatMessages');const user=document.createElement('div');user.className='chat-message user-message';user.textContent=message;target.appendChild(user);input.value='';const pending=document.createElement('div');pending.className='chat-message bot-message';pending.textContent='AgroBot está pensando…';target.appendChild(pending);target.scrollTop=target.scrollHeight;$('chatSendBtn').disabled=true;
        try{const result=await api('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,history:agroBotHistory.slice(-8)})});pending.textContent=result.answer||'No se recibió una respuesta.';if(result.answer){agroBotHistory.push({role:'user',content:message},{role:'assistant',content:result.answer});}}
        catch(e){pending.textContent=e.message;pending.classList.add('error-message');}finally{$('chatSendBtn').disabled=false;target.scrollTop=target.scrollHeight;}
    });
    $('refreshParcelsBtn')?.addEventListener('click',loadParcels);document.addEventListener('agro:parcels-changed',loadParcels);
    loadParcels();
})();
