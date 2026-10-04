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

// 🌐 URL และ Secret Key ของ Web Dashboard บน Render
const WEBHOOK_DASHBOARD_URL = 'https://kpgreenergy-planner-dev01.onrender.com/api/webhook';
const WEBHOOK_SECRET = 'kpg_sec_webhook_2026';

/**
 * 1. Installable Trigger: ทำงานทุกครั้งที่มีการพิมพ์/แก้ไขในเซลล์ของ Google Sheet
 */
function installedOnEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    const sNameLower = sheetName.trim().toLowerCase();
    
    // ตรวจสอบเฉพาะชีต Progress
    if (sNameLower.includes('progress')) {
      const startRow = e.range.getRow();
      const numRows = e.range.getNumRows();
      const startCol = e.range.getColumn();
      const numCols = e.range.getNumColumns();

      const endRow = startRow + numRows - 1;
      const endCol = startCol + numCols - 1;

      // ข้อมูลโครงการเริ่มแถว 6 เป็นต้นไป, คอลัมน์ Milestone เริ่มที่คอลัมน์ H (8) ถึง CR
      if (endRow >= 6 && endCol >= 8) {
        const effStartRow = Math.max(6, startRow);
        const effStartMIdx = Math.max(0, Math.floor((startCol - 8) / 3));
        const effEndMIdx = Math.min(32, Math.floor((endCol - 8) / 3));

        for (let r = effStartRow; r <= endRow; r++) {
          const orderNo = sheet.getRange(r, 3).getValue(); // Col C = ลำดับ (Order No)
          const prjName = sheet.getRange(r, 4).getValue(); // Col D = ชื่อโครงการ (Project Name)
          if (!prjName) continue;

          for (let mIdx = effStartMIdx; mIdx <= effEndMIdx; mIdx++) {
            const headerCol = (mIdx * 3) + 8;
            const milestoneName = sheet.getRange(3, headerCol).getValue(); // แถว 3 = ชื่อ Milestone

            // ดึงข้อมูลทั้ง 3 ช่องของ Milestone นี้ (Actual Start, Actual Finish, Actual %)
            const rawStart = sheet.getRange(r, headerCol).getValue();
            const rawFinish = sheet.getRange(r, headerCol + 1).getValue();
            const rawPct = sheet.getRange(r, headerCol + 2).getValue();
            
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

            // เติม % อัตโนมัติหากกรอกวันที่แต่เว้นช่อง % ไว้
            if (actualPct === 0) {
              if (actualFinish) {
                actualPct = 1.0;
              } else if (actualStart) {
                actualPct = 0.5;
              }
            }
            
            // ส่ง Webhook ไปอัปเดต Render ทันที
            notifyWebDashboard({
              action: 'sheet_edited',
              sheet: sheetName,
              row: r,
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
    }
    // ตรวจสอบชีต Weekly_Issues เมื่อมีการพิมพ์หรือแก้ไขปัญหาใน Google Sheet
    else if (sNameLower.includes('issue')) {
      const editRow = e.range.getRow();
      if (editRow >= 2) {
        const rowVals = sheet.getRange(editRow, 1, 1, 14).getValues()[0];
        const issueId = String(rowVals[0] || '').trim();
        const desc = String(rowVals[8] || '').trim();
        if (issueId && desc) {
          notifyWebDashboard({
            action: 'add_issue',
            issue: {
              id: issueId,
              project_id: String(rowVals[1] || '').trim(),
              site_name: String(rowVals[2] || '').trim(),
              lot: String(rowVals[3] || '').trim(),
              week: String(rowVals[4] || '').trim(),
              start_date: formatSheetDate(rowVals[5]),
              end_date: formatSheetDate(rowVals[6]) || null,
              category: String(rowVals[7] || '').trim(),
              description: desc,
              action_plan: String(rowVals[9] || '').trim(),
              status: String(rowVals[10] || 'OPEN').trim().toUpperCase(),
              severity: String(rowVals[11] || 'MEDIUM').trim().toUpperCase(),
              reported_by: String(rowVals[12] || 'วิศวกรโครงการ').trim()
            }
          });
        }
      }
    }
  } catch (err) {
    console.error('installedOnEdit error: ' + err);
  }
}

/**
 * ฟังก์ชันดึงรายการปัญหาทั้งหมดจากชีต Weekly_Issues
 */
function getAllIssuesFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const issueSheet = ss.getSheetByName('Weekly_Issues') || ss.getSheetByName('Issues');
  if (!issueSheet) return [];
  const lastRow = issueSheet.getLastRow();
  if (lastRow <= 1) return [];
  const rows = issueSheet.getRange(2, 1, lastRow - 1, 14).getValues();
  return rows.map(r => ({
    id: String(r[0] || '').trim(),
    project_id: String(r[1] || '').trim(),
    site_name: String(r[2] || '').trim(),
    lot: String(r[3] || '').trim(),
    week: String(r[4] || '').trim(),
    start_date: formatSheetDate(r[5]),
    end_date: formatSheetDate(r[6]) || null,
    category: String(r[7] || '').trim(),
    description: String(r[8] || '').trim(),
    action_plan: String(r[9] || '').trim(),
    status: String(r[10] || 'OPEN').trim().toUpperCase(),
    severity: String(r[11] || 'MEDIUM').trim().toUpperCase(),
    reported_by: String(r[12] || '').trim(),
    updated_at: String(r[13] || '')
  })).filter(i => i.id);
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
  const parts = str.split(/[\/\-]/);
  if (parts.length === 3) {
    let day = parts[0].padStart(2, '0');
    let month = parts[1].padStart(2, '0');
    let year = parseInt(parts[2]);
    if (year < 100) year += 2000;
    if (year > 2400) year -= 543;
    if (parseInt(month) > 12 && parseInt(day) <= 12) {
      const tmp = day; day = month; month = tmp;
    }
    return `${year}-${month}-${day}`;
  }
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
 * 2. GET Request: รองรับดึงข้อมูลด่วน, ดึงปัญหาทั้งหมด และรับคำสั่งบันทึก
 */
function doGet(e) {
  try {
    if (e && e.parameter) {
      if (e.parameter.action === 'update_milestone' || e.parameter.action === 'save_progress') {
        return handleUpdateMilestone(e.parameter);
      }
      if (e.parameter.action === 'get_issues') {
        return createJsonResponse({ status: 'success', issues: getAllIssuesFromSheet() });
      }
      if (e.parameter.action === 'get_photos') {
        return handleGetPhotos(e.parameter);
      }
      if (e.parameter.action === 'upload_photo' || e.parameter.action === 'save_photo') {
        return handlePhotoUpload(e.parameter);
      }
      if (e.parameter.action === 'create_project' || e.parameter.action === 'add_project') {
        return handleCreateProject(e.parameter);
      }
      if (e.parameter.action === 'get_sheets') {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        return createJsonResponse({ status: 'success', sheets: ss.getSheets().map(s => s.getName()) });
      }
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

    if (data && (data.action === 'create_project' || data.action === 'add_project')) {
      return handleCreateProject(data);
    }

    if (data && (data.action === 'add_issue' || data.action === 'update_issue')) {
      return handleIssueSync(data);
    }

    if (data && (data.action === 'upload_photo' || data.action === 'save_photo')) {
      return handlePhotoUpload(data);
    }

    if (data && data.action === 'get_photos') {
      return handleGetPhotos(data);
    }

    return createJsonResponse({ status: 'error', message: 'Invalid action' });
  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

/**
 * ฟังก์ชันช่วยค้นหาชีตตามชื่ออย่างยืดหยุ่น (ป้องกันปัญหาตัวพิมพ์เล็ก-ใหญ่ หรือมีช่องว่าง)
 */
function findSheetFlexible(ss, targetNames) {
  if (!ss) return null;
  const allSheets = ss.getSheets();
  const normalizedTargets = targetNames.map(t => String(t).trim().toUpperCase());
  
  // 1. Exact match (case-insensitive)
  for (let i = 0; i < allSheets.length; i++) {
    const sName = allSheets[i].getName().trim().toUpperCase();
    if (normalizedTargets.includes(sName)) {
      return allSheets[i];
    }
  }
  // 2. Substring match
  for (let i = 0; i < allSheets.length; i++) {
    const sName = allSheets[i].getName().trim().toUpperCase();
    for (let j = 0; j < normalizedTargets.length; j++) {
      if (sName.includes(normalizedTargets[j])) {
        return allSheets[i];
      }
    }
  }
  return null;
}

function findPlanSheet(ss) {
  return findSheetFlexible(ss, ['MASTER', 'Master', 'Plan', 'PLAN', 'Master Plan', 'MasterPlan']) || ss.getSheetByName('MASTER') || ss.getSheetByName('Plan');
}

function findProgressSheet(ss) {
  return findSheetFlexible(ss, ['data Progress', 'Progress', 'PROGRESS', 'Data Progress']) || ss.getSheetByName('data Progress') || ss.getSheetByName('Progress') || ss.getActiveSheet();
}

/**
 * บันทึกการสร้าง/อัปเดตโครงการใหม่ลงใน Google Sheet (ชีต MASTER/Plan และ data Progress)
 */
function handleCreateProject(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const planSheet = findPlanSheet(ss);
    const progSheet = findProgressSheet(ss);

    const orderNo = data.order_no || '';
    const projectName = String(data.name || data.project_name || '').trim();
    if (!projectName) {
      return createJsonResponse({ status: 'error', message: 'กรุณาระบุชื่อโครงการ' });
    }

    const bu = data.business_unit || 'ทั่วไป';
    const lot = data.lot || 'Lot 1';
    const capacity = parseFloat(data.capacity_kwp || 0);
    const installType = data.installation_type || 'Solar Rooftop';
    const typeCode = parseInt(data.type_code || 1);

    // 1. บันทึกลงในชีต data Progress (หรือ Progress)
    let progTargetRow = -1;
    if (progSheet) {
      const lastRow = progSheet.getLastRow();
      if (lastRow >= 6) {
        const existingNames = progSheet.getRange(6, 4, lastRow - 5, 1).getValues();
        for (let i = 0; i < existingNames.length; i++) {
          if (String(existingNames[i][0]).trim().toLowerCase() === projectName.toLowerCase()) {
            progTargetRow = i + 6;
            break;
          }
        }
      }

      if (progTargetRow === -1) {
        progTargetRow = Math.max(6, progSheet.getLastRow() + 1);
      }

      // Col A: BU, Col B: Empty, Col C: Order No, Col D: Name, Col E: Lot, Col F: Capacity, Col G: Installation
      progSheet.getRange(progTargetRow, 1, 1, 7).setValues([[
        bu, '', orderNo, projectName, lot, capacity, installType
      ]]);
    }

    // 2. บันทึกลงในชีต MASTER (หรือ Plan)
    let planTargetRow = -1;
    if (planSheet) {
      const lastRow = planSheet.getLastRow();
      if (lastRow >= 6) {
        const existingNames = planSheet.getRange(6, 3, lastRow - 5, 1).getValues();
        for (let i = 0; i < existingNames.length; i++) {
          if (String(existingNames[i][0]).trim().toLowerCase() === projectName.toLowerCase()) {
            planTargetRow = i + 6;
            break;
          }
        }
      }

      if (planTargetRow === -1) {
        planTargetRow = Math.max(6, planSheet.getLastRow() + 1);
      }

      // Col 1: BU, Col 2: Order No, Col 3: Name, Col 4: Lot, Col 5: Capacity, Col 6: Install, Col 7: Type Code
      planSheet.getRange(planTargetRow, 1, 1, 7).setValues([[
        bu, orderNo, projectName, lot, capacity, installType, typeCode
      ]]);

      // หากมีข้อมูล milestones ส่งมาด้วย ให้กรอก Planned Start / Finish / Weight ลงในแต่ละช่องแบบ Batch Write
      if (data.milestones && Array.isArray(data.milestones)) {
        const milestoneValues = [];
        for (let mIdx = 0; mIdx < Math.min(data.milestones.length, 33); mIdx++) {
          const m = data.milestones[mIdx];
          let w = parseFloat(m.weight || 0);
          if (w > 1.0) w = w / 100.0;
          milestoneValues.push(m.planned_start || '');
          milestoneValues.push(m.planned_finish || '');
          milestoneValues.push(w);
        }
        if (milestoneValues.length > 0) {
          planSheet.getRange(planTargetRow, 8, 1, milestoneValues.length).setValues([milestoneValues]);
        }
      }
    }

    // 3. บันทึก Log ลง Log_Updates
    const logSheet = ss.getSheetByName('Log_Updates');
    if (logSheet) {
      const nowStr = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
      const planNameUsed = planSheet ? planSheet.getName() : 'MASTER';
      const progNameUsed = progSheet ? progSheet.getName() : 'Progress';
      logSheet.appendRow([nowStr, 'Web Dashboard', projectName, 'All 33 Milestones', '0%', data.planned_start || '', data.planned_finish || '', 'สร้าง/อัปเดตลง ' + planNameUsed + ' และ ' + progNameUsed, '']);
    }

    return createJsonResponse({
      status: 'success',
      message: 'สร้าง/บันทึกโครงการ ' + projectName + ' ลงในชีต ' + (planSheet ? planSheet.getName() : 'MASTER') + ' และ ' + (progSheet ? progSheet.getName() : 'Progress') + ' สำเร็จแล้ว'
    });
  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

/**
 * บันทึกปัญหาลงในชีต Weekly_Issues (พร้อมระบบป้องกัน ID ชนกันระหว่างโครงการ)
 */
function handleIssueSync(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let issueSheet = ss.getSheetByName('Weekly_Issues') || ss.getSheetByName('Issues');
    if (!issueSheet) {
      issueSheet = ss.insertSheet('Weekly_Issues');
      const headers = ['Issue ID', 'Project ID', 'Site Name', 'Lot', 'Report Week', 'Start Date', 'End Date', 'Category', 'Description', 'Action Plan', 'Status', 'Severity', 'Reported By', 'Updated At'];
      issueSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      issueSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e2e8f0');
      issueSheet.setFrozenRows(1);
    }
    
    const issue = data.issue || data;
    let issueId = String(issue.id || '').trim();
    const reqPrjId = String(issue.project_id || '').trim();
    
    const lastRow = issueSheet.getLastRow();
    let foundRow = -1;
    let maxNum = 0;
    
    if (lastRow > 1) {
      const existingData = issueSheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (let i = 0; i < existingData.length; i++) {
        const rowId = String(existingData[i][0]).trim();
        const rowPrj = String(existingData[i][1]).trim();
        
        if (rowId.startsWith('ISS-')) {
          const numPart = parseInt(rowId.replace('ISS-', ''));
          if (!isNaN(numPart) && numPart > maxNum) {
            maxNum = numPart;
          }
        }
        
        if (rowId === issueId && issueId !== '') {
          // If action is update_issue OR belongs to same project -> update existing row
          if (data.action === 'update_issue' || reqPrjId === rowPrj || !rowPrj || !reqPrjId) {
            foundRow = i + 2;
          } else {
            // Collision: Same ID but DIFFERENT project! Must not overwrite!
            foundRow = -2; // Marker for collision
          }
        }
      }
    }
    
    if (foundRow === -2 || !issueId) {
      // Reassign new unique ID to avoid collision
      maxNum += 1;
      issueId = 'ISS-' + String(maxNum).padStart(3, '0');
      issue.id = issueId;
    }
    
    const rowValues = [
      issueId,
      issue.project_id || '',
      issue.site_name || '',
      issue.lot || '',
      issue.week || '',
      issue.start_date || '',
      issue.end_date || '',
      issue.category || '',
      issue.description || '',
      issue.action_plan || '',
      issue.status || '',
      issue.severity || '',
      issue.reported_by || '',
      new Date().toISOString()
    ];
    
    if (foundRow > 0) {
      issueSheet.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      issueSheet.appendRow(rowValues);
    }
    
    return createJsonResponse({ status: 'success', message: 'Issue saved to Google Sheet', issue_id: issueId });
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
    const progSheet = findProgressSheet(ss);

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

    // เขียนค่าลงเซลล์ทันทีแบบ Atomic Call (1 ครั้งแทนที่จะเป็น 3 ครั้ง เพื่อความเร็วสูงสุดและป้องกันข้อมูลขาดตอน)
    const currentCells = progSheet.getRange(targetRow, targetCol, 1, 3).getValues()[0];
    const newStart = actualStart || currentCells[0];
    let newFinish = actualFinish || currentCells[1];
    if (actualPct < 1.0) {
      newFinish = ''; // เคลียร์วันเสร็จสิ้นหากความคืบหน้ายังไม่ถึง 100%
    } else if (!newFinish) {
      newFinish = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    }
    progSheet.getRange(targetRow, targetCol, 1, 3).setValues([[newStart, newFinish, actualPct]]);

    // หากมีการระบุ planned_finish หรือ planned_start ให้อัปเดตลงชีต MASTER/Plan ด้วย
    if (data.planned_start || data.planned_finish) {
      const planSheet = findPlanSheet(ss);
      if (planSheet && targetRow > 0 && targetCol > 0) {
        const planCells = planSheet.getRange(targetRow, targetCol, 1, 2).getValues()[0];
        const pStart = data.planned_start || planCells[0];
        const pFinish = data.planned_finish || planCells[1];
        planSheet.getRange(targetRow, targetCol, 1, 2).setValues([[pStart, pFinish]]);
      }
    }

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
      headers: {
        'X-Webhook-Secret': WEBHOOK_SECRET
      },
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

/**
 * ฟังก์ชันทดสอบสร้างแท็บชีต Weekly_Issues ใน Google Sheet ทันที
 * สามารถเลือกฟังก์ชันนี้แล้วกด 'เรียกใช้' (Run) ใน Apps Script จะมีแท็บ Weekly_Issues โผล่มาที่ด้านล่างของชีตทันที
 */
function testCreateIssueSheet() {
  const testData = {
    action: 'add_issue',
    issue: {
      id: 'ISS-TEST-001',
      project_id: '1',
      site_name: 'ตัวอย่างไซต์งาน',
      lot: 'Lot 1',
      week: 'W1',
      start_date: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'),
      end_date: '',
      category: 'งานก่อสร้าง',
      description: 'ทดสอบการสร้างชีตและบันทึกปัญหาลงในแท็บ Weekly_Issues',
      action_plan: 'ตรวจสอบความถูกต้องของหัวคอลัมน์',
      status: 'In Progress',
      severity: 'Medium',
      reported_by: 'ผู้ดูแลระบบ'
    }
  };
  Logger.log('🚀 กำลังสร้างแท็บ Weekly_Issues และบันทึกแถวทดสอบ...');
  const res = handleIssueSync(testData);
  Logger.log('ผลลัพธ์: ' + JSON.stringify(res));
  Logger.log('✅ ดูที่แถบด้านล่างสุดของ Google Sheet จะมีแท็บแผ่นงานชื่อ "Weekly_Issues" เพิ่มขึ้นมาแล้วครับ!');
}

/**
 * บันทึกรูปภาพขึ้น Google Drive และเก็บ Metadata ในแท็บชีต Project_Photos
 */
function handlePhotoUpload(data) {
  try {
    const projectId = String(data.project_id || '').trim();
    const projectName = String(data.project_name || 'General').trim();
    const slot = parseInt(data.slot) || 1;
    const slotTitle = String(data.slot_title || ('Slot ' + slot)).trim();
    const photoDate = String(data.date || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd')).trim();
    const caption = String(data.caption || '').trim();
    const updatedBy = String(data.updated_by || 'Web App').trim();
    const base64Str = String(data.image_base64 || '').trim();

    let fileId = '';
    let directViewUrl = '';
    let driveDownloadUrl = '';

    if (base64Str) {
      // 1. ค้นหาหรือสร้างโฟลเดอร์หลัก KPGreenergy_Site_Photos ใน Google Drive
      let rootFolder;
      const rootFolders = DriveApp.getFoldersByName('KPGreenergy_Site_Photos');
      if (rootFolders.hasNext()) {
        rootFolder = rootFolders.next();
      } else {
        rootFolder = DriveApp.createFolder('KPGreenergy_Site_Photos');
      }

      // 2. ค้นหาหรือสร้างซับโฟลเดอร์ตามชื่อโครงการ
      const safeProjectFolder = projectName.replace(/[\/\\:*?"<>|]/g, '_');
      let prjFolder;
      const prjFolders = rootFolder.getFoldersByName(safeProjectFolder);
      if (prjFolders.hasNext()) {
        prjFolder = prjFolders.next();
      } else {
        prjFolder = rootFolder.createFolder(safeProjectFolder);
      }

      // 3. ถอดรหัส base64 และบันทึกเป็นไฟล์ภาพ
      const cleanBase64 = base64Str.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
      const decodedBytes = Utilities.base64Decode(cleanBase64);
      const fileName = 'Slot_' + slot + '_' + (photoDate.replace(/-/g, '') || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd')) + '_' + new Date().getTime() + '.jpg';
      const blob = Utilities.newBlob(decodedBytes, data.content_type || 'image/jpeg', fileName);
      
      const file = prjFolder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      fileId = file.getId();
      // Direct View URL ที่โหลดได้ทันทีบนเว็บและ PDF
      directViewUrl = 'https://lh3.googleusercontent.com/d/' + fileId;
      driveDownloadUrl = file.getDownloadUrl();
    } else if (data.photo_url) {
      directViewUrl = data.photo_url;
      fileId = data.drive_file_id || '';
    }

    // 4. บันทึก Metadata ลงชีต Project_Photos
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let photoSheet = ss.getSheetByName('Project_Photos') || ss.getSheetByName('Photos');
    if (!photoSheet) {
      photoSheet = ss.insertSheet('Project_Photos');
      const headers = ['Project ID', 'Project Name', 'Slot', 'Slot Title', 'File ID', 'View URL', 'Photo Date', 'Caption', 'Updated By', 'Updated At'];
      photoSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      photoSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#043327').setFontColor('#ffffff');
      photoSheet.setFrozenRows(1);
    }

    const nowStr = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
    const lastRow = photoSheet.getLastRow();
    let targetRow = -1;

    if (lastRow > 1) {
      const rows = photoSheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (let i = 0; i < rows.length; i++) {
        const rPrjId = String(rows[i][0]).trim();
        const rPrjName = String(rows[i][1]).trim().toLowerCase();
        const rSlot = parseInt(rows[i][2]);
        if ((rPrjId === projectId || (projectName && rPrjName === projectName.toLowerCase())) && rSlot === slot) {
          targetRow = i + 2;
          break;
        }
      }
    }

    const rowValues = [
      projectId,
      projectName,
      slot,
      slotTitle,
      fileId,
      directViewUrl,
      photoDate,
      caption,
      updatedBy,
      nowStr
    ];

    if (targetRow > 0) {
      photoSheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      photoSheet.appendRow(rowValues);
    }

    return createJsonResponse({
      status: 'success',
      message: 'บันทึกรูปภาพ Slot ' + slot + ' โครงการ ' + projectName + ' บน Google Drive สำเร็จ',
      file_id: fileId,
      photo_url: directViewUrl,
      download_url: driveDownloadUrl,
      slot: slot,
      date: photoDate,
      caption: caption,
      updated_at: nowStr
    });

  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

/**
 * ดึงรายการรูปภาพของโครงการจากชีต Project_Photos
 */
function handleGetPhotos(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const photoSheet = ss.getSheetByName('Project_Photos') || ss.getSheetByName('Photos');
    if (!photoSheet) {
      return createJsonResponse({ status: 'success', photos: [] });
    }

    const reqPrjId = String(data.project_id || '').trim();
    const reqPrjName = String(data.project_name || '').trim().toLowerCase();
    const lastRow = photoSheet.getLastRow();
    if (lastRow <= 1) {
      return createJsonResponse({ status: 'success', photos: [] });
    }

    const rows = photoSheet.getRange(2, 1, lastRow - 1, 10).getValues();
    const photos = [];

    for (let i = 0; i < rows.length; i++) {
      const rPrjId = String(rows[i][0]).trim();
      const rPrjName = String(rows[i][1]).trim().toLowerCase();
      
      let matched = false;
      if (reqPrjId && rPrjId === reqPrjId) matched = true;
      else if (reqPrjName && (rPrjName === reqPrjName || rPrjName.includes(reqPrjName) || reqPrjName.includes(rPrjName))) matched = true;
      else if (!reqPrjId && !reqPrjName) matched = true; // ดึงทั้งหมด

      if (matched) {
        photos.push({
          project_id: rows[i][0],
          project_name: rows[i][1],
          slot: parseInt(rows[i][2]),
          slot_title: rows[i][3],
          drive_file_id: rows[i][4],
          photo_url: rows[i][5],
          date: rows[i][6] instanceof Date ? Utilities.formatDate(rows[i][6], 'Asia/Bangkok', 'yyyy-MM-dd') : String(rows[i][6] || ''),
          caption: rows[i][7],
          updated_by: rows[i][8],
          updated_at: rows[i][9] instanceof Date ? Utilities.formatDate(rows[i][9], 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss') : String(rows[i][9] || '')
        });
      }
    }

    return createJsonResponse({ status: 'success', photos: photos });
  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

/**
 * ฟังก์ชันทดสอบระบบ Google Drive และสร้างแท็บ Project_Photos
 * ให้เลือกฟังก์ชันนี้แล้วกดปุ่ม 'เรียกใช้' (Run) 1 ครั้งเพื่ออนุญาตสิทธิ์ Google Drive
 */
function testDrivePhotoUpload() {
  Logger.log('🚀 กำลังทดสอบสร้างโฟลเดอร์ใน Google Drive และแท็บ Project_Photos...');
  const testData = {
    action: 'upload_photo',
    project_id: '1',
    project_name: 'CEE-2',
    slot: 1,
    slot_title: 'ภาพรวมหน้างาน (Overall Site Overview)',
    date: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'),
    caption: 'ทดสอบการสร้างแท็บ Project_Photos และการเชื่อมต่อ Google Drive',
    updated_by: 'ผู้ดูแลระบบ',
    image_base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  };
  const res = handlePhotoUpload(testData);
  Logger.log('ผลลัพธ์: ' + JSON.stringify(res));
  Logger.log('✅ ดูใน Google Drive จะมีโฟลเดอร์ KPGreenergy_Site_Photos/CEE-2 และแท็บชีต Project_Photos เพิ่มขึ้นมาแล้วครับ!');
}


