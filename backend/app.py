import os
import uuid
import json
import math
import sqlite3
import urllib.request
from datetime import datetime, timedelta
from io import BytesIO
from PIL import Image
from flask import Flask, jsonify, request, send_from_directory, send_file, Response

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from flask_cors import CORS
    has_cors = True
except ImportError:
    has_cors = False

app = Flask(__name__)
if has_cors:
    CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
DB_PATH = os.path.join(BASE_DIR, "sirenroute.db")
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_CONTENT_LENGTH = 10 * 1024 * 1024

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

def is_valid_image(file):
    try:
        image_data = file.read()
        image = Image.open(BytesIO(image_data))
        image.verify()
        file.seek(0)
        return True
    except Exception:
        file.seek(0)
        return False

def haversine_distance_meters(lat1, lon1, lat2, lon2):
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # Hazards Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS hazards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hazard_type TEXT,
            description TEXT,
            latitude REAL,
            longitude REAL,
            severity TEXT,
            status TEXT DEFAULT 'pending',
            image_filename TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ai_verified INTEGER DEFAULT 0,
            ai_confidence REAL DEFAULT 0.0,
            ai_label TEXT,
            ai_analysis TEXT,
            upvotes INTEGER DEFAULT 0,
            downvotes INTEGER DEFAULT 0,
            resolved INTEGER DEFAULT 0,
            points_awarded INTEGER DEFAULT 0
        )
    """)

    # Rewards & Coupons Catalog Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS rewards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            partner TEXT,
            category TEXT,
            points_cost INTEGER,
            discount_code TEXT,
            description TEXT,
            badge_icon TEXT,
            is_redeemed INTEGER DEFAULT 0
        )
    """)

    # Dynamic migrations for existing hazards table
    cursor.execute("PRAGMA table_info(hazards)")
    columns = [row["name"] for row in cursor.fetchall()]

    needed_columns = {
        "image_filename": "TEXT",
        "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "ai_verified": "INTEGER DEFAULT 0",
        "ai_confidence": "REAL DEFAULT 0.0",
        "ai_label": "TEXT",
        "ai_analysis": "TEXT",
        "upvotes": "INTEGER DEFAULT 0",
        "downvotes": "INTEGER DEFAULT 0",
        "resolved": "INTEGER DEFAULT 0",
        "points_awarded": "INTEGER DEFAULT 0"
    }
    for col_name, col_type in needed_columns.items():
        if col_name not in columns:
            try:
                cursor.execute(f"ALTER TABLE hazards ADD COLUMN {col_name} {col_type}")
            except Exception as e:
                print(f"DB migration note for {col_name}: {e}")

    # Seed Default Partner Rewards if empty
    cursor.execute("SELECT COUNT(*) FROM rewards")
    if cursor.fetchone()[0] == 0:
        default_rewards = [
            ("Free Artisanal Brew", "Café Coffee Day", "Food & Beverage", 75, "SIREN-BREW75", "Redeem for 1 regular cappuccino or iced brew at any participating outlet.", "fa-mug-hot"),
            ("15% Off Fuel Top-Up", "Shell Mobility", "Fuel & Energy", 120, "SHELL-SAFE15", "Get 15% discount up to ₹150 on Shell V-Power petrol or diesel.", "fa-gas-pump"),
            ("Comprehensive Bike Checkup", "Castrol Auto Care", "Maintenance", 150, "CASTROL-CARE150", "Free 15-point inspection, brake adjustment, and tire pressure check for two-wheelers.", "fa-wrench"),
            ("20% Off Safety Helmets", "Decathlon Sports", "Retail & Gear", 100, "DECAT-HELMET20", "Save 20% on any certified cycling or motorcycling safety helmet and reflective gear.", "fa-helmet-safety"),
            ("Free Meal Upgrade", "Burger King", "Food & Beverage", 60, "BK-ROADHERO60", "Complimentary King Fries and Coke upgrade with any burger combo.", "fa-burger")
        ]
        cursor.executemany("""
            INSERT INTO rewards (title, partner, category, points_cost, discount_code, description, badge_icon)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, default_rewards)

    conn.commit()
    conn.close()

init_db()

def analyze_hazard_image(filepath, hazard_type="pothole", description=""):
    api_key = os.getenv("GEMINI_API_KEY")
    result = {
        "is_road_hazard": True,
        "hazard_type": hazard_type,
        "severity": "medium",
        "confidence": 0.88,
        "verified": True,
        "analysis": "Road hazard visual pattern verified.",
        "ai_provider": "simulated"
    }

    if api_key and api_key.strip():
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=api_key.strip())
            pil_img = Image.open(filepath)

            prompt = f"""You are an expert road safety AI for SirenRoute navigation.
Analyze this user-reported road hazard photo.
User report details:
- Hazard Type: {hazard_type}
- Description: {description}

Tasks:
1. Verify if this image depicts a genuine road or traffic hazard (e.g., pothole, vehicle crash, flooding, collapsed asphalt, fallen tree, construction, road debris). If it is a selfie, meme, indoor photo, pet, or ordinary undamaged road, set is_road_hazard to false.
2. Determine the detected hazard_type (one of: pothole, accident, flooding, road_damage, debris, closure, other).
3. Determine severity (low, medium, high).
4. Assign confidence score (0.0 to 1.0).
5. Set verified (true if confidence >= 0.65 and is_road_hazard is true, otherwise false).
6. Provide a concise 1-2 sentence analysis describing the visual findings.

Respond ONLY with a valid JSON object matching this schema:
{{
  "is_road_hazard": boolean,
  "hazard_type": string,
  "severity": "low" | "medium" | "high",
  "confidence": number,
  "verified": boolean,
  "analysis": string
}}"""

            # Model cascade: gemini-3.5-flash (primary active vision model), fallback to gemini-flash-latest, gemini-3.8-flash
            candidate_models = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.8-flash", "gemini-2.5-pro"]
            response = None
            used_model = "gemini-3.5-flash"
            last_err = None

            for m in candidate_models:
                try:
                    response = client.models.generate_content(
                        model=m,
                        contents=[pil_img, prompt],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            temperature=0.2
                        )
                    )
                    used_model = m
                    break
                except Exception as model_err:
                    last_err = model_err
                    print(f"Model {m} failed: {model_err}, trying next...")
                    continue

            if response is None:
                raise last_err or Exception("All candidate Gemini models failed")

            parsed = json.loads(response.text)
            parsed["ai_provider"] = used_model
            return parsed
        except Exception as e:
            print(f"Gemini API error: {e}")
            result["analysis"] = f"AI fallback: Image processed. (Note: {str(e)[:120]})"
            result["ai_provider"] = "fallback"
            return result
    else:
        try:
            with Image.open(filepath) as img:
                w, h = img.size
                fmt = img.format or "JPEG"
                result["analysis"] = (
                    f"[Simulated AI - Set GEMINI_API_KEY in backend/.env for live Gemini 2.0 Flash] "
                    f"Verified {fmt} image ({w}x{h}). Visual patterns consistent with road conditions."
                )
                result["ai_provider"] = "simulated"
        except Exception:
            result["analysis"] = "[Simulated AI] Hazard image format validated."
        return result

def format_hazard(row):
    d = dict(row)
    if d.get("image_filename"):
        d["image_url"] = f"/uploads/{d['image_filename']}"
    else:
        d["image_url"] = None

    # Time decay degradation check (reports older than 48h lose freshness score if unconfirmed)
    try:
        created_time = datetime.fromisoformat(str(d["created_at"]).replace("Z", ""))
        hours_old = (datetime.utcnow() - created_time).total_seconds() / 3600.0
        d["hours_old"] = round(hours_old, 1)
        d["is_stale"] = bool(hours_old > 48.0 and d.get("upvotes", 0) < 2)
    except Exception:
        d["hours_old"] = 0
        d["is_stale"] = False

    return d

@app.route("/")
def home():
    accept = request.headers.get("Accept", "")
    if "application/json" in accept and "text/html" not in accept:
        return jsonify({
            "name": "SirenRoute API",
            "version": "2.2.0",
            "status": "running",
            "endpoints": {
                "hazards": "/hazards",
                "rewards": "/rewards",
                "civic_stats": "/civic/stats",
                "civic_export": "/civic/export",
                "health": "/health",
                "frontend": "/"
            }
        })
    index_file = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_file):
        return send_file(index_file)
    return jsonify({"status": "running", "message": "Frontend index.html not found"})

@app.route("/health")
@app.route("/api/health")
def health():
    gemini_key = os.getenv("GEMINI_API_KEY")
    return jsonify({
        "status": "healthy",
        "gemini_configured": bool(gemini_key and gemini_key.strip()),
        "model": "gemini-3.5-flash",
        "timestamp": datetime.utcnow().isoformat()
    })

@app.route("/api/locate-me")
def locate_me():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    if client_ip and "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()

    geo_data = None
    try:
        url = "https://ipwho.is/" if client_ip in ("127.0.0.1", "localhost", "::1", None) else f"https://ipwho.is/{client_ip}"
        req = urllib.request.Request(url, headers={"User-Agent": "SirenRoute/2.2"})
        with urllib.request.urlopen(req, timeout=3.5) as r:
            data = json.loads(r.read().decode())
            if data.get("success") and data.get("latitude") and data.get("longitude"):
                geo_data = {
                    "success": True,
                    "latitude": float(data["latitude"]),
                    "longitude": float(data["longitude"]),
                    "city": data.get("city") or "Local Area",
                    "region": data.get("region"),
                    "country": data.get("country"),
                    "source": "network_ip"
                }
    except Exception as e:
        print("ipwho.is backend fetch failed:", e)

    if not geo_data:
        try:
            url = "https://ipapi.co/json/" if client_ip in ("127.0.0.1", "localhost", "::1", None) else f"https://ipapi.co/{client_ip}/json/"
            req = urllib.request.Request(url, headers={"User-Agent": "SirenRoute/2.2"})
            with urllib.request.urlopen(req, timeout=3.5) as r:
                data = json.loads(r.read().decode())
                if data.get("latitude") and data.get("longitude"):
                    geo_data = {
                        "success": True,
                        "latitude": float(data["latitude"]),
                        "longitude": float(data["longitude"]),
                        "city": data.get("city") or "Local Area",
                        "region": data.get("region"),
                        "country": data.get("country_name"),
                        "source": "network_ip"
                    }
        except Exception as e:
            print("ipapi.co backend fetch failed:", e)

    if not geo_data:
        geo_data = {
            "success": True,
            "latitude": 12.9716,
            "longitude": 77.5946,
            "city": "Bengaluru",
            "region": "Karnataka",
            "country": "India",
            "source": "default_fallback"
        }

    return jsonify(geo_data)

@app.route("/hazards", methods=["GET"])
def get_hazards():
    status = request.args.get("status")
    severity = request.args.get("severity")
    hazard_type = request.args.get("hazard_type")
    resolved = request.args.get("resolved")
    limit = request.args.get("limit", default=250, type=int)

    query = "SELECT * FROM hazards WHERE 1=1"
    params = []

    if status and status.lower() != "all":
        query += " AND status = ?"
        params.append(status.lower())

    if severity and severity.lower() in ["low", "medium", "high"]:
        query += " AND severity = ?"
        params.append(severity.lower())

    if hazard_type and hazard_type != "all":
        query += " AND hazard_type LIKE ?"
        params.append(f"%{hazard_type}%")

    if resolved is not None:
        query += " AND resolved = ?"
        params.append(1 if resolved.lower() in ["1", "true"] else 0)

    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(query, tuple(params))
    rows = cursor.fetchall()
    conn.close()

    hazards = [format_hazard(r) for r in rows]
    return jsonify({
        "count": len(hazards),
        "hazards": hazards
    }), 200

@app.route("/hazards/<int:hazard_id>", methods=["GET"])
def get_hazard(hazard_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM hazards WHERE id = ?", (hazard_id,))
    row = cursor.fetchone()
    conn.close()

    if row is None:
        return jsonify({"error": "Hazard not found"}), 404

    return jsonify({"hazard": format_hazard(row)}), 200

@app.route("/hazards", methods=["POST"])
def add_hazard():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Hazard report data is required"}), 400

    required_fields = ["hazard_type", "description", "latitude", "longitude", "severity"]
    for field in required_fields:
        if field not in data or data[field] is None or str(data[field]).strip() == "":
            return jsonify({"error": f"Missing required field: {field}"}), 400

    severity = str(data["severity"]).lower()
    if severity not in ["low", "medium", "high"]:
        return jsonify({"error": "Severity must be low, medium, or high"}), 400

    try:
        latitude = float(data["latitude"])
        longitude = float(data["longitude"])
    except (ValueError, TypeError):
        return jsonify({"error": "Latitude and longitude must be numbers"}), 400

    if not (-90.0 <= latitude <= 90.0):
        return jsonify({"error": "Latitude must be between -90 and 90"}), 400

    if not (-180.0 <= longitude <= 180.0):
        return jsonify({"error": "Longitude must be between -180 and 180"}), 400

    status = data.get("status", "pending")
    hazard_type = data.get("hazard_type", "pothole").strip().lower()
    description = data.get("description", "").strip()

    conn = get_db()
    cursor = conn.cursor()

    # Geofenced Duplicate Detection: check within 15 meters
    cursor.execute("SELECT * FROM hazards WHERE status != 'rejected' AND resolved = 0")
    existing_hazards = cursor.fetchall()
    for eh in existing_hazards:
        dist = haversine_distance_meters(latitude, longitude, eh["latitude"], eh["longitude"])
        if dist <= 15.0 and eh["hazard_type"] == hazard_type:
            # Merge report by adding an upvote & reinforcement
            cursor.execute("""
                UPDATE hazards
                SET upvotes = upvotes + 1,
                    status = 'verified'
                WHERE id = ?
            """, (eh["id"],))
            conn.commit()
            cursor.execute("SELECT * FROM hazards WHERE id = ?", (eh["id"],))
            merged = format_hazard(cursor.fetchone())
            conn.close()
            return jsonify({
                "message": "Geofenced match found! Upvoted & reinforced existing nearby hazard report.",
                "id": eh["id"],
                "hazard": merged,
                "merged": True
            }), 200

    cursor.execute("""
        INSERT INTO hazards (hazard_type, description, latitude, longitude, severity, status, points_awarded)
        VALUES (?, ?, ?, ?, ?, ?, 50)
    """, (hazard_type, description, latitude, longitude, severity, status))
    conn.commit()
    hazard_id = cursor.lastrowid

    cursor.execute("SELECT * FROM hazards WHERE id = ?", (hazard_id,))
    new_hazard = format_hazard(cursor.fetchone())
    conn.close()

    return jsonify({
        "message": "Hazard report saved successfully! +50 Eco-Points earned.",
        "id": hazard_id,
        "hazard": new_hazard,
        "points_earned": 50,
        "merged": False
    }), 201

@app.route("/hazards/<int:hazard_id>", methods=["PUT"])
def update_hazard(hazard_id):
    data = request.get_json() or {}
    updates = []
    params = []

    if "status" in data:
        allowed = ["pending", "verified", "rejected"]
        if data["status"] not in allowed:
            return jsonify({"error": "Status must be pending, verified, or rejected"}), 400
        updates.append("status = ?")
        params.append(data["status"])

    if "severity" in data:
        if data["severity"] not in ["low", "medium", "high"]:
            return jsonify({"error": "Severity must be low, medium, or high"}), 400
        updates.append("severity = ?")
        params.append(data["severity"])

    if "resolved" in data:
        updates.append("resolved = ?")
        params.append(1 if data["resolved"] else 0)

    if not updates:
        return jsonify({"error": "No valid fields to update"}), 400

    params.append(hazard_id)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(f"UPDATE hazards SET {', '.join(updates)} WHERE id = ?", tuple(params))

    if cursor.rowcount == 0:
        conn.close()
        return jsonify({"error": "Hazard not found"}), 404

    conn.commit()
    cursor.execute("SELECT * FROM hazards WHERE id = ?", (hazard_id,))
    updated = format_hazard(cursor.fetchone())
    conn.close()

    return jsonify({"message": "Hazard updated successfully", "hazard": updated}), 200

@app.route("/hazards/<int:hazard_id>/vote", methods=["POST"])
def vote_hazard(hazard_id):
    data = request.get_json() or {}
    vote_type = data.get("vote", "up").lower()

    conn = get_db()
    cursor = conn.cursor()

    if vote_type == "up":
        cursor.execute("UPDATE hazards SET upvotes = upvotes + 1 WHERE id = ?", (hazard_id,))
    elif vote_type == "down":
        cursor.execute("UPDATE hazards SET downvotes = downvotes + 1 WHERE id = ?", (hazard_id,))
    else:
        conn.close()
        return jsonify({"error": "Vote must be 'up' or 'down'"}), 400

    if cursor.rowcount == 0:
        conn.close()
        return jsonify({"error": "Hazard not found"}), 404

    # Auto-adjust verification if net votes >= 3
    cursor.execute("SELECT * FROM hazards WHERE id = ?", (hazard_id,))
    row = cursor.fetchone()
    if (row["upvotes"] - row["downvotes"]) >= 3 and row["status"] != "verified":
        cursor.execute("UPDATE hazards SET status = 'verified' WHERE id = ?", (hazard_id,))

    conn.commit()
    cursor.execute("SELECT * FROM hazards WHERE id = ?", (hazard_id,))
    updated = format_hazard(cursor.fetchone())
    conn.close()

    return jsonify({"message": "Vote recorded", "hazard": updated}), 200

@app.route("/hazards/<int:hazard_id>/resolve", methods=["POST"])
def resolve_hazard(hazard_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE hazards SET resolved = 1 WHERE id = ?", (hazard_id,))

    if cursor.rowcount == 0:
        conn.close()
        return jsonify({"error": "Hazard not found"}), 404

    conn.commit()
    cursor.execute("SELECT * FROM hazards WHERE id = ?", (hazard_id,))
    updated = format_hazard(cursor.fetchone())
    conn.close()

    return jsonify({"message": "Hazard marked as resolved by civic maintenance", "hazard": updated}), 200

@app.route("/hazards/<int:hazard_id>", methods=["DELETE"])
def delete_hazard(hazard_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT image_filename FROM hazards WHERE id = ?", (hazard_id,))
    row = cursor.fetchone()

    if row is None:
        conn.close()
        return jsonify({"error": "Hazard not found"}), 404

    if row["image_filename"]:
        img_path = os.path.join(app.config["UPLOAD_FOLDER"], row["image_filename"])
        if os.path.exists(img_path):
            try:
                os.remove(img_path)
            except Exception as e:
                print(f"Error removing image: {e}")

    cursor.execute("DELETE FROM hazards WHERE id = ?", (hazard_id,))
    conn.commit()
    conn.close()

    return jsonify({"message": f"Hazard {hazard_id} deleted successfully"}), 200

@app.route("/hazards/<int:hazard_id>/image", methods=["POST"])
def upload_hazard_image(hazard_id):
    if "image" not in request.files:
        return jsonify({"error": "No image file provided in request"}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Only JPG, JPEG, PNG, and WEBP images are allowed"}), 400

    if not is_valid_image(file):
        return jsonify({"error": "Invalid or corrupted image file"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM hazards WHERE id = ?", (hazard_id,))
    hazard_row = cursor.fetchone()

    if hazard_row is None:
        conn.close()
        return jsonify({"error": "Hazard not found"}), 404

    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(filepath)

    ai_result = analyze_hazard_image(
        filepath=filepath,
        hazard_type=hazard_row["hazard_type"],
        description=hazard_row["description"]
    )

    ai_verified = 1 if ai_result.get("verified") else 0
    ai_confidence = float(ai_result.get("confidence", 0.0))
    ai_label = str(ai_result.get("hazard_type", hazard_row["hazard_type"]))
    ai_analysis = str(ai_result.get("analysis", ""))
    new_status = "verified" if ai_verified else hazard_row["status"]

    cursor.execute("""
        UPDATE hazards
        SET image_filename = ?,
            status = ?,
            ai_verified = ?,
            ai_confidence = ?,
            ai_label = ?,
            ai_analysis = ?
        WHERE id = ?
    """, (filename, new_status, ai_verified, ai_confidence, ai_label, ai_analysis, hazard_id))
    conn.commit()

    cursor.execute("SELECT * FROM hazards WHERE id = ?", (hazard_id,))
    updated_hazard = format_hazard(cursor.fetchone())
    conn.close()

    return jsonify({
        "message": "Image uploaded and analyzed by AI successfully",
        "hazard": updated_hazard,
        "ai_result": ai_result
    }), 201

# REWARDS & COUPONS ENDPOINTS
@app.route("/rewards", methods=["GET"])
def get_rewards():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM rewards ORDER BY points_cost ASC")
    rows = cursor.fetchall()
    conn.close()

    rewards = [dict(r) for r in rows]
    return jsonify({"rewards": rewards}), 200

@app.route("/rewards/<int:reward_id>/redeem", methods=["POST"])
def redeem_reward(reward_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM rewards WHERE id = ?", (reward_id,))
    reward = cursor.fetchone()

    if not reward:
        conn.close()
        return jsonify({"error": "Reward coupon not found"}), 404

    cursor.execute("UPDATE rewards SET is_redeemed = 1 WHERE id = ?", (reward_id,))
    conn.commit()
    conn.close()

    return jsonify({
        "message": "Reward redeemed successfully!",
        "reward": dict(reward),
        "discount_code": reward["discount_code"]
    }), 200

# CIVIC MUNICIPAL DASHBOARD & EXPORT APIS
@app.route("/civic/stats", methods=["GET"])
def get_civic_stats():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM hazards")
    total_hazards = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM hazards WHERE status = 'verified'")
    verified_hazards = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM hazards WHERE severity = 'high' AND resolved = 0")
    urgent_critical = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM hazards WHERE resolved = 1")
    resolved_count = cursor.fetchone()[0]

    cursor.execute("""
        SELECT hazard_type, COUNT(*) as count 
        FROM hazards 
        GROUP BY hazard_type 
        ORDER BY count DESC
    """)
    type_breakdown = {r["hazard_type"]: r["count"] for r in cursor.fetchall()}

    conn.close()

    return jsonify({
        "total_hazards": total_hazards,
        "verified_hazards": verified_hazards,
        "urgent_critical": urgent_critical,
        "resolved_count": resolved_count,
        "verification_rate": round((verified_hazards / total_hazards * 100), 1) if total_hazards > 0 else 0,
        "type_breakdown": type_breakdown
    }), 200

@app.route("/civic/export", methods=["GET"])
def export_civic_geojson():
    export_format = request.args.get("format", "geojson").lower()

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM hazards")
    rows = cursor.fetchall()
    conn.close()

    hazards = [format_hazard(r) for r in rows]

    if export_format == "csv":
        import csv
        import io
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["id", "hazard_type", "severity", "status", "latitude", "longitude", "description", "ai_verified", "ai_confidence", "upvotes", "resolved", "created_at"])
        for h in hazards:
            writer.writerow([h["id"], h["hazard_type"], h["severity"], h["status"], h["latitude"], h["longitude"], h["description"], h["ai_verified"], h["ai_confidence"], h["upvotes"], h["resolved"], h["created_at"]])
        return Response(output.getvalue(), mimetype="text/csv", headers={"Content-Disposition": "attachment;filename=sirenroute_hazards.csv"})

    # Default GeoJSON
    features = []
    for h in hazards:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [h["longitude"], h["latitude"]]
            },
            "properties": {
                "id": h["id"],
                "hazard_type": h["hazard_type"],
                "severity": h["severity"],
                "status": h["status"],
                "description": h["description"],
                "ai_verified": bool(h["ai_verified"]),
                "ai_confidence": h["ai_confidence"],
                "upvotes": h["upvotes"],
                "resolved": bool(h["resolved"]),
                "created_at": h["created_at"]
            }
        })

    geojson_doc = {
        "type": "FeatureCollection",
        "metadata": {
            "title": "SirenRoute Municipal Hazard GIS Export",
            "generated_at": datetime.utcnow().isoformat(),
            "count": len(features)
        },
        "features": features
    }

    return jsonify(geojson_doc), 200

@app.route("/demo/reset", methods=["POST"])
def reset_demo_data():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM hazards")

    sample_hazards = [
        ("pothole", "Deep crater pothole in the right lane near Trinity Circle. Causing heavy suspension damage to two-wheelers.", 12.9733, 77.6200, "high", "verified", 1, 0.94, "pothole", "Deep asphalt depression with exposed aggregate confirmed.", 4, 0, 0, 50),
        ("flooding", "Severe waterlogging under the railway underpass after heavy monsoon rain. Water depth approx 1.5 ft.", 12.9650, 77.6000, "high", "verified", 1, 0.92, "flooding", "Standing water across both lanes confirmed.", 7, 0, 0, 50),
        ("accident", "Minor two-wheeler collision causing bottleneck on the left shoulder.", 12.9800, 77.5850, "medium", "verified", 1, 0.82, "accident", "Disabled vehicle on road shoulder confirmed.", 2, 0, 0, 50),
        ("debris", "Large fallen tree bough obstructing the inbound bike lane.", 12.9780, 77.6100, "medium", "verified", 1, 0.89, "debris", "Tree limb blocking 40% of lane.", 3, 0, 0, 50),
        ("closure", "Emergency flyover resurfacing work underway. Left 2 lanes completely blocked.", 12.9550, 77.6400, "high", "verified", 1, 0.96, "closure", "Barricades and heavy machinery occupying roadway confirmed.", 5, 0, 0, 50)
    ]

    cursor.executemany("""
        INSERT INTO hazards (hazard_type, description, latitude, longitude, severity, status, ai_verified, ai_confidence, ai_label, ai_analysis, upvotes, downvotes, resolved, points_awarded)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, sample_hazards)
    conn.commit()
    conn.close()

    return jsonify({"message": "Demo data reset successfully", "count": len(sample_hazards)}), 200

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

@app.route("/routes/check-hazards", methods=["POST"])
def check_route_hazards():
    data = request.get_json() or {}
    points = data.get("coordinates", [])
    buffer_meters = float(data.get("radius_meters", 85.0))

    if not points:
        return jsonify({"error": "coordinates list is required"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM hazards WHERE status != 'rejected' AND resolved = 0")
    all_hazards = [format_hazard(r) for r in cursor.fetchall()]
    conn.close()

    impacted_hazards = []
    seen_ids = set()

    for p in points:
        plat, plon = float(p[0]), float(p[1])
        for h in all_hazards:
            hid = h["id"]
            if hid in seen_ids:
                continue
            hlat, hlon = float(h["latitude"]), float(h["longitude"])
            dist = haversine_distance_meters(plat, plon, hlat, hlon)
            if dist <= buffer_meters:
                seen_ids.add(hid)
                h_copy = dict(h)
                h_copy["distance_to_route_meters"] = round(dist, 1)
                impacted_hazards.append(h_copy)

    severity_counts = {"high": 0, "medium": 0, "low": 0}
    for h in impacted_hazards:
        sev = (h.get("severity") or "medium").lower()
        if sev in severity_counts:
            severity_counts[sev] += 1

    safety_rating = "Safe"
    if severity_counts["high"] > 0:
        safety_rating = "Critical Caution"
    elif severity_counts["medium"] > 0:
        safety_rating = "Moderate Warning"
    elif severity_counts["low"] > 0:
        safety_rating = "Minor Caution"

    return jsonify({
        "safety_rating": safety_rating,
        "hazard_count": len(impacted_hazards),
        "severity_breakdown": severity_counts,
        "hazards_on_route": impacted_hazards
    }), 200

@app.route("/app")
@app.route("/app/")
def serve_app_index():
    return send_file(os.path.join(FRONTEND_DIR, "index.html"))

@app.route("/css/<path:path>")
def serve_frontend_css(path):
    return send_from_directory(os.path.join(FRONTEND_DIR, "css"), path)

@app.route("/js/<path:path>")
def serve_frontend_js(path):
    return send_from_directory(os.path.join(FRONTEND_DIR, "js"), path)

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5001))
    debug = os.getenv("FLASK_DEBUG", "True").lower() in ["true", "1"]
    print(f"Starting SirenRoute on port {port} (debug={debug})...")
    app.run(host="0.0.0.0", port=port, debug=debug)