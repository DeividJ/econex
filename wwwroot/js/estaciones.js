(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const list = $('stationList');
    const form = $('stationCreateForm');
    const formatDate = iso => iso ? new Date(iso).toLocaleString('es-AR', {dateStyle:'short', timeStyle:'short'}) : 'Sin lecturas';
    const formatNumber = (value, unit) => value == null ? '—' : `${Number(value).toLocaleString('es-AR', {maximumFractionDigits:1})} ${unit}`;

    function showMessage(target, text, kind = 'error') {
        target.textContent = text;
        target.className = `station-feedback ${kind}`;
        target.hidden = false;
    }
    function hideMessage(target) { target.hidden = true; }
    async function getJson(url, options) {
        let response;
        try { response = await fetch(url, {cache:'no-store', ...options}); }
        catch { throw new Error('No se pudo contactar al servidor AgroAlerta. Revisá Internet, el servidor y la dirección web.'); }
        let body;
        try { body = await response.json(); } catch { body = {}; }
        if (!response.ok) {
            if (response.status === 401) throw new Error('Clave de estación incorrecta o no autorizada (HTTP 401).');
            if (response.status === 404) throw new Error('No se encontró el servicio o la estación (HTTP 404).');
            throw new Error(body.message || body.detail || `El servidor respondió con error HTTP ${response.status}.`);
        }
        return body;
    }
    function node(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text != null) el.textContent = text;
        return el;
    }
    function addMetric(parent, label, value) {
        const card = node('div', 'station-metric');
        card.append(node('span', '', label), node('strong', '', value));
        parent.append(card);
    }
    function renderStation(station) {
        const article = node('article', 'station-item');
        const top = node('div', 'station-item-top');
        const details = node('div');
        details.append(node('p', 'station-item-title', station.name),
            node('p', 'station-item-sub', `${station.brand} · ${station.model} · ${station.mode === 'pasarela' ? 'Pasarela local' : 'Envío directo'}`),
            node('p', 'station-item-sub', station.parcel ? `Parcela: ${station.parcel}` : 'Sin parcela asociada'));
        top.append(details, node('span', `station-status ${station.status}`, station.status === 'connected' ? 'Conectada' : 'Sin conexión'));
        const status = node('div', 'station-status-detail');
        status.append(node('strong', '', station.message), node('p', '', station.reason));
        const metrics = node('div', 'station-metrics');
        addMetric(metrics, 'Temperatura', formatNumber(station.temperatureC, '°C'));
        addMetric(metrics, 'Humedad', formatNumber(station.humidityPct, '%'));
        addMetric(metrics, 'Lluvia por lectura', formatNumber(station.rainMm, 'mm'));
        addMetric(metrics, 'Viento', formatNumber(station.windKmh, 'km/h'));
        addMetric(metrics, 'Presión', formatNumber(station.pressureHpa, 'hPa'));
        const bottom = node('div', 'station-item-bottom');
        bottom.append(node('small', '', `Última medición: ${formatDate(station.lastMeasuredUtc)}`));
        const button = node('button', 'station-outline', 'Comprobar conexión');
        button.type = 'button';
        button.addEventListener('click', async () => {
            button.disabled = true; button.textContent = 'Comprobando...';
            try {
                const fresh = await getJson(`/api/estaciones/${station.id}/estado`);
                article.replaceWith(renderStation(fresh));
            } catch (err) {
                showMessage($('stationListMessage'), `Error en la conexión: ${err.message}`);
                button.disabled = false; button.textContent = 'Comprobar conexión';
            }
        });
        bottom.append(button);
        article.append(top, status, metrics, bottom);
        return article;
    }
    async function loadStations() {
        hideMessage($('stationListMessage'));
        list.replaceChildren(node('p', 'station-empty', 'Consultando estaciones...'));
        try {
            const stations = await getJson('/api/estaciones');
            list.replaceChildren();
            if (!stations.length) list.append(node('p', 'station-empty', 'Todavía no hay estaciones registradas. Agregá la primera usando el formulario.'));
            else stations.forEach(station => list.append(renderStation(station)));
        } catch (err) {
            list.replaceChildren(node('p', 'station-empty', 'No se pudieron cargar las estaciones.'));
            showMessage($('stationListMessage'), `Error en la conexión: ${err.message}`);
        }
    }
    async function loadParcels() {
        try {
            const parcels = await getJson('/api/parcels');
            parcels.forEach(parcel => {
                const opt = document.createElement('option');
                opt.value = String(parcel.id);
                opt.textContent = `${parcel.name} — ${parcel.province}`;
                $('stationParcel').append(opt);
            });
        } catch { /* Parcela opcional: el registro de estaciones sigue disponible. */ }
    }
    $('stationMode').addEventListener('change', () => {
        $('stationModeHelp').textContent = $('stationMode').value === 'directa'
            ? 'Solo para estaciones que admiten configurar un servidor HTTP(S) personalizado y enviar JSON con una clave.'
            : 'Necesitás un programa local (PC, Raspberry Pi o ESP32) que lea el protocolo de la estación y envíe JSON por HTTPS a AgroAlerta.';
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        hideMessage($('stationFormMessage'));
        const button = $('stationSaveButton');
        button.disabled = true; button.textContent = 'Registrando...';
        try {
            const created = await getJson('/api/estaciones', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                    name:$('stationName').value.trim(), brand:$('stationBrand').value.trim(),
                    model:$('stationModel').value.trim(), mode:$('stationMode').value,
                    parcelId:$('stationParcel').value ? Number($('stationParcel').value) : null
                })
            });
            $('stationSetupEmpty').hidden = true;
            $('stationSetup').hidden = false;
            $('stationEndpoint').value = `${location.origin}${created.endpointPath}`;
            $('stationKey').value = created.key;
            $('stationKey').type = 'password';
            $('stationShowKey').textContent = 'Mostrar';
            showMessage($('stationFormMessage'), created.message, 'success');
            form.reset();
            $('stationMode').dispatchEvent(new Event('change'));
            await loadStations();
        } catch (err) {
            showMessage($('stationFormMessage'), `No se pudo registrar la estación: ${err.message}`);
        } finally {
            button.disabled = false; button.textContent = 'Registrar estación';
        }
    });
    $('stationShowKey').addEventListener('click', () => {
        const field = $('stationKey');
        field.type = field.type === 'password' ? 'text' : 'password';
        $('stationShowKey').textContent = field.type === 'password' ? 'Mostrar' : 'Ocultar';
    });
    document.querySelectorAll('[data-copy]').forEach(button => {
        button.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText($(button.dataset.copy).value);
                const old = button.textContent; button.textContent = 'Copiado';
                setTimeout(() => { button.textContent = old; }, 1400);
            } catch { showMessage($('stationFormMessage'), 'No se pudo copiar automáticamente. Seleccioná el texto y copialo manualmente.'); }
        });
    });
    $('stationReload').addEventListener('click', loadStations);
    loadParcels();
    loadStations();
})();
