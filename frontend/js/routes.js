/**
 * SirenRoute Routes Module
 * Handles hazard-aware route calculation using OSRM, multi-route alternatives comparison,
 * dynamic threat risk scoring, and radio-style audio/voice hazard alerts.
 */
const RoutesModule = (() => {
    let candidateRoutes = [];
    let selectedRouteIndex = 0;
    let audioContext = null;

    // Live Turn-by-Turn Navigation Engine State
    let isLiveNavActive = false;
    let isDriveSimulating = false;
    let driveInterval = null;
    let navRouteCoords = [];
    let navCurrentCoordIdx = 0;
    let navManeuvers = [];
    let navActiveManeuverIdx = 0;
    let navVoiceMuted = false;
    let alertedHazardSet = new Set();
    let simSpeedKmh = 42;

    function init() {
        bindEvents();
    }

    function bindEvents() {
        const form = document.getElementById('routeForm');
        if (form) form.addEventListener('submit', handleRouteSubmit);

        const clearBtn = document.getElementById('clearRouteBtn');
        if (clearBtn) clearBtn.addEventListener('click', clearRoute);

        const swapBtn = document.getElementById('swapLocationsBtn');
        if (swapBtn) swapBtn.addEventListener('click', swapLocations);

        const useGpsBtn = document.getElementById('useCurrentLocationBtn');
        if (useGpsBtn) {
            useGpsBtn.addEventListener('click', () => {
                AppModule.requestUserLocation(true, true);
            });
        }

        const pickDestBtn = document.getElementById('pickDestOnMapBtn');
        if (pickDestBtn) {
            pickDestBtn.addEventListener('click', () => {
                MapModule.enablePickerMode((coords) => {
                    const endInput = document.getElementById('routeEnd');
                    endInput.value = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
                    delete endInput.dataset.lat;
                    delete endInput.dataset.lon;
                    const clearEnd = document.getElementById('clearEndInputBtn');
                    if (clearEnd) clearEnd.style.display = 'flex';
                    AppModule.showToast('Destination picked from map', 'info');
                }, 'Click anywhere on map to set Destination');
            });
        }

        // Live Turn-by-Turn Navigation Controls
        const startNavBtn = document.getElementById('startLiveNavBtn');
        if (startNavBtn) startNavBtn.addEventListener('click', startLiveNavigation);

        const toggleSimBtn = document.getElementById('toggleDriveSimBtn');
        if (toggleSimBtn) toggleSimBtn.addEventListener('click', toggleDriveSimulation);

        const exitNavBtn = document.getElementById('exitNavBtn');
        if (exitNavBtn) exitNavBtn.addEventListener('click', stopLiveNavigation);

        const voiceMuteBtn = document.getElementById('navVoiceMuteBtn');
        if (voiceMuteBtn) voiceMuteBtn.addEventListener('click', toggleVoiceMute);

        // Location Autocomplete Search Suggestions with Clear Buttons & Keyboard Nav
        setupAutocomplete(
            document.getElementById('routeStart'),
            document.getElementById('startSuggestions'),
            document.getElementById('clearStartInputBtn')
        );
        setupAutocomplete(
            document.getElementById('routeEnd'),
            document.getElementById('endSuggestions'),
            document.getElementById('clearEndInputBtn')
        );

        // Quick Preset Destination Chips
        const chips = document.querySelectorAll('#quickDestChips .btn-quick-chip');
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                const dest = chip.getAttribute('data-dest');
                const endInput = document.getElementById('routeEnd');
                const startInput = document.getElementById('routeStart');
                const clearEnd = document.getElementById('clearEndInputBtn');

                if (endInput) {
                    endInput.value = dest;
                    delete endInput.dataset.lat;
                    delete endInput.dataset.lon;
                    if (clearEnd) clearEnd.style.display = 'flex';
                }

                if (startInput && !startInput.value.trim()) {
                    startInput.value = 'Current Location';
                    const clearStart = document.getElementById('clearStartInputBtn');
                    if (clearStart) clearStart.style.display = 'flex';
                }

                AppModule.showToast(`Routing to ${dest}...`, 'info');
                triggerRouteCalculation();
            });
        });

        // Demo Shortcuts
        const potholeBtn = document.getElementById('demoRoutePotholeBtn');
        if (potholeBtn) {
            potholeBtn.addEventListener('click', () => {
                document.getElementById('routeStart').value = '12.9780, 77.6100';
                document.getElementById('routeEnd').value = '12.9710, 77.6300';
                const c1 = document.getElementById('clearStartInputBtn');
                const c2 = document.getElementById('clearEndInputBtn');
                if (c1) c1.style.display = 'flex';
                if (c2) c2.style.display = 'flex';
                AppModule.showToast('Loaded Pothole Corridor demo scenario', 'info');
                triggerRouteCalculation();
            });
        }

        const floodBtn = document.getElementById('demoRouteFloodBtn');
        if (floodBtn) {
            floodBtn.addEventListener('click', () => {
                document.getElementById('routeStart').value = '12.9800, 77.5850';
                document.getElementById('routeEnd').value = '12.9600, 77.6100';
                const c1 = document.getElementById('clearStartInputBtn');
                const c2 = document.getElementById('clearEndInputBtn');
                if (c1) c1.style.display = 'flex';
                if (c2) c2.style.display = 'flex';
                AppModule.showToast('Loaded Underpass Flooding demo scenario', 'info');
                triggerRouteCalculation();
            });
        }

        // Audio Alert Test Trigger
        const testAudioBtn = document.getElementById('testAudioAlertBtn');
        if (testAudioBtn) {
            testAudioBtn.addEventListener('click', playDemoVoiceAlert);
        }
    }

    function triggerRouteCalculation() {
        const form = document.getElementById('routeForm');
        if (form) form.requestSubmit();
    }

    async function handleRouteSubmit(e) {
        e.preventDefault();
        const startVal = document.getElementById('routeStart').value.trim();
        const endVal = document.getElementById('routeEnd').value.trim();

        if (!startVal || !endVal) {
            AppModule.showToast('Please enter both start and destination points', 'error');
            return;
        }

        const calcBtn = document.getElementById('calculateRouteBtn');
        calcBtn.disabled = true;
        calcBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing Hazards & Alternative Corridors...';

        try {
            const startInput = document.getElementById('routeStart');
            const endInput = document.getElementById('routeEnd');
            const startCoords = await resolveCoordinates(startVal, startInput);
            const endCoords = await resolveCoordinates(endVal, endInput);

            if (!startCoords || !endCoords) {
                throw new Error('Could not resolve start or destination coordinates');
            }

            await planHazardAwareRoutes(startCoords, endCoords);
        } catch (err) {
            console.error('Routing error:', err);
            AppModule.showToast(err.message, 'error');
        } finally {
            calcBtn.disabled = false;
            calcBtn.innerHTML = '<i class="fa-solid fa-route"></i> Calculate & Compare Routes';
        }
    }

    async function planHazardAwareRoutes(start, end) {
        // Query OSRM public driving API with alternatives
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson&steps=true&alternatives=true`;

        const res = await fetch(osrmUrl);
        if (!res.ok) throw new Error('OSRM routing service unavailable');

        const data = await res.json();
        if (!data.routes || data.routes.length === 0) {
            throw new Error('No driving route found between these points');
        }

        const activeHazards = ReportsModule.getHazards().filter(h => h.status !== 'rejected' && !h.resolved);
        const alertBufferMeters = AppModule.getAlertDistance();

        // Evaluate all candidate routes
        candidateRoutes = data.routes.map((route, idx) => {
            const hazardsOnPath = checkHazardsAlongRoute(route.geometry.coordinates, activeHazards, alertBufferMeters);
            
            // Score penalty: High = 30, Medium = 15, Low = 5
            const penalty = hazardsOnPath.reduce((acc, h) => {
                const s = (h.severity || 'medium').toLowerCase();
                if (s === 'high') return acc + 30;
                if (s === 'medium') return acc + 15;
                return acc + 5;
            }, 0);

            const safetyScore = Math.max(10, 100 - penalty);
            const isSafe = (hazardsOnPath.length === 0);

            return {
                ...route,
                index: idx,
                name: (idx === 0) ? 'Route 1 (Primary / Direct)' : `Route ${idx + 1} (Alternative Detour)`,
                hazardsOnPath,
                safetyScore,
                isSafe,
                durationMins: Math.round(route.duration / 60),
                distanceKm: (route.distance / 1000).toFixed(1)
            };
        });

        // Determine Best Recommendation
        determineBestRecommendation();

        // Render Alternatives UI
        renderRouteAlternatives();

        // Select the recommended route by default
        selectRoute(selectedRouteIndex);

        // Play automated radio alert if the selected route has critical hazards
        const activeRoute = candidateRoutes[selectedRouteIndex];
        if (activeRoute && activeRoute.hazardsOnPath.length > 0) {
            const worstHazard = activeRoute.hazardsOnPath[0];
            const alertText = `SirenRoute Alert: ${worstHazard.severity} risk ${worstHazard.hazard_type.replace('_', ' ')} detected ahead. Caution advised.`;
            playRadioAlert(alertText);
        }
    }

    function checkHazardsAlongRoute(coords, hazards, bufferMeters = 85.0) {
        const found = [];
        const seen = new Set();

        for (const [lon, lat] of coords) {
            for (const h of hazards) {
                if (seen.has(h.id)) continue;
                const dist = haversineDistanceMeters(lat, lon, h.latitude, h.longitude);
                if (dist <= bufferMeters) {
                    seen.add(h.id);
                    found.push({
                        ...h,
                        distToRoute: Math.round(dist)
                    });
                }
            }
        }
        return found;
    }

    function determineBestRecommendation() {
        if (candidateRoutes.length === 1) {
            selectedRouteIndex = 0;
            return;
        }

        const r1 = candidateRoutes[0];
        const r2 = candidateRoutes[1];

        // If Route 1 has severe hazards and Route 2 has fewer/none, recommend Route 2
        if (r1.hazardsOnPath.length > r2.hazardsOnPath.length) {
            selectedRouteIndex = 1;
        } else if (r1.safetyScore >= r2.safetyScore) {
            selectedRouteIndex = 0;
        } else {
            selectedRouteIndex = 1;
        }
    }

    function renderRouteAlternatives() {
        const grid = document.getElementById('routeAlternativesGrid');
        const resultsCard = document.getElementById('routeResults');
        const clearBtn = document.getElementById('clearRouteBtn');
        const recBanner = document.getElementById('routeRecommendationBanner');
        const recTitle = document.getElementById('recTitle');
        const recDesc = document.getElementById('recDescription');

        if (!grid || !resultsCard) return;

        grid.innerHTML = candidateRoutes.slice(0, 2).map((r, i) => {
            const isRec = (i === selectedRouteIndex);
            const badgeClass = r.isSafe ? 'safe' : (r.safetyScore < 60 ? 'danger' : 'caution');
            const badgeText = r.isSafe ? 'Safe Corridor' : (r.safetyScore < 60 ? 'High Risk' : 'Caution');

            return `
                <div class="route-alt-card ${isRec ? 'selected' : ''} ${r.isSafe ? 'safe-choice' : ''}" onclick="RoutesModule.selectRoute(${i})">
                    <div class="alt-card-header">
                        <span class="alt-tag">${(i === 0) ? 'Fastest' : 'Alternative'}</span>
                        <span class="safety-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <span class="alt-card-time">${r.durationMins} min</span>
                    <div class="alt-card-details">
                        <span>${r.distanceKm} km</span>
                        <span style="color: ${r.hazardsOnPath.length > 0 ? '#ef4444' : '#10b981'}; font-weight: 700;">
                            ${r.hazardsOnPath.length} threats
                        </span>
                    </div>
                </div>
            `;
        }).join('');

        // Recommendation Text
        const chosen = candidateRoutes[selectedRouteIndex];
        if (recBanner && recTitle && recDesc) {
            if (candidateRoutes.length > 1 && selectedRouteIndex === 1 && candidateRoutes[0].hazardsOnPath.length > 0) {
                const avoidedCount = candidateRoutes[0].hazardsOnPath.length - chosen.hazardsOnPath.length;
                recTitle.textContent = `Recommended: Route 2 (Bypasses ${avoidedCount} Threats)`;
                recDesc.textContent = `Adds ${chosen.durationMins - candidateRoutes[0].durationMins} min, but avoids critical pothole/flood bottlenecks on the direct path.`;
            } else if (chosen.isSafe) {
                recTitle.textContent = 'Recommended: Route 1 (Fastest & Verified Safe)';
                recDesc.textContent = 'Zero road surface disruptions detected on this navigation corridor.';
            } else {
                recTitle.textContent = `Recommended: Route ${selectedRouteIndex + 1}`;
                recDesc.textContent = `Lowest hazard penalty route. Travel with caution.`;
            }
        }

        resultsCard.style.display = 'flex';
        if (clearBtn) clearBtn.style.display = 'block';
    }

    function selectRoute(index) {
        if (!candidateRoutes[index]) return;
        selectedRouteIndex = index;

        // Highlight selected alternative card
        const cards = document.querySelectorAll('.route-alt-card');
        cards.forEach((c, idx) => {
            if (idx === index) c.classList.add('selected');
            else c.classList.remove('selected');
        });

        const active = candidateRoutes[index];

        // Update overall badge
        const badge = document.getElementById('routeSafetyBadge');
        if (badge) {
            if (active.isSafe) {
                badge.className = 'safety-badge safe';
                badge.innerHTML = '<i class="fa-solid fa-shield-check"></i> Safe Route';
            } else if (active.safetyScore < 60) {
                badge.className = 'safety-badge danger';
                badge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Critical Risk';
            } else {
                badge.className = 'safety-badge caution';
                badge.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Caution Advised';
            }
        }

        // Render threats list
        const listEl = document.getElementById('routeHazardsList');
        if (listEl) {
            if (active.hazardsOnPath.length > 0) {
                listEl.innerHTML = active.hazardsOnPath.map(h => `
                    <div class="route-hazard-item">
                        <span>
                            <strong>${(h.hazard_type || 'hazard').toUpperCase()}</strong>: ${h.description.slice(0, 42)}... (${h.distToRoute}m from route)
                        </span>
                        <span class="badge ${h.severity}">${h.severity}</span>
                    </div>
                `).join('');
                listEl.style.display = 'flex';
            } else {
                listEl.innerHTML = '<div style="color: #10b981; font-size: 0.8rem;"><i class="fa-solid fa-check"></i> Zero road hazards detected on this corridor.</div>';
                listEl.style.display = 'block';
            }
        }

        // Draw on map
        MapModule.drawRoute(active.geometry.coordinates, !active.isSafe);
    }

    // Audio & Voice Hazard Alert Engine
    function playRadioAlert(textToSpeak) {
        if (navVoiceMuted) return;
        if (typeof AppModule !== 'undefined' && !AppModule.isVoiceAlertsEnabled()) return;

        // 1. Play Dual Chime via Web Audio API
        playSirenChime();

        // 2. Speak Spoken Announcement via Web Speech API
        setTimeout(() => {
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel(); // Stop any pending speech
                const utterance = new SpeechSynthesisUtterance(textToSpeak);
                utterance.rate = 1.05;
                utterance.pitch = 1.0;
                utterance.volume = 1.0;
                window.speechSynthesis.speak(utterance);
            }
        }, 350);
    }

    function playSirenChime() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;

            if (!audioContext) audioContext = new AudioCtx();
            if (audioContext.state === 'suspended') audioContext.resume();

            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();

            osc.type = 'sine';
            // Dual chime: 520 Hz -> 880 Hz
            osc.frequency.setValueAtTime(520, audioContext.currentTime);
            osc.frequency.exponentialRampToValueAtTime(880, audioContext.currentTime + 0.15);

            gain.gain.setValueAtTime(0.2, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.35);

            osc.connect(gain);
            gain.connect(audioContext.destination);

            osc.start();
            osc.stop(audioContext.currentTime + 0.35);
        } catch (e) {
            console.warn('Audio chime note:', e);
        }
    }

    function playDemoVoiceAlert() {
        const text = 'SirenRoute Caution: Severe crater pothole detected 120 meters ahead on the right lane. Please reduce speed.';
        playRadioAlert(text);
        AppModule.showToast('Radio-style voice alert triggered!', 'info');
    }

    function clearRoute() {
        candidateRoutes = [];
        selectedRouteIndex = 0;
        MapModule.clearRoute();
        const resultsCard = document.getElementById('routeResults');
        const clearBtn = document.getElementById('clearRouteBtn');
        if (resultsCard) resultsCard.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
    }

    function swapLocations() {
        const startInput = document.getElementById('routeStart');
        const endInput = document.getElementById('routeEnd');
        const tempVal = startInput.value;
        const tempLat = startInput.dataset.lat;
        const tempLon = startInput.dataset.lon;

        startInput.value = endInput.value;
        if (endInput.dataset.lat) startInput.dataset.lat = endInput.dataset.lat; else delete startInput.dataset.lat;
        if (endInput.dataset.lon) startInput.dataset.lon = endInput.dataset.lon; else delete startInput.dataset.lon;

        endInput.value = tempVal;
        if (tempLat) endInput.dataset.lat = tempLat; else delete endInput.dataset.lat;
        if (tempLon) endInput.dataset.lon = tempLon; else delete endInput.dataset.lon;
    }

    function setDestination(lat, lon) {
        const endInput = document.getElementById('routeEnd');
        if (endInput) {
            endInput.value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
            const routeTabBtn = document.querySelector('[data-tab="routesTab"]');
            if (routeTabBtn) routeTabBtn.click();
            AppModule.showToast('Destination set to selected hazard point', 'info');
        }
    }

    async function resolveCoordinates(inputStr, inputEl = null) {
        if (inputEl && inputEl.dataset.lat && inputEl.dataset.lon) {
            return {
                lat: parseFloat(inputEl.dataset.lat),
                lon: parseFloat(inputEl.dataset.lon)
            };
        }

        // Check if user entered or selected Current Location
        if (/current location|my location|here/i.test(inputStr)) {
            const coords = (typeof AppModule !== 'undefined' && AppModule.getUserCoords) ? AppModule.getUserCoords() : null;
            if (coords) return { lat: coords.lat, lon: coords.lon || coords.lng };
        }

        const coordMatch = inputStr.match(/^(-?\d+(\.\d+)?),\s*(-?\d+(\.\d+)?)$/);
        if (coordMatch) {
            return {
                lat: parseFloat(coordMatch[1]),
                lon: parseFloat(coordMatch[3])
            };
        }

        const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(inputStr)}&limit=1`;
        const res = await fetch(geoUrl, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('Geocoding service unavailable');
        const results = await res.json();
        if (results.length === 0) {
            throw new Error(`Location "${inputStr}" not found`);
        }
        return {
            lat: parseFloat(results[0].lat),
            lon: parseFloat(results[0].lon)
        };
    }

    function formatDistance(meters) {
        if (meters === null || meters === undefined || isNaN(meters)) return '';
        if (meters < 1000) {
            return `${Math.round(meters)} m`;
        }
        const km = meters / 1000;
        if (km < 10) {
            return `${km.toFixed(1)} km`;
        }
        if (km < 100) {
            return `${km.toFixed(0)} km`;
        }
        return `${Math.round(km)} km`;
    }

    function setupAutocomplete(input, dropdown, clearBtn) {
        if (!input || !dropdown) return;
        let debounceTimer = null;
        let abortCtrl = null;
        let activeIdx = -1;

        function updateClearBtnVisibility() {
            if (!clearBtn) return;
            clearBtn.style.display = input.value.trim().length > 0 ? 'flex' : 'none';
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                input.value = '';
                delete input.dataset.lat;
                delete input.dataset.lon;
                dropdown.style.display = 'none';
                dropdown.innerHTML = '';
                updateClearBtnVisibility();
                input.focus();
            });
        }

        input.addEventListener('focus', () => {
            updateClearBtnVisibility();
        });

        input.addEventListener('input', () => {
            updateClearBtnVisibility();
            clearTimeout(debounceTimer);
            const q = input.value.trim();

            delete input.dataset.lat;
            delete input.dataset.lon;
            activeIdx = -1;

            if (q.length < 2 || /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(q)) {
                dropdown.style.display = 'none';
                dropdown.innerHTML = '';
                return;
            }

            debounceTimer = setTimeout(async () => {
                if (abortCtrl) {
                    try { abortCtrl.abort(); } catch (e) {}
                }
                abortCtrl = new AbortController();

                try {
                    // 1. Fetch user's reference coordinates for distance & proximity biasing
                    const refCoords = (typeof AppModule !== 'undefined' && AppModule.getUserCoords)
                        ? AppModule.getUserCoords()
                        : (MapModule.getCenter ? MapModule.getCenter() : { lat: 12.9716, lng: 77.5946 });

                    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lat=${refCoords.lat}&lon=${refCoords.lon}`;
                    
                    let items = [];
                    try {
                        const res = await fetch(photonUrl, { signal: abortCtrl.signal });
                        if (res.ok) {
                            const data = await res.json();
                            items = (data.features || []).map(f => {
                                const p = f.properties || {};
                                const name = p.name || p.street || p.city || q;
                                const details = [p.street, p.city, p.state, p.country].filter(Boolean).join(', ');
                                const lat = f.geometry.coordinates[1];
                                const lon = f.geometry.coordinates[0];
                                const distMeters = haversineDistanceMeters(refCoords.lat, refCoords.lon, lat, lon);
                                return {
                                    name: name,
                                    subtitle: details || 'Landmark / City Area',
                                    lat: lat,
                                    lon: lon,
                                    distMeters: distMeters,
                                    distFormatted: formatDistance(distMeters)
                                };
                            });
                        }
                    } catch (e) {
                        if (e.name !== 'AbortError') console.warn('Photon query note:', e);
                    }

                    // Fallback to Nominatim if Photon returns nothing
                    if (items.length === 0) {
                        try {
                            const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=8&lat=${refCoords.lat}&lon=${refCoords.lon}`;
                            const res = await fetch(nomUrl, { 
                                headers: { 'Accept': 'application/json' },
                                signal: abortCtrl.signal 
                            });
                            if (res.ok) {
                                const data = await res.json();
                                items = data.map(d => {
                                    const lat = parseFloat(d.lat);
                                    const lon = parseFloat(d.lon);
                                    const distMeters = haversineDistanceMeters(refCoords.lat, refCoords.lon, lat, lon);
                                    return {
                                        name: d.display_name.split(',')[0],
                                        subtitle: d.display_name.split(',').slice(1, 4).join(','),
                                        lat: lat,
                                        lon: lon,
                                        distMeters: distMeters,
                                        distFormatted: formatDistance(distMeters)
                                    };
                                });
                            }
                        } catch (e) {
                            if (e.name !== 'AbortError') console.warn('Nominatim fallback note:', e);
                        }
                    }

                    if (items.length === 0) {
                        dropdown.style.display = 'none';
                        return;
                    }

                    // 2. Correlate first to places near user by sorting by proximity
                    items.sort((a, b) => a.distMeters - b.distMeters);

                    // 3. Render items with Google Maps-style right-aligned distance badge
                    dropdown.innerHTML = items.map((item, idx) => `
                        <div class="autocomplete-item" data-idx="${idx}">
                            <div class="autocomplete-item-left">
                                <i class="fa-solid fa-location-dot"></i>
                                <div class="autocomplete-item-text">
                                    <strong>${escapeHtml(item.name)}</strong>
                                    <span>${escapeHtml(item.subtitle)}</span>
                                </div>
                            </div>
                            ${item.distFormatted ? `
                                <div class="autocomplete-distance" title="${item.distFormatted} from your position">
                                    <i class="fa-solid fa-arrow-turn-up"></i>
                                    <span>${item.distFormatted}</span>
                                </div>
                            ` : ''}
                        </div>
                    `).join('');

                    dropdown.style.display = 'block';
                    activeIdx = -1;

                    dropdown.querySelectorAll('.autocomplete-item').forEach(el => {
                        el.addEventListener('click', () => {
                            const idx = parseInt(el.getAttribute('data-idx'), 10);
                            const item = items[idx];
                            if (item) {
                                input.value = item.name;
                                input.dataset.lat = item.lat;
                                input.dataset.lon = item.lon;
                                updateClearBtnVisibility();
                            }
                            dropdown.style.display = 'none';
                            dropdown.innerHTML = '';
                        });
                    });
                } catch (err) {
                    if (err.name !== 'AbortError') dropdown.style.display = 'none';
                }
            }, 180);
        });

        // Keyboard Navigation (ArrowDown, ArrowUp, Enter, Escape)
        input.addEventListener('keydown', (e) => {
            const items = dropdown.querySelectorAll('.autocomplete-item');
            if (dropdown.style.display === 'block' && items.length > 0) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeIdx = (activeIdx + 1) % items.length;
                    highlightItem(items, activeIdx);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeIdx = (activeIdx - 1 + items.length) % items.length;
                    highlightItem(items, activeIdx);
                } else if (e.key === 'Enter') {
                    if (activeIdx >= 0 && items[activeIdx]) {
                        e.preventDefault();
                        items[activeIdx].click();
                        checkAutoSubmit();
                    } else if (items.length > 0) {
                        e.preventDefault();
                        items[0].click();
                        checkAutoSubmit();
                    }
                } else if (e.key === 'Escape') {
                    dropdown.style.display = 'none';
                }
            } else if (e.key === 'Escape') {
                dropdown.style.display = 'none';
            }
        });

        function highlightItem(items, idx) {
            items.forEach((item, i) => {
                if (i === idx) {
                    item.classList.add('active');
                    item.scrollIntoView({ block: 'nearest' });
                } else {
                    item.classList.remove('active');
                }
            });
        }

        function checkAutoSubmit() {
            const startVal = document.getElementById('routeStart').value.trim();
            const endVal = document.getElementById('routeEnd').value.trim();
            if (startVal && endVal) {
                setTimeout(() => triggerRouteCalculation(), 120);
            }
        }

        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }

    // ==========================================
    // LIVE TURN-BY-TURN NAVIGATION ENGINE
    // ==========================================

    function startLiveNavigation() {
        const activeRoute = candidateRoutes[selectedRouteIndex];
        if (!activeRoute) {
            AppModule.showToast('Please calculate and select a route first', 'error');
            return;
        }

        navRouteCoords = (activeRoute.geometry && activeRoute.geometry.coordinates) ? activeRoute.geometry.coordinates : [];
        if (navRouteCoords.length === 0) {
            AppModule.showToast('No route coordinates found for navigation', 'error');
            return;
        }

        isLiveNavActive = true;
        navCurrentCoordIdx = 0;
        navManeuvers = parseRouteManeuvers(activeRoute);
        navActiveManeuverIdx = 0;
        alertedHazardSet = new Set();
        simSpeedKmh = 38 + Math.floor(Math.random() * 8);

        // Show HUD Overlay
        const hud = document.getElementById('liveNavHud');
        if (hud) hud.style.display = 'flex';

        updateVoiceMuteUI();

        // Place Vehicle Marker at Origin
        const startPoint = navRouteCoords[0];
        const mode = (typeof AppModule !== 'undefined' && AppModule.getVehicleMode) ? AppModule.getVehicleMode() : 'two_wheeler';
        const iconClass = mode === 'two_wheeler' ? 'fa-motorcycle' : (mode === 'car' ? 'fa-car-side' : 'fa-truck-fast');

        MapModule.showNavVehicle(startPoint[1], startPoint[0], iconClass, 0);
        MapModule.panTo(startPoint[1], startPoint[0], 17);

        // Initial HUD Display
        updateNavHud(startPoint[1], startPoint[0]);

        // Spoken Announcement
        playRadioAlert('SirenRoute Navigation started. Scanning corridor for real-time road hazards.');

        // Start drive simulation automatically for immediate responsiveness
        startDriveSimulation();

        AppModule.showToast('Live Turn-by-Turn Navigation Started 🏎️', 'success');
    }

    function stopLiveNavigation() {
        pauseDriveSimulation();
        isLiveNavActive = false;

        const hud = document.getElementById('liveNavHud');
        if (hud) hud.style.display = 'none';

        const alertBanner = document.getElementById('navHazardAlertBanner');
        if (alertBanner) alertBanner.style.display = 'none';

        MapModule.hideNavVehicle();

        if (navRouteCoords.length > 0) {
            MapModule.fitRouteBounds(navRouteCoords);
        }

        AppModule.showToast('Live navigation ended', 'info');
    }

    function toggleDriveSimulation() {
        if (isDriveSimulating) {
            pauseDriveSimulation();
            AppModule.showToast('Drive simulation paused', 'info');
        } else {
            startDriveSimulation();
            AppModule.showToast('Drive simulation running', 'info');
        }
    }

    function startDriveSimulation() {
        if (driveInterval) clearInterval(driveInterval);
        isDriveSimulating = true;
        updateSimButtonUI(true);

        driveInterval = setInterval(() => {
            advanceVehicleStep();
        }, 650);
    }

    function pauseDriveSimulation() {
        if (driveInterval) {
            clearInterval(driveInterval);
            driveInterval = null;
        }
        isDriveSimulating = false;
        updateSimButtonUI(false);
    }

    function updateSimButtonUI(isPlaying) {
        const icon = document.getElementById('simPlayPauseIcon');
        const text = document.getElementById('simPlayPauseText');
        const btn = document.getElementById('toggleDriveSimBtn');
        if (icon && text) {
            if (isPlaying) {
                icon.className = 'fa-solid fa-pause';
                text.textContent = 'Pause';
                if (btn) btn.classList.add('active');
            } else {
                icon.className = 'fa-solid fa-play';
                text.textContent = 'Drive';
                if (btn) btn.classList.remove('active');
            }
        }
    }

    function toggleVoiceMute() {
        navVoiceMuted = !navVoiceMuted;
        updateVoiceMuteUI();
        AppModule.showToast(navVoiceMuted ? 'Voice guidance muted' : 'Voice guidance enabled', 'info');
    }

    function updateVoiceMuteUI() {
        const icon = document.getElementById('navVoiceMuteIcon');
        if (icon) {
            icon.className = navVoiceMuted ? 'fa-solid fa-volume-xmark text-danger' : 'fa-solid fa-volume-high';
        }
    }

    function advanceVehicleStep() {
        if (!isLiveNavActive || navRouteCoords.length === 0) return;

        // Dynamic step stride for long routes
        const stepStride = Math.max(1, Math.floor(navRouteCoords.length / 75));
        navCurrentCoordIdx = Math.min(navCurrentCoordIdx + stepStride, navRouteCoords.length - 1);

        const [currLon, currLat] = navRouteCoords[navCurrentCoordIdx];

        if (navCurrentCoordIdx >= navRouteCoords.length - 1) {
            // Arrival reached
            pauseDriveSimulation();

            const turnDist = document.getElementById('navTurnDistance');
            const turnInst = document.getElementById('navTurnInstruction');
            const turnIcon = document.getElementById('navManeuverIcon');
            const etaTime = document.getElementById('navEtaTime');
            const remDist = document.getElementById('navRemainingDist');
            const speedDisp = document.getElementById('navSpeedDisplay');

            if (turnDist) turnDist.textContent = 'Arrived';
            if (turnInst) turnInst.textContent = 'You have reached your destination!';
            if (turnIcon) turnIcon.className = 'fa-solid fa-flag-checkered';
            if (etaTime) etaTime.textContent = '0 min';
            if (remDist) remDist.textContent = '0 m';
            if (speedDisp) speedDisp.textContent = '0 km/h';

            playRadioAlert('You have arrived at your destination.');
            AppModule.showToast('Destination reached safely! 🌟', 'success');
            if (typeof AppModule !== 'undefined' && AppModule.addPoints) {
                AppModule.addPoints(50, 'Completed Hazard-Safe Navigation');
            }
            return;
        }

        const nextIdx = Math.min(navCurrentCoordIdx + 1, navRouteCoords.length - 1);
        const [nextLon, nextLat] = navRouteCoords[nextIdx];
        const heading = calculateBearing(currLat, currLon, nextLat, nextLon);

        const mode = (typeof AppModule !== 'undefined' && AppModule.getVehicleMode) ? AppModule.getVehicleMode() : 'two_wheeler';
        const iconClass = mode === 'two_wheeler' ? 'fa-motorcycle' : (mode === 'car' ? 'fa-car-side' : 'fa-truck-fast');

        MapModule.showNavVehicle(currLat, currLon, iconClass, heading);
        MapModule.panTo(currLat, currLon);

        updateNavHud(currLat, currLon);
        checkHazardRadarProximity(currLat, currLon);
    }

    function updateNavHud(currLat, currLon) {
        if (!isLiveNavActive) return;

        // 1. Calculate remaining distance from current coordinate index to destination
        let remainingMeters = 0;
        for (let i = navCurrentCoordIdx; i < navRouteCoords.length - 1; i++) {
            const p1 = navRouteCoords[i];
            const p2 = navRouteCoords[i + 1];
            remainingMeters += haversineDistanceMeters(p1[1], p1[0], p2[1], p2[0]);
        }

        // 2. Remaining minutes & arrival clock
        const speedMetersPerMin = (simSpeedKmh * 1000) / 60;
        const remainingMins = Math.max(1, Math.round(remainingMeters / speedMetersPerMin));
        const arrivalTime = new Date(Date.now() + remainingMins * 60000);
        const arrivalClock = arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const etaEl = document.getElementById('navEtaTime');
        const distEl = document.getElementById('navRemainingDist');
        const arrivalEl = document.getElementById('navArrivalClock');
        const speedEl = document.getElementById('navSpeedDisplay');

        if (etaEl) etaEl.textContent = `${remainingMins} min`;
        if (distEl) distEl.textContent = formatDistance(remainingMeters);
        if (arrivalEl) arrivalEl.textContent = arrivalClock;
        if (speedEl) {
            const jitter = Math.floor(Math.random() * 3) - 1;
            speedEl.textContent = `${Math.max(20, simSpeedKmh + jitter)} km/h`;
        }

        // 3. Maneuver instruction card
        if (navManeuvers.length > 0) {
            if (currLat !== undefined && currLon !== undefined) {
                const curM = navManeuvers[navActiveManeuverIdx];
                if (curM) {
                    const distToM = haversineDistanceMeters(currLat, currLon, curM.lat, curM.lon);
                    if (distToM < 40 && navActiveManeuverIdx < navManeuvers.length - 1) {
                        navActiveManeuverIdx++;
                    }
                }
            }

            const activeManeuver = navManeuvers[navActiveManeuverIdx] || navManeuvers[navManeuvers.length - 1];
            if (activeManeuver) {
                const distM = (currLat !== undefined && currLon !== undefined)
                    ? haversineDistanceMeters(currLat, currLon, activeManeuver.lat, activeManeuver.lon)
                    : activeManeuver.distance;

                const turnDistEl = document.getElementById('navTurnDistance');
                const turnInstEl = document.getElementById('navTurnInstruction');
                const turnIconEl = document.getElementById('navManeuverIcon');

                if (turnDistEl) turnDistEl.textContent = distM < 40 ? 'Now' : `In ${formatDistance(distM)}`;
                if (turnInstEl) turnInstEl.textContent = activeManeuver.instruction;
                if (turnIconEl) turnIconEl.className = `fa-solid ${activeManeuver.icon}`;
            }
        }
    }

    function checkHazardRadarProximity(vehLat, vehLon) {
        if (!isLiveNavActive) return;

        const alertBufferMeters = (typeof AppModule !== 'undefined' && AppModule.getAlertDistance)
            ? AppModule.getAlertDistance()
            : 150;

        const activeHazards = (typeof ReportsModule !== 'undefined' && ReportsModule.getHazards)
            ? ReportsModule.getHazards().filter(h => h.status !== 'rejected' && !h.resolved)
            : [];

        let closestHazard = null;
        let minDistance = Infinity;

        for (const h of activeHazards) {
            const d = haversineDistanceMeters(vehLat, vehLon, h.latitude, h.longitude);
            if (d <= alertBufferMeters && d < minDistance) {
                minDistance = d;
                closestHazard = h;
            }
        }

        const alertBanner = document.getElementById('navHazardAlertBanner');
        const alertTitle = document.getElementById('navAlertHazardTitle');
        const alertDesc = document.getElementById('navAlertHazardDesc');

        if (closestHazard && alertBanner && alertTitle && alertDesc) {
            const hazardName = (closestHazard.hazard_type || 'Road Hazard').replace('_', ' ').toUpperCase();
            alertTitle.textContent = `⚠️ Hazard Alert (${Math.round(minDistance)}m ahead!)`;
            alertDesc.textContent = `${closestHazard.severity.toUpperCase()} RISK: ${hazardName} - ${closestHazard.description || 'Reduce speed immediately'}`;
            alertBanner.style.display = 'flex';

            if (!alertedHazardSet.has(closestHazard.id)) {
                alertedHazardSet.add(closestHazard.id);
                if (!navVoiceMuted) {
                    const spokenText = `Attention: ${closestHazard.severity} risk ${closestHazard.hazard_type.replace('_', ' ')} detected ${Math.round(minDistance)} meters ahead. Slow down.`;
                    playRadioAlert(spokenText);
                }
            }
        } else if (alertBanner) {
            alertBanner.style.display = 'none';
        }
    }

    function parseRouteManeuvers(route) {
        const steps = (route.legs && route.legs[0] && route.legs[0].steps) ? route.legs[0].steps : [];
        if (steps.length > 0) {
            return steps.map(s => {
                const m = s.maneuver || {};
                const type = m.type || 'turn';
                const mod = m.modifier || '';
                const loc = m.location || [0, 0];

                let icon = 'fa-arrow-up';
                if (mod.includes('right')) {
                    icon = mod.includes('slight') ? 'fa-arrow-turn-up' : 'fa-arrow-turn-right';
                } else if (mod.includes('left')) {
                    icon = mod.includes('slight') ? 'fa-arrow-turn-up' : 'fa-arrow-turn-left';
                } else if (mod.includes('u-turn') || mod.includes('uturn')) {
                    icon = 'fa-arrow-rotate-left';
                } else if (type === 'arrive') {
                    icon = 'fa-flag-checkered';
                }

                let text = 'Continue straight';
                if (type === 'depart') {
                    text = `Depart onto ${s.name || 'route'}`;
                } else if (type === 'arrive') {
                    text = 'Arrive at destination';
                } else if (mod) {
                    const modWord = mod.charAt(0).toUpperCase() + mod.slice(1);
                    text = s.name ? `${modWord} onto ${s.name}` : `${modWord} ahead`;
                } else if (s.name) {
                    text = `Continue onto ${s.name}`;
                }

                return {
                    instruction: text,
                    icon: icon,
                    lat: loc[1],
                    lon: loc[0],
                    distance: s.distance || 0
                };
            });
        }

        // Synthetic fallback maneuvers if steps are omitted
        const coords = route.geometry.coordinates;
        const synth = [];
        if (coords && coords.length > 0) {
            synth.push({
                instruction: 'Depart and proceed along recommended corridor',
                icon: 'fa-arrow-up',
                lat: coords[0][1],
                lon: coords[0][0],
                distance: 250
            });
            const midIdx = Math.floor(coords.length / 2);
            synth.push({
                instruction: 'Follow corridor bypassing detected road threats',
                icon: 'fa-arrow-turn-right',
                lat: coords[midIdx][1],
                lon: coords[midIdx][0],
                distance: 400
            });
            const lastIdx = coords.length - 1;
            synth.push({
                instruction: 'Arrive at destination',
                icon: 'fa-flag-checkered',
                lat: coords[lastIdx][1],
                lon: coords[lastIdx][0],
                distance: 0
            });
        }
        return synth;
    }

    function calculateBearing(lat1, lon1, lat2, lon2) {
        const toRad = d => d * Math.PI / 180;
        const toDeg = r => r * 180 / Math.PI;
        const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
                  Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
        return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    return {
        init,
        setDestination,
        selectRoute,
        clearRoute,
        playRadioAlert,
        startLiveNavigation,
        stopLiveNavigation,
        toggleDriveSimulation,
        toggleVoiceMute
    };
})();