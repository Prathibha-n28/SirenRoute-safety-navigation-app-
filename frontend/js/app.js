/**
 * SirenRoute Main Application Coordinator
 * Manages tabs, user safety points & gamification, vehicle profile modes,
 * radio voice alert toggles, settings sync, and geolocation.
 */
const AppModule = (() => {
    let userLocation = null;
    let points = parseInt(localStorage.getItem('sirenroute_points') || '250', 10);
    let vehicleMode = localStorage.getItem('sirenroute_vehicle') || 'two_wheeler';
    let voiceAlertsEnabled = localStorage.getItem('sirenroute_voice_alerts') !== 'false';
    let alertDistance = parseInt(localStorage.getItem('sirenroute_alert_distance') || '150', 10);

    function init() {
        // Initialize Submodules
        MapModule.init();
        ReportsModule.init();
        RoutesModule.init();

        bindGlobalEvents();
        bindSettingsEvents();
        updateVehicleUI();
        updatePointsUI();
        updateAudioToggleUI();

        checkBackendHealth();
        requestUserLocation();

        // 45s periodic poll
        setInterval(() => {
            checkBackendHealth();
            ReportsModule.loadHazards();
        }, 45000);
    }

    function bindGlobalEvents() {
        // Tab Switching
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTabId = btn.getAttribute('data-tab');

                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                document.querySelectorAll('.tab-pane').forEach(pane => {
                    pane.classList.remove('active');
                });

                const targetPane = document.getElementById(targetTabId);
                if (targetPane) targetPane.classList.add('active');

                // If opening civic tab, refresh civic stats
                if (targetTabId === 'civicTab') {
                    ReportsModule.loadHazards();
                }

                // Force map resize check
                MapModule.invalidateSize();
            });
        });

        // Mobile Sidebar Toggle
        const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
        const sidebar = document.getElementById('sidebar');
        if (toggleSidebarBtn && sidebar) {
            toggleSidebarBtn.addEventListener('click', () => {
                sidebar.classList.toggle('open');
            });
        }

        // Navbar Quick Toggles
        const navVehiclePill = document.getElementById('navVehiclePill');
        if (navVehiclePill) {
            navVehiclePill.addEventListener('click', () => {
                switchTab('settingsTab');
                showToast('Vehicle Profile Settings', 'info');
            });
        }

        const navAudioToggle = document.getElementById('navAudioToggle');
        if (navAudioToggle) {
            navAudioToggle.addEventListener('click', () => {
                voiceAlertsEnabled = !voiceAlertsEnabled;
                localStorage.setItem('sirenroute_voice_alerts', voiceAlertsEnabled);
                updateAudioToggleUI();
                showToast(voiceAlertsEnabled ? 'Radio voice alerts activated' : 'Voice alerts muted', 'info');
            });
        }

        const navPointsPill = document.getElementById('navPointsPill');
        if (navPointsPill) {
            navPointsPill.addEventListener('click', () => {
                switchTab('rewardsTab');
            });
        }

        const navHazardsPill = document.getElementById('navHazardsPill');
        if (navHazardsPill) {
            navHazardsPill.addEventListener('click', () => {
                switchTab('hazardsTab');
            });
        }

        // Floating Action Buttons
        const locateMeBtn = document.getElementById('locateMeBtn');
        if (locateMeBtn) {
            locateMeBtn.addEventListener('click', () => requestUserLocation(true));
        }

        const refreshBtn = document.getElementById('refreshHazardsBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                ReportsModule.loadHazards();
                showToast('Live hazards refreshed', 'info');
            });
        }

        const quickReportBtn = document.getElementById('quickReportBtn');
        if (quickReportBtn) {
            quickReportBtn.addEventListener('click', () => {
                const center = MapModule.getCenter();
                document.getElementById('hazardLat').value = center.lat.toFixed(5);
                document.getElementById('hazardLon').value = center.lng.toFixed(5);
                switchTab('reportTab');
                showToast('Hazard coordinates pinned to current map center', 'info');
            });
        }

        const cancelPickerBtn = document.getElementById('cancelPickerBtn');
        if (cancelPickerBtn) {
            cancelPickerBtn.addEventListener('click', () => {
                MapModule.disablePickerMode();
                showToast('Location selection cancelled', 'info');
            });
        }

        // Location Precision Banner Controls
        const enableGpsBtn = document.getElementById('enableGpsBtn');
        if (enableGpsBtn) {
            enableGpsBtn.addEventListener('click', () => {
                requestUserLocation(true, true);
            });
        }

        const adjustPinBtn = document.getElementById('adjustPinBtn');
        if (adjustPinBtn) {
            adjustPinBtn.addEventListener('click', () => {
                MapModule.enablePickerMode((coords) => {
                    setUserLocationManual(coords.lat, coords.lng, 'Pinned Location');
                }, 'Click anywhere on the map to place your exact location pin');
            });
        }
    }

    function bindSettingsEvents() {
        // Vehicle Profile Selection
        const vehicleCards = document.querySelectorAll('.vehicle-card');
        vehicleCards.forEach(card => {
            card.addEventListener('click', () => {
                vehicleCards.forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                vehicleMode = card.getAttribute('data-vehicle');
                localStorage.setItem('sirenroute_vehicle', vehicleMode);
                updateVehicleUI();
                showToast(`Vehicle mode switched to ${card.querySelector('strong').textContent}`, 'success');
            });
        });

        // Audio Voice Switch in Settings
        const voiceSwitch = document.getElementById('settingVoiceEnabled');
        if (voiceSwitch) {
            voiceSwitch.checked = voiceAlertsEnabled;
            voiceSwitch.addEventListener('change', (e) => {
                voiceAlertsEnabled = e.target.checked;
                localStorage.setItem('sirenroute_voice_alerts', voiceAlertsEnabled);
                updateAudioToggleUI();
            });
        }

        // Distance Slider
        const distSlider = document.getElementById('settingAlertDistance');
        const distVal = document.getElementById('distVal');
        if (distSlider && distVal) {
            distSlider.value = alertDistance;
            distVal.textContent = alertDistance;
            distSlider.addEventListener('input', (e) => {
                alertDistance = parseInt(e.target.value, 10);
                distVal.textContent = alertDistance;
                localStorage.setItem('sirenroute_alert_distance', alertDistance);
            });
        }

        // Test Voice in Settings
        const testVoiceBtn = document.getElementById('testVoiceBtn');
        if (testVoiceBtn) {
            testVoiceBtn.addEventListener('click', () => {
                RoutesModule.playRadioAlert('SirenRoute Voice System Online. Ready for hazard-aware navigation.');
                showToast('Playing sample voice announcement...', 'info');
            });
        }

        // Map Theme Switcher
        const mapThemeSelect = document.getElementById('settingMapTheme');
        if (mapThemeSelect) {
            mapThemeSelect.addEventListener('change', (e) => {
                MapModule.changeTileLayer(e.target.value);
                showToast(`Map theme updated to ${e.target.options[e.target.selectedIndex].text}`, 'info');
            });
        }

        // Save Gemini API Key
        const saveKeyBtn = document.getElementById('saveGeminiKeyBtn');
        const keyInput = document.getElementById('settingGeminiKey');
        if (saveKeyBtn && keyInput) {
            saveKeyBtn.addEventListener('click', () => {
                const key = keyInput.value.trim();
                if (key) {
                    localStorage.setItem('sirenroute_gemini_key', key);
                    showToast('Gemini API key saved to browser cache!', 'success');
                } else {
                    showToast('Key cleared; using simulated AI verification', 'info');
                }
            });
        }

        // Reset Demo Scenario
        const resetDemoBtn = document.getElementById('resetDemoBtn');
        if (resetDemoBtn) {
            resetDemoBtn.addEventListener('click', async () => {
                if (!confirm('Reload pitch demo scenario? This seeds the official Bangalore hazard corridor.')) return;
                try {
                    const res = await fetch(`${ReportsModule.API_BASE}/demo/reset`, { method: 'POST' });
                    if (res.ok) {
                        showToast('Hackathon demo scenario reloaded successfully!', 'success');
                        ReportsModule.loadHazards();
                        MapModule.flyTo(12.9716, 77.5946, 13);
                    }
                } catch {
                    showToast('Could not reset demo data', 'error');
                }
            });
        }

        // Service Health Diagnostics Ping
        const runDiagnosticsBtn = document.getElementById('runDiagnosticsBtn');
        if (runDiagnosticsBtn) {
            runDiagnosticsBtn.addEventListener('click', () => {
                runDiagnostics(true);
            });
        }
    }

    function switchTab(tabId) {
        const tabBtn = document.querySelector(`[data-tab="${tabId}"]`);
        if (tabBtn) tabBtn.click();
    }

    function updateVehicleUI() {
        const icon = document.getElementById('navVehicleIcon');
        const label = document.getElementById('navVehicleLabel');
        if (!icon || !label) return;

        if (vehicleMode === 'two_wheeler') {
            icon.className = 'fa-solid fa-motorcycle';
            label.textContent = 'Two-Wheeler';
        } else if (vehicleMode === 'car') {
            icon.className = 'fa-solid fa-car';
            label.textContent = 'Passenger Car';
        } else {
            icon.className = 'fa-solid fa-truck-fast';
            label.textContent = 'Fleet / Logistics';
        }

        // Sync card active state in settings
        document.querySelectorAll('.vehicle-card').forEach(card => {
            if (card.getAttribute('data-vehicle') === vehicleMode) card.classList.add('active');
            else card.classList.remove('active');
        });
    }

    function updateAudioToggleUI() {
        const toggle = document.getElementById('navAudioToggle');
        const label = document.getElementById('navAudioLabel');
        const icon = document.getElementById('navAudioIcon');
        const voiceSwitch = document.getElementById('settingVoiceEnabled');

        if (toggle && label && icon) {
            if (voiceAlertsEnabled) {
                toggle.className = 'nav-pill nav-audio-pill active';
                label.textContent = 'Voice Alerts: ON';
                icon.className = 'fa-solid fa-volume-high';
            } else {
                toggle.className = 'nav-pill nav-audio-pill muted';
                label.textContent = 'Voice Alerts: OFF';
                icon.className = 'fa-solid fa-volume-xmark';
            }
        }
        if (voiceSwitch) voiceSwitch.checked = voiceAlertsEnabled;
    }

    function updatePointsUI() {
        const navPoints = document.getElementById('navPointsCount');
        const profilePoints = document.getElementById('profilePointsVal');
        if (navPoints) navPoints.textContent = points;
        if (profilePoints) profilePoints.textContent = points;
    }

    function addPoints(amount) {
        points += amount;
        localStorage.setItem('sirenroute_points', points);
        updatePointsUI();
    }

    function deductPoints(amount) {
        points = Math.max(0, points - amount);
        localStorage.setItem('sirenroute_points', points);
        updatePointsUI();
    }

    async function checkBackendHealth() {
        await runDiagnostics(false);
    }

    async function runDiagnostics(showToastAlert = false) {
        const btn = document.getElementById('runDiagnosticsBtn');
        if (btn && showToastAlert) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Pinging...';
        }

        const t0 = performance.now();
        let isOnline = false;
        let pingMs = 0;
        let healthData = null;

        try {
            const res = await fetch(`${ReportsModule.API_BASE}/health`, { cache: 'no-store' });
            pingMs = Math.max(1, Math.round(performance.now() - t0));
            if (res.ok) {
                isOnline = true;
                healthData = await res.json();
            }
        } catch (e) {
            console.warn('Diagnostics ping failed:', e);
        }

        updateDiagnosticsUI(isOnline, pingMs, healthData);

        if (btn && showToastAlert) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Ping Status';
            if (isOnline) {
                showToast(`System Operational • Latency: ${pingMs}ms`, 'success');
            } else {
                showToast('Diagnostics Alert: Backend server unreachable', 'error');
            }
        }
    }

    function updateDiagnosticsUI(isOnline, pingMs, healthData) {
        const diagBackendStatus = document.getElementById('diagBackendStatus');
        const diagBackendPing = document.getElementById('diagBackendPing');
        const diagAiStatus = document.getElementById('diagAiStatus');
        const diagAiBadge = document.getElementById('diagAiBadge');

        if (diagBackendStatus) {
            if (isOnline) {
                diagBackendStatus.innerHTML = '<span class="status-indicator"></span> Online (Port 5001)';
                diagBackendStatus.style.color = '#10b981';
            } else {
                diagBackendStatus.innerHTML = '<span class="status-indicator" style="background:#ef4444;box-shadow:none;"></span> Disconnected';
                diagBackendStatus.style.color = '#ef4444';
            }
        }

        if (diagBackendPing) {
            if (isOnline) {
                diagBackendPing.textContent = `${pingMs}ms`;
                diagBackendPing.className = 'diag-badge text-success';
            } else {
                diagBackendPing.textContent = 'Timeout';
                diagBackendPing.className = 'diag-badge text-danger';
            }
        }

        if (diagAiStatus && diagAiBadge) {
            const modelName = healthData?.model || 'Gemini 3.5 Flash';
            if (isOnline && healthData?.gemini_configured) {
                diagAiStatus.textContent = `${modelName} (Cloud Active)`;
                diagAiBadge.textContent = 'Online';
                diagAiBadge.className = 'diag-badge text-ai';
            } else if (isOnline) {
                diagAiStatus.textContent = `${modelName} (Simulated)`;
                diagAiBadge.textContent = 'Ready';
                diagAiBadge.className = 'diag-badge text-info';
            } else {
                diagAiStatus.textContent = 'AI Vision (Unreachable)';
                diagAiBadge.textContent = 'Offline';
                diagAiBadge.className = 'diag-badge text-danger';
            }
        }
    }

    function setBackendStatus(isOnline) {
        updateDiagnosticsUI(isOnline, 0, null);
    }

    async function requestUserLocation(panTo = false, explicitUserClick = false) {
        let hasGps = false;

        const applyLocation = (lat, lon, accuracy, label, isGps = false) => {
            userLocation = { lat, lon, accuracy, label, isGps };
            MapModule.setUserLocation(lat, lon, accuracy);

            const startInput = document.getElementById('routeStart');
            if (startInput) {
                if (!startInput.value || startInput.value === 'My Current Location' || startInput.value === 'My Pinned Location' || /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(startInput.value)) {
                    startInput.value = isGps ? 'My Current Location' : (label.includes('City') || label.includes('Area') ? `Current Area (${label})` : 'My Current Location');
                    startInput.dataset.lat = lat;
                    startInput.dataset.lon = lon;
                }
            }

            if (isGps) {
                updateLocationBanner('High-Precision GPS Locked', `Accurate within ~${Math.round(accuracy)}m (Satellite)`, 'fa-satellite', '#10b981');
            } else {
                updateLocationBanner(`Network Location: ${label}`, 'Approximate area. Click Enable GPS or drag pin to adjust.', 'fa-satellite-dish', '#38bdf8');
            }

            if (panTo) {
                MapModule.flyTo(lat, lon, isGps ? 16 : 14);
                showToast(`Location locked: ${label}`, 'success');
            } else {
                MapModule.flyTo(lat, lon, 14);
            }
        };

        if (explicitUserClick) {
            showToast('Requesting GPS satellite fix... Please click "Allow" on the browser prompt.', 'info');
        }

        // 1. Instantly query first-party backend endpoint for reliable network IP location
        try {
            const res = await fetch(`${ReportsModule.API_BASE}/api/locate-me`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.success && data.latitude && data.longitude) {
                    if (!hasGps && (!userLocation || !userLocation.isGps)) {
                        applyLocation(data.latitude, data.longitude, 400, data.city || 'Your Area', false);
                    }
                }
            }
        } catch (e) {
            console.warn('Backend locate-me error:', e);
        }

        // 2. Concurrently query browser GPS for high-precision satellite coordinates
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    hasGps = true;
                    applyLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy || 15, 'Exact GPS Position', true);
                },
                (err) => {
                    console.warn('Browser GPS permission ungranted or timed out:', err.message);
                    if (explicitUserClick) {
                        showToast('Browser GPS was not approved or timed out. You can drag your blue pin or click "Pick on Map" to set your exact spot!', 'info');
                    }
                },
                { enableHighAccuracy: true, timeout: explicitUserClick ? 10000 : 5000, maximumAge: 30000 }
            );
        }
    }

    function setUserLocationManual(lat, lon, label = 'Pinned Spot') {
        userLocation = { lat, lon, accuracy: 25, label, isGps: true, isManual: true };
        MapModule.setUserLocation(lat, lon, 25);

        const startInput = document.getElementById('routeStart');
        if (startInput) {
            startInput.value = 'My Pinned Location';
            startInput.dataset.lat = lat;
            startInput.dataset.lon = lon;
        }

        updateLocationBanner('Manual Location Pinned', `Exact pin set on road: ${lat.toFixed(4)}, ${lon.toFixed(4)}`, 'fa-location-dot', '#06b6d4');
        MapModule.flyTo(lat, lon, 15);
        showToast(`Position pinned at ${lat.toFixed(4)}, ${lon.toFixed(4)}`, 'success');
    }

    function updateLocationBanner(title, sub, iconClass = 'fa-satellite', color = '#38bdf8') {
        const titleEl = document.getElementById('locStatusTitle');
        const subEl = document.getElementById('locStatusSub');
        const iconEl = document.getElementById('locStatusIcon');
        if (titleEl) titleEl.textContent = title;
        if (subEl) subEl.textContent = sub;
        if (iconEl) {
            iconEl.className = `fa-solid ${iconClass}`;
            iconEl.style.color = color;
        }
    }

    function getUserLocation(callback) {
        if (userLocation) {
            callback(userLocation);
        } else {
            requestUserLocation(true);
            setTimeout(() => {
                if (userLocation) callback(userLocation);
                else {
                    const center = MapModule.getCenter();
                    callback({ lat: center.lat, lon: center.lng });
                }
            }, 600);
        }
    }

    function getUserCoords() {
        if (userLocation && userLocation.lat && userLocation.lon) {
            return { lat: userLocation.lat, lon: userLocation.lon };
        }
        return MapModule.getCenter ? MapModule.getCenter() : { lat: 12.9716, lng: 77.5946 };
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            success: 'fa-circle-check',
            error: 'fa-circle-xmark',
            info: 'fa-circle-info'
        };
        const iconClass = icons[type] || icons.info;

        toast.innerHTML = `
            <i class="fa-solid ${iconClass}"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.4s ease';
            setTimeout(() => toast.remove(), 400);
        }, 3600);
    }

    return {
        init,
        getUserLocation,
        getUserCoords,
        requestUserLocation,
        setUserLocationManual,
        setBackendStatus,
        showToast,
        getPoints: () => points,
        addPoints,
        deductPoints,
        getVehicleMode: () => vehicleMode,
        isVoiceAlertsEnabled: () => voiceAlertsEnabled,
        getAlertDistance: () => alertDistance
    };
})();

document.addEventListener('DOMContentLoaded', AppModule.init);