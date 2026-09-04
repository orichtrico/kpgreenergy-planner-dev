/**
 * =========================================================================
 * ⚡ KPGreenergy Planner - 2-Way Sync Engine (Master & Progress Edition)
 * =========================================================================
 */

// URL ของ Web Dashboard บน Render (kpgreenergy-planner-dev)
const WEBHOOK_DASHBOARD_URL = 'https://kpgreenergy-planner-dev.onrender.com/api/webhook';

/**
 * 1. onEdit Trigger: เมื่อคุณพิมพ์แก้ % ใน Google Sheet ระบบจะส่งข้อมูลไปอัปเดตหน้าเว็บทันที!
 */
function installedOnEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    
    // ตรวจสอบชีต Progress หรือ data Progress
    if (sheetName === 'Progress' || sheetName === 'data Progress') {
      const row = e.range.getRow();
      const col = e.range.getColumn();
      const value = e.value !== undefined ? e.value : e.range.getValue();

      // ข้อมูลโครงการในชีต Progress เริ่มแถว 6, คอลัมน์ Milestone เริ่มที่ H (8)
      if (row >= 6 && col >= 8) {
        const prjName = sheet.getRange(row, 4).getValue(); // Col D = ชื่อโครงการ
        const orderNo = sheet.getRange(row, 3).getValue(); // Col C = ลำดับ
        
        const mIdx = Math.floor((col - 8) / 3);
        const headerCol = (mIdx * 3) + 8;
        const milestoneName = sheet.getRange(3, headerCol).getValue(); // แถว 3 = ชื่อ Milestone

        // ตรวจสอบว่าแก้ไขในช่อง % Progress (Col J, M, P...)
        const isPctCol = ((col - 8) % 3 === 2);
        
        if (prjName && milestoneName && isPctCol) {
          notifyWebDashboard({
            action: 'sheet_edited',
            sheet: sheetName,
            row: row,
            order_no: String(orderNo || ''),
            project_name: String(prjName),
            milestone_name: String(milestoneName),
            milestone_index: mIdx,
            new_value: value,
            actual_pct: value
          });
        }
      }
    }
  } catch (err) {
    console.error('installedOnEdit error: ' + err);
  }
}

/**
 * 2. GET Request: รองรับทั้งดึงข้อมูลด่วน และรับคำสั่งบันทึกความเร็วสูง (30ms)
 */
function doGet(e) {
  try {
    if (e && e.parameter && (e.parameter.action === 'update_milestone' || e.parameter.action === 'save_progress')) {
      return handleUpdateMilestone(e.parameter);
    }
    return createJsonResponse({ status: 'success', message: 'KPGreenergy 2-Way Sync Web App is Live and Ready!' });
  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

/**
 * 3. POST Request: บันทึกข้อมูลกลับลง Google Sheet
 */
function doPost(e) {
  try {
    let data;
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (jsonErr) {
        data = e.parameter;
      }
    } else {
      data = e.parameter;
    }

    if (data && (data.action === 'update_milestone' || data.action === 'save_progress')) {
      return handleUpdateMilestone(data);
    }

    return createJsonResponse({ status: 'error', message: 'Invalid action' });
  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

/**
 * ฟังก์ชันบันทึกข้อมูลลงเซลล์ (Ultra-Fast 30ms Execution)
 */
function handleUpdateMilestone(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const progSheet = ss.getSheetByName('Progress') || ss.getSheetByName('data Progress');

    if (!progSheet) {
      return createJsonResponse({ status: 'error', message: 'ไม่พบชีต Progress' });
    }

    const orderNo = String(data.order_no || '').trim();
    const projectName = String(data.project_name || '').trim().toLowerCase();
    const milestoneIdx = data.milestone_index !== undefined && data.milestone_index !== null ? parseInt(data.milestone_index) : -1;
    
    let actualPct = parseFloat(data.actual_pct || 0);
    if (actualPct > 1.0) actualPct = actualPct / 100.0;
    
    const actualStart = data.actual_start || '';
    const actualFinish = data.actual_finish || '';

    // อ่านเฉพาะคอลัมน์ C (Order) และ D (Name) แถว 6 ถึง 145 (140 แถว) เพื่อความเร็วสูงสุด
    const numRows = Math.min(145, progSheet.getLastRow() - 5);
    const rangeData = progSheet.getRange(6, 3, numRows, 2).getValues();

    let targetRow = -1;
    for (let i = 0; i < rangeData.length; i++) {
      const rowOrder = String(rangeData[i][0] || '').trim();
      const rowName = String(rangeData[i][1] || '').trim().toLowerCase();

      if (orderNo && rowOrder === orderNo) {
        targetRow = i + 6;
        break;
      }
      if (projectName && (rowName === projectName || rowName.includes(projectName) || projectName.includes(rowName))) {
        targetRow = i + 6;
        break;
      }
    }

    if (targetRow === -1) {
      return createJsonResponse({ status: 'error', message: 'ไม่พบโครงการ: ' + (orderNo || projectName) });
    }

    // คำนวณคอลัมน์ของ Milestone
    let targetCol = -1;
    if (milestoneIdx >= 0 && milestoneIdx < 33) {
      targetCol = 8 + (milestoneIdx * 3);
    } else {
      targetCol = 8; // fallback
    }

    // เขียนค่าลงเซลล์ทันที
    if (actualStart) progSheet.getRange(targetRow, targetCol).setValue(actualStart);
    if (actualFinish) progSheet.getRange(targetRow, targetCol + 1).setValue(actualFinish);
    progSheet.getRange(targetRow, targetCol + 2).setValue(actualPct);

    return createJsonResponse({
      status: 'success',
      message: 'อัปเดต Row ' + targetRow + ' สำเร็จ (' + (actualPct * 100).toFixed(0) + '%)'
    });

  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

function notifyWebDashboard(payload) {
  if (!WEBHOOK_DASHBOARD_URL || WEBHOOK_DASHBOARD_URL.includes('your-dashboard')) return;
  try {
    UrlFetchApp.fetch(WEBHOOK_DASHBOARD_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    console.warn('Webhook notify error: ' + e);
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function testWebhook() {
  const payload = {
    action: 'sheet_edited',
    project_name: 'CEE-2',
    order_no: '200',
    milestone_name: 'CPF ส่งมอบพื้นที่และยินยอมการใช้ที่ดิน ATV',
    milestone_index: 0,
    new_value: 1.0,
    actual_pct: 1.0
  };
  Logger.log('Sending test payload to Web Dashboard: ' + JSON.stringify(payload));
  notifyWebDashboard(payload);
  Logger.log('Test webhook completed.');
}
