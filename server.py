import os
import json
import re
import csv
import io
import time
import threading
import requests
from datetime import datetime, date
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from engine import ProjectEngine

app = FastAPI(title="KPGreenergy Planner", version="1.0.0")

# Security Password for editing
EDITOR_PASSWORD = "KPGEditor"
DEFAULT_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbwSbMxBfzkOWgXMA9OwZpu6-Y18Ap0mX1DFgXkZYvQ6P3NrKYpI4kKsxgz2LIEb6QmQ/exec"

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

# Data Version for Real-Time Auto Sync across open tabs
DATA_VERSION = 1
LAST_UPDATE_TIME = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
LAST_SHEET_SYNC_TIME = 0
IS_SYNCING_SHEET = False

def notify_data_updated():
    global DATA_VERSION, LAST_UPDATE_TIME
    DATA_VERSION += 1
    LAST_UPDATE_TIME = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def do_sheet_sync() -> int:
    global LAST_SHEET_SYNC_TIME, IS_SYNCING_SHEET
    if IS_SYNCING_SHEET:
        return 0
    try:
        IS_SYNCING_SHEET = True
        count = engine.sync_from_google_sheet_csv()
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

@app.on_event("startup")
async def on_startup():
    # Sync latest Google Sheet on server startup
    print("[Startup] Triggering initial Google Sheet sync in background...")
    trigger_background_sheet_sync()
    threading.Thread(target=background_periodic_sync, daemon=True).start()

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
    note: Optional[str] = None
    updated_by: Optional[str] = "Web Editor"
    password: Optional[str] = None
    sheet_url: Optional[str] = None

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
        "phases": phases
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

@app.get("/api/phases")
async def get_phases():
    return engine.get_phase_summary()

@app.post("/api/update-milestone")
async def update_milestone(req: MilestoneUpdateRequest):
    # 1. Verify Password: Allow 'KPGEditor' OR LINE LIFF submissions
    is_liff = (req.updated_by == "LINE LIFF User" or "LINE" in (req.updated_by or ""))
    is_valid_pwd = (req.password == EDITOR_PASSWORD)
    
    if not (is_valid_pwd or is_liff):
        raise HTTPException(
            status_code=401, 
            detail="รหัสผ่านไม่ถูกต้อง! กรุณาใส่รหัสผ่าน 'KPGEditor' เพื่อยืนยันการแก้ไขข้อมูล"
        )
    
    pct = req.actual_pct
    if pct > 1.0:
        pct = pct / 100.0
    
    success = engine.update_milestone(
        project_id=req.project_id,
        milestone_name=req.milestone_name,
        actual_pct=pct,
        actual_start=req.actual_start,
        actual_finish=req.actual_finish
    )
    
    if not success:
        raise HTTPException(status_code=400, detail="Failed to update milestone. Check project_id and milestone_name.")
    
    updated_project = engine.projects_dict[req.project_id]
    
    # 2. Write-back to Google Sheet via Google Apps Script Web App
    gsheet_synced = False
    gsheet_msg = ""
    target_write_url = req.sheet_url or getattr(engine, "google_sheet_webapp_url", "") or DEFAULT_WEBAPP_URL
    
    if "script.google.com" in target_write_url:
        try:
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
                "updated_by": req.updated_by or "Web Editor",
                "note": req.note or "อัปเดตผ่านระบบ (KPGreenergy Planner)"
            }
            gs_resp = requests.post(target_write_url, json=payload, timeout=12, allow_redirects=True)
            if gs_resp.status_code == 200:
                try:
                    res_json = gs_resp.json()
                    if res_json.get("status") == "success":
                        gsheet_synced = True
                        gsheet_msg = " และบันทึกลง Google Sheet เรียบร้อยแล้ว ✅"
                    else:
                        gsheet_msg = f" (Google Sheet แจ้ง: {res_json.get('message')})"
                except:
                    gsheet_synced = True
                    gsheet_msg = " และส่งข้อมูลไปยัง Google Sheet เรียบร้อยแล้ว ✅"
            else:
                gsheet_msg = f" (Google Sheet ตอบกลับสถานะ {gs_resp.status_code})"
        except Exception as e:
            print(f"Warning: Failed to write to Google Sheet Web App: {e}")
            gsheet_msg = f" (ไม่สามารถเขียนลงชีตได้: {str(e)})"

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
    try:
        body = await request.json()
    except:
        body = {}
    
    action = body.get("action") or body.get("event") or ""
    
    if action in ["update_milestone", "save_progress"]:
        p_id = body.get("project_id")
        p_order = str(body.get("order_no") or "").strip()
        p_name = str(body.get("project_name", "")).strip().lower()
        m_name = str(body.get("milestone_name", "")).strip()
        m_idx = body.get("milestone_index")
        pct = float(body.get("actual_pct", 0.0))
        if pct > 1.0:
            pct = pct / 100.0
        
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
            return {
                "status": "ok",
                "updated": eng_res,
                "project_id": p_id,
                "project_name": engine.projects_dict[p_id]["name"],
                "milestone": m_name,
                "milestone_index": m_idx,
                "actual_progress_pct": engine.projects_dict[p_id]["actual_progress_pct"],
                "version": DATA_VERSION
            }

    if action in ["sheet_edited", "on_edit"]:
        p_order = str(body.get("order_no") or "").strip()
        p_name = str(body.get("project_name", "")).strip().lower()
        m_name = str(body.get("milestone_name", "")).strip()
        m_idx = body.get("milestone_index")
        val_str = str(body.get("new_value", body.get("actual_pct", "0"))).replace("%", "").strip()
        try:
            val_pct = float(val_str)
            if val_pct > 1.0:
                val_pct = val_pct / 100.0
        except:
            val_pct = 0.0
            
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

        headers = {"User-Agent": "Mozilla/5.0"}
        try:
            resp = requests.get(raw_url, headers=headers, timeout=12, allow_redirects=True)
        except Exception as net_err:
            raise HTTPException(status_code=502, detail=f"ไม่สามารถเชื่อมต่อ Web App URL: {str(net_err)}")
            
        content_type = resp.headers.get("Content-Type", "")
        if "accounts.google.com" in resp.url or ("text/html" in content_type and "<!DOCTYPE html>" in resp.text):
            raise HTTPException(
                status_code=403,
                detail="Google Sheet ติดสิทธิ์การเข้าถึง! คุณสามารถใส่ 'ลิงก์ของ Google Sheet' ปกติ (https://docs.google.com/spreadsheets/d/...) แทนได้เลยครับ สะดวกและเร็วกว่า"
            )
            
        try:
            data = resp.json()
        except:
            raise HTTPException(status_code=422, detail="ข้อมูลที่ตอบกลับไม่ใช่ JSON ลองวางลิงก์ Google Sheet แทน")
            
        projects_from_sheet = data.get("projects", [])
        updated_count = 0
        for p_sheet in projects_from_sheet:
            p_name = p_sheet.get("name", "").strip().lower()
            for p_eng in engine.projects:
                if p_eng["name"].strip().lower() == p_name:
                    for m_s in p_sheet.get("milestones", []):
                        m_name = m_s.get("name")
                        act_pct = float(m_s.get("actual_pct", 0.0))
                        for m in p_eng.get("milestones", []):
                            if m["name"].strip().lower() == m_name.strip().lower():
                                m["actual_pct"] = max(0.0, min(1.0, act_pct))
                                if m_s.get("actual_start"):
                                    m["actual_start"] = m_s.get("actual_start")
                                if m_s.get("actual_finish"):
                                    m["actual_finish"] = m_s.get("actual_finish")
                                m["status"] = "COMPLETED" if m["actual_pct"] >= 1.0 else ("IN_PROGRESS" if m["actual_pct"] > 0 else "PENDING")
                                m["actual_contribution"] = round(m["actual_pct"] * m["weight"], 4)
                                break
                    
                    total_act = sum(m["actual_contribution"] for m in p_eng["milestones"])
                    p_eng["actual_progress_pct"] = round(min(100.0, total_act * 100), 2)
                    p_eng["variance_pct"] = round(p_eng["actual_progress_pct"] - p_eng["planned_progress_pct"], 2)
                    if p_eng["actual_progress_pct"] >= 99.9:
                        p_eng["status"] = "COMPLETED"
                        p_eng["status_th"] = "เสร็จสมบูรณ์"
                    elif p_eng["variance_pct"] >= 0:
                        p_eng["status"] = "ON_TRACK"
                        p_eng["status_th"] = "ตามแผนงาน"
                    elif p_eng["variance_pct"] >= -10:
                        p_eng["status"] = "SLIGHT_DELAY"
                        p_eng["status_th"] = "ล่าช้าเล็กน้อย"
                    else:
                        p_eng["status"] = "DELAYED"
                        p_eng["status_th"] = "ล่าช้ากว่าแผน"
                        
                    p_eng["s_curve"] = engine.generate_project_scurve(p_eng)
                    updated_count += 1
                    break
                    
        engine.save_to_cache()
        return {
            "success": True, 
            "message": f"ซิงค์ข้อมูลจาก Google Sheets สำเร็จเรียบร้อยแล้ว ({updated_count} โครงการ)"
        }
        
    except HTTPException:
        raise
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
    uvicorn.run(app, host="0.0.0.0", port=port)
