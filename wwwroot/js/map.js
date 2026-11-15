(() => {
    const mapElement = document.getElementById('agroMap');
    if (!mapElement || typeof L === 'undefined') return;

    const georef = 'https://apis.datos.gob.ar/georef/api';
    const map = L.map('agroMap', { worldCopyJump: true }).setView([-27.78, -64.26], 5);
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, attribution: 'Tiles &copy; Esri'
    });

    const searchInput = document.getElementById('placeSearch');
    const searchButton = document.getElementById('searchPlaceBtn');
    const resultsBox = document.getElementById('searchResults');
    const provinceSelect = document.getElementById('provinceSelect');
    const localitySelect = document.getElementById('localitySelect');
    const locateButton = document.getElementById('locateMeBtn');
    const layerButton = document.getElementById('mapLayerBtn');
    const saveButton = document.getElementById('saveParcelBtn');
    const parcelName = document.getElementById('parcelName');
    let marker = null;
    let selected = null;
    let isSatellite = false;
    let searchTimer = null;
    let currentLocationMarker = null;

    const el = id => document.getElementById(id);
    const safeText = value => value || '—';

    function setSelection(lat, lon, details = {}) {
        selected = { lat: Number(lat), lon: Number(lon), ...details };
        if (marker) marker.remove();
        marker = L.marker([selected.lat, selected.lon], { draggable: true }).addTo(map);
        marker.on('dragend', () => {
            const point = marker.getLatLng();
            reverseLookup(point.lat, point.lng);
        });
        el('selectedName').textContent = safeText(details.name || details.locality || 'Punto seleccionado');
        el('selectedRegion').textContent = safeText(details.region || details.province);
        el('selectedCountry').textContent = safeText(details.country || (details.province ? 'Argentina' : ''));
        el('selectedLat').textContent = selected.lat.toFixed(6);
        el('selectedLon').textContent = selected.lon.toFixed(6);
        el('selectionStatus').textContent = 'Ubicación lista para guardar';
        saveButton.disabled = false;
        if (!parcelName.value && (details.name || details.locality)) parcelName.value = details.name || details.locality;
        if (!details.pending) {
            document.dispatchEvent(new CustomEvent('agro:location-selected', { detail: {
                lat: selected.lat, lon: selected.lon,
                name: details.name || details.locality || '',
                province: details.province || details.region || '',
                country: details.country || ''
            } }));
        }
    }

    async function reverseLookup(lat, lon) {
        setSelection(lat, lon, { name: 'Consultando ubicación…', pending: true });
        // 1) Georef (oficial, solo Argentina). Fuera del país devuelve la provincia vacía.
        try {
            const response = await fetch(`${georef}/ubicacion?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&campos=estandar`);
            if (response.ok) {
                const data = await response.json();
                const p = data.ubicacion || {};
                const province = p.provincia?.nombre || '';
                if (province) {
                    const locality = p.localidad_censal?.nombre || p.localidad?.nombre || p.municipio?.nombre || p.departamento?.nombre || 'Punto seleccionado';
                    setSelection(lat, lon, { name: locality, locality, province, region: province, country: 'Argentina' });
                    return;
                }
            }
        } catch { /* se intenta el geocodificador mundial */ }
        // 2) Photon / OpenStreetMap (mundial): nombre, provincia/estado y país.
        try {
            const response = await fetch(`https://photon.komoot.io/reverse?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}`);
            if (response.ok) {
                const data = await response.json();
                const props = data.features?.[0]?.properties;
                if (props) {
                    const name = props.name || props.city || props.county || props.state || 'Punto seleccionado';
                    const state = props.state || props.county || '';
                    setSelection(lat, lon, { name, locality: props.city || name, province: state, region: state, country: props.country || '' });
                    return;
                }
            }
        } catch { /* el punto sigue siendo válido aunque no haya respuesta del servicio */ }
        setSelection(lat, lon, { name: 'Punto seleccionado', country: '' });
    }

    map.on('click', event => reverseLookup(event.latlng.lat, event.latlng.lng));

    async function loadProvinces() {
        try {
            const response = await fetch(`${georef}/provincias?max=100&orden=nombre`);
            if (!response.ok) throw new Error('No se pudo consultar Georef');
            const data = await response.json();
            (data.provincias || []).forEach(province => {
                const option = document.createElement('option');
                option.value = province.nombre;
                option.textContent = province.nombre;
                provinceSelect.appendChild(option);
            });
        } catch {
            provinceSelect.innerHTML = '<option value="">No se pudieron cargar las provincias</option>';
        }
    }

    function showResults(items) {
        resultsBox.innerHTML = '';
        if (!items.length) {
            resultsBox.innerHTML = '<div class="search-result">No se encontraron resultados.</div>';
        } else {
            items.forEach(item => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'search-result';
                button.innerHTML = `${escapeHtml(item.title)}<small>${escapeHtml(item.subtitle || '')}</small>`;
                button.addEventListener('click', () => {
                    resultsBox.classList.remove('show');
                    searchInput.value = item.title;
                    map.setView([item.lat, item.lon], item.zoom || 12);
                    setSelection(item.lat, item.lon, item.details || { name: item.title, region: item.subtitle, country: 'Argentina / mundo' });
                });
                resultsBox.appendChild(button);
            });
        }
        resultsBox.classList.add('show');
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function searchPlaces() {
        const term = searchInput.value.trim();
        if (term.length < 2) return;
        resultsBox.innerHTML = '<div class="search-result">Buscando localidades argentinas y lugares del mundo…</div>';
        resultsBox.classList.add('show');
        const results = [];
        const province = provinceSelect.value;

        // Georef: catálogo oficial argentino, filtrable por provincia y localidad.
        try {
            const params = new URLSearchParams({ nombre: term, max: '30', orden: 'nombre', campos: 'nombre,provincia.nombre,centroide' });
            if (province) params.set('provincia', province);
            const response = await fetch(`${georef}/localidades?${params.toString()}`);
            if (response.ok) {
                const data = await response.json();
                (data.localidades || []).forEach(item => {
                    const lat = item.centroide?.lat;
                    const lon = item.centroide?.lon;
                    if (Number.isFinite(lat) && Number.isFinite(lon)) results.push({
                        title: item.nombre, subtitle: `${item.provincia?.nombre || ''}, Argentina`, lat, lon, zoom: 11,
                        details: { name: item.nombre, locality: item.nombre, province: item.provincia?.nombre, region: item.provincia?.nombre, country: 'Argentina' }
                    });
                });
            }
        } catch { /* Continúa con la búsqueda mundial */ }

        // Photon / OpenStreetMap: geocodificador mundial de lugares y direcciones.
        try {
            const params = new URLSearchParams({ q: term, limit: '8', lang: 'es' });
            const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`);
            if (response.ok) {
                const data = await response.json();
                (data.features || []).forEach(feature => {
                    const props = feature.properties || {};
                    const [lon, lat] = feature.geometry.coordinates;
                    const country = props.country || '';
                    const region = props.state || props.county || '';
                    const locality = props.city || props.name || props.locality || '';
                    results.push({ title: props.name || locality || term, subtitle: [props.city, props.state, country].filter(Boolean).join(', '), lat: Number(lat), lon: Number(lon), zoom: 12,
                        details: { name: locality || props.name, locality, region, country } });
                });
            }
        } catch { /* Puede no estar disponible el geocodificador mundial */ }
        showResults(results.slice(0, 18));
    }

    searchButton.addEventListener('click', searchPlaces);
    searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') searchPlaces(); });
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        if (searchInput.value.trim().length >= 3) searchTimer = setTimeout(searchPlaces, 850);
        else resultsBox.classList.remove('show');
    });
    document.addEventListener('click', event => {
        if (!resultsBox.contains(event.target) && event.target !== searchInput && event.target !== searchButton) resultsBox.classList.remove('show');
    });

    provinceSelect.addEventListener('change', async () => {
        localitySelect.innerHTML = '<option value="">Cargando localidades…</option>';
        localitySelect.disabled = true;
        if (!provinceSelect.value) {
            localitySelect.innerHTML = '<option value="">Primero elegí una provincia</option>';
            return;
        }
        try {
            const params = new URLSearchParams({ provincia: provinceSelect.value, max: '5000', orden: 'nombre', campos: 'nombre,provincia.nombre,centroide' });
            const response = await fetch(`${georef}/localidades?${params.toString()}`);
            if (!response.ok) throw new Error('No se pudieron cargar las localidades');
            const data = await response.json();
            const localities = data.localidades || [];
            localitySelect.innerHTML = `<option value="">Elegí una localidad (${localities.length})</option>`;
            localities.forEach(item => {
                const option = document.createElement('option');
                option.value = JSON.stringify({ name: item.nombre, lat: item.centroide?.lat, lon: item.centroide?.lon, province: item.provincia?.nombre });
                option.textContent = item.nombre;
                localitySelect.appendChild(option);
            });
            localitySelect.disabled = false;
            const firstWithCenter = localities.find(item => Number.isFinite(item.centroide?.lat) && Number.isFinite(item.centroide?.lon));
            if (firstWithCenter) map.setView([firstWithCenter.centroide.lat, firstWithCenter.centroide.lon], 7);
        } catch {
            localitySelect.innerHTML = '<option value="">Error al cargar localidades</option>';
        }
    });

    localitySelect.addEventListener('change', () => {
        if (!localitySelect.value) return;
        const item = JSON.parse(localitySelect.value);
        if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
        map.setView([item.lat, item.lon], 12);
        setSelection(item.lat, item.lon, { name: item.name, locality: item.name, province: item.province, region: item.province, country: 'Argentina' });
    });

    locateButton.addEventListener('click', () => {
        if (!navigator.geolocation) { alert('Tu navegador no permite obtener la ubicación.'); return; }
        locateButton.disabled = true;
        locateButton.textContent = 'Localizando…';
        const success = position => {
            const { latitude, longitude } = position.coords;
            map.invalidateSize(); map.setView([latitude, longitude], 16, { animate: true });
            if (currentLocationMarker) currentLocationMarker.remove();
            currentLocationMarker = L.circleMarker([latitude, longitude], { radius: 9, color: '#fff', weight: 3, fillColor: '#2878d0', fillOpacity: 1 }).addTo(map).bindPopup('Tu ubicación actual').openPopup();
            reverseLookup(latitude, longitude); locateButton.disabled = false; locateButton.textContent = '◎ Mi ubicación';
        };
        const failure = error => { alert(error.code === 1 ? 'No autorizaste el acceso. Habilitá el permiso de ubicación del navegador.' : 'No se pudo obtener tu ubicación. Comprobá los servicios de ubicación e intentá nuevamente.'); locateButton.disabled = false; locateButton.textContent = '◎ Mi ubicación'; };
        navigator.geolocation.getCurrentPosition(success, error => { if (error.code === 2 || error.code === 3) navigator.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }); else failure(error); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    });

    layerButton.addEventListener('click', () => {
        if (isSatellite) { map.removeLayer(satellite); streets.addTo(map); layerButton.textContent = '▧ Ver satélite'; }
        else { map.removeLayer(streets); satellite.addTo(map); layerButton.textContent = '▤ Ver mapa de calles'; }
        isSatellite = !isSatellite;
    });

    async function renderSaved() {
        const list = el('savedParcelList');
        list.innerHTML = '<li>Cargando parcelas…</li>';
        try {
            const response = await fetch('/api/parcels');
            if (!response.ok) throw new Error('No se pudieron cargar las parcelas');
            const parcels = await response.json();
            list.innerHTML = '';
            if (!parcels.length) { list.innerHTML = '<li>Todavía no guardaste parcelas.</li>'; return; }
            parcels.forEach(parcel => {
                const li = document.createElement('li');
                li.textContent = `${parcel.name} — ${[parcel.locality, parcel.province].filter(Boolean).join(', ')} (${Number(parcel.lat).toFixed(4)}, ${Number(parcel.lon).toFixed(4)})`;
                list.appendChild(li);
            });
        } catch (error) {
            list.innerHTML = '<li>No se pudieron cargar las parcelas. Verificá SQL Server y la base AgroAlertaDb.</li>';
        }
    }

    saveButton.addEventListener('click', async () => {
        if (!selected) return;
        const name = parcelName.value.trim();
        if (!name) { alert('Escribí un nombre para la parcela.'); parcelName.focus(); return; }
        saveButton.disabled = true;
        saveButton.textContent = 'Guardando…';
        try {
            const response = await fetch('/api/parcels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, lat: selected.lat, lon: selected.lon, locality: selected.locality || selected.name || '', province: selected.province || selected.region || '' }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'No se pudo guardar la parcela.');
            await renderSaved();
            el('saveNote').textContent = 'Parcela guardada correctamente en SQL Server.';
            parcelName.value = '';
            document.dispatchEvent(new CustomEvent('agro:parcels-changed'));
        } catch (error) { alert(error.message); }
        finally { saveButton.disabled = !selected; saveButton.textContent = '＋ Guardar como parcela'; }
    });

    window.agroShowParcel = (lat, lon, name, locality, province) => { map.setView([lat, lon], 13); setSelection(lat, lon, { name, locality, province, region: province, country: 'Argentina' }); document.getElementById('agroMap').scrollIntoView({ behavior: 'smooth', block: 'center' }); };

    loadProvinces();
    renderSaved();
    setTimeout(() => map.invalidateSize(), 250);
})();
