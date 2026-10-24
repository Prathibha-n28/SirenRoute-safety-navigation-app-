/**
 * SirenRoute Map Module
 * Powered by Google Maps & Leaflet tiles with live animated hazard radar markers,
 * interactive popups, route polyline overlays, and responsive resize handlers.
 */
const MapModule = (() => {
    let map = null;
    let hazardLayer = null;
    let routeLayer = null;
    let userLayer = null;
    let currentTileLayer = null;
    let pickerModeActive = false;
    let pickerCallback = null;

    // Bangalore, India coordinates as initial focal center
    const DEFAULT_COORDS = [12.9716, 77.5946];
    const DEFAULT_ZOOM = 13;

    const HAZARD_ICONS = {
        pothole: 'fa-circle-dot',
        accident: 'fa-car-burst',
        flooding: 'fa-water',
        road_damage: 'fa-road-barrier',
        debris: 'fa-tree',
        closure: 'fa-ban',
        other: 'fa-triangle-exclamation'
    };

    function init() {
        if (map) return map;

        const mapEl = document.getElementById('map');
        if (!mapEl) {
            console.error('Map container #map not found in DOM');
            return null;
        }

        // Initialize Leaflet Map
        map = L.map('map', {
            zoomControl: false,
            preferCanvas: true
        }).setView(DEFAULT_COORDS, DEFAULT_ZOOM);

        // Position zoom controls at bottom right
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        // Google Maps Standard Road Tiles as Default
        // Uses Google public tile servers: mt0, mt1, mt2, mt3
        currentTileLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
            maxZoom: 20,
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            attribution: '&copy; Google Maps'
        }).addTo(map);

        // Layer Groups
        hazardLayer = L.layerGroup().addTo(map);
        routeLayer = L.layerGroup().addTo(map);
        userLayer = L.layerGroup().addTo(map);

        // Map Click Listener (for coordinate picker mode)
        map.on('click', (e) => {
            if (pickerModeActive && pickerCallback) {
                pickerCallback(e.latlng);
                disablePickerMode();
            }
        });

        // Trigger map invalidate size to prevent grey tile loading issues in flex containers
        setTimeout(() => { if (map) map.invalidateSize(); }, 250);
        setTimeout(() => { if (map) map.invalidateSize(); }, 800);
        window.addEventListener('resize', () => { if (map) map.invalidateSize(); });

        return map;
    }

    function changeTileLayer(theme) {
        if (!map) return;
        if (currentTileLayer) map.removeLayer(currentTileLayer);

        let tileUrl = 'https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
        let subdomains = ['mt0', 'mt1', 'mt2', 'mt3'];
        let attribution = '&copy; Google Maps';

        if (theme === 'google_satellite' || theme === 'satellite') {
            tileUrl = 'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
        } else if (theme === 'google_terrain' || theme === 'terrain') {
            tileUrl = 'https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}';
        } else if (theme === 'dark') {
            tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
            subdomains = ['a', 'b', 'c', 'd'];
            attribution = '&copy; OpenStreetMap &copy; CARTO';
        } else if (theme === 'osm') {
            tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
            subdomains = ['a', 'b', 'c'];
            attribution = '&copy; OpenStreetMap contributors';
        } else if (theme === 'voyager') {
            tileUrl = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
            subdomains = ['a', 'b', 'c', 'd'];
            attribution = '&copy; OpenStreetMap &copy; CARTO';
        }

        currentTileLayer = L.tileLayer(tileUrl, {
            maxZoom: 20,
            subdomains: subdomains,
            attribution: attribution
        }).addTo(map);

        map.invalidateSize();
    }

    function createHazardIcon(hazard) {
        const severity = (hazard.severity || 'medium').toLowerCase();
        const type = (hazard.hazard_type || 'other').toLowerCase();
        const iconClass = HAZARD_ICONS[type] || HAZARD_ICONS.other;

        const html = `
            <div class="hazard-pulse-marker ${severity}" title="${hazard.hazard_type} (${severity})">
                <i class="fa-solid ${iconClass}"></i>
            </div>
        `;

        return L.divIcon({
            html: html,
            className: 'custom-hazard-icon',
            iconSize: [34, 34],
            iconAnchor: [17, 17],
            popupAnchor: [0, -20]
        });
    }

    function renderHazards(hazards) {
        if (!hazardLayer) return;
        hazardLayer.clearLayers();

        hazards.forEach((hazard) => {
            if (!hazard.latitude || !hazard.longitude) return;

            const icon = createHazardIcon(hazard);
            const marker = L.marker([hazard.latitude, hazard.longitude], { icon });

            // Popup HTML
            const popupContent = document.createElement('div');
            popupContent.className = 'hazard-popup-box';

            let imageHtml = '';
            if (hazard.image_url) {
                const fullImgUrl = `${ReportsModule.API_BASE}${hazard.image_url}`;
                imageHtml = `
                    <div style="margin: 8px 0;">
                        <img src="${fullImgUrl}" alt="Hazard photo" style="width: 100%; max-height: 140px; object-fit: cover; border-radius: 6px; border: 1px solid #374151;" onerror="this.style.display='none'">
                    </div>
                `;
            }

            let aiBadge = '';
            if (hazard.ai_verified) {
                aiBadge = `
                    <div style="background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.4); padding: 5px 8px; border-radius: 6px; margin-top: 6px; font-size: 0.75rem; color: #a855f7;">
                        <i class="fa-solid fa-brain"></i> <strong>Gemini 2.0 Flash Verified</strong> (${Math.round((hazard.ai_confidence || 0.88) * 100)}% conf.)
                        <div style="color: #cbd5e1; font-size: 0.72rem; margin-top: 2px;">${hazard.ai_analysis || 'Visual confirmation completed.'}</div>
                    </div>
                `;
            }

            popupContent.innerHTML = `
                <div style="font-family: inherit; min-width: 220px; color: #0f172a;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <strong style="text-transform: capitalize; font-size: 0.95rem; color: #0f172a;">
                            ${hazard.hazard_type.replace('_', ' ')}
                        </strong>
                        <span class="badge ${hazard.severity}">${hazard.severity}</span>
                    </div>
                    <p style="font-size: 0.82rem; color: #334155; margin: 4px 0; line-height: 1.4;">${hazard.description}</p>
                    ${imageHtml}
                    ${aiBadge}
                    <div style="margin-top: 10px; display: flex; gap: 6px;">
                        <button class="btn-card-action" style="background: #0284c7; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: 700; cursor: pointer;" onclick="RoutesModule.setDestination(${hazard.latitude}, ${hazard.longitude})">
                            <i class="fa-solid fa-diamond-turn-right"></i> Navigate Here
                        </button>
                    </div>
                </div>
            `;

            marker.bindPopup(popupContent);
            hazardLayer.addLayer(marker);
        });
    }

    function setUserLocation(lat, lon, accuracy = 50) {
        if (!userLayer) return;
        userLayer.clearLayers();

        // Soft blue GPS accuracy circle (Google Maps style)
        if (accuracy && accuracy > 0) {
            const accuracyCircle = L.circle([lat, lon], {
                radius: Math.max(accuracy, 30),
                color: '#0284c7',
                weight: 1,
                fillColor: '#38bdf8',
                fillOpacity: 0.12
            });
            userLayer.addLayer(accuracyCircle);
        }

        const userIcon = L.divIcon({
            html: `
                <div class="user-location-puck">
                    <div class="pulse-ring"></div>
                    <div class="dot-core"></div>
                </div>
            `,
            className: 'user-gps-marker',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        const marker = L.marker([lat, lon], { icon: userIcon, zIndexOffset: 1000, draggable: true })
            .bindPopup(`
                <div style="font-family: inherit; font-size: 0.85rem; padding: 2px;">
                    <div style="display:flex; align-items:center; gap:6px; color:#38bdf8; font-weight:700;">
                        <i class="fa-solid fa-location-crosshairs"></i> Your Current Position
                    </div>
                    <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 4px;">
                        ${lat.toFixed(5)}, ${lon.toFixed(5)}
                    </div>
                    <div style="font-size: 0.7rem; color: #06b6d4; margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 4px;">
                        <i class="fa-solid fa-hand-pointer"></i> Drag pin to adjust your exact spot
                    </div>
                </div>
            `);

        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            if (typeof AppModule !== 'undefined' && AppModule.setUserLocationManual) {
                AppModule.setUserLocationManual(newPos.lat, newPos.lng, 'Pinned Spot');
            }
        });

        userLayer.addLayer(marker);
    }

    let navVehicleMarker = null;

    function showNavVehicle(lat, lon, iconClass = 'fa-motorcycle', headingDeg = 0) {
        if (!map) return;
        if (!navVehicleMarker) {
            const vehicleIcon = L.divIcon({
                html: `
                    <div class="vehicle-drive-puck" id="vehicleDrivePuck" style="transform: rotate(${headingDeg}deg);">
                        <i class="fa-solid ${iconClass}"></i>
                    </div>
                `,
                className: 'vehicle-drive-marker',
                iconSize: [36, 36],
                iconAnchor: [18, 18]
            });
            navVehicleMarker = L.marker([lat, lon], { icon: vehicleIcon, zIndexOffset: 2500 }).addTo(map);
        } else {
            navVehicleMarker.setLatLng([lat, lon]);
            const puck = document.getElementById('vehicleDrivePuck');
            if (puck) {
                puck.style.transform = `rotate(${headingDeg}deg)`;
                puck.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
            }
        }
    }

    function hideNavVehicle() {
        if (navVehicleMarker && map) {
            map.removeLayer(navVehicleMarker);
            navVehicleMarker = null;
        }
    }

    function enablePickerMode(callback, promptText) {
        pickerModeActive = true;
        pickerCallback = callback;

        const banner = document.getElementById('mapPickerOverlay');
        const promptSpan = document.getElementById('pickerPromptText');
        if (promptSpan && promptText) promptSpan.textContent = promptText;
        if (banner) banner.style.display = 'block';

        if (map) map.getContainer().style.cursor = 'crosshair';
    }

    function disablePickerMode() {
        pickerModeActive = false;
        pickerCallback = null;

        const banner = document.getElementById('mapPickerOverlay');
        if (banner) banner.style.display = 'none';

        if (map) map.getContainer().style.cursor = '';
    }

    function drawRoute(geojsonCoords, isHazardous = false) {
        if (!routeLayer) return;
        routeLayer.clearLayers();

        // Convert [lon, lat] from GeoJSON to [lat, lon] for Leaflet
        const latlngs = geojsonCoords.map(coord => [coord[1], coord[0]]);

        const routeColor = isHazardous ? '#ef4444' : '#10b981';

        const polyline = L.polyline(latlngs, {
            color: routeColor,
            weight: 6,
            opacity: 0.9,
            lineJoin: 'round',
            dashArray: isHazardous ? '10, 8' : null
        }).addTo(routeLayer);

        // Start & Destination Markers
        const startCoord = latlngs[0];
        const endCoord = latlngs[latlngs.length - 1];

        const startPin = L.circleMarker(startCoord, {
            radius: 8,
            fillColor: '#10b981',
            color: '#ffffff',
            weight: 2,
            fillOpacity: 1
        }).bindPopup('<strong>Route Origin</strong>');

        const endPin = L.circleMarker(endCoord, {
            radius: 8,
            fillColor: '#ef4444',
            color: '#ffffff',
            weight: 2,
            fillOpacity: 1
        }).bindPopup('<strong>Destination</strong>');

        routeLayer.addLayer(startPin);
        routeLayer.addLayer(endPin);

        // Fit map bounds to polyline
        map.fitBounds(polyline.getBounds(), { padding: [60, 60] });
    }

    function clearRoute() {
        if (routeLayer) routeLayer.clearLayers();
    }

    function flyTo(lat, lon, zoom = 16) {
        if (map) {
            map.flyTo([lat, lon], zoom, { duration: 1.2 });
        }
    }

    function panTo(lat, lon, zoom) {
        if (!map) return;
        if (zoom && map.getZoom() !== zoom) {
            map.setView([lat, lon], zoom, { animate: true, duration: 0.5 });
        } else {
            map.panTo([lat, lon], { animate: true, duration: 0.5 });
        }
    }

    function fitRouteBounds(coords) {
        if (!map || !coords || coords.length === 0) return;
        const latlngs = coords.map(c => [c[1], c[0]]);
        map.fitBounds(L.latLngBounds(latlngs), { padding: [60, 60], animate: true });
    }

    function getCenter() {
        return map ? map.getCenter() : { lat: DEFAULT_COORDS[0], lng: DEFAULT_COORDS[1] };
    }

    function invalidateSize() {
        if (map) map.invalidateSize();
    }

    return {
        init,
        renderHazards,
        setUserLocation,
        enablePickerMode,
        disablePickerMode,
        drawRoute,
        clearRoute,
        flyTo,
        panTo,
        fitRouteBounds,
        getCenter,
        changeTileLayer,
        invalidateSize,
        showNavVehicle,
        hideNavVehicle
    };
})();