/**
 * =========================================================================
 * ⚡ KPGreenergy Planner - 2-Way Sync Engine (Master & Progress Edition)
 * =========================================================================
 */

// ใส่ URL ของ Web Dashboard บน Render ของคุณที่นี่ (เพื่อซิงค์ข้อมูลสดอัตโนมัติ)
const WEBHOOK_DASHBOARD_URL = 'https://kpgreenergy-planner.onrender.com/api/webhook';

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

      const minRow = (sheetName === 'Progress') ? 6 : 5;
      const nameCol = (sheetName === 'Progress') ? 4 : 3;
      const orderCol = (sheetName === 'Progress') ? 3 : 2;
      const headerRow = (sheetName === 'Progress') ? 3 : 3;

      if (row >= minRow && col >= 8) {
        const prjName = sheet.getRange(row, nameCol).getValue();
        const orderNo = sheet.getRange(row, orderCol).getValue();
        
        const mIdx = Math.floor((col - 8) / 3);
        const headerCol = (mIdx * 3) + 8;
        const milestoneName = sheet.getRange(headerRow, headerCol).getValue();

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
 * 2. GET Request: ดึงข้อมูลเป็น JSON ความเร็วสูง
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const masterSheet = ss.getSheetByName('MASTER') || ss.getSheetByName('Master') || ss.getSheetByName('Plan');
    const progSheet = ss.getSheetByName('Progress') || ss.getSheetByName('data Progress');

    if (!masterSheet) {
      return createJsonResponse({ status: 'error', message: 'ไม่พบชีต MASTER หรือ Plan' });
    }

    const isNewFormat = (masterSheet.getName().toUpperCase() === 'MASTER');
    const masterData = masterSheet.getDataRange().getValues();
    const progData = progSheet ? progSheet.getDataRange().getValues() : [];

    const mHeaderRowIdx = isNewFormat ? 1 : 2;
    const pStartRowIdx = isNewFormat ? 4 : 4;

    const headerRow = masterData[mHeaderRowIdx];
    const milestones = [];
    for (let c = 7; c < headerRow.length; c += 3) {
      const mName = String(headerRow[c] || '').trim();
      if (mName) {
        milestones.push({ name: mName, col_idx: c, index: milestones.length });
      }
    }

    const progMap = {};
    if (progData && progData.length > 0) {
      const isProgNew = (progSheet.getName() === 'Progress');
      const progStartRow = isProgNew ? 5 : 4;
      const progOrderCol = isProgNew ? 2 : 1;
      const progNameCol = isProgNew ? 3 : 2;

      for (let r = progStartRow; r < progData.length; r++) {
        const oNo = String(progData[r][progOrderCol] || '').trim();
        const pName = String(progData[r][progNameCol] || '').trim().toLowerCase();
        if (oNo) progMap['order_' + oNo] = progData[r];
        if (pName) progMap['name_' + pName] = progData[r];
      }
    }

    const projects = [];
    for (let r = pStartRowIdx; r < masterData.length; r++) {
      const prjName = String(masterData[r][isNewFormat ? 2 : 2] || '').trim();
      if (!prjName) continue;

      const orderNo = String(masterData[r][isNewFormat ? 1 : 1] || '').trim();
      const bu = String(masterData[r][0] || '').trim();
      const lot = String(masterData[r][isNewFormat ? 3 : 3] || 'Other').trim();
      const cap = Number(masterData[r][isNewFormat ? 4 : 4]) || 0;
      const inst = String(masterData[r][isNewFormat ? 5 : 5] || '').trim();
      const typeCode = String(masterData[r][isNewFormat ? 6 : 6] || '').trim();

      const progRow = progMap['order_' + orderNo] || progMap['name_' + prjName.toLowerCase()] || masterData[r];
      const mList = [];

      for (let i = 0; i < milestones.length; i++) {
        const c = milestones[i].col_idx;
        const pStart = masterData[r][c];
        const pFinish = masterData[r][c+1];
        const pWeight = Number(masterData[r][c+2]) || 0;

        const aStart = progRow[c];
        const aFinish = progRow[c+1];
        let aPct = Number(progRow[c+2]) || 0;
        if (aPct > 1.0) aPct = aPct / 100.0;

        mList.push({
          index: i,
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
        id: 'prj_' + ('000' + (projects.length + 1)).slice(-3),
        order_no: orderNo,
        name: prjName,
        business_unit: bu,
        lot: lot,
        capacity_kwp: cap,
        installation_type: inst,
        type_code: typeCode,
        milestones: mList
      });
    }

    return createJsonResponse({
      status: 'success',
      total_projects: projects.length,
      projects: projects
    });

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

    if (data.action === 'update_milestone' || data.action === 'save_progress') {
      return handleUpdateMilestone(data);
    }

    return createJsonResponse({ status: 'error', message: 'Invalid action: ' + data.action });
  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

function handleUpdateMilestone(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const projectId = String(data.project_id || '').trim();
    const orderNo = String(data.order_no || '').trim();
    const projectName = String(data.project_name || '').trim().toLowerCase();
    const milestoneName = String(data.milestone_name || '').trim();
    const milestoneIdx = data.milestone_index !== undefined && data.milestone_index !== null ? parseInt(data.milestone_index) : -1;
    let actualPct = parseFloat(data.actual_pct || 0);
    if (actualPct > 1.0) actualPct = actualPct / 100.0;
    
    const actualStart = data.actual_start || '';
    const actualFinish = data.actual_finish || '';
    const note = data.note || 'อัปเดตผ่านระบบ';
    const updatedBy = data.updated_by || 'Web Dashboard';

    const progSheet = ss.getSheetByName('Progress') || ss.getSheetByName('data Progress');
    const logSheet = ss.getSheetByName('Log_Updates');

    if (!progSheet) {
      return createJsonResponse({ status: 'error', message: 'ไม่พบชีต Progress หรือ data Progress' });
    }

    const isNewProg = (progSheet.getName() === 'Progress');
    const progData = progSheet.getDataRange().getValues();
    const startRowIdx = isNewProg ? 5 : 4;
    const orderColIdx = isNewProg ? 2 : 1;
    const nameColIdx = isNewProg ? 3 : 2;

    let targetRow = -1;
    for (let r = startRowIdx; r < progData.length; r++) {
      const rowOrder = String(progData[r][orderColIdx] || '').trim();
      const rowName = String(progData[r][nameColIdx] || '').trim().toLowerCase();
      const rowId = 'prj_' + ('000' + (r - (startRowIdx - 1))).slice(-3);

      if (orderNo && rowOrder === orderNo) {
        targetRow = r + 1;
        break;
      }
      if (projectId && (projectId === rowId || projectId === String(r - (startRowIdx - 1)))) {
        targetRow = r + 1;
        break;
      }
      if (projectName && (rowName === projectName || rowName.includes(projectName) || projectName.includes(rowName))) {
        targetRow = r + 1;
        break;
      }
    }

    if (targetRow === -1) {
      return createJsonResponse({ status: 'error', message: 'ไม่พบโครงการ: ' + (orderNo || projectName || projectId) });
    }

    let targetCol = -1;
    if (milestoneIdx >= 0 && milestoneIdx < 33) {
      targetCol = 8 + (milestoneIdx * 3);
    } else {
      const headerRow = progData[isNewProg ? 2 : 2];
      for (let c = 7; c < headerRow.length; c += 3) {
        const title = String(headerRow[c] || '').trim().toLowerCase();
        if (title === milestoneName.toLowerCase() || title.includes(milestoneName.toLowerCase()) || milestoneName.toLowerCase().includes(title)) {
          targetCol = c + 1;
          break;
        }
      }
    }

    if (targetCol === -1) {
      return createJsonResponse({ status: 'error', message: 'ไม่พบคอลัมน์ Milestone: ' + milestoneName });
    }

    if (actualStart) progSheet.getRange(targetRow, targetCol).setValue(actualStart);
    if (actualFinish) progSheet.getRange(targetRow, targetCol + 1).setValue(actualFinish);
    progSheet.getRange(targetRow, targetCol + 2).setValue(actualPct);

    if (logSheet) {
      const nowStr = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
      logSheet.appendRow([nowStr, updatedBy, projectName || ('Row ' + targetRow), milestoneName, (actualPct * 100).toFixed(0) + '%', actualStart, actualFinish, note, '2-Way API']);
    }

    return createJsonResponse({
      status: 'success',
      message: 'อัปเดต Row ' + targetRow + ' (' + milestoneName + ') สำเร็จ (' + (actualPct * 100).toFixed(0) + '%)'
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

function formatSimpleDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = ('0' + (val.getMonth() + 1)).slice(-2);
    const d = ('0' + val.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }
  return String(val).slice(0, 10);
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function testWebhook() {
  const payload = {
    action: 'sheet_edited',
    project_name: 'ฟาร์มสุกรขุนเขาหินซ้อน',
    order_no: '96',
    milestone_name: 'CPF ส่งมอบพื้นที่และยินยอมการใช้ที่ดิน ATV',
    milestone_index: 0,
    new_value: 1.0,
    actual_pct: 1.0
  };
  Logger.log('Sending test payload to Web Dashboard: ' + JSON.stringify(payload));
  notifyWebDashboard(payload);
  Logger.log('Test webhook completed.');
}
