# 🚨 SirenRoute: Real-Time Hazard Intelligence & Navigation

SirenRoute is a community-driven road safety and navigation project designed to help users identify and report road hazards such as potholes, accidents, waterlogging, damaged roads, and fallen debris.

The platform aims to turn community-submitted hazard information into useful travel insights through interactive maps, hazard reporting, route-risk analysis, and civic data tools.

SirenRoute supports the goals of **UN Sustainable Development Goal 3.6** (road safety) and **SDG 11.2** (safe, accessible, and sustainable transport).

> **Project status:** Some capabilities described below may be in development or demonstration-only. Route recommendations and hazard information should not be treated as a guarantee of road safety.

---

## 🌟 Key Features

### 1. 🛡️ Hazard-Aware Navigation

- Interactive map for viewing reported road hazards.
- Hazard categories such as potholes, waterlogging, road damage, and other obstacles.
- Route planning interface for entering a starting point and destination.
- Planned route comparison using road-network data and hazard information.
- Risk explanations intended to help users make more informed travel decisions.

### 2. 🗺️ Interactive Map and Location Support

- Interactive map powered by Leaflet.
- OpenStreetMap map tiles.
- Map markers for displaying hazard locations.
- Hazard category filters.
- Planned location search, autocomplete, and geolocation support.

### 3. 📷 Community Hazard Reporting

- Form for submitting road hazard details.
- Hazard category, location, description, and photo input.
- Photo preview and basic input validation.
- Demonstration reports stored in browser local storage in the current frontend prototype.
- Planned backend integration for persistent reports, status tracking, and community verification.

### 4. 🔊 Audio and Voice Alerts

- Planned proximity-based warnings for reported hazards.
- Potential use of the Web Audio API for alert sounds.
- Potential use of the Web Speech API for spoken warnings.

### 5. 🤖 AI-Assisted Hazard Verification

- Planned image analysis for identifying potential road hazards.
- Intended classification of hazard types and severity.
- Future integration with a vision-capable AI service, such as Google's Gemini API.
- Confidence-based verification intended to help distinguish relevant reports from unrelated images.

AI predictions can be inaccurate and should not be treated as definitive proof that a road is safe or unsafe.

### 6. 🎁 Community Rewards

- Proposed points for useful, verified community reports.
- Planned reward catalogue and coupon redemption demonstration.
- Potential incentives to encourage responsible participation in road safety reporting.

Any displayed rewards or coupons are demonstration features unless actual partner agreements and redemption systems are implemented.

### 7. 🏛️ Civic Analytics and Data Export

Planned civic features include:

- Statistics about reported hazards and their status.
- Identification of areas with recurring road problems.
- GeoJSON export for use with GIS software such as QGIS.
- CSV export for reviewing and organizing road maintenance reports.
- Hazard resolution tracking.

### 8. ⚙️ Vehicle Profiles and Map Customization

Potential future enhancements include:

- Two-wheeler, passenger car, and delivery vehicle profiles.
- Configurable hazard alert distances.
- Alternative map themes.
- Vehicle-specific route-risk preferences.

---

## 🧰 Technology Stack

| Technology | Purpose |
|---|---|
| HTML | Web page structure |
| CSS | Layout, styling, and responsive design |
| JavaScript | Frontend interactions |
| Leaflet | Interactive maps |
| OpenStreetMap | Map tile data |
| Python | Backend development |
| Flask | Web server and API framework |
| SQLite | Local database storage |
| OSRM | Planned road routing integration |
| Google Gemini API | Planned AI image analysis |
| Git and GitHub | Version control and collaboration |

The technologies listed as planned integrations should be considered future work until their implementation has been tested.

---

## 🏗️ Project Structure

```text
SirenRoute/
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   ├── database.py
│   ├── risk.py
│   ├── sirenroute.db
│   └── uploads/
├── frontend/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js
│       ├── map.js
│       ├── reports.js
│       └── routes.js
├── .gitignore
└── README.md
```

**Note:** The database and uploaded files are generated locally and should not be committed to GitHub. The exact project structure may change as the team integrates its modules.

---

## 🚀 Getting Started

### Prerequisites

- Python 3.10 or later, compatible with the project's dependencies.
- Git.
- A modern web browser.
- Visual Studio Code or another code editor.

### 1. Clone the repository

```bash
git clone https://github.com/Prathibha-n28/SirenRoute-safety-navigation-app-.git
cd SirenRoute-safety-navigation-app-
```

### 2. Create and activate a virtual environment

On Windows PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3. Install dependencies

```powershell
py -m pip install -r backend/requirements.txt
```

### 4. Start the backend

From the project root, run:

```powershell
py backend/app.py
```

If the Flask application starts successfully on port `5001`, open:

- `http://127.0.0.1:5001/`
- `http://127.0.0.1:5001/health`

These URLs work only if the corresponding routes are implemented in the running backend. If the server reports an error or uses different routes, check the terminal output and backend code.

### Frontend note

The frontend currently includes a map and demonstration reporting functionality. Some features may work independently of the backend, and additional integration may be required for persistent reports and real route calculation.

---

## 📡 API Reference

The following endpoints are intended for the backend. Confirm that each endpoint is implemented before relying on it.

| Method | Endpoint | Intended purpose |
|---|---|---|
| GET | `/health` | Backend health check |
| GET | `/api/health` | Alternative health check |
| GET | `/api/locate-me` | Location lookup, if configured |
| GET | `/hazards` | Retrieve hazard reports |
| POST | `/hazards` | Submit a hazard report |
| POST | `/hazards/<id>/image` | Upload a hazard photo |
| POST | `/hazards/<id>/vote` | Record a community vote |
| POST | `/hazards/<id>/resolve` | Mark a hazard as resolved |
| GET | `/rewards` | Retrieve available rewards |
| POST | `/rewards/<id>/redeem` | Redeem a reward |
| GET | `/civic/stats` | Retrieve civic statistics |
| GET | `/civic/export` | Export civic data |
| POST | `/demo/reset` | Reset demonstration data |
| POST | `/routes/check-hazards` | Evaluate route coordinates against reported hazards |

The API list is a reference for intended functionality, not a guarantee that every endpoint is currently available.

---

## 🔐 Privacy and Security

- Do not commit API keys, passwords, access tokens, or private configuration files.
- Keep `.env` files out of version control.
- Keep local databases, uploaded photos, and virtual environments out of GitHub unless there is a specific, safe reason to share them.
- Use `.env.example` for documenting required configuration variable names without including real secrets.
- Validate uploaded files and user input on the backend.
- Avoid exposing precise personal location information unnecessarily.

---

## 🛣️ Future Enhancements

- Connect frontend reporting forms to the Flask backend.
- Display hazard reports retrieved from the database.
- Implement and test actual route calculations and route-risk comparison.
- Integrate and validate AI-assisted image analysis.
- Add report status history and community verification.
- Complete rewards and civic export workflows.
- Improve accessibility, responsive design, and automated testing.

---

## 🌍 Project Vision

SirenRoute aims to encourage safer travel by making road hazards easier to report, visualize, and understand. By combining community participation, interactive mapping, and data-driven tools, the project explores how civic technology can support better road awareness and urban mobility.

**Disclaimer:** SirenRoute is a developing project. Hazard data may be incomplete, outdated, or inaccurate. Always follow traffic laws and official road advisories, and use your own judgment when travelling.
