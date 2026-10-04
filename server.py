import os
import json
import re
import csv
import io
import time
import threading
import requests
from datetime import datetime, date
from typing import Optional, List, Any, Union, Dict
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from engine import ProjectEngine

app = FastAPI(title="KPGreenergy Planner", version="1.0.0")

# Security Credentials & Web App Configurations (Supports Render Environment Variables)
EDITOR_PASSWORD = os.environ.get("EDITOR_PASSWORD", "KPGEditor")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "kpg_sec_webhook_2026")
DEFAULT_WEBAPP_URL = os.environ.get(
    "DEFAULT_WEBAPP_URL",
    "https://script.google.com/macros/s/AKfycbx139TsQvyxZslZKF0wmHRI0EuXWaRVaU0Vt5TthJvyWevkMCZ57S_alqHTOgELQEMs4A/exec"
)

# Enable CORS with sensible origins and Render domain regex support
ALLOWED_ORIGINS = [
    "https://kpgreenergy-planner-dev01.onrender.com",
    "https://script.google.com",
    "https://script.googleusercontent.com",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1",
    "http://localhost"
]
cors_env = os.environ.get("CORS_ORIGINS", "")
if cors_env:
    ALLOWED_ORIGINS = [o.strip() for o in cors_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.onrender\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Force No-Cache for all responses to prevent stale browser cache
@app.middleware("http")
async def add_no_cache_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# Initialize Engine
engine = ProjectEngine()

def safe_parse_progress_pct(val, fallback: Optional[float] = None) -> Optional[float]:
    """
    Robustly parses progress percentage values from string, float, or int.
    Handles:
      - 0.95 -> 0.95
      - 95 -> 0.95
      - "95%" -> 0.95
      - "95.00%" -> 0.95
      - "95,00%" -> 0.95 (European/Thai comma decimal)
      - " 95 % " -> 0.95
      - "100%" -> 1.0
      - Invalid/unparseable text -> returns fallback WITHOUT setting to 0.0!
    """
    if val is None:
        return fallback
    if isinstance(val, (int, float)):
        v = float(val)
        return v / 100.0 if v > 1.0 else max(0.0, min(1.0, v))
    s = str(val).strip()
    if not s or s == "-":
        return fallback
    clean = s.replace("%", "").replace(" ", "").strip()
    if "," in clean and "." not in clean:
        clean = clean.replace(",", ".")
    elif "," in clean and "." in clean:
        clean = clean.replace(",", "")
    try:
        v = float(clean)
        return v / 100.0 if v > 1.0 else max(0.0, min(1.0, v))
    except (ValueError, TypeError):
        return fallback


class SyncQueueManager:
    """
    Manages pending sync operations to Google Sheet with automatic retry and stale CSV protection.
    """
    def __init__(self):
        self.pending_milestones = {}  # key: f"{prj_id}:{m_name}" -> dict
        self.pending_issues = {}      # key: issue_id -> dict
        self.lock = threading.Lock()

    def record_milestone_edit(self, project_id: str, milestone_name: str, payload: dict):
        key = f"{project_id}:{milestone_name}".strip().lower()
        with self.lock:
            self.pending_milestones[key] = {
                "project_id": project_id,
                "milestone_name": milestone_name,
                "payload": payload,
                "timestamp": time.time(),
                "synced": False,
                "retries": 0
            }

    def mark_milestone_synced(self, project_id: str, milestone_name: str):
        key = f"{project_id}:{milestone_name}".strip().lower()
        with self.lock:
            if key in self.pending_milestones:
                self.pending_milestones[key]["synced"] = True
                self.pending_milestones[key]["synced_at"] = time.time()

    def is_milestone_protected(self, project_id: str, milestone_name: str) -> bool:
        key = f"{project_id}:{milestone_name}".strip().lower()
        with self.lock:
            item = self.pending_milestones.get(key)
            if not item:
                return False
            # If not yet confirmed synced, ALWAYS protect!
            if not item.get("synced", False):
                return True
            # If synced, protect for 15 minutes (900s) to allow Google Sheet's CSV export cache to catch up
            synced_at = item.get("synced_at", 0)
            return (time.time() - synced_at) < 900

    def record_issue_edit(self, issue_id: str, payload: dict):
        iid = str(issue_id).strip()
        with self.lock:
            self.pending_issues[iid] = {
                "issue_id": iid,
                "payload": payload,
                "timestamp": time.time(),
                "synced": False,
                "retries": 0
            }

    def mark_issue_synced(self, issue_id: str):
        iid = str(issue_id).strip()
        with self.lock:
            if iid in self.pending_issues:
                self.pending_issues[iid]["synced"] = True
                self.pending_issues[iid]["synced_at"] = time.time()


sync_manager = SyncQueueManager()
engine.sync_manager = sync_manager

# Data Version for Real-Time Auto Sync across open tabs
DATA_VERSION = 1
LAST_UPDATE_TIME = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
LAST_SHEET_SYNC_TIME = 0
IS_SYNCING_SHEET = False

def notify_data_updated():
    global DATA_VERSION, LAST_UPDATE_TIME
    DATA_VERSION += 1
    LAST_UPDATE_TIME = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def sync_issues_from_sheet() -> int:
    target_url = getattr(engine, "google_sheet_webapp_url", "") or DEFAULT_WEBAPP_URL
    if not target_url or "script.google.com" not in target_url:
        return 0
    try:
        url = target_url + ("&" if "?" in target_url else "?") + "action=get_issues"
        resp = requests.get(url, timeout=15, allow_redirects=True)
        if resp.status_code == 200:
            res_json = resp.json()
            issues_list = res_json.get("issues", [])
            if issues_list is not None:
                engine.set_issues_from_sheet(issues_list)
                print(f"[SheetSync] Synced {len(issues_list)} issues from Google Sheet (Clean 1:1 match).")
                return len(issues_list)
    except Exception as e:
        print(f"[SheetSync Warning] Failed to sync issues from sheet: {e}")
    return 0

def do_sheet_sync() -> int:
    global LAST_SHEET_SYNC_TIME, IS_SYNCING_SHEET
    if IS_SYNCING_SHEET:
        return 0
    try:
        IS_SYNCING_SHEET = True
        count = engine.sync_from_google_sheet_csv()
        sync_issues_from_sheet()
        if count > 0:
            notify_data_updated()
            print(f"[SheetSync] Successfully synced {count} projects from Google Sheet (v{DATA_VERSION}).")
        LAST_SHEET_SYNC_TIME = time.time()
        return count
    except Exception as e:
        print(f"[SheetSync] Error syncing from Google Sheet: {e}")
        return 0
    finally:
        IS_SYNCING_SHEET = False

def trigger_background_sheet_sync():
    threading.Thread(target=do_sheet_sync, daemon=True).start()

def background_periodic_sync():
    while True:
        time.sleep(600)  # Sync every 10 minutes
        try:
            do_sheet_sync()
        except:
            pass

def background_retry_worker():
    while True:
        time.sleep(20)  # Retry pending queue every 20 seconds
        target_write_url = getattr(engine, "google_sheet_webapp_url", "") or DEFAULT_WEBAPP_URL
        if not target_write_url or "script.google.com" not in target_write_url:
            continue

        # 1. Retry pending milestones
        with sync_manager.lock:
            m_items = [
                (k, dict(v)) for k, v in sync_manager.pending_milestones.items()
                if not v.get("synced", False) and v.get("retries", 0) < 15
            ]

        for k, item in m_items:
            payload = item["payload"]
            try:
                resp = requests.post(target_write_url, json=payload, timeout=18, allow_redirects=True)
                if resp.status_code == 200:
                    try:
                        rj = resp.json()
                        if rj.get("status") == "success":
                            sync_manager.mark_milestone_synced(payload["project_id"], payload["milestone_name"])
                            print(f"[RetrySync] Milestone synced: {k}")
                            continue
                    except:
                        sync_manager.mark_milestone_synced(payload["project_id"], payload["milestone_name"])
                        continue
                with sync_manager.lock:
                    if k in sync_manager.pending_milestones:
                        sync_manager.pending_milestones[k]["retries"] += 1
            except Exception as e:
                with sync_manager.lock:
                    if k in sync_manager.pending_milestones:
                        sync_manager.pending_milestones[k]["retries"] += 1
                print(f"[RetrySync Warning] Milestone {k} retry failed: {e}")

        # 2. Retry pending issues
        with sync_manager.lock:
            i_items = [
                (iid, dict(v)) for iid, v in sync_manager.pending_issues.items()
                if not v.get("synced", False) and v.get("retries", 0) < 15
            ]

        for iid, item in i_items:
            payload = item["payload"]
            try:
                resp = requests.post(target_write_url, json=payload, timeout=18, allow_redirects=True)
                if resp.status_code == 200:
                    try:
                        rj = resp.json()
                        if rj.get("status") == "success":
                            sync_manager.mark_issue_synced(iid)
                            print(f"[RetrySync] Issue synced: {iid}")
                            continue
                    except:
                        sync_manager.mark_issue_synced(iid)
                        continue
                with sync_manager.lock:
                    if iid in sync_manager.pending_issues:
                        sync_manager.pending_issues[iid]["retries"] += 1
            except Exception as e:
                with sync_manager.lock:
                    if iid in sync_manager.pending_issues:
                        sync_manager.pending_issues[iid]["retries"] += 1
                print(f"[RetrySync Warning] Issue {iid} retry failed: {e}")

@app.on_event("startup")
async def on_startup():
    # Sync latest Google Sheet on server startup
    print("[Startup] Triggering initial Google Sheet sync in background...")
    trigger_background_sheet_sync()
    threading.Thread(target=background_periodic_sync, daemon=True).start()
    threading.Thread(target=background_retry_worker, daemon=True).start()

@app.get("/api/live-status")
async def get_live_status():
    global DATA_VERSION, LAST_UPDATE_TIME
    return {"version": DATA_VERSION, "last_update": LAST_UPDATE_TIME}

@app.get("/api/sync-latest")
@app.post("/api/sync-latest")
async def sync_latest_endpoint():
    count = do_sheet_sync()
    return {
        "success": True, 
        "updated_projects": count, 
        "version": DATA_VERSION,
        "message": f"ซิงค์ข้อมูลล่าสุดจาก Google Sheet สำเร็จเรียบร้อยแล้ว ({count} โครงการ)"
    }

# Ensure static directory exists
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
os.makedirs(STATIC_DIR, exist_ok=True)

# Mount static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Pydantic models for requests
class MilestoneUpdateRequest(BaseModel):
    project_id: str
    milestone_name: str
    actual_pct: float
    actual_start: Optional[str] = None
    actual_finish: Optional[str] = None
    planned_start: Optional[str] = None
    planned_finish: Optional[str] = None
    note: Optional[str] = None
    updated_by: Optional[str] = "Web Editor"
    password: Optional[str] = None
    sheet_url: Optional[str] = None

class IssueCreateRequest(BaseModel):
    project_id: Optional[str] = ""
    site_name: Optional[str] = ""
    lot: Optional[str] = ""
    week: Optional[str] = ""
    start_date: Optional[str] = ""
    end_date: Optional[str] = None
    category: Optional[str] = "งานทั่วไป"
    description: str
    action_plan: Optional[str] = ""
    status: Optional[str] = "IN_PROGRESS"
    severity: Optional[str] = "MEDIUM"
    reported_by: Optional[str] = "วิศวกรหน้างาน"
    password: Optional[str] = ""

class IssueUpdateRequest(BaseModel):
    project_id: Optional[str] = None
    site_name: Optional[str] = None
    lot: Optional[str] = None
    week: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    action_plan: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    reported_by: Optional[str] = None
    password: Optional[str] = ""

class PhotoUploadRequest(BaseModel):
    project_id: str
    project_name: Optional[str] = None
    slot: int
    title: Optional[str] = None
    image_base64: Optional[str] = None
    photo_url: Optional[str] = None
    drive_file_id: Optional[str] = None
    date: Optional[str] = None
    caption: Optional[str] = None
    updated_by: Optional[str] = "วิศวกรหน้างาน"
    password: Optional[str] = ""

class ProjectCreateRequest(BaseModel):
    name: str
    order_no: Optional[Union[int, str]] = None
    lot: Optional[str] = "Lot 1"
    capacity_kwp: Optional[float] = 100.0
    business_unit: Optional[str] = "ทั่วไป"
    installation_type: Optional[str] = "Solar Rooftop"
    voltage_level: Optional[str] = "LV"
    type_code: Optional[int] = None
    planned_start: Optional[str] = None
    planned_finish: Optional[str] = None
    password: Optional[str] = ""
    milestones: Optional[List[Dict[str, Any]]] = None




@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>KPGreenergy Planner Running</h1>")

@app.get("/index.html", response_class=HTMLResponse)
async def serve_index_html():
    return await serve_index()

@app.get("/liff", response_class=HTMLResponse)
async def serve_liff():
    liff_path = os.path.join(STATIC_DIR, "liff.html")
    if os.path.exists(liff_path):
        with open(liff_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>LINE LIFF Form</h1>")

@app.get("/liff.html", response_class=HTMLResponse)
async def serve_liff_html():
    return await serve_liff()

@app.get("/api/debug-log")
async def debug_log(err: str = ""):
    print(f"[FRONTEND JS ERROR] {err}")
    return {"ok": True}

# API Endpoints
@app.get("/api/overview")
async def get_overview():
    projects = engine.projects
    total_projects = len(projects)
    total_capacity = sum(p.get("capacity_kwp", 0.0) for p in projects)
    
    completed_count = sum(1 for p in projects if p.get("status") == "COMPLETED")
    delayed_count = sum(1 for p in projects if p.get("status") == "DELAYED")
    on_track_count = sum(1 for p in projects if p.get("status") in ["ON_TRACK", "SLIGHT_DELAY"])
    
    total_act_weighted = sum(p.get("actual_progress_pct", 0.0) * p.get("capacity_kwp", 0.0) for p in projects)
    total_plan_weighted = sum(p.get("planned_progress_pct", 0.0) * p.get("capacity_kwp", 0.0) for p in projects)
    
    avg_actual = round(total_act_weighted / total_capacity, 2) if total_capacity > 0 else 0.0
    avg_planned = round(total_plan_weighted / total_capacity, 2) if total_capacity > 0 else 0.0
    
    business_units = sorted(list(set(p.get("business_unit") for p in projects if p.get("business_unit"))))
    lots = sorted(list(set(p.get("lot") for p in projects if p.get("lot"))))
    installation_types = sorted(list(set(p.get("installation_type") for p in projects if p.get("installation_type"))))
    
    phases = engine.get_phase_summary()
    energized_summary = engine.get_energized_summary()

    return {
        "total_projects": total_projects,
        "total_capacity_kwp": round(total_capacity, 2),
        "total_capacity_mwp": round(total_capacity / 1000.0, 2),
        "avg_actual_progress_pct": avg_actual,
        "avg_planned_progress_pct": avg_planned,
        "variance_pct": round(avg_actual - avg_planned, 2),
        "completed_count": completed_count,
        "delayed_count": delayed_count,
        "on_track_count": on_track_count,
        "business_units": business_units,
        "lots": lots,
        "installation_types": installation_types,
        "phases": phases,
        "energized": energized_summary
    }

@app.get("/api/projects")
async def get_projects(
    lot: Optional[str] = None,
    business_unit: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None
):
    results = []
    for p in engine.projects:
        if lot and p.get("lot") != lot:
            continue
        if business_unit and p.get("business_unit") != business_unit:
            continue
        if status and p.get("status") != status:
            continue
        if search:
            q = search.lower().strip()
            name_match = q in p.get("name", "").lower()
            bu_match = q in p.get("business_unit", "").lower()
            lot_match = q in p.get("lot", "").lower()
            if not (name_match or bu_match or lot_match):
                continue
        
        results.append({
            "id": p["id"],
            "name": p["name"],
            "business_unit": p["business_unit"],
            "order_no": p["order_no"],
            "lot": p["lot"],
            "capacity_kwp": p["capacity_kwp"],
            "installation_type": p["installation_type"],
            "type_code": p["type_code"],
            "planned_start": p["planned_start"],
            "planned_finish": p["planned_finish"],
            "actual_start": p["actual_start"],
            "actual_finish": p["actual_finish"],
            "actual_progress_pct": p["actual_progress_pct"],
            "planned_progress_pct": p["planned_progress_pct"],
            "variance_pct": p["variance_pct"],
            "status": p["status"],
            "status_th": p["status_th"]
        })
    
    return {"count": len(results), "projects": results}

@app.get("/api/projects/{project_id}")
async def get_project_detail(project_id: str):
    if project_id not in engine.projects_dict:
        raise HTTPException(status_code=404, detail="Project not found")
    return engine.projects_dict[project_id]

def background_sync_new_project_to_sheet(prj: dict):
    """
    Asynchronously notifies Google Apps Script to append the new project row into Google Sheets (Approach C).
    """
    target_url = engine.google_sheet_webapp_url or DEFAULT_WEBAPP_URL
    if not target_url or "script.google.com" not in target_url:
        print("[SheetSync NewProject] No valid Google Apps Script Web App URL configured. Skipping sheet writeback.")
        return

    payload = {
        "action": "create_project",
        "project_id": prj.get("id"),
        "order_no": prj.get("order_no"),
        "name": prj.get("name"),
        "lot": prj.get("lot"),
        "capacity_kwp": prj.get("capacity_kwp"),
        "business_unit": prj.get("business_unit"),
        "installation_type": prj.get("installation_type"),
        "voltage_level": prj.get("voltage_level", "LV"),
        "type_code": prj.get("type_code"),
        "planned_start": prj.get("planned_start"),
        "planned_finish": prj.get("planned_finish"),
        "milestones": [
            {
                "name": m.get("name"),
                "weight": m.get("weight"),
                "planned_start": m.get("planned_start"),
                "planned_finish": m.get("planned_finish")
            }
            for m in prj.get("milestones", [])
        ]
    }

    try:
        resp = requests.post(target_url, json=payload, timeout=25, allow_redirects=True)
        print(f"[SheetSync NewProject] Google Sheet webhook response status: {resp.status_code}, body: {resp.text[:200]}")
    except Exception as e:
        print(f"[SheetSync NewProject Warning] Failed to write new project to Google Sheet: {e}")

@app.get("/api/cal-progress-weights")
async def get_cal_progress_weights(
    installation_type: str = "Solar Rooftop",
    capacity_kwp: float = 100.0,
    voltage_level: str = "LV"
):
    type_code = engine.resolve_type_code(installation_type, capacity_kwp, voltage_level)
    weights = engine.weight_matrix.get(type_code, engine.weight_matrix.get(1, {}))
    
    vl_clean = str(voltage_level).strip().upper()
    volt_desc = "LV (แรงดันต่ำ - ตู้ MDB เดิม ไม่ใช้หม้อแปลง)" if vl_clean == "LV" else "MV (แรงดันปานกลาง - มีหม้อแปลง Step-Up)"
    
    return {
        "type_code": type_code,
        "installation_type": installation_type,
        "voltage_level": vl_clean,
        "capacity_kwp": capacity_kwp,
        "description": f"Type {type_code}: {installation_type} [{vl_clean}]",
        "voltage_desc": volt_desc,
        "weights": weights,
        "milestones": [
            {
                "index": idx,
                "name": m_name,
                "category": engine.milestone_categories.get(m_name, "งานทั่วไป"),
                "weight": round(weights.get(m_name, 0.0), 4)
            }
            for idx, m_name in enumerate(engine.milestone_names)
        ]
    }

@app.post("/api/projects")
async def create_new_project(req: ProjectCreateRequest):
    global DATA_VERSION, LAST_UPDATE_TIME
    
    # Validate password if configured
    if EDITOR_PASSWORD:
        if not req.password or req.password.strip() != EDITOR_PASSWORD:
            raise HTTPException(status_code=401, detail="รหัสผ่านไม่ถูกต้อง (Invalid Editor Password)")

    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="กรุณาระบุชื่อโครงการ (Project name is required)")

    try:
        data = req.dict()
        new_prj = engine.add_new_project(data, trigger_cache_save=True)
        DATA_VERSION += 1
        LAST_UPDATE_TIME = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Asynchronously sync to Google Sheet via Apps Script
        threading.Thread(
            target=background_sync_new_project_to_sheet,
            args=(new_prj,),
            daemon=True
        ).start()

        return {
            "success": True,
            "project": new_prj,
            "version": DATA_VERSION,
            "message": f"เพิ่มไซต์งาน '{new_prj['name']}' เข้าสู่ระบบสำเร็จแล้ว"
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        print(f"[CreateProject Error] {e}")
        raise HTTPException(status_code=500, detail=f"เกิดข้อผิดพลาดในการสร้างโครงการ: {e}")

@app.get("/api/phases")
async def get_phases():
    return engine.get_phase_summary()

@app.get("/api/lot-weekly-progress")
async def get_lot_weekly_progress(lot: Optional[str] = None):
    # Filter active projects by lot
    if lot and lot != "ALL":
        target_projects = [p for p in engine.active_projects if p.get("lot") == lot]
    else:
        target_projects = engine.active_projects

    # Get canonical S-curve and category data for this lot
    lot_scurve_data = engine.get_lot_scurve_and_categories(lot)
    scurve_info = lot_scurve_data.get("scurve", {})
    all_weeks = scurve_info.get("weeks", [])
    all_labels = scurve_info.get("labels", [])

    today_str = date.today().strftime('%Y-%m-%d')
    current_week_idx = 0
    for idx, w_date in enumerate(all_weeks):
        if today_str >= str(w_date)[:10]:
            current_week_idx = idx

    # Build site list
    sites = []
    for p in target_projects:
        sc = p.get("s_curve", {})
        pw = sc.get("planned_weekly", [])
        aw = sc.get("actual_weekly", [])
        pc = sc.get("planned_cum", [])
        ac = sc.get("actual_cum", [])

        p_weeks = sc.get("weeks", [])
        p_week_map = {str(w)[:10]: i for i, w in enumerate(p_weeks)}

        site_pw = []
        site_aw = []
        site_pc = []
        site_ac = []

        last_pc = 0.0
        last_ac = 0.0
        for gw in all_weeks:
            gw_str = str(gw)[:10]
            if gw_str in p_week_map:
                pi = p_week_map[gw_str]
                raw_pw = pw[pi] if pi < len(pw) else 0.0
                raw_aw = aw[pi] if pi < len(aw) else 0.0
                raw_pc = pc[pi] if pi < len(pc) else last_pc
                raw_ac = ac[pi] if pi < len(ac) else last_ac
                
                val_pw = float(raw_pw) if raw_pw is not None else 0.0
                val_aw = float(raw_aw) if raw_aw is not None else 0.0
                val_pc = float(raw_pc) if raw_pc is not None else last_pc
                val_ac = float(raw_ac) if raw_ac is not None else last_ac
                
                last_pc = val_pc
                last_ac = val_ac
            else:
                val_pw = 0.0
                val_aw = 0.0
                val_pc = last_pc
                val_ac = last_ac

            site_pw.append(round(val_pw, 2))
            site_aw.append(round(val_aw, 2))
            site_pc.append(round(val_pc, 2))
            site_ac.append(round(val_ac, 2))

        sites.append({
            "id": p["id"],
            "name": p["name"],
            "order_no": p.get("order_no"),
            "lot": p.get("lot"),
            "business_unit": p.get("business_unit"),
            "capacity_kwp": p.get("capacity_kwp", 0.0),
            "planned_progress_pct": p.get("planned_progress_pct", 0.0),
            "actual_progress_pct": p.get("actual_progress_pct", 0.0),
            "variance_pct": p.get("variance_pct", 0.0),
            "status": p.get("status"),
            "status_th": p.get("status_th"),
            "weekly_planned": site_pw,
            "weekly_actual": site_aw,
            "cumulative_planned": site_pc,
            "cumulative_actual": site_ac
        })

    total_sites = len(sites)
    total_capacity = sum(s["capacity_kwp"] for s in sites)
    avg_planned = round(sum(s["planned_progress_pct"] * s["capacity_kwp"] for s in sites) / total_capacity, 2) if total_capacity > 0 else 0.0
    avg_actual = round(sum(s["actual_progress_pct"] * s["capacity_kwp"] for s in sites) / total_capacity, 2) if total_capacity > 0 else 0.0


    return {
        "lot": lot or "ALL",
        "total_sites": total_sites,
        "total_capacity_kwp": round(total_capacity, 2),
        "total_capacity_mwp": round(total_capacity / 1000.0, 2),
        "avg_planned_progress_pct": avg_planned,
        "avg_actual_progress_pct": avg_actual,
        "variance_pct": round(avg_actual - avg_planned, 2),
        "weeks": [str(w)[:10] for w in all_weeks],
        "week_labels": all_labels,
        "current_week_index": current_week_idx,
        "sites": sites,
        "category_breakdown": lot_scurve_data.get("category_breakdown", []),
        "category_breakdown_by_week": lot_scurve_data.get("category_breakdown_by_week", []),
        "scurve": lot_scurve_data.get("scurve", {})
    }

@app.get("/api/issues")
async def get_issues_endpoint(
    lot: Optional[str] = None,
    project_id: Optional[str] = None,
    status: Optional[str] = None,
    category: Optional[str] = None,
    search: Optional[str] = None
):
    issues = engine.get_issues(lot=lot, project_id=project_id, status=status, category=category, search=search)
    total_issues = len(engine.issues)
    open_count = sum(1 for i in engine.issues if i.get("status") in ["OPEN", "IN_PROGRESS"])
    resolved_count = sum(1 for i in engine.issues if i.get("status") == "RESOLVED")
    high_sev_count = sum(1 for i in engine.issues if i.get("severity") == "HIGH" and i.get("status") in ["OPEN", "IN_PROGRESS"])
    affected_sites_count = len(set(i.get("project_id") for i in engine.issues if i.get("project_id") and i.get("status") in ["OPEN", "IN_PROGRESS"]))
    
    return {
        "issues": issues,
        "total": len(issues),
        "summary": {
            "total_all": total_issues,
            "open_issues": open_count,
            "resolved_issues": resolved_count,
            "high_severity_open": high_sev_count,
            "affected_sites": affected_sites_count
        }
    }

@app.post("/api/issues")
async def create_issue_endpoint(req: IssueCreateRequest):
    if req.password != EDITOR_PASSWORD:
        raise HTTPException(status_code=401, detail="รหัสผ่านไม่ถูกต้อง กรุณาระบุรหัสผ่านที่ถูกต้องเพื่อยืนยัน")
    if not req.description.strip():
        raise HTTPException(status_code=400, detail="กรุณาระบุคำอธิบายปัญหา")
    
    new_issue = engine.add_issue(req.dict())
    notify_data_updated()
    
    # Sync to Google Sheet Web App if configured
    target_write_url = getattr(engine, "google_sheet_webapp_url", "") or DEFAULT_WEBAPP_URL
    gsheet_synced = False
    if target_write_url:
        payload = {
            "action": "add_issue",
            "issue": new_issue,
            "updated_by": req.reported_by or "Web User",
            "source": "webapp"
        }
        # Record in sync_manager for reliable retry
        sync_manager.record_issue_edit(new_issue["id"], payload)
        try:
            gs_resp = requests.post(target_write_url, json=payload, timeout=18, allow_redirects=True)
            if gs_resp.status_code == 200:
                gsheet_synced = True
                sync_manager.mark_issue_synced(new_issue["id"])
            else:
                gsheet_synced = True  # Queued for background worker retry
        except Exception as e:
            print(f"[Warning] Issue sync queued for background retry: {e}")
            gsheet_synced = True  # Queued for background worker retry
            
    return {
        "success": True,
        "message": f"บันทึกรายงานปัญหา {new_issue['id']} สำเร็จเรียบร้อย",
        "issue": new_issue,
        "gsheet_synced": gsheet_synced
    }

@app.post("/api/issues/{issue_id}/update")
async def update_issue_endpoint(issue_id: str, req: IssueUpdateRequest):
    if req.password != EDITOR_PASSWORD:
        raise HTTPException(status_code=401, detail="รหัสผ่านไม่ถูกต้อง กรุณาระบุรหัสผ่านที่ถูกต้องเพื่อยืนยัน")
    
    updates = {}
    if req.project_id is not None:
        updates["project_id"] = req.project_id
    if req.site_name is not None:
        updates["site_name"] = req.site_name
    if req.lot is not None:
        updates["lot"] = req.lot
    if req.week is not None:
        updates["week"] = req.week
    if req.start_date is not None:
        updates["start_date"] = req.start_date
    if req.end_date is not None:
        updates["end_date"] = req.end_date if req.end_date != "" else None
    if req.action_plan is not None:
        updates["action_plan"] = req.action_plan
    if req.status is not None:
        updates["status"] = req.status
    if req.description is not None:
        updates["description"] = req.description
    if req.category is not None:
        updates["category"] = req.category
    if req.severity is not None:
        updates["severity"] = req.severity
    if req.reported_by is not None:
        updates["reported_by"] = req.reported_by
        
    updated = engine.update_issue(issue_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="ไม่พบรหัสปัญหานี้ในระบบ")
        
    notify_data_updated()
    
    # Sync to Google Sheet Web App if configured
    target_write_url = getattr(engine, "google_sheet_webapp_url", "") or DEFAULT_WEBAPP_URL
    if target_write_url:
        payload = {
            "action": "update_issue",
            "issue": updated,
            "updated_by": req.reported_by or "Web User",
            "source": "webapp"
        }
        sync_manager.record_issue_edit(issue_id, payload)
        try:
            gs_resp = requests.post(target_write_url, json=payload, timeout=18, allow_redirects=True)
            if gs_resp.status_code == 200:
                sync_manager.mark_issue_synced(issue_id)
        except Exception as e:
            print(f"[Warning] Issue update sync queued for background retry: {e}")

    return {
        "success": True,
        "message": f"อัปเดตปัญหา {issue_id} เรียบร้อยแล้ว",
        "issue": updated
    }

@app.delete("/api/issues/{issue_id}")
async def delete_issue_endpoint(issue_id: str, request: Request):
    pwd = None
    try:
        data = await request.json()
        pwd = data.get("password")
    except:
        pwd = request.query_params.get("password")
        
    if pwd != EDITOR_PASSWORD:
        raise HTTPException(status_code=401, detail="รหัสผ่านไม่ถูกต้อง กรุณาระบุรหัสผ่านที่ถูกต้องเพื่อยืนยัน")
        
    success = engine.delete_issue(issue_id)
    if not success:
        raise HTTPException(status_code=404, detail="ไม่พบรายการปัญหาที่จะลบ")
        
    notify_data_updated()
    return {"success": True, "message": f"ลบรายการปัญหา {issue_id} สำเร็จ"}

# =========================================================================
# PHOTO MANAGEMENT ENDPOINTS (6 SLOTS PER PROJECT)
# =========================================================================
@app.get("/api/projects/{project_id}/photos")
async def get_project_photos_endpoint(project_id: str):
    photos = engine.get_project_photos(project_id)
    prj = engine.projects_dict.get(str(project_id))
    prj_name = prj.get("name", f"Project {project_id}") if prj else f"Project {project_id}"
    return {
        "project_id": project_id,
        "project_name": prj_name,
        "photos": photos
    }

def background_upload_photo_to_drive(project_id: str, prj_name: str, slot: int, slot_title: str, photo_date: str, caption: str, updated_by: str, image_base64: str, target_write_url: str):
    try:
        gas_payload = {
            "action": "upload_photo",
            "project_id": str(project_id),
            "project_name": prj_name,
            "slot": slot,
            "slot_title": slot_title,
            "date": photo_date,
            "caption": caption,
            "updated_by": updated_by,
            "image_base64": image_base64,
            "content_type": "image/jpeg"
        }
        res = requests.post(target_write_url, json=gas_payload, timeout=30)
        if res.status_code == 200:
            try:
                gas_res = res.json()
                if gas_res.get("status") == "success":
                    engine.save_project_photo(project_id, {
                        "slot": slot,
                        "drive_file_id": gas_res.get("file_id", ""),
                        "photo_url": gas_res.get("photo_url", ""),
                        "download_url": gas_res.get("download_url", "")
                    })
                    print(f"[Photo Drive Sync] Uploaded slot {slot} to Google Drive: {gas_res.get('file_id')}")
            except Exception as json_err:
                print(f"[Photo Drive Sync Notice] Google Apps Script response: {res.text[:100]}")
    except Exception as e:
        print(f"[Photo Drive Sync Warning] Could not sync to Google Drive: {e}")

@app.post("/api/projects/{project_id}/photos")
async def upload_project_photo_endpoint(project_id: str, req: PhotoUploadRequest):
    if req.password and req.password != EDITOR_PASSWORD:
        raise HTTPException(status_code=401, detail="รหัสผ่านไม่ถูกต้อง กรุณาระบุรหัสผ่านที่ถูกต้องเพื่อยืนยัน")
    
    prj = engine.projects_dict.get(str(project_id))
    prj_name = req.project_name or (prj.get("name") if prj else f"Project {project_id}")
    
    # 1. Update local cache immediately with base64 data URL
    photo_payload = req.dict()
    photo_payload["project_name"] = prj_name
    saved_slot = engine.save_project_photo(project_id, photo_payload)
    
    # 2. Trigger Google Drive upload in background thread (non-blocking!)
    target_write_url = getattr(engine, "google_sheet_webapp_url", "") or DEFAULT_WEBAPP_URL
    if req.image_base64 and target_write_url:
        threading.Thread(
            target=background_upload_photo_to_drive,
            args=(
                str(project_id),
                prj_name,
                req.slot,
                saved_slot.get("title", f"Slot {req.slot}"),
                req.date or saved_slot.get("date"),
                req.caption or "",
                req.updated_by or "Web User",
                req.image_base64,
                target_write_url
            ),
            daemon=True
        ).start()
            
    notify_data_updated()
    return {
        "success": True,
        "message": "บันทึกรูปภาพสำเร็จ",
        "photo": saved_slot
    }

@app.delete("/api/projects/{project_id}/photos/{slot}")
async def delete_project_photo_endpoint(project_id: str, slot: int, request: Request):
    pwd = None
    try:
        data = await request.json()
        pwd = data.get("password")
    except:
        pwd = request.query_params.get("password")
        
    if pwd and pwd != EDITOR_PASSWORD:
        raise HTTPException(status_code=401, detail="รหัสผ่านไม่ถูกต้อง กรุณาระบุรหัสผ่านที่ถูกต้องเพื่อยืนยัน")
        
    success = engine.delete_project_photo(project_id, slot)
    notify_data_updated()
    return {"success": success, "message": f"ลบรูปภาพ Slot {slot} สำเร็จ"}

@app.post("/api/update-milestone")
async def update_milestone(req: MilestoneUpdateRequest):
    # Verify Password (from Web Editor or LINE LIFF)
    if req.password != EDITOR_PASSWORD:
        raise HTTPException(
            status_code=401, 
            detail="รหัสผ่านไม่ถูกต้อง กรุณาระบุรหัสผ่านที่ถูกต้องเพื่อยืนยันการแก้ไขข้อมูล"
        )
    
    pct = safe_parse_progress_pct(req.actual_pct, fallback=0.0)
    
    success = engine.update_milestone(
        project_id=req.project_id,
        milestone_name=req.milestone_name,
        actual_pct=pct,
        actual_start=req.actual_start,
        actual_finish=req.actual_finish,
        planned_start=req.planned_start,
        planned_finish=req.planned_finish
    )
    
    if not success:
        raise HTTPException(status_code=400, detail="Failed to update milestone. Check project_id and milestone_name.")
    
    notify_data_updated()
    updated_project = engine.projects_dict[req.project_id]
    
    # 2. Write-back to Google Sheet via Google Apps Script Web App
    gsheet_synced = False
    gsheet_msg = ""
    target_write_url = req.sheet_url or getattr(engine, "google_sheet_webapp_url", "") or DEFAULT_WEBAPP_URL
    
    if "script.google.com" in target_write_url:
        m_idx = 0
        for idx, m in enumerate(updated_project.get("milestones", [])):
            if m["name"].strip().lower() == req.milestone_name.strip().lower():
                m_idx = idx
                break

        payload = {
            "action": "update_milestone",
            "project_id": updated_project["id"],
            "project_name": updated_project["name"],
            "order_no": str(updated_project.get("order_no") or ""),
            "milestone_name": req.milestone_name,
            "milestone_index": m_idx,
            "actual_pct": pct,
            "actual_start": req.actual_start or "",
            "actual_finish": req.actual_finish or "",
            "planned_start": req.planned_start or "",
            "planned_finish": req.planned_finish or "",
            "updated_by": req.updated_by or "Web Editor",
            "note": req.note or "อัปเดตผ่านระบบ (KPGreenergy Planner)",
            "source": "webapp"
        }
        
        # Record in queue for retry and stale CSV protection
        sync_manager.record_milestone_edit(req.project_id, req.milestone_name, payload)

        try:
            gs_resp = requests.post(target_write_url, json=payload, timeout=18, allow_redirects=True)
            if gs_resp.status_code == 200:
                try:
                    res_json = gs_resp.json()
                    if res_json.get("status") == "success":
                        gsheet_synced = True
                        sync_manager.mark_milestone_synced(req.project_id, req.milestone_name)
                        gsheet_msg = " และบันทึกลง Google Sheet เรียบร้อยแล้ว ✅"
                    else:
                        gsheet_msg = f" (Google Sheet แจ้ง: {res_json.get('message')})"
                except:
                    gsheet_synced = True
                    sync_manager.mark_milestone_synced(req.project_id, req.milestone_name)
                    gsheet_msg = " และส่งข้อมูลไปยัง Google Sheet เรียบร้อยแล้ว ✅"
            else:
                gsheet_msg = " (เข้าคิวซิงค์อัตโนมัติในพื้นหลังแล้ว ⏳)"
                gsheet_synced = True  # Queued in background retry worker!
        except Exception as e:
            print(f"Warning: Write to Google Sheet timed out / queued for retry: {e}")
            gsheet_msg = " (เข้าคิวซิงค์อัตโนมัติในพื้นหลังแล้ว ⏳)"
            gsheet_synced = True  # Queued, background worker will retry!

    return {
        "success": True,
        "message": f"อัปเดต {req.milestone_name} เป็น {pct*100:.1f}% สำเร็จ{gsheet_msg}",
        "gsheet_synced": gsheet_synced,
        "project": {
            "id": updated_project["id"],
            "name": updated_project["name"],
            "actual_progress_pct": updated_project["actual_progress_pct"],
            "planned_progress_pct": updated_project["planned_progress_pct"],
            "status": updated_project["status"],
            "status_th": updated_project["status_th"]
        }
    }

@app.post("/api/webhook")
async def handle_webhook(request: Request):
    # Security: Verify Webhook Secret if configured
    expected_secret = os.environ.get("WEBHOOK_SECRET", "kpg_sec_webhook_2026")
    client_secret = request.headers.get("X-Webhook-Secret") or request.query_params.get("secret")
    
    try:
        body = await request.json()
    except:
        body = {}
        
    if not client_secret:
        client_secret = body.get("webhook_secret") or body.get("secret")
        
    if expected_secret:
        user_agent = request.headers.get("user-agent", "")
        # Allow if secret matches OR if request is genuine Google-Apps-Script
        if client_secret != expected_secret and "Google-Apps-Script" not in user_agent:
            raise HTTPException(status_code=401, detail="Unauthorized webhook access")
    
    action = body.get("action") or body.get("event") or ""
    source = body.get("source", "")
    
    if action in ["update_milestone", "save_progress"]:
        p_id = body.get("project_id")
        p_order = str(body.get("order_no") or "").strip()
        p_name = str(body.get("project_name", "")).strip().lower()
        m_name = str(body.get("milestone_name", "")).strip()
        m_idx = body.get("milestone_index")
        
        if not p_id:
            # 1. Exact order_no
            if p_order:
                for p in engine.all_projects:
                    if str(p.get("order_no", "")).strip() == p_order:
                        p_id = p["id"]
                        break
            # 2. Exact project name
            if not p_id and p_name:
                for p in engine.all_projects:
                    if p["name"].strip().lower() == p_name:
                        p_id = p["id"]
                        break
            # 3. Substring project name
            if not p_id and p_name:
                for p in engine.all_projects:
                    pn = p["name"].strip().lower()
                    if p_name in pn or pn in p_name:
                        p_id = p["id"]
                        break

        # Fallback to existing pct if parse fails (Bug #6)
        existing_val = 0.0
        if p_id and p_id in engine.projects_dict:
            for idx, m in enumerate(engine.projects_dict[p_id].get("milestones", [])):
                if (m_name and m["name"].strip().lower() == m_name.lower()) or (m_idx is not None and idx == m_idx):
                    existing_val = m.get("actual_pct", 0.0)
                    if not m_name:
                        m_name = m["name"]
                    break

        pct = safe_parse_progress_pct(body.get("actual_pct", body.get("new_value")), fallback=existing_val)
        
        if p_id:
            eng_res = engine.update_milestone(
                project_id=p_id,
                milestone_name=m_name,
                actual_pct=pct,
                actual_start=body.get("actual_start"),
                actual_finish=body.get("actual_finish"),
                milestone_index=m_idx
            )
            if eng_res:
                notify_data_updated()
                
                # BUG #1 FIX: If webhook source was NOT sheet, write back to Google Sheet!
                if source != "sheet":
                    target_write_url = getattr(engine, "google_sheet_webapp_url", "") or DEFAULT_WEBAPP_URL
                    if target_write_url and "script.google.com" in target_write_url:
                        sheet_payload = {
                            "action": "update_milestone",
                            "project_id": p_id,
                            "project_name": engine.projects_dict[p_id]["name"],
                            "order_no": str(engine.projects_dict[p_id].get("order_no") or ""),
                            "milestone_name": m_name,
                            "milestone_index": m_idx,
                            "actual_pct": pct,
                            "actual_start": body.get("actual_start") or "",
                            "actual_finish": body.get("actual_finish") or "",
                            "updated_by": body.get("updated_by") or "Webhook API",
                            "note": body.get("note") or "อัปเดตผ่าน Webhook",
                            "source": "webapp_webhook"
                        }
                        sync_manager.record_milestone_edit(p_id, m_name, sheet_payload)
                        def _send():
                            try:
                                r = requests.post(target_write_url, json=sheet_payload, timeout=18, allow_redirects=True)
                                if r.status_code == 200:
                                    sync_manager.mark_milestone_synced(p_id, m_name)
                            except Exception as ex:
                                print(f"[Webhook Writeback Warning] {ex}")
                        threading.Thread(target=_send, daemon=True).start()

            return {
                "status": "ok",
                "updated": eng_res,
                "project_id": p_id,
                "project_name": engine.projects_dict[p_id]["name"] if p_id in engine.projects_dict else "",
                "milestone": m_name,
                "milestone_index": m_idx,
                "actual_progress_pct": engine.projects_dict[p_id]["actual_progress_pct"] if p_id in engine.projects_dict else 0,
                "version": DATA_VERSION
            }

    if action in ["sheet_edited", "on_edit"]:
        p_order = str(body.get("order_no") or "").strip()
        p_name = str(body.get("project_name", "")).strip().lower()
        m_name = str(body.get("milestone_name", "")).strip()
        m_idx = body.get("milestone_index")
        
        p_id = None
        # 1. Exact order_no
        if p_order:
            for p in engine.all_projects:
                if str(p.get("order_no", "")).strip() == p_order:
                    p_id = p["id"]
                    break
        # 2. Exact project name
        if not p_id and p_name:
            for p in engine.all_projects:
                if p["name"].strip().lower() == p_name:
                    p_id = p["id"]
                    break
        # 3. Substring project name
        if not p_id and p_name:
            for p in engine.all_projects:
                pn = p["name"].strip().lower()
                if p_name in pn or pn in p_name:
                    p_id = p["id"]
                    break

        # Check existing milestone value and protect against overwrite loops
        existing_val = 0.0
        if p_id and p_id in engine.projects_dict:
            for idx, m in enumerate(engine.projects_dict[p_id].get("milestones", [])):
                if (m_name and m["name"].strip().lower() == m_name.lower()) or (m_idx is not None and idx == m_idx):
                    existing_val = m.get("actual_pct", 0.0)
                    if not m_name:
                        m_name = m["name"]
                    break
                    
        # Protection check: if recently edited from Web App / webhook, avoid echoing back!
        if p_id and m_name and sync_manager.is_milestone_protected(p_id, m_name):
            return {
                "status": "ignored",
                "reason": "milestone_protected_by_webapp_edit",
                "project_id": p_id,
                "milestone": m_name
            }

        # Safe parse progress with comma and % support (Bug #6)
        val_pct = safe_parse_progress_pct(body.get("new_value", body.get("actual_pct")), fallback=existing_val)
        
        if val_pct == 0.0:
            if body.get("actual_finish"):
                val_pct = 1.0
            elif body.get("actual_start"):
                val_pct = 0.5
                
        if p_id:
            eng_res = engine.update_milestone(
                project_id=p_id,
                milestone_name=m_name,
                actual_pct=val_pct,
                actual_start=body.get("actual_start"),
                actual_finish=body.get("actual_finish"),
                milestone_index=m_idx
            )
            if eng_res:
                notify_data_updated()
            return {
                "status": "ok",
                "updated": eng_res,
                "project_id": p_id,
                "project_name": engine.projects_dict[p_id]["name"],
                "milestone": m_name,
                "milestone_index": m_idx,
                "new_pct": val_pct,
                "actual_progress_pct": engine.projects_dict[p_id]["actual_progress_pct"],
                "version": DATA_VERSION
            }

    if action in ["add_issue", "create_issue"]:
        issue_data = body.get("issue") or body
        new_iss = engine.add_issue(issue_data)
        notify_data_updated()
        return {"status": "ok", "action": "add_issue", "issue": new_iss, "version": DATA_VERSION}

    if action in ["update_issue", "resolve_issue"]:
        issue_id = body.get("issue_id") or (body.get("issue") or {}).get("id")
        updates = body.get("updates") or body.get("issue") or body
        updated_iss = engine.update_issue(issue_id, updates)
        notify_data_updated()
        return {"status": "ok", "action": "update_issue", "issue": updated_iss, "version": DATA_VERSION}
            
    return {"status": "received", "body": body}


@app.post("/api/sync-google-sheet")
async def sync_google_sheet(request: Request):
    try:
        count = do_sheet_sync()
        return {
            "success": True, 
            "updated_projects": count,
            "version": DATA_VERSION,
            "message": f"ซิงค์ข้อมูลจาก Google Sheets สำเร็จเรียบร้อยแล้ว ({count} โครงการ)"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/save-webapp-url")
async def save_webapp_url_endpoint(request: Request):
    try:
        body = await request.json()
        url = body.get("webapp_url", "").strip()
        if url:
            engine.google_sheet_webapp_url = url
            engine.save_to_cache()
            return {"success": True, "message": "บันทึก Google Apps Script Web App URL บนเซิร์ฟเวอร์เรียบร้อยแล้ว (ใช้งานได้กับทุกเครื่องและ LINE LIFF)"}
        raise HTTPException(status_code=400, detail="Missing webapp_url")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/get-webapp-url")
async def get_webapp_url_endpoint():
    return {"webapp_url": getattr(engine, "google_sheet_webapp_url", "") or DEFAULT_WEBAPP_URL}

@app.get("/api/google-apps-script-code")
async def get_gas_code():
    gas_path = os.path.join(BASE_DIR, "google_apps_script.js")
    if os.path.exists(gas_path):
        with open(gas_path, "r", encoding="utf-8") as f:
            return {"code": f.read()}
    return {"code": "// Google Apps Script template"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="127.0.0.1", port=port)
