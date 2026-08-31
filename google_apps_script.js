/**
 * =========================================================================
 * ⚡ KPGreenergy Planner - 2-Way Sync Engine (Complete Real-Time Edition)
 * =========================================================================
 */

// ใส่ URL ของ Web Dashboard ของคุณที่นี่ (เพื่อซิงค์ข้อมูลสดอัตโนมัติ)
const WEBHOOK_DASHBOARD_URL = "https://kpgreenergy-planner.onrender.com/api/webhook";

/**
 * 1. onEdit Trigger: เมื่อคุณพิมพ์แก้ % ใน Google Sheet ระบบจะส่งข้อมูลไปอัปเดตหน้าเว็บทันที!
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    
    // ทำงานเฉพาะชีต 'data Progress'
    if (sheetName === "data Progress") {
      const row = e.range.getRow();
      const col = e.range.getColumn();
      const value = e.value !== undefined ? e.value : e.range.getValue();

      // แถวข้อมูลโครงการเริ่มตั้งแต่แถว 5, คอลัมน์ Milestone เริ่มตั้งแต่คอลัมน์ H (8)
      if (row >= 5 && col >= 8) {
        const prjName = sheet.getRange(row, 3).getValue(); // Col C = ชื่อโครงการ
        
        // หาคอลัมน์เริ่มต้นของ Milestone (Col H, K, N, ...)
        const headerCol = Math.floor((col - 8) / 3) * 3 + 8;
        const milestoneName = sheet.getRange(3, headerCol).getValue(); // แถว 3 = ชื่อ Milestone

        // ตรวจสอบว่าแก้ในช่อง % Progress (Col J, M, P...)
        const isPctCol = ((col - 8) % 3 === 2);
        
        if (prjName && milestoneName && isPctCol) {
          notifyWebDashboard({
            action: "sheet_edited",
            sheet: sheetName,
            project_name: String(prjName),
            milestone_name: String(milestoneName),
            new_value: value
          });
        }
      }
    }
  } catch (err) {
    console.error("onEdit error: " + err);
  }
}

/**
 * 2. GET Request: ดึงข้อมูลเป็น JSON หรือรับคำสั่งอัปเดต (GET Fallback)
 */
function doGet(e) {
  try {
    // 2.1 หากมี parameter update_milestone ส่งมาแบบ GET ให้เขียนลงเซลล์ทันที
    if (e && e.parameter && e.parameter.action === "update_milestone") {
      return handleUpdateMilestone({
        project_name: e.parameter.project_name,
        milestone_name: e.parameter.milestone_name,
        actual_pct: e.parameter.actual_pct,
        actual_start: e.parameter.actual_start,
        actual_finish: e.parameter.actual_finish,
        updated_by: e.parameter.updated_by || "Web User",
        note: e.parameter.note || "อัปเดตผ่าน Web Dashboard"
      });
    }

    // 2.2 โหลดรายการโครงการทั้งหมด 137 โครงการ
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const planSheet = ss.getSheetByName("Plan");
    const progSheet = ss.getSheetByName("data Progress");

    if (!planSheet || !progSheet) {
      return createJsonResponse({ status: "error", message: "ไม่พบชีต 'Plan' หรือ 'data Progress'" });
    }

    const planLastRow = planSheet.getLastRow();
    const planLastCol = planSheet.getLastColumn();
    const progLastRow = progSheet.getLastRow();
    const progLastCol = progSheet.getLastColumn();

    if (planLastRow < 5) {
      return createJsonResponse({ status: "success", total_projects: 0, projects: [] });
    }

    const planData = planSheet.getRange(1, 1, planLastRow, planLastCol).getValues();
    const progData = progSheet.getRange(1, 1, progLastRow, progLastCol).getValues();

    const headerRow3 = planData[2];
    const milestones = [];
    for (let c = 7; c < headerRow3.length; c += 3) {
      const mName = String(headerRow3[c] || "").trim();
      if (mName) {
        milestones.push({ name: mName, col_idx: c });
      }
    }

    const progMap = {};
    for (let r = 4; r < progData.length; r++) {
      const pName = String(progData[r][2] || "").trim();
      if (pName) {
        progMap[pName] = progData[r];
      }
    }

    const projects = [];
    for (let r = 4; r < planData.length; r++) {
      const prjName = String(planData[r][2] || "").trim();
      if (!prjName) continue;

      const progRow = progMap[prjName] || planData[r];
      const mList = [];

      for (let i = 0; i < milestones.length; i++) {
        const c = milestones[i].col_idx;
        const pStart = planData[r][c];
        const pFinish = planData[r][c+1];
        const pWeight = Number(planData[r][c+2]) || 0;

        const aStart = progRow[c];
        const aFinish = progRow[c+1];
        let aPct = Number(progRow[c+2]) || 0;
        if (aPct > 1.0) aPct = aPct / 100.0;

        mList.push({
          name: milestones[i].name,
          weight: pWeight,
          planned_start: formatSimpleDate(pStart),
          planned_finish: formatSimpleDate(pFinish),
          actual_start: formatSimpleDate(aStart),
          actual_finish: formatSimpleDate(aFinish),
          actual_pct: aPct
        });
      }

      projects.push({
        id: "prj_" + ("000" + (r - 3)).slice(-3),
        business_unit: String(planData[r][4] || planData[r][0] || ""),
        order_no: planData[r][1],
        name: prjName,
        lot: String(planData[r][3] || ""),
        capacity_kwp: Number(planData[r][6] || planData[r][4]) || 0,
        installation_type: String(planData[r][5] || ""),
        type_code: String(planData[r][5] || "1"),
        milestones: mList
      });
    }

    return createJsonResponse({
      status: "success",
      total_projects: projects.length,
      milestones_count: milestones.length,
      projects: projects
    });

  } catch (err) {
    return createJsonResponse({ status: "error", message: err.toString() });
  }
}

/**
 * 3. POST Request: รับข้อมูลอัปเดตจาก LINE LIFF / Web
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ status: "error", message: "Missing POST body" });
    }
    const data = JSON.parse(e.postData.contents);
    return handleUpdateMilestone(data);
  } catch (err) {
    return createJsonResponse({ status: "error", message: err.toString() });
  }
}

/**
 * 4. Shared Update Engine: เขียนค่าลง Google Sheet ทันที
 */
function handleUpdateMilestone(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const projectName = String(data.project_name || "").trim();
    const milestoneName = String(data.milestone_name || "").trim();
    let actualPct = parseFloat(data.actual_pct || 0);
    if (actualPct > 1.0) actualPct = actualPct / 100.0;
    
    const actualStart = data.actual_start || "";
    const actualFinish = data.actual_finish || "";
    const note = data.note || "อัปเดตผ่านระบบ";
    const updatedBy = data.updated_by || "Web User";

    const progSheet = ss.getSheetByName("data Progress");
    const logSheet = ss.getSheetByName("Log_Updates");

    if (!progSheet) {
      return createJsonResponse({ status: "error", message: "ไม่พบชีต 'data Progress'" });
    }

    const lastRow = progSheet.getLastRow();
    const lastCol = progSheet.getLastColumn();
    const progData = progSheet.getRange(1, 1, lastRow, lastCol).getValues();

    // หาแถวของโครงการ (Col C = Index 2)
    let targetRow = -1;
    for (let r = 4; r < progData.length; r++) {
      if (String(progData[r][2] || "").trim().toLowerCase() === projectName.toLowerCase()) {
        targetRow = r + 1;
        break;
      }
    }

    if (targetRow === -1) {
      return createJsonResponse({ status: "error", message: "ไม่พบโครงการ: " + projectName });
    }

    // หาคอลัมน์ของ Milestone (Row 3 = Index 2)
    const headerRow3 = progData[2];
    let targetCol = -1;
    for (let c = 7; c < headerRow3.length; c += 3) {
      const title = String(headerRow3[c] || "").trim().toLowerCase();
      if (title === milestoneName.toLowerCase() || title.includes(milestoneName.toLowerCase()) || milestoneName.toLowerCase().includes(title)) {
        targetCol = c + 1;
        break;
      }
    }

    if (targetCol === -1) {
      return createJsonResponse({ status: "error", message: "ไม่พบคอลัมน์ Milestone: " + milestoneName });
    }

    // เขียนค่าลงเซลล์
    if (actualStart) progSheet.getRange(targetRow, targetCol).setValue(actualStart);
    if (actualFinish) progSheet.getRange(targetRow, targetCol + 1).setValue(actualFinish);
    progSheet.getRange(targetRow, targetCol + 2).setValue(actualPct);

    // บันทึกลง Audit Log ถ้ามีชีต
    if (logSheet) {
      const nowStr = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
      logSheet.appendRow([nowStr, updatedBy, projectName, milestoneName, (actualPct * 100).toFixed(0) + "%", actualStart, actualFinish, note, "2-Way API"]);
    }

    return createJsonResponse({
      status: "success",
      message: "อัปเดต " + milestoneName + " ของ " + projectName + " สำเร็จ (" + (actualPct * 100).toFixed(0) + "%)"
    });

  } catch (err) {
    return createJsonResponse({ status: "error", message: err.toString() });
  }
}

function notifyWebDashboard(payload) {
  if (!WEBHOOK_DASHBOARD_URL || WEBHOOK_DASHBOARD_URL.includes("your-dashboard")) return;
  try {
    UrlFetchApp.fetch(WEBHOOK_DASHBOARD_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    console.warn("Webhook notify error: " + e);
  }
}

function formatSimpleDate(val) {
  if (!val) return "";
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = ("0" + (val.getMonth() + 1)).slice(-2);
    const d = ("0" + val.getDate()).slice(-2);
    return y + "-" + m + "-" + d;
  }
  return String(val).slice(0, 10);
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
