# 🚨 SirenRoute: Real-Time Hazard Intelligence & Navigation Infrastructure

**SirenRoute** is a production-grade, community-driven civic technology and navigation platform designed to transform micro-road risks (potholes, accidents, flash floods, collapsed asphalt, open debris) into actionable driving intelligence.

Alighed with **UN Sustainable Development Goals (SDG 3.6: Good Health & Road Safety, SDG 11.2: Sustainable Urban Mobility)**.

---

## 🌟 Key Capabilities & Architecture

### 1. 🛡️ Hazard-Aware Multi-Route Navigation & Live HUD
- **Alternative Corridor Comparison**: Calculates multiple candidate driving paths using OSRM with live hazard collision checking.
- **Live Turn-by-Turn Navigation Cockpit**: Real-time HUD overlay with maneuver cards (`Turn onto MG Road`), distance countdowns (`In 180 m` / `Now`), dynamic ETA clock, and speedometer.
- **Dynamic Hazard Proximity Radar**: In-flight 150m radar proximity alert drops down pulsing threat alerts with synthesized radio voice warnings.
- **Drive Simulation Engine**: Smooth road tracking with vehicle heading angle calculation and custom commuter vehicle icons (🏍️ Two-Wheeler, 🚗 Passenger Car, 🚚 Delivery Fleet).
- **Intelligent Detour Recommendations**: Bypasses severe pothole clusters and submerged underpasses while calculating exact travel time trade-offs.

### 2. 🔍 Google Maps-Style Autocomplete & Geolocation
- **Proximity-Biased Search**: Correlates places near the driver first with right-aligned distance badges (`1.2 km`).
- **Keyboard Navigation & Quick Chips**: Arrow key selection, Enter-to-route, input clear buttons ("X"), and one-click preset destination chips.
- **Draggable Location Puck**: Blue GPS position puck can be dragged directly onto your street/house to lock exact coordinates.
- **First-Party Geolocation**: `/api/locate-me` endpoint provides instant network geolocation without browser ad-blocker restrictions.

### 3. 🔊 Radio-Style Audio & Voice Alerts
- **Hands-Free Driver Safety**: Emits a dual-frequency synthesized radar chime (Web Audio API) followed by spoken road hazard warnings (Web Speech API).
- **Configurable Distance Buffer**: Customize alert proximity (50m to 400m) with vehicle sensitivity presets.

### 4. 🤖 Google Gemini 3.5 Flash AI Vision Verification
- **Automated Evidence Analysis**: Inspects user-submitted incident photos in real time using active `gemini-3.5-flash` with cascade fallback.
- **Categorization & Severity Rating**: Classifies potholes, floods, crashes, and fallen trees while discarding spam or indoor photos.
- **Confidence Scoring & Auto-Verification**: Auto-marks hazards as verified when confidence $\ge 65\%$. Includes a smart simulated fallback when an API key is not configured.

### 4. 🎁 Community Gamification & Partner Rewards
- **Earn While Protecting**: Users earn **+50 Eco-Points** for verified hazard reports.
- **Redeemable Demo Coupons**: Integrated discount catalog for local businesses:
  - ☕ **Café Coffee Day**: Free Artisanal Brew (75 PTS)
  - ⛽ **Shell Mobility**: 15% off fuel top-up (120 PTS)
  - 🛵 **Castrol Auto Care**: Comprehensive two-wheeler inspection (150 PTS)
  - 🛒 **Decathlon**: 20% off certified safety helmets (100 PTS)
  - 🍔 **Burger King**: Free meal combo upgrade (60 PTS)
- **Interactive Redemption Modal**: Displays coupon codes with one-click clipboard copying.

### 5. 🏛️ Civic Road Analytics & Municipal Exports
- **Hotspot Statistics**: Real-time KPIs on active threats, high-severity clusters, and verification rates.
- **GIS-Ready GeoJSON Export**: Download spatial hazard datasets directly into ArcGIS, QGIS, or city planning software.
- **Municipal CSV Export**: Downloadable reports for road maintenance and repair dispatch crews.
- **Civic Resolution**: Mark hazards as repaired by municipal authorities.

### 6. ⚙️ Production Settings & Vehicle Profiles
- **Vehicle Presets**:
  - 🛵 **Two-Wheeler Commuter** (Maximum sensitivity to potholes, loose gravel, and rain)
  - 🚗 **Passenger Car** (Standard vehicle sensitivity)
  - 🚚 **Last-Mile Delivery Fleet** (Prioritizes delivery corridors, bridge clearances, and closures)
- **Map Themes**: Toggle between CartoDB Voyager, Dark Matter, and OpenStreetMap.

---

## 🏗️ Project Layout

```
SirenRoute/
├── backend/
│   ├── app.py                # Flask API, SQLite DB, Gemini AI Vision, Rewards, Civic Exports
│   ├── requirements.txt      # Python dependencies (Flask, Pillow, google-genai, etc.)
│   ├── sirenroute.db         # SQLite database storing hazards, votes, and rewards
│   ├── uploads/              # Storage directory for verified hazard photos
│   ├── .env.example          # Environment template for GEMINI_API_KEY
│   └── .env                  # Local environment configuration
├── frontend/
│   ├── index.html            # Production dashboard with 6 panels & Leaflet map
│   ├── css/
│   │   └── style.css         # High-tech dark cockpit UI styling & animations
│   └── js/
│       ├── app.js            # Coordinator, vehicle modes, points balance, voice alert toggles
│       ├── map.js            # Leaflet map, pulsing markers, tile switcher, polyline rendering
│       ├── reports.js        # Hazard reporting, upvoting, rewards redemption, civic stats
│       └── routes.js         # OSRM route comparison, hazard collisions, audio alerts
└── README.md
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- Python 3.10+
- (Optional) Free Google Gemini API Key ([Get one here](https://aistudio.google.com/))

### 2. Start the Server
Open a terminal in the project root:
```powershell
python backend/app.py
```
The server will start on **`http://localhost:5001`**.

### 3. Open the Application
Navigate to **[http://localhost:5001/](http://localhost:5001/)** or **[http://localhost:5001/app](http://localhost:5001/app)** in any web browser.

---

## 📡 API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` / `/api/health` | Server diagnostics & Gemini AI configuration state |
| `GET` | `/api/locate-me` | First-party network IP geolocation resolver |
| `GET` | `/hazards` | List hazards (filters: `status`, `severity`, `hazard_type`, `resolved`) |
| `POST` | `/hazards` | Submit a hazard report (with 15m geofenced duplicate clustering) |
| `POST` | `/hazards/<id>/image` | Upload photo & trigger Gemini 3.5 Flash AI vision verification |
| `POST` | `/hazards/<id>/vote` | Community confirmation upvote or downvote |
| `POST` | `/hazards/<id>/resolve` | Mark hazard as resolved by municipal maintenance |
| `GET` | `/rewards` | Fetch redeemable partner discount coupons |
| `POST` | `/rewards/<id>/redeem` | Redeem a coupon and unlock discount promo code |
| `GET` | `/civic/stats` | High-level municipal statistics and category breakdown |
| `GET` | `/civic/export` | Download GIS GeoJSON or CSV data (`?format=geojson` or `?format=csv`) |
| `POST` | `/demo/reset` | Reset demo data to the official Bangalore hazard corridor |
| `POST` | `/routes/check-hazards`| Evaluate candidate route coordinates against active hazards |
