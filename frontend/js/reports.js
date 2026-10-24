/**
 * SirenRoute Reports & Community Module
 * Handles hazard reporting, Gemini AI vision verification, community upvoting,
 * rewards coupon redemption, and municipal civic analytics.
 */
const ReportsModule = (() => {
    const API_BASE = (window.location.port === '5001')
        ? ''
        : (window.location.protocol === 'file:'
            ? 'http://127.0.0.1:5001'
            : (window.location.hostname ? `${window.location.protocol}//${window.location.hostname}:5001` : 'http://127.0.0.1:5001'));

    let currentHazards = [];
    let currentRewards = [];
    let selectedImageFile = null;

    function init() {
        bindEvents();
        loadHazards();
        loadRewards();
        loadCivicStats();
    }

    function bindEvents() {
        const form = document.getElementById('hazardForm');
        if (form) form.addEventListener('submit', handleFormSubmit);

        const imageInput = document.getElementById('hazardImageInput');
        if (imageInput) imageInput.addEventListener('change', handleImageSelect);

        const removeImgBtn = document.getElementById('removeImageBtn');
        if (removeImgBtn) removeImgBtn.addEventListener('click', clearSelectedImage);

        const statusFilter = document.getElementById('statusFilter');
        const severityFilter = document.getElementById('severityFilter');
        if (statusFilter) statusFilter.addEventListener('change', loadHazards);
        if (severityFilter) severityFilter.addEventListener('change', loadHazards);

        const searchInput = document.getElementById('hazardSearchInput');
        if (searchInput) searchInput.addEventListener('input', filterAndRenderHazards);

        // Map picker for reporting
        const pickOnMapBtn = document.getElementById('pickHazardOnMapBtn');
        if (pickOnMapBtn) {
            pickOnMapBtn.addEventListener('click', () => {
                MapModule.enablePickerMode((coords) => {
                    document.getElementById('hazardLat').value = coords.lat.toFixed(5);
                    document.getElementById('hazardLon').value = coords.lng.toFixed(5);
                    AppModule.showToast('Selected location from map!', 'info');
                }, 'Click anywhere on the map to set hazard location');
            });
        }

        // GPS for reporting
        const useGpsBtn = document.getElementById('useGpsForHazardBtn');
        if (useGpsBtn) {
            useGpsBtn.addEventListener('click', () => {
                AppModule.getUserLocation((coords) => {
                    document.getElementById('hazardLat').value = coords.lat.toFixed(5);
                    document.getElementById('hazardLon').value = coords.lon.toFixed(5);
                    AppModule.showToast('Location updated from your GPS', 'success');
                });
            });
        }

        // Civic Exports
        const exportGeoJsonBtn = document.getElementById('exportGeoJsonBtn');
        if (exportGeoJsonBtn) {
            exportGeoJsonBtn.addEventListener('click', () => {
                window.open(`${API_BASE}/civic/export?format=geojson`, '_blank');
                AppModule.showToast('Exporting GeoJSON for GIS integration...', 'success');
            });
        }

        const exportCsvBtn = document.getElementById('exportCsvBtn');
        if (exportCsvBtn) {
            exportCsvBtn.addEventListener('click', () => {
                window.open(`${API_BASE}/civic/export?format=csv`, '_blank');
                AppModule.showToast('Downloading CSV for municipal dispatch...', 'success');
            });
        }

        // Coupon Modal Close & Copy
        const closeModalBtn = document.getElementById('closeCouponModalBtn');
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => {
                document.getElementById('couponModal').style.display = 'none';
            });
        }

        const copyCodeBtn = document.getElementById('copyCodeBtn');
        if (copyCodeBtn) {
            copyCodeBtn.addEventListener('click', () => {
                const code = document.getElementById('modalDiscountCode').textContent;
                navigator.clipboard.writeText(code);
                AppModule.showToast(`Promo Code ${code} copied to clipboard!`, 'success');
            });
        }
    }

    async function loadHazards() {
        const status = document.getElementById('statusFilter')?.value || 'all';
        const severity = document.getElementById('severityFilter')?.value || 'all';

        let url = `${API_BASE}/hazards?status=${status}`;
        if (severity !== 'all') url += `&severity=${severity}`;

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
            const data = await res.json();
            currentHazards = data.hazards || [];

            // Update Counts in Navbar and Tabs
            const activeCount = currentHazards.filter(h => h.status !== 'rejected' && !h.resolved).length;
            const tabCountEl = document.getElementById('tabHazardsCount');
            if (tabCountEl) tabCountEl.textContent = currentHazards.length;
            const navCountEl = document.getElementById('navActiveHazardsCount');
            if (navCountEl) navCountEl.textContent = activeCount;

            filterAndRenderHazards();
            MapModule.renderHazards(currentHazards);
            loadCivicStats();
        } catch (err) {
            console.error('Failed to load hazards:', err);
            AppModule.setBackendStatus(false);
        }
    }

    function filterAndRenderHazards() {
        const searchInput = document.getElementById('hazardSearchInput');
        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

        let list = currentHazards;
        if (query) {
            list = currentHazards.filter(h => {
                const desc = (h.description || '').toLowerCase();
                const type = (h.hazard_type || '').toLowerCase();
                const formatted = formatHazardType(h.hazard_type).toLowerCase();
                return desc.includes(query) || type.includes(query) || formatted.includes(query);
            });
        }
        renderHazardCards(list);
    }

    function renderHazardCards(hazards) {
        const container = document.getElementById('hazardsListContainer');
        if (!container) return;

        if (hazards.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: #64748b; padding: 40px 10px;">
                    <i class="fa-solid fa-shield-cat" style="font-size: 2.2rem; margin-bottom: 10px; color: #3b82f6;"></i>
                    <p style="font-size: 0.9rem; font-weight: 600;">No road hazards match this filter.</p>
                    <span style="font-size: 0.75rem; color: #64748b;">Community routes in this zone are clear.</span>
                </div>
            `;
            return;
        }

        container.innerHTML = hazards.map(h => {
            const hasImg = !!h.image_url;
            const imgHtml = hasImg 
                ? `<img src="${API_BASE}${h.image_url}" class="hazard-thumbnail" alt="Hazard photo" onerror="this.style.display='none'">` 
                : '';

            const aiBadge = h.ai_verified ? `
                <span class="badge verified" title="${h.ai_analysis || 'AI Verified'}">
                    <i class="fa-solid fa-brain"></i> AI Verified (${Math.round((h.ai_confidence || 0.85) * 100)}%)
                </span>
            ` : '';

            const staleBadge = h.is_stale ? `
                <span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8;" title="Report unconfirmed over 48h">
                    <i class="fa-regular fa-hourglass-half"></i> Stale
                </span>
            ` : '';

            const resolvedBadge = h.resolved ? `
                <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">
                    <i class="fa-solid fa-wrench"></i> Repaired
                </span>
            ` : '';

            return `
                <div class="hazard-card" id="card-hazard-${h.id}">
                    <div class="hazard-card-top">
                        <div class="hazard-type-tag">
                            <span>${getHazardIcon(h.hazard_type)}</span>
                            <span>${formatHazardType(h.hazard_type)}</span>
                        </div>
                        <div style="display:flex; gap: 4px; flex-wrap: wrap;">
                            <span class="badge ${h.severity}">${h.severity}</span>
                            ${aiBadge}
                            ${staleBadge}
                            ${resolvedBadge}
                        </div>
                    </div>

                    <p class="hazard-desc">${escapeHtml(h.description)}</p>
                    ${imgHtml}

                    <div class="hazard-card-footer">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span><i class="fa-regular fa-clock"></i> ${formatDate(h.created_at)}</span>
                            <!-- Community Upvote / Downvote -->
                            <div style="display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.04); padding: 2px 6px; border-radius: 10px;">
                                <button type="button" class="btn-card-action" style="padding: 1px 4px; border: none;" title="Confirm Hazard" onclick="ReportsModule.voteHazard(${h.id}, 'up')">
                                    <i class="fa-solid fa-thumbs-up" style="color: #10b981;"></i>
                                </button>
                                <span style="font-weight: 700; font-size: 0.75rem; color: #cbd5e1;">${(h.upvotes || 0) - (h.downvotes || 0)}</span>
                                <button type="button" class="btn-card-action" style="padding: 1px 4px; border: none;" title="Downvote / Report Resolved" onclick="ReportsModule.voteHazard(${h.id}, 'down')">
                                    <i class="fa-solid fa-thumbs-down" style="color: #ef4444;"></i>
                                </button>
                            </div>
                        </div>

                        <div class="hazard-actions">
                            <button class="btn-card-action" onclick="MapModule.flyTo(${h.latitude}, ${h.longitude})">
                                <i class="fa-solid fa-location-crosshairs"></i> Map
                            </button>
                            ${!h.resolved ? `
                                <button class="btn-card-action" style="color: #10b981;" title="Mark as Repaired by Civic Authorities" onclick="ReportsModule.resolveHazard(${h.id})">
                                    <i class="fa-solid fa-wrench"></i> Resolve
                                </button>
                            ` : ''}
                            <button class="btn-card-action btn-del" onclick="ReportsModule.deleteHazard(${h.id})">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    async function handleFormSubmit(e) {
        e.preventDefault();
        const submitBtn = document.getElementById('submitHazardBtn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting & Awarding Points...';

        const hazardType = document.getElementById('hazardType').value;
        const severity = document.querySelector('input[name="severity"]:checked')?.value || 'medium';
        const description = document.getElementById('hazardDescription').value.trim();
        const lat = parseFloat(document.getElementById('hazardLat').value);
        const lon = parseFloat(document.getElementById('hazardLon').value);

        try {
            // 1. Submit Hazard Report (with Geofenced duplicate rejection in backend)
            const res = await fetch(`${API_BASE}/hazards`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hazard_type: hazardType,
                    severity: severity,
                    description: description,
                    latitude: lat,
                    longitude: lon
                })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to create hazard');
            }

            const hazardData = await res.json();
            const hazardId = hazardData.id;

            // 2. Upload Evidence Photo with Gemini AI Vision (if selected)
            if (selectedImageFile) {
                submitBtn.innerHTML = '<i class="fa-solid fa-brain fa-spin"></i> Gemini 2.0 Flash AI Analyzing...';
                const formData = new FormData();
                formData.append('image', selectedImageFile);

                const uploadRes = await fetch(`${API_BASE}/hazards/${hazardId}/image`, {
                    method: 'POST',
                    body: formData
                });

                if (uploadRes.ok) {
                    const uploadData = await uploadRes.json();
                    showAiVerificationCard(uploadData.ai_result);
                }
            }

            // Award Eco-Points
            AppModule.addPoints(50);
            AppModule.showToast('Hazard reported! +50 Eco-Points added to your balance 🎉', 'success');

            // Reset form
            document.getElementById('hazardDescription').value = '';
            clearSelectedImage();

            await loadHazards();
            MapModule.flyTo(lat, lon, 16);
        } catch (err) {
            console.error('Error submitting hazard:', err);
            AppModule.showToast(err.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit & Verify Hazard (+50 PTS)';
        }
    }

    function showAiVerificationCard(aiResult) {
        const card = document.getElementById('aiVerificationCard');
        const text = document.getElementById('aiAnalysisBody');
        if (!card || !text) return;

        const isVerified = aiResult.verified;
        const confidence = Math.round((aiResult.confidence || 0.88) * 100);

        text.innerHTML = `
            <div><strong>Status:</strong> ${isVerified ? '✅ Verified Road Hazard' : '⚠️ Flagged for Manual Review'} (${confidence}% confidence)</div>
            <div style="margin-top: 4px; color: #cbd5e1;">${aiResult.analysis || 'Visual confirmation completed.'}</div>
            <div style="margin-top: 4px; font-size: 0.72rem; color: #c084fc;">Model: ${aiResult.ai_provider || 'Google Gemini 3.5 Flash'}</div>
        `;
        card.style.display = 'block';
    }

    async function voteHazard(id, type) {
        try {
            const res = await fetch(`${API_BASE}/hazards/${id}/vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vote: type })
            });
            if (!res.ok) throw new Error('Vote failed');
            AppModule.showToast(type === 'up' ? 'Hazard report confirmed 👍' : 'Vote recorded', 'info');
            loadHazards();
        } catch (err) {
            AppModule.showToast(err.message, 'error');
        }
    }

    async function resolveHazard(id) {
        try {
            const res = await fetch(`${API_BASE}/hazards/${id}/resolve`, { method: 'POST' });
            if (!res.ok) throw new Error('Could not resolve hazard');
            AppModule.showToast('Hazard marked as resolved by civic road maintenance', 'success');
            loadHazards();
        } catch (err) {
            AppModule.showToast(err.message, 'error');
        }
    }

    async function deleteHazard(id) {
        if (!confirm('Are you sure you want to delete this hazard?')) return;
        try {
            const res = await fetch(`${API_BASE}/hazards/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            AppModule.showToast('Hazard deleted', 'info');
            loadHazards();
        } catch (err) {
            AppModule.showToast(err.message, 'error');
        }
    }

    // REWARDS & COUPONS
    async function loadRewards() {
        const container = document.getElementById('couponsGridContainer');
        if (!container) return;

        try {
            const res = await fetch(`${API_BASE}/rewards`);
            if (!res.ok) return;
            const data = await res.json();
            currentRewards = data.rewards || [];

            container.innerHTML = currentRewards.map(r => `
                <div class="coupon-card">
                    <div class="coupon-left">
                        <div class="coupon-icon-box">
                            <i class="fa-solid ${r.badge_icon || 'fa-gift'}"></i>
                        </div>
                        <div class="coupon-info">
                            <h4>${escapeHtml(r.title)}</h4>
                            <span class="coupon-partner">${escapeHtml(r.partner)} • ${escapeHtml(r.category)}</span>
                            <p class="coupon-desc">${escapeHtml(r.description)}</p>
                        </div>
                    </div>
                    <div class="coupon-right">
                        <span class="points-cost-tag">${r.points_cost} PTS</span>
                        <button type="button" class="btn-redeem" onclick="ReportsModule.redeemCoupon(${r.id}, ${r.points_cost})">
                            Redeem
                        </button>
                    </div>
                </div>
            `).join('');
        } catch (err) {
            console.warn('Could not load rewards catalog:', err);
        }
    }

    async function redeemCoupon(rewardId, pointsCost) {
        const userPoints = AppModule.getPoints();
        if (userPoints < pointsCost) {
            AppModule.showToast(`Not enough points! You have ${userPoints} PTS, need ${pointsCost} PTS. Report more hazards to earn points!`, 'error');
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/rewards/${rewardId}/redeem`, { method: 'POST' });
            if (!res.ok) throw new Error('Redemption error');
            const data = await res.json();

            // Deduct points locally
            AppModule.deductPoints(pointsCost);

            // Open Modal
            const modal = document.getElementById('couponModal');
            document.getElementById('modalCouponTitle').textContent = data.reward.title;
            document.getElementById('modalCouponPartner').textContent = `Partner: ${data.reward.partner}`;
            document.getElementById('modalCouponDesc').textContent = data.reward.description;
            document.getElementById('modalDiscountCode').textContent = data.discount_code;
            modal.style.display = 'flex';

            AppModule.showToast('Coupon unlocked successfully! Show code at checkout.', 'success');
        } catch (err) {
            AppModule.showToast(err.message, 'error');
        }
    }

    // CIVIC STATS
    async function loadCivicStats() {
        try {
            const res = await fetch(`${API_BASE}/civic/stats`);
            if (!res.ok) return;
            const data = await res.json();

            document.getElementById('civicTotalHazards').textContent = data.total_hazards || 0;
            document.getElementById('civicUrgentCount').textContent = data.urgent_critical || 0;
            document.getElementById('civicVerifyRate').textContent = `${data.verification_rate || 0}%`;
            document.getElementById('civicResolvedCount').textContent = data.resolved_count || 0;

            const breakdownEl = document.getElementById('civicTypeBreakdown');
            if (breakdownEl && data.type_breakdown) {
                breakdownEl.innerHTML = Object.entries(data.type_breakdown).map(([type, count]) => `
                    <div class="breakdown-item">
                        <span>${getHazardIcon(type)} ${formatHazardType(type)}</span>
                        <strong>${count} reported</strong>
                    </div>
                `).join('');
            }
        } catch (e) {
            console.warn('Could not load civic stats:', e);
        }
    }

    function handleImageSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        selectedImageFile = file;
        const reader = new FileReader();
        reader.onload = (event) => {
            document.getElementById('imagePreviewImg').src = event.target.result;
            document.getElementById('dropzonePreview').style.display = 'inline-block';
            document.getElementById('dropzoneContent').style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    function clearSelectedImage() {
        selectedImageFile = null;
        const input = document.getElementById('hazardImageInput');
        if (input) input.value = '';
        const preview = document.getElementById('dropzonePreview');
        if (preview) preview.style.display = 'none';
        const content = document.getElementById('dropzoneContent');
        if (content) content.style.display = 'flex';
    }

    function getHazardIcon(type) {
        const icons = {
            pothole: '🕳️',
            accident: '💥',
            flooding: '🌊',
            road_damage: '🚧',
            debris: '🌲',
            closure: '⛔',
            other: '⚠️'
        };
        return icons[type] || '⚠️';
    }

    function formatHazardType(type) {
        return (type || 'Hazard').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'Just now';
        try {
            const d = new Date(dateStr);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return dateStr;
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    return {
        API_BASE,
        init,
        loadHazards,
        loadRewards,
        redeemCoupon,
        voteHazard,
        resolveHazard,
        deleteHazard,
        getHazards: () => currentHazards
    };
})();