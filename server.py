import os
import json
import re
import csv
import io
import time
import asyncio
import urllib.request
import requests
from datetime import datetime, date
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from engine import ProjectEngine

app = FastAPI(title="KPGreenergy Planner", version="1.0.0")

# Security Password for editing
EDITOR_PASSWORD = "KPGEditor"

# Enable GZip Compression (Reduces network payload by ~90%)
app.add_middleware(GZipMiddleware, minimum_size=500)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Hardcoded Google Apps Script & Sheet 2-Way Sync URLs
DEFAULT_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbyXXxkATGwPOWbbGGJniiP8FTgr77QnR3VJHur5Sf_5-51fIhV2smCGEwCbqpmF8i3x/exec"
DEFAULT_GSHEET_URL = "https://docs.google.com/spreadsheets/d/1yCL9cvdxc26EPURkLxws937ZaLFIjI3XSHwQFel-JgE/edit?usp=sharing"

# Initialize Engine
engine = ProjectEngine()
if not getattr(engine, "google_sheet_webapp_url", None) or not engine.google_sheet_webapp_url:
    engine.google_sheet_webapp_url = DEFAULT_WEBAPP_URL
if not getattr(engine, "google_sheet_url", None) or not engine.google_sheet_url:
    engine.google_sheet_url = DEFAULT_GSHEET_URL

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

# Background Non-Blocking Auto-Sync Worker
def _fetch_and_apply_google_sheet():
    url = getattr(engine, "google_sheet_webapp_url", "") or os.environ.get("GOOGLE_SHEET_URL", "") or os.environ.get("WEBAPP_URL", "")
    if not url:
        return
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as response:
            res_text = response.read().decode('utf-8')
            data = json.loads(res_text)
            
        projects_from_sheet = data.get("projects", [])
        if not projects_from_sheet:
            return
            
        updated = False
        for idx, p_sheet in enumerate(projects_from_sheet):
            sheet_order = str(p_sheet.get("order_no", "")).strip()
            
            # Match project by index (1-to-1) or order_no
            target_p = None
            if idx < len(engine.projects):
                target_p = engine.projects[idx]
            else:
                for p in engine.projects:
                    if str(p.get("order_no", "")).strip() == sheet_order:
                        target_p = p
                        break
            
            if target_p:
                for m_idx, m_s in enumerate(p_sheet.get("milestones", [])):
                    act_pct = float(m_s.get("actual_pct", 0.0))
                    target_m = None
                    if m_idx < len(target_p.get("milestones", [])):
                        target_m = target_p["milestones"][m_idx]
                    else:
                        m_name = str(m_s.get("name", "")).strip().lower()
                        for m in target_p.get("milestones", []):
                            if m["name"].strip().lower() == m_name:
                                target_m = m
                                break
                    
                    if target_m:
                        target_m["actual_pct"] = max(0.0, min(1.0, act_pct))
                        if m_s.get("actual_start"):
                            target_m["actual_start"] = m_s.get("actual_start")
                        if m_s.get("actual_finish"):
                            target_m["actual_finish"] = m_s.get("actual_finish")
                        target_m["status"] = "COMPLETED" if target_m["actual_pct"] >= 1.0 else ("IN_PROGRESS" if target_m["actual_pct"] > 0 else "PENDING")
                        target_m["actual_contribution"] = round(target_m["actual_pct"] * target_m["weight"], 4)
                
                total_act = sum(m["actual_contribution"] for m in target_p["milestones"])
                target_p["actual_progress_pct"] = round(min(100.0, total_act * 100), 2)
                target_p["variance_pct"] = round(target_p["actual_progress_pct"] - target_p["planned_progress_pct"], 2)
                if target_p["actual_progress_pct"] >= 99.9:
                    target_p["status"] = "COMPLETED"
                    target_p["status_th"] = "เสร็จสมบูรณ์"
                elif target_p["variance_pct"] >= 0:
                    target_p["status"] = "ON_TRACK"
                    target_p["status_th"] = "ตามแผนงาน"
                elif target_p["variance_pct"] >= -10:
                    target_p["status"] = "SLIGHT_DELAY"
                    target_p["status_th"] = "ล่าช้าเล็กน้อย"
                else:
                    target_p["status"] = "DELAYED"
                    target_p["status_th"] = "ล่าช้ากว่าแผน"
                    
                target_p["s_curve"] = engine.generate_project_scurve(target_p)
                updated = True
                
        if updated:
            engine.save_to_cache()
            print(f"[Auto-Sync] Successfully synchronized {len(projects_from_sheet)} projects from Google Sheet.")
    except Exception as e:
        print(f"[Auto-Sync Notice] {e}")

async def auto_sync_worker():
    while True:
        await asyncio.sleep(180) # Auto check every 3 mins quietly
        await asyncio.to_thread(_fetch_and_apply_google_sheet)

@app.on_event("startup")
async def on_startup():
    asyncio.create_task(asyncio.to_thread(_fetch_and_apply_google_sheet))
    asyncio.create_task(auto_sync_worker())

# API Endpoints (Instant <5ms memory response)
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
            "status_th": p["status_th"],
            "s_curve": p.get("s_curve", {}),
            "milestones": p.get("milestones", [])
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
    
    # 2. Record in Activity Audit Log
    source_name = "LINE LIFF" if is_liff else "Web Dashboard"
    engine.log_activity(
        project_id=updated_project["id"],
        project_name=updated_project["name"],
        milestone_name=req.milestone_name,
        actual_pct=pct,
        actual_start=req.actual_start,
        actual_finish=req.actual_finish,
        updated_by=req.updated_by or "Web Editor",
        note=req.note or f"อัปเดตความก้าวหน้า {pct*100:.1f}%",
        source=source_name
    )
    
    # 3. Write-back to Google Sheet via Google Apps Script Web App
    gsheet_synced = False
    gsheet_msg = ""
    target_write_url = req.sheet_url or getattr(engine, "google_sheet_webapp_url", "") or ""
    
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
                "order_no": str(updated_project.get("order_no", "")),
                "project_name": updated_project["name"],
                "milestone_name": req.milestone_name,
                "milestone_index": m_idx,
                "actual_pct": pct,
                "actual_start": req.actual_start or "",
                "actual_finish": req.actual_finish or "",
                "updated_by": req.updated_by or "Web Editor",
                "note": req.note or "อัปเดตผ่านระบบ (KPGreenergy Planner)"
            }
            # Attempt 1: Direct JSON POST
            gs_resp = requests.post(target_write_url, json=payload, timeout=12, allow_redirects=True)
            if gs_resp.status_code == 200:
                try:
                    res_json = gs_resp.json()
                    if res_json.get("status") == "success":
                        gsheet_synced = True
                        gsheet_msg = " และบันทึกลง Google Sheet เรียบร้อยแล้ว ✅"
                except:
                    pass
            
            # Attempt 2: GET query params fallback
            if not gsheet_synced:
                params = {
                    "action": "update_milestone",
                    "project_id": updated_project["id"],
                    "order_no": str(updated_project.get("order_no", "")),
                    "project_name": updated_project["name"],
                    "milestone_name": req.milestone_name,
                    "milestone_index": str(m_idx),
                    "actual_pct": str(pct),
                    "actual_start": req.actual_start or "",
                    "actual_finish": req.actual_finish or "",
                    "updated_by": req.updated_by or "Web Editor"
                }
                gs_resp_get = requests.get(target_write_url, params=params, timeout=12, allow_redirects=True)
                if gs_resp_get.status_code == 200:
                    gsheet_synced = True
                    gsheet_msg = " และบันทึกลง Google Sheet เรียบร้อยแล้ว ✅"
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
        p_name = body.get("project_name", "").strip().lower()
        m_name = body.get("milestone_name", "").strip()
        pct = float(body.get("actual_pct", 0.0))
        if pct > 1.0:
            pct = pct / 100.0
        
        if not p_id and p_name:
            for p in engine.projects:
                if p["name"].strip().lower() == p_name:
                    p_id = p["id"]
                    break
        
        if p_id:
            eng_res = engine.update_milestone(
                project_id=p_id,
                milestone_name=m_name,
                actual_pct=pct,
                actual_start=body.get("actual_start"),
                actual_finish=body.get("actual_finish")
            )
            p_obj = engine.projects_dict.get(p_id, {})
            engine.log_activity(
                project_id=p_id,
                project_name=p_obj.get("name", p_name),
                milestone_name=m_name,
                actual_pct=pct,
                actual_start=body.get("actual_start"),
                actual_finish=body.get("actual_finish"),
                updated_by=body.get("updated_by", "Webhook API"),
                note=body.get("note", "อัปเดตผ่าน Webhook"),
                source="Webhook"
            )
            return {"status": "ok", "updated": eng_res, "project_id": p_id}

    if action in ["sheet_edited", "on_edit"]:
        p_name = str(body.get("project_name", "")).strip().lower()
        m_name = str(body.get("milestone_name", "")).strip()
        val_str = str(body.get("new_value", "0")).replace("%", "").strip()
        try:
            val_pct = float(val_str)
            if val_pct > 1.0:
                val_pct = val_pct / 100.0
        except:
            val_pct = 0.0
            
        p_id = None
        for p in engine.projects:
            if p["name"].strip().lower() == p_name or p_name in p["name"].strip().lower():
                p_id = p["id"]
                break
                
        if p_id and m_name:
            eng_res = engine.update_milestone(
                project_id=p_id,
                milestone_name=m_name,
                actual_pct=val_pct
            )
            p_obj = engine.projects_dict.get(p_id, {})
            engine.log_activity(
                project_id=p_id,
                project_name=p_obj.get("name", p_name),
                milestone_name=m_name,
                actual_pct=val_pct,
                updated_by="Google Sheet Edit",
                note=f"แก้ไขผ่านเซลล์ใน Google Sheet ({val_pct*100:.1f}%)",
                source="Google Sheet"
            )
            return {"status": "ok", "updated": eng_res, "project_id": p_id, "new_pct": val_pct}
            
    return {"status": "received", "body": body}

@app.post("/api/sync-google-sheet")
async def sync_google_sheet(request: Request):
    try:
        body = await request.json()
        raw_url = body.get("sheet_url", "").strip()
        if not raw_url:
            raise HTTPException(status_code=400, detail="กรุณาระบุลิงก์ Google Sheet")
        
        sheet_match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', raw_url)
        if sheet_match:
            sheet_id = sheet_match.group(1)
            prog_csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet=data%20Progress"
            headers = {"User-Agent": "Mozilla/5.0"}
            
            try:
                r_prog = requests.get(prog_csv_url, headers=headers, timeout=12)
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"ไม่สามารถเชื่อมต่อ Google Sheets: {str(e)}")
                
            if r_prog.status_code != 200 or ("html" in r_prog.headers.get("Content-Type", "") and "<html" in r_prog.text.lower()):
                raise HTTPException(
                    status_code=403, 
                    detail="Google Sheet ยังไม่ได้เปิดสิทธิ์แชร์! กรุณาเปิด Google Sheet กดปุ่ม 'แชร์ (Share)' ด้านบนขวา > เลือก 'ทุกคนที่มีลิงก์ (Anyone with link)' ให้เป็น 'ผู้มีสิทธิ์อ่าน (Viewer)' แล้วกดซิงค์ใหม่อีกครั้งครับ"
                )
                
            csv_text = r_prog.text
            reader = list(csv.reader(io.StringIO(csv_text)))
            if len(reader) < 2:
                raise HTTPException(status_code=400, detail="ไม่พบข้อมูลโครงการในชีต 'data Progress'")
                
            m_names = [m['name'] for m in engine.projects[0]['milestones']] if engine.projects else []
            updated_count = engine.batch_sync_from_sheet_data(reader[1:], m_names)
            
            return {
                "success": True, 
                "message": f"ซิงค์ข้อมูลจาก Google Sheets สำเร็จเรียบร้อยแล้ว ({updated_count} โครงการ)"
            }

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
    return {"webapp_url": getattr(engine, "google_sheet_webapp_url", "")}

@app.get("/api/activity-logs")
async def get_activity_logs_endpoint(limit: int = 50, project_id: Optional[str] = None):
    logs = engine.get_activity_logs(limit=limit, project_id=project_id)
    return {"count": len(logs), "logs": logs}

@app.get("/api/export-csv")
async def export_csv_endpoint():
    rows = engine.generate_export_rows()
    if not rows:
        raise HTTPException(status_code=404, detail="No project data available to export")
    
    output = io.StringIO()
    # Write UTF-8 BOM so Excel opens Thai characters seamlessly
    output.write('\ufeff')
    fieldnames = list(rows[0].keys())
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    
    csv_content = output.getvalue()
    today_str = date.today().strftime('%Y-%m-%d')
    filename = f"KPGreenergy_137_Projects_Export_{today_str}.csv"
    
    return Response(
        content=csv_content.encode('utf-8-sig'),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/export-data")
async def export_data_endpoint():
    rows = engine.generate_export_rows()
    return {"total_projects": len(rows), "rows": rows}

@app.get("/api/cctv-config")
async def get_cctv_config_endpoint(project_id: Optional[str] = None):
    return engine.get_cctv_config(project_id=project_id)

class CctvConfigRequest(BaseModel):
    project_id: Optional[str] = "default"
    cameras: List[dict]

@app.post("/api/cctv-config")
async def save_cctv_config_endpoint(req: CctvConfigRequest):
    success = engine.save_cctv_config(project_id=req.project_id or "default", cameras=req.cameras)
    if success:
        return {"success": True, "message": "บันทึกการตั้งค่ากล้อง CCTV เรียบร้อยแล้ว"}
    raise HTTPException(status_code=500, detail="Failed to save CCTV config")

@app.get("/api/backups")
async def get_backups_endpoint():
    backups = engine.list_backups()
    return {"count": len(backups), "backups": backups}

@app.post("/api/backups")
async def create_backup_endpoint():
    fname = engine.create_backup_snapshot()
    if fname:
        return {"success": True, "message": f"สร้าง Backup สำเร็จ: {fname}", "filename": fname}
    raise HTTPException(status_code=500, detail="Failed to create backup")

@app.get("/api/line-flex-preview")
async def get_line_flex_preview(project_id: Optional[str] = None, milestone_name: Optional[str] = None):
    prj = None
    if project_id and project_id in engine.projects_dict:
        prj = engine.projects_dict[project_id]
    elif engine.projects:
        prj = engine.projects[0]
        
    p_name = prj["name"] if prj else "โครงการโซลาร์"
    p_lot = prj["lot"] if prj else "Lot 1"
    p_act = prj["actual_progress_pct"] if prj else 0.0
    p_plan = prj["planned_progress_pct"] if prj else 0.0
    p_status = prj["status_th"] if prj else "ตามแผนงาน"
    m_name = milestone_name or "Soiling Test"
    
    flex_payload = {
        "type": "flex",
        "altText": f"⚡ รายงานความก้าวหน้า: {p_name}",
        "contents": {
            "type": "bubble",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#043327",
                "paddingAll": "16px",
                "contents": [
                    {
                        "type": "text",
                        "text": "⚡ KPGreenergy Planner",
                        "weight": "bold",
                        "color": "#f59e0b",
                        "size": "sm"
                    },
                    {
                        "type": "text",
                        "text": p_name,
                        "weight": "bold",
                        "color": "#ffffff",
                        "size": "lg",
                        "wrap": True,
                        "margin": "xs"
                    },
                    {
                        "type": "text",
                        "text": f"เฟส: {p_lot} | สถานะ: {p_status}",
                        "color": "#a7f3d0",
                        "size": "xs",
                        "margin": "xs"
                    }
                ]
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "md",
                "contents": [
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {"type": "text", "text": "ความก้าวหน้าจริง", "size": "xs", "color": "#64748b", "flex": 1},
                            {"type": "text", "text": f"{p_act}%", "size": "sm", "weight": "bold", "color": "#059669", "align": "end"}
                        ]
                    },
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {"type": "text", "text": "แผนงานสะสม", "size": "xs", "color": "#64748b", "flex": 1},
                            {"type": "text", "text": f"{p_plan}%", "size": "sm", "weight": "bold", "color": "#2563eb", "align": "end"}
                        ]
                    },
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {"type": "text", "text": "รายการงานล่าสุด", "size": "xs", "color": "#64748b", "flex": 1},
                            {"type": "text", "text": m_name, "size": "xs", "weight": "bold", "color": "#0f172a", "align": "end"}
                        ]
                    }
                ]
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "spacing": "sm",
                "contents": [
                    {
                        "type": "button",
                        "style": "primary",
                        "color": "#043327",
                        "action": {
                            "type": "uri",
                            "label": "เปิดดูรายละเอียดโครงการ",
                            "uri": "https://kpgreenergy-planner.onrender.com"
                        }
                    }
                ]
            }
        }
    }
    return {"flex_message": flex_payload}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
