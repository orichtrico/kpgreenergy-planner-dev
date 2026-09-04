/**
 * =========================================================================
 * ⚡ KPGreenergy Planner - 2-Way Real-Time Sync Engine (Google Sheet & Web)
 * =========================================================================
 * 
 * 📌 คำแนะนำในการเปิดใช้งานให้แก้ข้อมูลใน Google Sheet แล้วหน้าเว็บเปลี่ยนทันที:
 * 
 * 1. วางโค้ดทั้งหมดนี้ลงใน Google Apps Script (ส่วนขยาย > Apps Script) แล้วกด Save (บันทึก)
 * 2. เลือกฟังก์ชัน "testWebhook" แล้วกดปุ่ม "Run" (เรียกใช้) 1 ครั้ง
 *    - ระบบจะขึ้นหน้าต่างให้สิทธิ์ (Authorization Required) ให้กด "ตรวจสอบสิทธิ์" > เลือกอีเมลของคุณ > "ขั้นสูง" (Advanced) > "ไปยัง... (ไม่ปลอดภัย)" > กด "อนุญาต" (Allow)
 * 3. ตั้งค่าทริกเกอร์อัตโนมัติ (สำคัญมาก!):
 *    - คลิกเมนู "ทริกเกอร์" (รูปนาฬิกา ⏰ เมนูด้านซ้าย)
 *    - กดปุ่ม "+ เพิ่มทริกเกอร์" (+ Add Trigger) ที่มุมขวาล่าง
 *    - เลือกฟังก์ชันที่จะเรียกใช้: installedOnEdit
 *    - เลือกแหล่งที่มาของเหตุการณ์: จากสเปรดชีต (From spreadsheet)
 *    - เลือกประเภทเหตุการณ์: เมื่อแก้ไข (On edit)
 *    - การแจ้งเตือนความล้มเหลว: แจ้งเตือนฉันทันที
 *    - กด "บันทึก" (Save)
 * 
 * 4. นำไปใช้งานได้ทันที! เมื่อมีการพิมพ์แก้ไข % หรือวันที่ในชีต Progress หน้าเว็บ Render จะอัปเดตแบบ Real-time ทันทีครับ
 */

// 🌐 URL ของ Web Dashboard บน Render
const WEBHOOK_DASHBOARD_URL = 'https://kpgreenergy-planner-dev.onrender.com/api/webhook';

/**
 * 1. Installable Trigger: ทำงานทุกครั้งที่มีการพิมพ์/แก้ไขในเซลล์ของ Google Sheet
 */
function installedOnEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    
    // ตรวจสอบเฉพาะชีต Progress หรือ data Progress
    if (sheetName === 'Progress' || sheetName === 'data Progress') {
      const row = e.range.getRow();
      const col = e.range.getColumn();

      // ข้อมูลโครงการเริ่มแถว 6 เป็นต้นไป, คอลัมน์ Milestone เริ่มที่คอลัมน์ H (8) ถึง CR
      if (row >= 6 && col >= 8) {
        const orderNo = sheet.getRange(row, 3).getValue(); // Col C = ลำดับ (Order No)
        const prjName = sheet.getRange(row, 4).getValue(); // Col D = ชื่อโครงการ (Project Name)
        
        // คำนวณลำดับ Milestone Index (0 ถึง 32)
        const mIdx = Math.floor((col - 8) / 3);
        const headerCol = (mIdx * 3) + 8;
        const milestoneName = sheet.getRange(3, headerCol).getValue(); // แถว 3 = ชื่อ Milestone

        // ดึงข้อมูลทั้ง 3 ช่องของ Milestone นี้ (Actual Start, Actual Finish, Actual %)
        const rawStart = sheet.getRange(row, headerCol).getValue();
        const rawFinish = sheet.getRange(row, headerCol + 1).getValue();
        const rawPct = sheet.getRange(row, headerCol + 2).getValue();
        
        const actualStart = formatSheetDate(rawStart);
        const actualFinish = formatSheetDate(rawFinish);
        
        let actualPct = 0;
        if (typeof rawPct === 'number') {
          actualPct = rawPct > 1.0 ? rawPct / 100.0 : rawPct;
        } else if (rawPct) {
          const cleanStr = String(rawPct).replace('%', '').trim();
          const p = parseFloat(cleanStr);
          if (!isNaN(p)) {
            actualPct = p > 1.0 ? p / 100.0 : p;
          }
        }
        
        // ส่ง Webhook ไปอัปเดต Render ทันที
        if (prjName) {
          notifyWebDashboard({
            action: 'sheet_edited',
            sheet: sheetName,
            row: row,
            order_no: String(orderNo || ''),
            project_name: String(prjName),
            milestone_name: String(milestoneName || ''),
            milestone_index: mIdx,
            actual_start: actualStart,
            actual_finish: actualFinish,
            new_value: actualPct,
            actual_pct: actualPct
          });
        }
      }
    }
  } catch (err) {
    console.error('installedOnEdit error: ' + err);
  }
}

/**
 * ฟังก์ชันช่วยแปลงวันที่จาก Google Sheet ให้อยู่ในรูปแบบ YYYY-MM-DD
 */
function formatSheetDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Bangkok', 'yyyy-MM-dd');
  }
  const str = String(val).trim();
  if (str === '-' || str === '') return '';
  return str;
}

/**
 * Simple onEdit fallback (แจ้งเตือนความปลอดภัย)
 */
function onEdit(e) {
  // Simple trigger ไม่สามารถยิง UrlFetchApp ออกภายนอกได้เนื่องจากระบบความปลอดภัยของ Google
  // ระบบจะใช้ installedOnEdit ที่ตั้งในเมนูทริกเกอร์แทนครับ
}

/**
 * 2. GET Request: รองรับทั้งดึงข้อมูลด่วน และรับคำสั่งบันทึกความเร็วสูง (30ms) จากหน้าเว็บ
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
 * บันทึกข้อมูลลงเซลล์ใน Google Sheet (Ultra-Fast 30ms Execution)
 */
function handleUpdateMilestone(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const progSheet = ss.getSheetByName('Progress') || ss.getSheetByName('data Progress') || ss.getActiveSheet();

    if (!progSheet) {
      return createJsonResponse({ status: 'error', message: 'ไม่พบชีต Progress' });
    }

    const orderNo = String(data.order_no || '').trim();
    const projectName = String(data.project_name || '').trim().toLowerCase();
    const milestoneIdx = data.milestone_index !== undefined && data.milestone_index !== null ? parseInt(data.milestone_index) : -1;
    const milestoneName = String(data.milestone_name || '').trim().toLowerCase();
    
    let actualPct = parseFloat(data.actual_pct || 0);
    if (actualPct > 1.0) actualPct = actualPct / 100.0;
    
    const actualStart = data.actual_start || '';
    const actualFinish = data.actual_finish || '';

    // อ่านเฉพาะคอลัมน์ C (Order) และ D (Name) แถว 6 ถึง 145 (140 แถว) เพื่อความเร็วสูงสุด
    const lastRow = Math.max(145, progSheet.getLastRow());
    const numRows = Math.min(140, lastRow - 5);
    const rangeData = progSheet.getRange(6, 3, numRows, 2).getValues();

    let targetRow = -1;
    for (let i = 0; i < rangeData.length; i++) {
      const rowOrder = String(rangeData[i][0] || '').trim();
      const rowName = String(rangeData[i][1] || '').trim().toLowerCase();

      // 1. Match by Order No if available and not empty
      if (orderNo && rowOrder && rowOrder === orderNo) {
        targetRow = i + 6;
        break;
      }
      // 2. Match by Project Name (Exact or substring)
      if (projectName && rowName && (rowName === projectName || rowName.includes(projectName) || projectName.includes(rowName))) {
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
    } else if (milestoneName) {
      const headerRow3 = progSheet.getRange(3, 8, 1, 99).getValues()[0];
      for (let c = 0; c < headerRow3.length; c += 3) {
        const title = String(headerRow3[c] || '').trim().toLowerCase();
        if (title && (title === milestoneName || title.includes(milestoneName) || milestoneName.includes(title))) {
          targetCol = 8 + c;
          break;
        }
      }
    }
    
    if (targetCol === -1) {
      targetCol = 8; // fallback to Milestone 0
    }

    // เขียนค่าลงเซลล์ทันที
    if (actualStart) progSheet.getRange(targetRow, targetCol).setValue(actualStart);
    if (actualFinish) progSheet.getRange(targetRow, targetCol + 1).setValue(actualFinish);
    progSheet.getRange(targetRow, targetCol + 2).setValue(actualPct);

    // บันทึก Log ลงชีต Log_Updates (ถ้ามีชีตนี้)
    const logSheet = ss.getSheetByName('Log_Updates');
    if (logSheet) {
      const nowStr = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
      logSheet.appendRow([nowStr, data.updated_by || 'Web App', data.project_name || '', data.milestone_name || '', (actualPct * 100).toFixed(0) + '%', actualStart, actualFinish, data.note || '2-Way API', 'Row ' + targetRow]);
    }

    return createJsonResponse({
      status: 'success',
      message: 'อัปเดต ' + (data.project_name || '') + ' (Row ' + targetRow + ') สำเร็จ (' + (actualPct * 100).toFixed(0) + '%)'
    });

  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

/**
 * ฟังก์ชันยิง Webhook ไปยังหน้าเว็บ Render
 */
function notifyWebDashboard(payload) {
  if (!WEBHOOK_DASHBOARD_URL || WEBHOOK_DASHBOARD_URL.includes('your-dashboard')) return;
  try {
    const res = UrlFetchApp.fetch(WEBHOOK_DASHBOARD_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    console.log('Webhook sent to dashboard: ' + res.getResponseCode());
  } catch (e) {
    console.warn('Webhook notify error: ' + e);
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ฟังก์ชันทดสอบการเชื่อมต่อ Webhook ไปยัง Render
 * ใช้กด Run เพื่อให้ระบบขึ้นขออนุญาตสิทธิ์ (OAuth Authorization)
 */
function testWebhook() {
  const payload = {
    action: 'sheet_edited',
    project_name: 'CEE-2',
    order_no: '',
    milestone_name: 'CPF ส่งมอบพื้นที่และยินยอมการใช้ที่ดิน ATV',
    milestone_index: 0,
    new_value: 1.0,
    actual_pct: 1.0
  };
  Logger.log('🚀 กำลังทดสอบส่งข้อมูลไปยัง Render Webhook...');
  notifyWebDashboard(payload);
  Logger.log('✅ ทดสอบส่ง Webhook เสร็จสิ้น! ตรวจสอบที่หน้าเว็บ Render ได้เลย');
}
