import os
import json
import time
import openpyxl
from datetime import datetime, date, timedelta
from typing import Dict, List, Any, Optional

EXCEL_PATH = os.environ.get('EXCEL_PATH', os.path.join(os.path.dirname(__file__), 'Weekly Progress R2.xlsx'))
CACHE_PATH = os.path.join(os.path.dirname(__file__), 'data_cache.json')
BACKUP_CACHE_PATH = os.path.join(os.path.dirname(__file__), 'data_cache_backup.json')
DEFAULT_SHEET_ID = os.environ.get('GOOGLE_SHEET_ID', '1ERBqRnmVGYi7JCqzqTbJMmeh41ShAHWfBmLJW96IC7Y')
DEFAULT_WEBAPP_URL = os.environ.get(
    'DEFAULT_WEBAPP_URL',
    'https://script.google.com/macros/s/AKfycbx139TsQvyxZslZKF0wmHRI0EuXWaRVaU0Vt5TthJvyWevkMCZ57S_alqHTOgELQEMs4A/exec'
)

def format_date(dt):
    if dt is None or dt == "-" or dt == "":
        return None
    if isinstance(dt, (datetime, date)):
        return dt.strftime('%Y-%m-%d')
    if isinstance(dt, str):
        try:
            return dt[:10]
        except:
            return None
    return None

def parse_date(d_str):
    if not d_str or d_str in ("-", "", "None"):
        return None
    if isinstance(d_str, (datetime, date)):
        if isinstance(d_str, datetime):
            return d_str.date()
        return d_str
    if isinstance(d_str, str):
        clean_str = d_str.strip()
        for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%d/%m/%Y', '%d/%m/%y', '%m/%d/%Y', '%m/%d/%y', 
                    '%d-%m-%Y', '%d-%m-%y', '%Y-%m-%d %H:%M:%S'):
            try:
                res_date = datetime.strptime(clean_str, fmt).date()
                if res_date.year > 2400:  # Buddhist era year (e.g. 2568 -> 2025)
                    res_date = res_date.replace(year=res_date.year - 543)
                elif res_date.year < 1000:  # Typo correction (e.g. 0206 -> 2026)
                    res_date = res_date.replace(year=2026 if res_date.year in (206, 26) else res_date.year + 2000)
                return res_date
            except ValueError:
                pass
    return None

def safe_parse_progress_pct(val, fallback: float = 0.0) -> float:
    """
    Safely parse percentage in all possible formats without wiping to 0.0%.
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

class ProjectEngine:
    @staticmethod
    def is_cc_project(p: dict) -> bool:
        lot = str(p.get("lot", "")).strip().upper()
        name = str(p.get("name", "")).strip().upper()
        status = str(p.get("status", "")).strip().upper()
        return lot.startswith("CC") or " CC" in name or name.endswith("CC") or "ยกเลิก" in name or "CANCEL" in status

    def __init__(self, excel_path: str = EXCEL_PATH, cache_path: str = CACHE_PATH):
        self.excel_path = excel_path
        self.cache_path = cache_path
        self.backup_path = os.path.join(os.path.dirname(cache_path), 'data_cache_backup.json')
        self.weight_matrix = {}
        self.milestone_names = []
        self.milestone_categories = {}
        self.all_projects = []
        self.active_projects = []
        self.projects = []
        self.projects_dict = {}
        self.google_sheet_webapp_url = ''
        self.issues_path = os.path.join(os.path.dirname(cache_path), 'issues_cache.json')
        self.issues = []
        self.photos_path = os.path.join(os.path.dirname(cache_path), 'photos_cache.json')
        self.photos = {}
        
        # Load from cache first
        if not self.load_from_cache():
            if os.path.exists(self.excel_path):
                self.load_data_from_excel()
                self.save_to_cache()
            else:
                print(f"[Engine Warning] Neither valid cache nor Excel file found.")
        self.load_issues_cache()
        self.load_photos_cache()

    def load_from_cache(self) -> bool:
        # Try primary cache
        for path in [self.cache_path, self.backup_path]:
            if os.path.exists(path):
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    
                    projects = data.get('projects', [])
                    if len(projects) > 0:
                        self.weight_matrix = {int(k): v for k, v in data.get('weight_matrix', {}).items()}
                        self.milestone_names = data.get('milestone_names', [])
                        self.milestone_categories = data.get('milestone_categories', {})
                        self.google_sheet_webapp_url = data.get('google_sheet_webapp_url') or DEFAULT_WEBAPP_URL
                        self.all_projects = projects
                        self.projects_dict = {p['id']: p for p in self.all_projects}
                        self.active_projects = [p for p in self.all_projects if not self.is_cc_project(p)]
                        self.projects = self.active_projects
                        print(f"[Fast Engine] Loaded {len(self.all_projects)} total projects ({len(self.active_projects)} active projects) successfully from {os.path.basename(path)}.")
                        return True
                except Exception as e:
                    print(f"[Engine] Error reading {path}: {e}")
        return False

    def save_to_cache(self):
        """
        Atomic cache saving to prevent any file corruption
        """
        try:
            self.active_projects = [p for p in self.all_projects if not self.is_cc_project(p)]
            self.projects = self.active_projects
            data = {
                'weight_matrix': self.weight_matrix,
                'milestone_names': self.milestone_names,
                'milestone_categories': self.milestone_categories,
                'projects': self.all_projects,
                'google_sheet_webapp_url': self.google_sheet_webapp_url
            }
            tmp_path = self.cache_path + '.tmp'
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False)
            
            # Atomic replace
            os.replace(tmp_path, self.cache_path)
            
            # Also keep a backup
            try:
                import shutil
                shutil.copyfile(self.cache_path, self.backup_path)
            except:
                pass
                
        except Exception as e:
            print(f"[Engine] Failed to save cache: {e}")

    def load_data_from_excel(self):
        if not os.path.exists(self.excel_path):
            print(f"File not found: {self.excel_path}")
            return

        print(f"[Engine] Reading Excel: {self.excel_path}...")
        wb = openpyxl.load_workbook(self.excel_path, data_only=True)
        self._load_weights(wb)
        self._load_projects(wb)
        self._calculate_all_scurves()

    def _load_weights(self, wb):
        if 'Weight Prj' not in wb.sheetnames:
            return
        ws = wb['Weight Prj']
        type_cols = {}
        for col in range(4, ws.max_column + 1):
            t_val = ws.cell(row=4, column=col).value
            if t_val is not None:
                try:
                    type_num = int(t_val)
                    type_cols[type_num] = col
                    if type_num not in self.weight_matrix:
                        self.weight_matrix[type_num] = {}
                except:
                    pass

        current_category = "งานขออนุญาตราชการ (Permission)"
        for r in range(6, ws.max_row + 1):
            c_name = ws.cell(row=r, column=2).value
            plan_act = ws.cell(row=r, column=3).value
            
            if c_name:
                c_name_str = str(c_name).strip()
                if "Engineering Design" in c_name_str:
                    current_category = "งานออกแบบวิศวกรรม (Engineering Design)"
                    continue
                elif "Construction Work" in c_name_str:
                    current_category = "งานก่อสร้างและติดตั้ง (Construction Work)"
                    continue
                elif "ราชการ" in c_name_str:
                    current_category = "งานขออนุญาตราชการ (Permission)"
                    continue
                
                if plan_act and str(plan_act).strip().upper() == "PLAN":
                    m_name = c_name_str
                    if m_name not in self.milestone_names:
                        self.milestone_names.append(m_name)
                        self.milestone_categories[m_name] = current_category
                    
                    for t_num, col_idx in type_cols.items():
                        w_val = ws.cell(row=r, column=col_idx).value
                        try:
                            w_float = float(w_val) if w_val is not None else 0.0
                        except:
                            w_float = 0.0
                        self.weight_matrix[t_num][m_name] = w_float

    def _load_projects(self, wb):
        plan_sheet_name = next((s for s in ['MASTER', 'Master', 'Plan', 'PLAN', 'Master Plan'] if s in wb.sheetnames), None)
        if not plan_sheet_name:
            return
        
        ws_plan = wb[plan_sheet_name]
        prog_sheet_name = next((s for s in ['data Progress', 'Progress', 'PROGRESS', 'Data Progress'] if s in wb.sheetnames), None)
        ws_prog = wb[prog_sheet_name] if prog_sheet_name else None
        
        plan_milestones_cols = []
        c = 8
        while c <= ws_plan.max_column:
            m_title = ws_plan.cell(row=3, column=c).value
            if not m_title:
                m_title = ws_plan.cell(row=2, column=c).value
            
            if m_title:
                m_title = str(m_title).strip()
                plan_milestones_cols.append({
                    "name": m_title,
                    "start_col": c,
                    "finish_col": c + 1,
                    "weight_col": c + 2
                })
                if m_title.lower() == "punch list":
                    break
                c += 3
            else:
                c += 1

        prog_data_by_prj = {}
        if ws_prog:
            for r in range(6, ws_prog.max_row + 1):
                p_name = ws_prog.cell(row=r, column=4).value
                if p_name:
                    p_name_str = str(p_name).strip()
                    prog_data_by_prj[p_name_str] = {}
                    for m_info in plan_milestones_cols:
                        m_name = m_info["name"]
                        s_c = m_info["start_col"]
                        f_c = m_info["finish_col"]
                        p_c = m_info["weight_col"]
                        
                        act_start = ws_prog.cell(row=r, column=s_c).value if s_c <= ws_prog.max_column else None
                        act_finish = ws_prog.cell(row=r, column=f_c).value if f_c <= ws_prog.max_column else None
                        act_pct = ws_prog.cell(row=r, column=p_c).value if p_c <= ws_prog.max_column else None
                        
                        try:
                            act_pct_val = float(act_pct) if act_pct is not None and str(act_pct).strip() not in ("", "-") else 0.0
                            if act_pct_val > 1.0:
                                act_pct_val = act_pct_val / 100.0
                        except:
                            act_pct_val = 0.0

                        prog_data_by_prj[p_name_str][m_name] = {
                            "actual_start": format_date(act_start),
                            "actual_finish": format_date(act_finish),
                            "actual_pct": act_pct_val
                        }

        self.projects = []
        self.projects_dict = {}
        self.google_sheet_webapp_url = ''
        
        for r in range(6, ws_plan.max_row + 1):
            p_name = ws_plan.cell(row=r, column=3).value
            if not p_name:
                continue
            p_name_str = str(p_name).strip()
            if not p_name_str or p_name_str == "None":
                continue
            
            bu = ws_plan.cell(row=r, column=1).value or "ทั่วไป"
            order_no = ws_plan.cell(row=r, column=2).value
            lot = ws_plan.cell(row=r, column=4).value or "Lot 1"
            capacity = ws_plan.cell(row=r, column=5).value or 0.0
            installation = ws_plan.cell(row=r, column=6).value or "Solar Rooftop"
            type_code = ws_plan.cell(row=r, column=7).value or 1
            
            try:
                capacity = float(capacity)
            except:
                capacity = 0.0
                
            try:
                type_code = int(type_code)
            except:
                type_code = 1

            project_id = f"prj_{r-5:03d}"
            milestones = []
            total_planned_weight = 0.0
            total_actual_progress = 0.0
            
            min_plan_start = None
            max_plan_finish = None
            min_act_start = None
            max_act_finish = None
            
            for m_info in plan_milestones_cols:
                m_name = m_info["name"]
                p_start = ws_plan.cell(row=r, column=m_info["start_col"]).value
                p_finish = ws_plan.cell(row=r, column=m_info["finish_col"]).value
                p_w = ws_plan.cell(row=r, column=m_info["weight_col"]).value
                
                try:
                    p_weight = float(p_w) if p_w is not None and str(p_w).strip() not in ("", "-") else 0.0
                except:
                    p_weight = self.weight_matrix.get(type_code, {}).get(m_name, 0.0)
                
                if p_weight == 0.0 and m_name in self.weight_matrix.get(type_code, {}):
                    p_weight = self.weight_matrix[type_code][m_name]
                    
                total_planned_weight += p_weight
                
                p_start_str = format_date(p_start)
                p_finish_str = format_date(p_finish)
                p_s_date = parse_date(p_start_str)
                p_f_date = parse_date(p_finish_str)
                
                if p_s_date:
                    if min_plan_start is None or p_s_date < min_plan_start:
                        min_plan_start = p_s_date
                if p_f_date:
                    if max_plan_finish is None or p_f_date > max_plan_finish:
                        max_plan_finish = p_f_date

                act_data = prog_data_by_prj.get(p_name_str, {}).get(m_name, {})
                act_start_str = act_data.get("actual_start")
                act_finish_str = act_data.get("actual_finish")
                act_pct = act_data.get("actual_pct", 0.0)
                
                if act_finish_str and act_pct == 0.0:
                    act_pct = 1.0
                elif act_start_str and not act_finish_str and act_pct == 0.0:
                    act_pct = 0.5

                a_s_date = parse_date(act_start_str)
                a_f_date = parse_date(act_finish_str)
                
                if a_s_date:
                    if min_act_start is None or a_s_date < min_act_start:
                        min_act_start = a_s_date
                if a_f_date:
                    if max_act_finish is None or a_f_date > max_act_finish:
                        max_act_finish = a_f_date

                milestone_actual_contrib = act_pct * p_weight
                total_actual_progress += milestone_actual_contrib
                category = self.milestone_categories.get(m_name, "งานทั่วไป")

                milestones.append({
                    "name": m_name,
                    "category": category,
                    "weight": round(p_weight, 4),
                    "planned_start": p_start_str,
                    "planned_finish": p_finish_str,
                    "actual_start": act_start_str,
                    "actual_finish": act_finish_str,
                    "actual_pct": round(act_pct, 4),
                    "actual_contribution": round(milestone_actual_contrib, 4),
                    "status": "COMPLETED" if act_pct >= 1.0 else ("IN_PROGRESS" if act_pct > 0 else "PENDING")
                })

            today = date.today()
            total_planned_progress_today = 0.0
            for m in milestones:
                p_s = parse_date(m["planned_start"])
                p_f = parse_date(m["planned_finish"])
                w = m["weight"]
                if p_s and p_f and w > 0:
                    if today >= p_f:
                        total_planned_progress_today += w
                    elif today <= p_s:
                        total_planned_progress_today += 0.0
                    else:
                        total_days = (p_f - p_s).days or 1
                        elapsed_days = (today - p_s).days
                        pct = min(1.0, max(0.0, elapsed_days / total_days))
                        total_planned_progress_today += pct * w

            actual_pct_total = min(100.0, total_actual_progress * 100)
            planned_pct_today = min(100.0, total_planned_progress_today * 100)
            diff = actual_pct_total - planned_pct_today
            
            if actual_pct_total >= 99.9:
                status = "COMPLETED"
                status_th = "เสร็จสมบูรณ์"
            elif diff >= 0:
                status = "ON_TRACK"
                status_th = "ตามแผนงาน"
            elif diff >= -10:
                status = "SLIGHT_DELAY"
                status_th = "ล่าช้าเล็กน้อย"
            else:
                status = "DELAYED"
                status_th = "ล่าช้ากว่าแผน"

            prj_obj = {
                "id": project_id,
                "business_unit": str(bu).strip(),
                "order_no": order_no,
                "name": p_name_str,
                "lot": str(lot).strip(),
                "capacity_kwp": round(capacity, 2),
                "installation_type": str(installation).strip(),
                "type_code": type_code,
                "planned_start": str(min_plan_start) if min_plan_start else None,
                "planned_finish": str(max_plan_finish) if max_plan_finish else None,
                "actual_start": str(min_act_start) if min_act_start else None,
                "actual_finish": str(max_act_finish) if max_act_finish else None,
                "actual_progress_pct": round(actual_pct_total, 2),
                "planned_progress_pct": round(planned_pct_today, 2),
                "variance_pct": round(diff, 2),
                "status": status,
                "status_th": status_th,
                "milestones": milestones
            }
            
            self.projects.append(prj_obj)
            self.projects_dict[project_id] = prj_obj

    def _calculate_all_scurves(self):
        for prj in self.projects:
            prj["s_curve"] = self.generate_project_scurve(prj)

    def generate_project_scurve(self, prj: Dict[str, Any]) -> Dict[str, Any]:
        milestones = prj.get("milestones", [])
        all_dates = []
        for m in milestones:
            for d_field in ["planned_start", "planned_finish", "actual_start", "actual_finish"]:
                dt = parse_date(m.get(d_field))
                if dt and 2020 <= dt.year <= 2035:
                    all_dates.append(dt)
        
        if not all_dates:
            return {"weeks": [], "labels": [], "planned_cum": [], "actual_cum": [], "planned_weekly": [], "actual_weekly": []}

        min_d = min(all_dates)
        max_d = max(all_dates)
        start_monday = min_d - timedelta(days=min_d.weekday())
        end_monday = max_d + timedelta(days=(7 - max_d.weekday()) % 7)
        if (end_monday - start_monday).days < 28:
            end_monday = start_monday + timedelta(days=35)

        weeks = []
        labels = []
        curr = start_monday
        w_idx = 1
        while curr <= end_monday:
            weeks.append(curr)
            labels.append(f"W{w_idx} ({curr.strftime('%d/%m/%y')})")
            curr += timedelta(days=7)
            w_idx += 1

        num_weeks = len(weeks)
        weekly_planned = [0.0] * num_weeks
        weekly_actual = [0.0] * num_weeks
        
        for m in milestones:
            w = m["weight"]
            if w <= 0:
                continue
            ps = parse_date(m.get("planned_start"))
            pf = parse_date(m.get("planned_finish"))
            if not ps or not pf:
                continue
            
            covered_indices = []
            for i, w_monday in enumerate(weeks):
                w_sunday = w_monday + timedelta(days=6)
                if not (pf < w_monday or ps > w_sunday):
                    covered_indices.append(i)
            
            if covered_indices:
                w_inc = w / len(covered_indices)
                for i in covered_indices:
                    weekly_planned[i] += w_inc

            act_pct = m.get("actual_pct", 0.0)
            if act_pct > 0:
                act_w = act_pct * w
                as_d = parse_date(m.get("actual_start")) or ps
                af_d = parse_date(m.get("actual_finish")) or date.today()
                
                act_covered_indices = []
                for i, w_monday in enumerate(weeks):
                    w_sunday = w_monday + timedelta(days=6)
                    if not (af_d < w_monday or as_d > w_sunday):
                        act_covered_indices.append(i)
                
                if act_covered_indices:
                    act_inc = act_w / len(act_covered_indices)
                    for i in act_covered_indices:
                        weekly_actual[i] += act_inc

        planned_cum = []
        actual_cum = []
        cum_p = 0.0
        cum_a = 0.0
        today = date.today()
        
        for i, w_monday in enumerate(weeks):
            cum_p += weekly_planned[i] * 100.0
            planned_cum.append(round(min(100.0, cum_p), 2))
            
            if w_monday <= today + timedelta(days=7):
                cum_a += weekly_actual[i] * 100.0
                actual_cum.append(round(min(100.0, cum_a), 2))
            else:
                actual_cum.append(None)

        return {
            "weeks": [w.strftime('%Y-%m-%d') for w in weeks],
            "labels": labels,
            "planned_cum": planned_cum,
            "actual_cum": actual_cum,
            "planned_weekly": [round(x * 100, 2) for x in weekly_planned],
            "actual_weekly": [round(x * 100, 2) for x in weekly_actual]
        }

    def get_phase_summary(self) -> List[Dict[str, Any]]:
        phases = {}
        for prj in self.projects:
            lot = prj.get("lot", "Other")
            if lot not in phases:
                phases[lot] = {
                    "lot": lot,
                    "project_count": 0,
                    "total_capacity_kwp": 0.0,
                    "actual_progress_weighted": 0.0,
                    "planned_progress_weighted": 0.0,
                    "projects": [],
                    "completed_count": 0,
                    "delayed_count": 0,
                    "on_track_count": 0
                }
            
            p = phases[lot]
            cap = prj.get("capacity_kwp", 0.0)
            p["project_count"] += 1
            p["total_capacity_kwp"] += cap
            p["actual_progress_weighted"] += prj.get("actual_progress_pct", 0.0) * cap
            p["planned_progress_weighted"] += prj.get("planned_progress_pct", 0.0) * cap
            p["projects"].append({
                "id": prj["id"],
                "name": prj["name"],
                "business_unit": prj["business_unit"],
                "capacity_kwp": cap,
                "installation_type": prj["installation_type"],
                "actual_progress_pct": prj["actual_progress_pct"],
                "planned_progress_pct": prj["planned_progress_pct"],
                "variance_pct": prj["variance_pct"],
                "status": prj["status"],
                "status_th": prj["status_th"]
            })
            
            if prj["status"] == "COMPLETED":
                p["completed_count"] += 1
            elif prj["status"] == "DELAYED":
                p["delayed_count"] += 1
            else:
                p["on_track_count"] += 1

        result = []
        for lot, data in phases.items():
            cap = data["total_capacity_kwp"]
            if cap > 0:
                data["avg_actual_progress"] = round(data["actual_progress_weighted"] / cap, 2)
                data["avg_planned_progress"] = round(data["planned_progress_weighted"] / cap, 2)
            else:
                data["avg_actual_progress"] = 0.0
                data["avg_planned_progress"] = 0.0
            data["total_capacity_kwp"] = round(data["total_capacity_kwp"], 2)
            result.append(data)
            
        return sorted(result, key=lambda x: x["lot"])

    def calculate_planned_progress_today(self, milestones: list) -> float:
        """
        Calculates the expected cumulative planned progress percentage as of today
        based on the milestone schedule and weights.
        """
        today = date.today()
        total_planned = 0.0
        for m in milestones:
            p_s = parse_date(m.get("planned_start"))
            p_f = parse_date(m.get("planned_finish"))
            w = m.get("weight", 0.0)
            if p_s and p_f and w > 0:
                if today >= p_f:
                    total_planned += w
                elif today <= p_s:
                    total_planned += 0.0
                else:
                    total_days = (p_f - p_s).days or 1
                    elapsed_days = (today - p_s).days
                    pct = min(1.0, max(0.0, elapsed_days / total_days))
                    total_planned += pct * w
        return round(min(100.0, total_planned * 100.0), 2)

    def resolve_type_code(self, installation_type: str, capacity_kwp: float, voltage_level: str = "LV") -> int:
        """
        Resolves the 1..42 Type Code according to sheet 'Cal Progress' based on:
        - Installation Type (Roof, Car park, Farm, Floating, Fishery)
        - Voltage Level (LV vs MV)
        - Capacity (kWp) - Tier 1 (<250), Tier 2 (250-999), Tier 3 (>=1000)
        """
        it = str(installation_type or '').strip().lower()
        cap = float(capacity_kwp or 100.0)
        vl = str(voltage_level or 'LV').strip().upper()
        is_mv = (vl == 'MV')

        if 'roof' in it and 'car' not in it:
            if not is_mv:
                return 1 if cap < 250 else (2 if cap < 1000 else 3)
            else:
                return 22 if cap < 250 else (23 if cap < 1000 else 24)
        elif 'car' in it:
            if not is_mv:
                return 19 if cap < 250 else (20 if cap < 1000 else 21)
            else:
                return 40 if cap < 250 else (41 if cap < 1000 else 42)
        elif 'farm' in it and 'float' not in it:
            if not is_mv:
                return 4 if cap < 250 else (7 if cap < 1000 else 8)
            else:
                return 25 if cap < 250 else (28 if cap < 1000 else 29)
        elif 'fish' in it or 'บ่อ' in it:
            if not is_mv:
                return 9 if cap < 250 else (12 if cap < 1000 else 13)
            else:
                return 30 if cap < 250 else (33 if cap < 1000 else 34)
        elif 'float' in it:
            if 'farm' in it:
                return 39 if is_mv else 18
            if not is_mv:
                return 14 if cap < 250 else (17 if cap < 1000 else 18)
            else:
                return 35 if cap < 250 else (38 if cap < 1000 else 39)
        return 1

    def add_new_project(self, data: dict, trigger_cache_save: bool = True) -> dict:
        """
        Creates and registers a new solar project with 33 milestones, weights based on type_code,
        staggered milestone planned dates, initial S-Curve, and atomic cache persistence.
        """
        name = str(data.get("name", "")).strip()
        if not name:
            raise ValueError("Project name is required")

        # Check for existing project with exact name (case-insensitive)
        clean_name = name.lower()
        for p in self.all_projects:
            if p.get("name", "").strip().lower() == clean_name:
                print(f"[Engine] Project '{name}' already exists with ID {p.get('id')}")
                return p

        # Determine next project ID (prj_XXX)
        existing_ids = []
        for p in self.all_projects:
            pid = str(p.get("id", ""))
            if pid.startswith("prj_"):
                num_part = pid.replace("prj_", "")
                if num_part.isdigit():
                    existing_ids.append(int(num_part))
        next_num = (max(existing_ids) + 1) if existing_ids else (len(self.all_projects) + 1)
        project_id = f"prj_{next_num:03d}"

        # Determine order_no
        order_no = data.get("order_no")
        if order_no is not None and str(order_no).strip():
            try:
                order_no = int(order_no)
            except (ValueError, TypeError):
                order_no = str(order_no).strip()
        else:
            existing_orders = [int(p["order_no"]) for p in self.all_projects if str(p.get("order_no", "")).isdigit()]
            order_no = (max(existing_orders) + 1) if existing_orders else next_num

        # Basic fields
        bu = str(data.get("business_unit", "ทั่วไป")).strip() or "ทั่วไป"
        lot = str(data.get("lot", "Lot 1")).strip() or "Lot 1"
        
        try:
            capacity_kwp = round(float(data.get("capacity_kwp", 100.0)), 2)
        except:
            capacity_kwp = 100.0

        installation = str(data.get("installation_type", "Solar Rooftop")).strip() or "Solar Rooftop"
        voltage_level = str(data.get("voltage_level", "LV")).strip().upper()
        if voltage_level not in ("LV", "MV"):
            voltage_level = "MV" if capacity_kwp > 500.0 else "LV"

        try:
            raw_type_code = data.get("type_code")
            if raw_type_code is not None and str(raw_type_code).strip() not in ("", "0"):
                type_code = int(raw_type_code)
            else:
                type_code = self.resolve_type_code(installation, capacity_kwp, voltage_level)
        except:
            type_code = self.resolve_type_code(installation, capacity_kwp, voltage_level)

        # Planned dates setup
        planned_start_str = data.get("planned_start")
        planned_finish_str = data.get("planned_finish")

        p_s_date = parse_date(planned_start_str) or date.today()
        p_f_date = parse_date(planned_finish_str) or (p_s_date + timedelta(days=90))
        if p_f_date <= p_s_date:
            p_f_date = p_s_date + timedelta(days=90)

        planned_start = p_s_date.strftime('%Y-%m-%d')
        planned_finish = p_f_date.strftime('%Y-%m-%d')
        total_duration = max(14, (p_f_date - p_s_date).days)

        # Build 33 milestones matching type_code weights
        weights = self.weight_matrix.get(type_code, self.weight_matrix.get(1, {}))
        milestones = []
        num_m = len(self.milestone_names) or 33

        # Map any custom milestone dates/weights passed by user
        custom_ms_map = {}
        if "milestones" in data and isinstance(data["milestones"], list):
            for m_item in data["milestones"]:
                if isinstance(m_item, dict):
                    idx = m_item.get("index")
                    m_custom_name = m_item.get("name")
                    p_f = m_item.get("planned_finish")
                    p_s = m_item.get("planned_start")
                    p_w = m_item.get("weight")
                    info = {"planned_finish": p_f, "planned_start": p_s, "weight": p_w}
                    if idx is not None:
                        custom_ms_map[int(idx)] = info
                    elif m_custom_name:
                        custom_ms_map[m_custom_name.strip().lower()] = info

        for i, m_name in enumerate(self.milestone_names):
            category = self.milestone_categories.get(m_name, "งานทั่วไป")
            w = weights.get(m_name, 0.0)

            # Default staggered dates
            offset_pct = (i / max(1, num_m - 1)) * 0.75
            dur_pct = 0.25
            m_s = p_s_date + timedelta(days=int(total_duration * offset_pct))
            m_f = min(p_f_date, m_s + timedelta(days=max(5, int(total_duration * dur_pct))))
            if i == num_m - 1:
                m_f = p_f_date

            # Override with custom date / weight if provided
            custom_info = custom_ms_map.get(i) or custom_ms_map.get(m_name.strip().lower())
            if custom_info:
                if custom_info.get("planned_finish"):
                    cf = parse_date(custom_info["planned_finish"])
                    if cf:
                        m_f = cf
                if custom_info.get("planned_start"):
                    cs = parse_date(custom_info["planned_start"])
                    if cs:
                        m_s = cs
                if custom_info.get("weight") is not None:
                    try:
                        custom_w = float(custom_info["weight"])
                        if custom_w > 1.0:
                            custom_w = custom_w / 100.0
                        w = max(0.0, custom_w)
                    except:
                        pass

            milestones.append({
                "name": m_name,
                "category": category,
                "weight": round(w, 4),
                "planned_start": m_s.strftime('%Y-%m-%d'),
                "planned_finish": m_f.strftime('%Y-%m-%d'),
                "actual_start": None,
                "actual_finish": None,
                "actual_pct": 0.0,
                "actual_contribution": 0.0,
                "status": "PENDING"
            })

        planned_today = self.calculate_planned_progress_today(milestones)
        variance = round(0.0 - planned_today, 2)
        if variance >= 0:
            status = "ON_TRACK"
            status_th = "ตามแผนงาน"
        elif variance >= -10:
            status = "SLIGHT_DELAY"
            status_th = "ล่าช้าเล็กน้อย"
        else:
            status = "DELAYED"
            status_th = "ล่าช้ากว่าแผน"

        prj_obj = {
            "id": project_id,
            "business_unit": bu,
            "order_no": order_no,
            "name": name,
            "lot": lot,
            "capacity_kwp": capacity_kwp,
            "installation_type": installation,
            "voltage_level": voltage_level,
            "type_code": type_code,
            "planned_start": planned_start,
            "planned_finish": planned_finish,
            "actual_start": None,
            "actual_finish": None,
            "actual_progress_pct": 0.0,
            "planned_progress_pct": planned_today,
            "variance_pct": variance,
            "status": status,
            "status_th": status_th,
            "milestones": milestones
        }

        # Calculate initial S-Curve
        prj_obj["s_curve"] = self.generate_project_scurve(prj_obj)

        self.all_projects.append(prj_obj)
        self.projects_dict[project_id] = prj_obj
        self.active_projects = [p for p in self.all_projects if not self.is_cc_project(p)]
        self.projects = self.active_projects

        if trigger_cache_save:
            self.save_to_cache()

        print(f"[Engine] Successfully created new project {project_id} ('{name}') in Lot '{lot}' with 33 milestones.")
        return prj_obj

    def recalculate_project_metrics(self, prj: dict):
        """
        Recalculates progress %, status, variance %, and actual_start / actual_finish dates
        Rule: Project actual_finish is ONLY set if ALL milestones with weight > 0 are 100% completed.
        In that case, actual_finish = latest finish date of milestones with weight > 0.
        Otherwise, actual_finish = None (shows as '-').
        """
        milestones = prj.get("milestones", [])
        total_act = sum(m["actual_contribution"] for m in milestones)
        prj["actual_progress_pct"] = round(min(100.0, total_act * 100), 2)
        if "planned_progress_pct" not in prj or prj["planned_progress_pct"] is None:
            prj["planned_progress_pct"] = self.calculate_planned_progress_today(milestones)
        prj["variance_pct"] = round(prj["actual_progress_pct"] - prj["planned_progress_pct"], 2)
        
        if prj["actual_progress_pct"] >= 99.9:
            prj["status"] = "COMPLETED"
            prj["status_th"] = "เสร็จสมบูรณ์"
        elif prj["variance_pct"] >= 0:
            prj["status"] = "ON_TRACK"
            prj["status_th"] = "ตามแผนงาน"
        elif prj["variance_pct"] >= -10:
            prj["status"] = "SLIGHT_DELAY"
            prj["status_th"] = "ล่าช้าเล็กน้อย"
        else:
            prj["status"] = "DELAYED"
            prj["status_th"] = "ล่าช้ากว่าแผน"
            
        # Calculate actual_start: minimum start date of any started milestone
        start_dates = []
        for m in milestones:
            d = parse_date(m.get("actual_start"))
            if d:
                start_dates.append(d)
        prj["actual_start"] = min(start_dates).strftime('%Y-%m-%d') if start_dates else None
        
        # Calculate actual_finish: ONLY if all active milestones (weight > 0) are completed 100%
        active_milestones = [m for m in milestones if m.get("weight", 0) > 0]
        if active_milestones:
            all_active_completed = all(m.get("actual_pct", 0) >= 0.999 for m in active_milestones)
        else:
            all_active_completed = (prj["actual_progress_pct"] >= 99.9)
            
        if all_active_completed:
            finish_dates = []
            for m in active_milestones:
                d = parse_date(m.get("actual_finish"))
                if d:
                    finish_dates.append(d)
            prj["actual_finish"] = max(finish_dates).strftime('%Y-%m-%d') if finish_dates else date.today().strftime('%Y-%m-%d')
        else:
            prj["actual_finish"] = None
            
        prj["s_curve"] = self.generate_project_scurve(prj)

    def update_milestone(self, project_id: str, milestone_name: str = "", actual_pct: float = 0.0, 
                         actual_start: Optional[str] = None, actual_finish: Optional[str] = None,
                         milestone_index: Optional[int] = None,
                         planned_start: Optional[str] = None, planned_finish: Optional[str] = None) -> bool:
        if project_id not in self.projects_dict:
            return False
            
        prj = self.projects_dict[project_id]
        milestones = prj.get("milestones", [])
        target_m = None
        
        # 1. Match by milestone_index if provided
        if milestone_index is not None:
            try:
                idx = int(milestone_index)
                if 0 <= idx < len(milestones):
                    target_m = milestones[idx]
            except:
                pass
                
        # 2. Match by exact name
        if not target_m and milestone_name:
            clean_name = milestone_name.strip().lower()
            for m in milestones:
                if m["name"].strip().lower() == clean_name:
                    target_m = m
                    break
                    
        # 3. Match by normalized / whitespace-stripped name
        if not target_m and milestone_name:
            clean_nospace = "".join(milestone_name.lower().split())
            for m in milestones:
                m_clean = "".join(m["name"].lower().split())
                if m_clean == clean_nospace or m_clean in clean_nospace or clean_nospace in m_clean:
                    target_m = m
                    break
                    
        if not target_m:
            return False
            
        if actual_pct == 0.0:
            if actual_finish:
                actual_pct = 1.0
            elif actual_start:
                actual_pct = 0.5
                
        target_m["actual_pct"] = max(0.0, min(1.0, actual_pct))
        if actual_start:
            target_m["actual_start"] = actual_start

        if planned_start:
            target_m["planned_start"] = planned_start
        if planned_finish:
            target_m["planned_finish"] = planned_finish
            
        # User Rule: If actual_pct < 100%, do not display/keep finish date
        if target_m["actual_pct"] >= 1.0:
            target_m["actual_finish"] = actual_finish or target_m.get("actual_finish") or date.today().strftime('%Y-%m-%d')
        else:
            target_m["actual_finish"] = None
            
        target_m["status"] = "COMPLETED" if target_m["actual_pct"] >= 1.0 else ("IN_PROGRESS" if target_m["actual_pct"] > 0 else "PENDING")
        target_m["actual_contribution"] = round(target_m["actual_pct"] * target_m["weight"], 4)
        target_m["last_webhook_edit"] = time.time()
        prj["last_webhook_edit"] = time.time()
        
        # Update overall planned finish / start of project if milestones changed
        p_dates = [parse_date(m.get("planned_finish")) for m in prj.get("milestones", []) if parse_date(m.get("planned_finish"))]
        if p_dates:
            prj["planned_finish"] = max(p_dates).strftime('%Y-%m-%d')
        p_s_dates = [parse_date(m.get("planned_start")) for m in prj.get("milestones", []) if parse_date(m.get("planned_start"))]
        if p_s_dates:
            prj["planned_start"] = min(p_s_dates).strftime('%Y-%m-%d')

        self.recalculate_project_metrics(prj)
        self.save_to_cache()
        return True

    def batch_sync_from_sheet_data(self, sheet_rows: list, m_names: list) -> int:
        updated_projects = 0
        for row in sheet_rows:
            if len(row) < 3:
                continue
            p_name = row[2].strip()
            if not p_name:
                continue
            
            p_order = row[1].strip() if len(row) > 1 else ''
            target_prj = None
            for p in self.all_projects:
                if p['name'].strip().lower() == p_name.lower() or (p_order and str(p.get('order_no')) == p_order):
                    target_prj = p
                    break
                    
            if not target_prj:
                print(f"[BatchSync Ingest] Auto-ingesting new project from sheet data: '{p_name}'")
                target_prj = self.add_new_project({
                    "name": p_name,
                    "order_no": p_order,
                    "lot": "Lot 1",
                    "capacity_kwp": 100.0,
                    "installation_type": "Solar Rooftop",
                    "type_code": 1
                }, trigger_cache_save=False)
                updated_projects += 1
                
            m_idx = 0
            for c in range(7, len(row), 3):
                if m_idx >= len(m_names):
                    break
                m_name = m_names[m_idx]
                a_start = row[c].strip() if c < len(row) else ''
                a_finish = row[c+1].strip() if c+1 < len(row) else ''
                pct_raw = row[c+2].strip().replace('%', '') if c+2 < len(row) else '0'
                try:
                    val = float(pct_raw)
                    if val > 1.0:
                        val = val / 100.0
                except:
                    val = 0.0
                    
                for m in target_prj.get("milestones", []):
                    if m["name"].strip().lower() == m_name.strip().lower():
                        m["actual_pct"] = max(0.0, min(1.0, val))
                        if a_start:
                            m["actual_start"] = a_start
                        if val >= 1.0:
                            m["actual_finish"] = a_finish if a_finish else (m.get("actual_finish") or date.today().strftime('%Y-%m-%d'))
                        else:
                            m["actual_finish"] = None
                        m["status"] = "COMPLETED" if m["actual_pct"] >= 1.0 else ("IN_PROGRESS" if m["actual_pct"] > 0 else "PENDING")
                        m["actual_contribution"] = round(m["actual_pct"] * m["weight"], 4)
                        break
                        
                m_idx += 1
                
            self.recalculate_project_metrics(target_prj)
    def sync_from_google_sheet_csv(self, sheet_id: str = DEFAULT_SHEET_ID, gid: str = '669434805') -> int:
        """
        Directly fetches latest CSV from Google Sheet and syncs projects & milestones.
        Optimized with diff-checking (1700x speedup) and stale CSV protection to prevent recent live edits from disappearing.
        """
        import urllib.request
        import csv
        import io
        
        url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                text = resp.read().decode('utf-8')
        except Exception as e:
            print(f"[Engine] Failed to download Google Sheet CSV: {e}")
            return 0
            
        rows = list(csv.reader(io.StringIO(text)))
        if len(rows) < 6:
            return 0
            
        changed_projects_count = 0
        now_ts = time.time()
        
        for r_idx in range(5, len(rows)):
            row = rows[r_idx]
            if len(row) < 4:
                continue
            order_str = row[2].strip() if len(row) > 2 else ''
            name_str = row[3].strip() if len(row) > 3 else ''
            if not name_str:
                continue
                
            target_prj = None
            # 1. Match by order_no if available
            if order_str:
                for p in self.all_projects:
                    if str(p.get("order_no", "")).strip() == order_str:
                        target_prj = p
                        break
            # 2. Match by exact name
            if not target_prj and name_str:
                clean_n = name_str.lower().strip()
                for p in self.all_projects:
                    if p["name"].strip().lower() == clean_n:
                        target_prj = p
                        break
            # 3. Match by normalized name
            if not target_prj and name_str:
                clean_n = "".join(name_str.lower().split())
                for p in self.all_projects:
                    if "".join(p["name"].lower().split()) == clean_n:
                        target_prj = p
                        break
                        
            if not target_prj:
                # Approach A: Auto-ingest newly added project from Google Sheet
                print(f"[SheetSync Ingest] Auto-ingesting new project from Google Sheet: '{name_str}' (Order: {order_str})")
                new_lot = row[4].strip() if len(row) > 4 and row[4].strip() else "Lot 1"
                new_cap = 100.0
                if len(row) > 5 and row[5].strip():
                    try:
                        new_cap = float(row[5].strip().replace(',', ''))
                    except:
                        new_cap = 100.0
                target_prj = self.add_new_project({
                    "name": name_str,
                    "order_no": order_str,
                    "lot": new_lot,
                    "capacity_kwp": new_cap,
                    "installation_type": "Solar Rooftop",
                    "type_code": 1
                }, trigger_cache_save=False)
                changed_projects_count += 1
                
            milestones = target_prj.get("milestones", [])
            prj_has_change = False
            
            for m_idx in range(min(len(milestones), 33)):
                col_base = 7 + (m_idx * 3)
                if col_base + 2 < len(row):
                    raw_start = row[col_base].strip()
                    raw_finish = row[col_base + 1].strip()
                    raw_pct = row[col_base + 2].strip()
                    
                    m = milestones[m_idx]
                    pct_val = safe_parse_progress_pct(raw_pct, fallback=m.get("actual_pct", 0.0))
                    
                    # 🛡️ STALE CSV PROTECTION:
                    # If this milestone was edited via live webhook or web app within 15 minutes (900s),
                    # or is pending in sync_manager, DO NOT OVERWRITE with lagged CSV!
                    last_edit = m.get("last_webhook_edit", 0)
                    is_protected = False
                    if getattr(self, "sync_manager", None):
                        is_protected = self.sync_manager.is_milestone_protected(target_prj["id"], m.get("name", ""))
                    if (is_protected or (now_ts - last_edit) < 900) and abs(m.get("actual_pct", 0.0) - pct_val) > 0.001:
                        continue
                        
                    # Parse dates
                    new_start = None
                    if raw_start and raw_start != '-':
                        d = parse_date(raw_start)
                        new_start = d.strftime('%Y-%m-%d') if d else raw_start
                        
                    new_finish = None
                    if raw_finish and raw_finish != '-':
                        d = parse_date(raw_finish)
                        new_finish = d.strftime('%Y-%m-%d') if d else raw_finish

                    # Auto-complete pct_val if user entered dates in sheet but left % empty
                    if pct_val == 0.0:
                        if new_finish:
                            pct_val = 1.0
                        elif new_start and not new_finish:
                            pct_val = 0.5
                            
                    # User Rule: If pct_val < 100%, do not display/keep finish date
                    if pct_val >= 1.0:
                        new_finish = new_finish or m.get("actual_finish") or date.today().strftime('%Y-%m-%d')
                    else:
                        new_finish = None
                        
                    # Check if anything actually changed
                    pct_diff = abs(m.get("actual_pct", 0.0) - pct_val) > 0.001
                    start_diff = (m.get("actual_start") != new_start)
                    finish_diff = (m.get("actual_finish") != new_finish)
                    
                    if pct_diff or start_diff or finish_diff:
                        prj_has_change = True
                        m["actual_pct"] = max(0.0, min(1.0, pct_val))
                        m["actual_start"] = new_start
                        m["actual_finish"] = new_finish
                        m["status"] = "COMPLETED" if m["actual_pct"] >= 1.0 else ("IN_PROGRESS" if m["actual_pct"] > 0 else "PENDING")
                        m["actual_contribution"] = round(m["actual_pct"] * m["weight"], 4)
                        
            if prj_has_change:
                changed_projects_count += 1
                self.recalculate_project_metrics(target_prj)

        # 🛡️ AUTOMATIC DELETION PRUNING:
        # Collect all project names present in the live Google Sheet CSV
        sheet_project_names = set()
        for r_idx in range(5, len(rows)):
            row = rows[r_idx]
            if len(row) >= 4:
                n = row[3].strip().lower()
                if n:
                    sheet_project_names.add(n)
                    sheet_project_names.add("".join(n.split()))

        # Remove any project from local cache that no longer exists in Google Sheet
        projects_to_keep = []
        deleted_count = 0
        for p in self.all_projects:
            p_name = p.get("name", "").strip().lower()
            p_nospace = "".join(p_name.split())
            if p_name in sheet_project_names or p_nospace in sheet_project_names:
                projects_to_keep.append(p)
            else:
                deleted_count += 1
                print(f"[SheetSync Prune] Removing project '{p.get('name')}' (no longer in Google Sheet)")

        if deleted_count > 0:
            self.all_projects = projects_to_keep
            self.projects_dict = {p['id']: p for p in self.all_projects}
            self.active_projects = [p for p in self.all_projects if not self.is_cc_project(p)]
            self.projects = self.active_projects
            changed_projects_count += deleted_count

        if changed_projects_count > 0:
            print(f"[Engine] Synced and updated {changed_projects_count} changed/pruned projects from Google Sheet.")
            self.save_to_cache()
            
        return changed_projects_count

    def load_issues_cache(self):
        if os.path.exists(self.issues_path):
            try:
                with open(self.issues_path, 'r', encoding='utf-8') as f:
                    self.issues = json.load(f)
                print(f"[Engine] Loaded {len(self.issues)} issues from issues_cache.json.")
                return
            except Exception as e:
                print(f"[Engine Warning] Failed to load issues cache: {e}")
        
        self.issues = []
        self.save_issues_cache()

    def save_issues_cache(self):
        try:
            tmp_path = self.issues_path + '.tmp'
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(self.issues, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, self.issues_path)
        except Exception as e:
            print(f"[Engine Error] Failed to save issues cache: {e}")

    def get_issues(self, lot: str = None, project_id: str = None, status: str = None, category: str = None, search: str = None) -> List[Dict[str, Any]]:
        results = list(self.issues)
        if lot and lot != 'ALL':
            results = [i for i in results if str(i.get("lot", "")).strip().upper() == str(lot).strip().upper()]
        if project_id and project_id != 'ALL':
            results = [i for i in results if i.get("project_id") == project_id]
        if status and status != 'ALL':
            results = [i for i in results if i.get("status") == status]
        if category and category != 'ALL':
            results = [i for i in results if i.get("category") == category]
        if search:
            s = search.strip().lower()
            results = [
                i for i in results
                if s in str(i.get("site_name", "")).lower()
                or s in str(i.get("description", "")).lower()
                or s in str(i.get("action_plan", "")).lower()
                or s in str(i.get("reported_by", "")).lower()
                or s in str(i.get("id", "")).lower()
            ]
        
        def sort_key(item):
            stat_order = 0 if item.get("status") in ["OPEN", "IN_PROGRESS"] else 1
            return (stat_order, item.get("start_date") or "", item.get("id") or "")
        results.sort(key=sort_key, reverse=False)
        return results

    def set_issues_from_sheet(self, issues_list: List[Dict[str, Any]]):
        """
        Cleanly synchronizes issues directly from Google Sheet Weekly_Issues without creating duplicates.
        """
        if not isinstance(issues_list, list):
            return
        
        valid_issues = []
        for iss in issues_list:
            if isinstance(iss, dict) and iss.get("id"):
                valid_issues.append(iss)
                
        self.issues = valid_issues
        self.save_issues_cache()

    def add_issue(self, data: Dict[str, Any]) -> Dict[str, Any]:
        req_id = str(data.get("id", "")).strip()
        p_id = str(data.get("project_id", "")).strip()
        
        if req_id:
            existing_match = None
            for item in self.issues:
                if str(item.get("id", "")).strip() == req_id:
                    existing_match = item
                    break
                    
            if existing_match:
                # Update existing issue directly
                for k in ["project_id", "site_name", "lot", "week", "start_date", "end_date", "category", "description", "action_plan", "status", "severity", "reported_by"]:
                    if k in data and data[k] is not None:
                        existing_match[k] = data[k]
                existing_match["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                self.save_issues_cache()
                return existing_match
            else:
                new_id = req_id
        else:
            existing_nums = []
            for item in self.issues:
                iid = str(item.get("id", ""))
                if iid.startswith("ISS-"):
                    try:
                        num_str = iid.replace("ISS-", "")
                        if num_str.isdigit():
                            existing_nums.append(int(num_str))
                    except:
                        pass
            next_num = (max(existing_nums) + 1) if existing_nums else 1
            new_id = f"ISS-{next_num:03d}"

        p_id = data.get("project_id", "")
        site_name = data.get("site_name", "")
        lot = data.get("lot", "")

        if p_id and p_id in self.projects_dict:
            p = self.projects_dict[p_id]
            site_name = p.get("name") or site_name
            lot = p.get("lot") or lot

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        issue_obj = {
            "id": new_id,
            "project_id": p_id,
            "site_name": site_name,
            "lot": lot,
            "week": data.get("week") or f"สัปดาห์ {datetime.now().strftime('%d/%m/%Y')}",
            "start_date": data.get("start_date") or date.today().strftime("%Y-%m-%d"),
            "end_date": data.get("end_date") or None,
            "category": data.get("category") or "งานทั่วไป",
            "description": data.get("description", "").strip(),
            "action_plan": data.get("action_plan", "").strip(),
            "status": data.get("status") or "IN_PROGRESS",
            "severity": data.get("severity") or "MEDIUM",
            "reported_by": data.get("reported_by") or "วิศวกรหน้างาน",
            "created_at": now_str,
            "updated_at": now_str
        }
        
        if issue_obj["status"] == "RESOLVED" and not issue_obj["end_date"]:
            issue_obj["end_date"] = date.today().strftime("%Y-%m-%d")

        self.issues.insert(0, issue_obj)
        self.save_issues_cache()
        return issue_obj

    def update_issue(self, issue_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        for issue in self.issues:
            if issue.get("id") == issue_id:
                p_id = updates.get("project_id") or issue.get("project_id")
                if p_id and p_id in self.projects_dict:
                    p = self.projects_dict[p_id]
                    updates["project_id"] = p_id
                    updates["site_name"] = p.get("name") or updates.get("site_name")
                    updates["lot"] = p.get("lot") or updates.get("lot")
                
                for k, v in updates.items():
                    if k != "id":
                        issue[k] = v
                issue["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                if issue.get("status") == "RESOLVED" and not issue.get("end_date"):
                    issue["end_date"] = date.today().strftime("%Y-%m-%d")
                self.save_issues_cache()
                return issue
        return None

    def delete_issue(self, issue_id: str) -> bool:
        init_len = len(self.issues)
        self.issues = [i for i in self.issues if i.get("id") != issue_id]
        if len(self.issues) < init_len:
            self.save_issues_cache()
            return True
        return False

    def get_energized_summary(self) -> Dict[str, Any]:
        """
        Calculates Energized Sites:
        Counts a site as Energized if Milestone 'Testing & Commissioning' has an actual_start date.
        Returns total energized count, total energized MWp/kWp, and % of total active sites.
        """
        energized = []
        for p in self.active_projects:
            for m in p.get('milestones', []):
                if m.get('name', '').strip().lower() == 'testing & commissioning':
                    act_start = m.get('actual_start')
                    if act_start and str(act_start).strip() not in ('', '-', 'None'):
                        energized.append(p)
                        break
        total_kwp = sum(p.get('capacity_kwp', 0.0) for p in energized)
        all_kwp = sum(p.get('capacity_kwp', 0.0) for p in self.active_projects)
        return {
            "total_energized_sites": len(energized),
            "total_energized_kwp": round(total_kwp, 2),
            "total_energized_mwp": round(total_kwp / 1000.0, 2),
            "total_active_sites": len(self.active_projects),
            "total_active_kwp": round(all_kwp, 2),
            "total_active_mwp": round(all_kwp / 1000.0, 2),
            "pct_sites": round(len(energized) / len(self.active_projects) * 100.0, 1) if self.active_projects else 0.0,
            "pct_capacity": round(total_kwp / all_kwp * 100.0, 1) if all_kwp > 0 else 0.0,
            "site_ids": [p['id'] for p in energized]
        }

    def get_lot_scurve_and_categories(self, lot: Optional[str] = None) -> Dict[str, Any]:
        """
        Calculates Lot Cumulative S-Curve and 3-Category Breakdown (% delay for Permission, Design, Construction)
        both dynamically week-by-week and overall as of current week.
        """
        if not lot or lot == 'ALL':
            lot_prjs = self.active_projects
        else:
            lot_prjs = [p for p in self.active_projects if str(p.get('lot', '')).strip().upper() == str(lot).strip().upper()]

        total_cap = sum(p.get('capacity_kwp', 0.0) for p in lot_prjs)
        if total_cap == 0:
            total_cap = 1.0

        cat_names = [
            "งานขออนุญาตราชการ (Permission)",
            "งานออกแบบวิศวกรรม (Engineering Design)",
            "งานก่อสร้างและติดตั้ง (Construction Work)"
        ]

        all_weeks = set()
        for p in lot_prjs:
            sc = p.get('s_curve', {})
            for w in sc.get('weeks', []):
                all_weeks.add(str(w)[:10])
        
        sorted_weeks = sorted(list(all_weeks))
        num_weeks = len(sorted_weeks)

        # Pre-parse week dates for high-performance milestone interval coverage
        sorted_week_dates = [datetime.strptime(ws, '%Y-%m-%d').date() for ws in sorted_weeks]
        sorted_week_sundays = [d + timedelta(days=6) for d in sorted_week_dates]

        # Find max actual date across system
        max_system_act_date = '2026-09-14'
        for p in self.active_projects:
            sc = p.get('s_curve', {})
            pw = [str(w)[:10] for w in sc.get('weeks', [])]
            ac = sc.get('actual_cum', [])
            for i, val in enumerate(ac):
                if val is not None and i < len(pw):
                    if pw[i] > max_system_act_date:
                        max_system_act_date = pw[i]

        # 1. Calculate category progress for each project on project's own timeline
        project_cat_data = {}
        today = date.today()

        for p in lot_prjs:
            pid = p['id']
            sc = p.get('s_curve', {})
            p_weeks = [str(w)[:10] for w in sc.get('weeks', [])]
            p_num_w = len(p_weeks)
            p_dates = [datetime.strptime(ws, '%Y-%m-%d').date() for ws in p_weeks]
            p_sundays = [d + timedelta(days=6) for d in p_dates]

            p_cat_plan_wk = {c: [0.0] * p_num_w for c in cat_names}
            p_cat_act_wk = {c: [0.0] * p_num_w for c in cat_names}
            p_cat_weights = {c: 0.0 for c in cat_names}

            for m in p.get('milestones', []):
                m_name = m.get('name', '')
                cat = self.milestone_categories.get(m_name)
                if not cat:
                    m_lower = m_name.lower()
                    if 'design' in m_lower or 'procurement' in m_lower or 'soiling' in m_lower:
                        cat = "งานออกแบบวิศวกรรม (Engineering Design)"
                    elif 'ราชการ' in m_lower or 'cpf' in m_lower or 'cop' in m_lower or 'อ.' in m_lower or 'รง.' in m_lower or 'ขนาน' in m_lower:
                        cat = "งานขออนุญาตราชการ (Permission)"
                    else:
                        cat = "งานก่อสร้างและติดตั้ง (Construction Work)"
                if cat not in p_cat_weights:
                    cat = "งานก่อสร้างและติดตั้ง (Construction Work)"

                w = m.get('weight', 0.0)
                if w <= 0:
                    continue
                p_cat_weights[cat] += w

                # Planned weekly
                ps = parse_date(m.get('planned_start'))
                pf = parse_date(m.get('planned_finish'))
                if ps and pf:
                    covered = [i for i in range(p_num_w) if not (pf < p_dates[i] or ps > p_sundays[i])]
                    if covered:
                        inc = w / len(covered)
                        for i in covered:
                            p_cat_plan_wk[cat][i] += inc

                # Actual weekly
                act_pct = m.get('actual_pct', 0.0)
                if act_pct > 0:
                    act_w = act_pct * w
                    as_d = parse_date(m.get('actual_start')) or ps
                    af_d = parse_date(m.get('actual_finish')) or today
                    act_covered = [i for i in range(p_num_w) if not (af_d < p_dates[i] or as_d > p_sundays[i])]
                    if act_covered:
                        inc = act_w / len(act_covered)
                        for i in act_covered:
                            p_cat_act_wk[cat][i] += inc

            # Cumulative on project weeks (enforcing monotonic non-decreasing actuals)
            p_cat_plan_cum = {c: [] for c in cat_names}
            p_cat_act_cum = {c: [] for c in cat_names}
            for c in cat_names:
                cp, ca = 0.0, 0.0
                cw = p_cat_weights[c]
                last_a = 0.0
                for i in range(p_num_w):
                    cp += p_cat_plan_wk[c][i] * 100.0
                    ca += p_cat_act_wk[c][i] * 100.0
                    curr_a = min(cw * 100.0, ca)
                    if curr_a < last_a:
                        curr_a = last_a
                    last_a = curr_a
                    p_cat_plan_cum[c].append(min(cw * 100.0, cp))
                    p_cat_act_cum[c].append(curr_a)

            project_cat_data[pid] = {
                'weeks': p_weeks,
                'weights': p_cat_weights,
                'plan_wk': p_cat_plan_wk,
                'act_wk': p_cat_act_wk,
                'plan_cum': p_cat_plan_cum,
                'act_cum': p_cat_act_cum
            }

        # 2. Category weights in Lot
        cat_lot_weights = {c: 0.0 for c in cat_names}
        for p in lot_prjs:
            p_cap = p.get('capacity_kwp', 0.0)
            p_ratio = p_cap / total_cap
            for c in cat_names:
                cat_lot_weights[c] += project_cat_data[p['id']]['weights'][c] * p_ratio

        # 3. Aggregate onto sorted_weeks for each category
        cat_lot_plan_cum = {c: [] for c in cat_names}
        cat_lot_act_cum = {c: [] for c in cat_names}
        cat_lot_plan_wk = {c: [] for c in cat_names}
        cat_lot_act_wk = {c: [] for c in cat_names}

        week_labels = []
        for idx, w_str in enumerate(sorted_weeks):
            try:
                parts = w_str.split('-')
                week_labels.append(f"W{idx+1} ({parts[2]}/{parts[1]}/{parts[0][2:]})")
            except:
                week_labels.append(f"W{idx+1}")

            for c in cat_names:
                w_plan_sum = 0.0
                w_act_sum = 0.0
                w_plan_wk_sum = 0.0
                w_act_wk_sum = 0.0

                for p in lot_prjs:
                    p_cap = p.get('capacity_kwp', 0.0)
                    p_data = project_cat_data[p['id']]
                    pw = p_data['weeks']
                    pc = p_data['plan_cum'][c]
                    ac = p_data['act_cum'][c]
                    pwk = p_data['plan_wk'][c]
                    awk = p_data['act_wk'][c]

                    if not pw:
                        val_p, val_a, val_pwk, val_awk = 0.0, 0.0, 0.0, 0.0
                    elif w_str < pw[0]:
                        val_p, val_a, val_pwk, val_awk = 0.0, 0.0, 0.0, 0.0
                    elif w_str in pw:
                        pi = pw.index(w_str)
                        val_p = pc[pi] if pi < len(pc) and pc[pi] is not None else 0.0
                        val_a = ac[pi] if pi < len(ac) and ac[pi] is not None else 0.0
                        val_pwk = pwk[pi] * 100.0 if pi < len(pwk) else 0.0
                        val_awk = awk[pi] * 100.0 if pi < len(awk) else 0.0
                    else:
                        prior_p = [pc[i] for i, x in enumerate(pw) if x < w_str and pc[i] is not None]
                        val_p = prior_p[-1] if prior_p else 0.0
                        prior_a = [ac[i] for i in range(len(ac)) if ac[i] is not None]
                        val_a = prior_a[-1] if prior_a else 0.0
                        val_pwk, val_awk = 0.0, 0.0

                    w_plan_sum += val_p * p_cap
                    w_act_sum += val_a * p_cap
                    w_plan_wk_sum += val_pwk * p_cap
                    w_act_wk_sum += val_awk * p_cap

                cat_lot_plan_cum[c].append(round(w_plan_sum / total_cap, 2))
                cat_lot_act_cum[c].append(round(w_act_sum / total_cap, 2))
                cat_lot_plan_wk[c].append(round(w_plan_wk_sum / total_cap, 2))
                cat_lot_act_wk[c].append(round(w_act_wk_sum / total_cap, 2))

        # 4. Enforce monotonic non-decreasing on cumulative actuals per category
        for c in cat_names:
            last_val = 0.0
            for i in range(num_weeks):
                if cat_lot_act_cum[c][i] < last_val:
                    cat_lot_act_cum[c][i] = last_val
                last_val = cat_lot_act_cum[c][i]

        # 5. Build category breakdown by week
        category_breakdown_by_week = []
        lot_planned_cum = []
        lot_actual_cum = []

        today_str = today.strftime('%Y-%m-%d')
        current_week_idx = 0

        for i in range(num_weeks):
            w_str = sorted_weeks[i]
            if today_str >= w_str:
                current_week_idx = i

            week_cats = []
            w_tot_plan = 0.0
            w_tot_act = 0.0

            for c in cat_names:
                cw = cat_lot_weights[c]
                cw_pct = round(cw * 100.0, 2)
                plan_contrib = cat_lot_plan_cum[c][i]
                act_contrib = cat_lot_act_cum[c][i]
                var_contrib = round(act_contrib - plan_contrib, 2)

                pct_plan_in_cat = round((plan_contrib / cw_pct * 100.0), 1) if cw_pct > 0 else 0.0
                pct_act_in_cat = round((act_contrib / cw_pct * 100.0), 1) if cw_pct > 0 else 0.0

                wk_plan = cat_lot_plan_wk[c][i]
                wk_act = cat_lot_act_wk[c][i]
                wk_var = round(wk_act - wk_plan, 2)

                short_name = "งานราชการ" if "ขออนุญาต" in c else ("งานออกแบบ" if "ออกแบบ" in c else "งานก่อสร้าง")

                status = "ON_TRACK" if var_contrib >= 0 else ("DELAYED" if var_contrib < -5 else "SLIGHT_DELAY")
                status_wk = "ON_TRACK" if wk_var >= 0 else ("DELAYED" if wk_var < -1 else "SLIGHT_DELAY")

                week_cats.append({
                    "category": c,
                    "short_name": short_name,
                    "weight_pct": cw_pct,
                    "planned_contribution_pct": plan_contrib,
                    "actual_contribution_pct": act_contrib,
                    "variance_pct": var_contrib,
                    "cat_planned_pct": pct_plan_in_cat,
                    "cat_actual_pct": pct_act_in_cat,
                    "status": status,
                    "weekly_planned_contribution_pct": wk_plan,
                    "weekly_actual_contribution_pct": wk_act,
                    "weekly_variance_pct": wk_var,
                    "weekly_status": status_wk
                })

                w_tot_plan += plan_contrib
                w_tot_act += act_contrib

            category_breakdown_by_week.append(week_cats)
            lot_planned_cum.append(round(w_tot_plan, 2))

            if max_system_act_date and w_str > max_system_act_date:
                lot_actual_cum.append(None)
            else:
                lot_actual_cum.append(round(w_tot_act, 2))

        latest_breakdown = category_breakdown_by_week[current_week_idx] if current_week_idx < len(category_breakdown_by_week) else category_breakdown_by_week[-1]

        return {
            "lot": lot or "ALL",
            "total_sites": len(lot_prjs),
            "total_capacity_kwp": round(total_cap, 2),
            "category_breakdown": latest_breakdown,
            "category_breakdown_by_week": category_breakdown_by_week,
            "current_week_index": current_week_idx,
            "scurve": {
                "weeks": sorted_weeks,
                "labels": week_labels,
                "planned_cum": lot_planned_cum,
                "actual_cum": lot_actual_cum
            }
        }

    # =========================================================================
    # PHOTO MANAGEMENT (6 SLOTS PER PROJECT)
    # =========================================================================
    DEFAULT_PHOTO_SLOTS = [
        {"slot": 1, "title": "ภาพรวมหน้างาน (Overall Site Overview)", "category": "site_overview"},
        {"slot": 2, "title": "งานโครงสร้างและฐานราก (Mounting & Civil Structure)", "category": "civil_mounting"},
        {"slot": 3, "title": "งานติดตั้งแผงโซลาร์เซลล์ (Solar PV Modules)", "category": "solar_panels"},
        {"slot": 4, "title": "งานอินเวอร์เตอร์และรางสายไฟ (Inverter & Cable Trays)", "category": "inverter_cables"},
        {"slot": 5, "title": "จุดเชื่อมต่อระบบไฟฟ้า (MDB / Substation & Grid Connection)", "category": "grid_connection"},
        {"slot": 6, "title": "งานทดสอบและตรวจรับความปลอดภัย (Testing & Safety Activities)", "category": "testing_safety"}
    ]

    def load_photos_cache(self):
        if os.path.exists(self.photos_path):
            try:
                with open(self.photos_path, 'r', encoding='utf-8') as f:
                    self.photos = json.load(f)
                print(f"[Engine] Loaded photos cache for {len(self.photos)} projects.")
                return
            except Exception as e:
                print(f"[Engine Warning] Failed to load photos cache: {e}")
        
        self.photos = {}
        self.save_photos_cache()

    def save_photos_cache(self):
        try:
            tmp_path = self.photos_path + '.tmp'
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(self.photos, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, self.photos_path)
        except Exception as e:
            print(f"[Engine Error] Failed to save photos cache: {e}")

    def get_project_photos(self, project_id: str) -> List[Dict[str, Any]]:
        p_id = str(project_id).strip()
        prj_data = self.photos.get(p_id, {})
        slots_map = prj_data.get("slots", {})
        
        results = []
        for def_slot in self.DEFAULT_PHOTO_SLOTS:
            s_num = def_slot["slot"]
            existing = slots_map.get(str(s_num), {})
            results.append({
                "slot": s_num,
                "title": existing.get("title") or def_slot["title"],
                "category": def_slot["category"],
                "photo_url": existing.get("photo_url", ""),
                "drive_file_id": existing.get("drive_file_id", ""),
                "download_url": existing.get("download_url", ""),
                "date": existing.get("date", ""),
                "caption": existing.get("caption", ""),
                "updated_by": existing.get("updated_by", ""),
                "updated_at": existing.get("updated_at", "")
            })
        return results

    def save_project_photo(self, project_id: str, photo_data: Dict[str, Any]) -> Dict[str, Any]:
        p_id = str(project_id).strip()
        slot = int(photo_data.get("slot", 1))
        
        if p_id not in self.photos:
            prj = self.projects_dict.get(p_id)
            prj_name = photo_data.get("project_name") or (prj.get("name") if prj else f"Project {p_id}")
            self.photos[p_id] = {
                "project_id": p_id,
                "project_name": prj_name,
                "slots": {}
            }
        
        slots_map = self.photos[p_id].setdefault("slots", {})
        existing = slots_map.get(str(slot), {})
        
        def_title = f"Slot {slot}"
        for d in self.DEFAULT_PHOTO_SLOTS:
            if d["slot"] == slot:
                def_title = d["title"]
                break
                
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Prefer new photo_url, or incoming image_base64 (data URL), or retain existing photo_url
        new_photo_url = photo_data.get("photo_url") or photo_data.get("image_base64") or existing.get("photo_url", "")
        new_drive_id = photo_data.get("drive_file_id") or existing.get("drive_file_id", "")
        new_download_url = photo_data.get("download_url") or existing.get("download_url", "")
        
        slot_obj = {
            "slot": slot,
            "title": photo_data.get("title") or existing.get("title") or def_title,
            "photo_url": new_photo_url,
            "drive_file_id": new_drive_id,
            "download_url": new_download_url,
            "date": photo_data.get("date") or existing.get("date") or datetime.now().strftime("%Y-%m-%d"),
            "caption": photo_data.get("caption") if photo_data.get("caption") is not None else existing.get("caption", ""),
            "updated_by": photo_data.get("updated_by") or existing.get("updated_by") or "Web App",
            "updated_at": now_str
        }
        
        slots_map[str(slot)] = slot_obj
        self.save_photos_cache()
        return slot_obj

    def delete_project_photo(self, project_id: str, slot: int) -> bool:
        p_id = str(project_id).strip()
        if p_id in self.photos and "slots" in self.photos[p_id]:
            if str(slot) in self.photos[p_id]["slots"]:
                del self.photos[p_id]["slots"][str(slot)]
                self.save_photos_cache()
                return True
        return False



