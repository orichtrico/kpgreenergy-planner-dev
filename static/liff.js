let liffProjects = [];
let liffCurrentProject = null;

// Offline Queue Helper
function getOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem('kpg_liff_offline_queue') || '[]');
  } catch {
    return [];
  }
}

function saveOfflineQueue(queue) {
  localStorage.setItem('kpg_liff_offline_queue', JSON.stringify(queue));
  updateOfflineBanner();
}

function updateOfflineBanner() {
  const banner = document.getElementById('liff-offline-banner');
  const btn = document.getElementById('liff-sync-queue-btn');
  const queue = getOfflineQueue();
  const isOffline = !navigator.onLine;

  if (!banner) return;

  if (isOffline || queue.length > 0) {
    banner.classList.remove('hidden');
    if (queue.length > 0) {
      banner.className = 'p-3 bg-amber-600 text-white rounded-2xl shadow-sm text-xs flex items-center justify-between';
      banner.querySelector('span').innerText = `มีรายการรอซิงค์ ${queue.length} รายการ (${isOffline ? 'ออฟไลน์' : 'ออนไลน์'})`;
      if (btn) btn.classList.remove('hidden');
    } else {
      banner.className = 'p-3 bg-slate-700 text-white rounded-2xl shadow-sm text-xs flex items-center justify-between';
      banner.querySelector('span').innerText = `โหมดออฟไลน์: บันทึกข้อมูลลงเครื่องได้ตามปกติ`;
      if (btn) btn.classList.add('hidden');
    }
  } else {
    banner.classList.add('hidden');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  
  window.addEventListener('online', () => {
    updateOfflineBanner();
    syncOfflineQueue();
  });
  window.addEventListener('offline', updateOfflineBanner);
  updateOfflineBanner();
  
  // Set default dates
  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById('liff-start-date').value = todayStr;
  document.getElementById('liff-finish-date').value = todayStr;
  
  const savedPwd = localStorage.getItem('liff_auth_pwd');
  const pwdEl = document.getElementById('liff-password');
  if (savedPwd && pwdEl) {
    pwdEl.value = savedPwd;
  }
  
  // Try initializing LINE LIFF SDK if LIFF ID is configured
  if (typeof liff !== 'undefined') {
    try {
      // liff.init({ liffId: "YOUR_LIFF_ID" });
    } catch (e) {
      console.log("LIFF not initialized in web mode:", e);
    }
  }

  await loadLiffData();
});

async function loadLiffData() {
  try {
    const [overviewRes, projectsRes] = await Promise.all([
      fetch('/api/overview'),
      fetch('/api/projects')
    ]);
    
    const overview = await overviewRes.json();
    const pData = await projectsRes.json();
    liffProjects = pData.projects || [];
    
    // Populate Lots
    const lotSel = document.getElementById('liff-lot-select');
    lotSel.innerHTML = '<option value="">-- เลือกเฟส / Lot --</option>';
    (overview.lots || []).forEach(lot => {
      lotSel.innerHTML += `<option value="${lot}">${lot}</option>`;
    });
    
    // Default first lot
    if (overview.lots && overview.lots.length > 0) {
      lotSel.value = overview.lots[0];
      onLiffLotChange();
    }
  } catch (err) {
    console.error("Error loading LIFF data:", err);
    alert("ไม่สามารถโหลดข้อมูลโครงการได้ กรุณาลองใหม่อีกครั้ง");
  }
}

function onLiffLotChange() {
  const selectedLot = document.getElementById('liff-lot-select').value;
  const prjSel = document.getElementById('liff-project-select');
  
  const filtered = liffProjects.filter(p => p.lot === selectedLot);
  prjSel.innerHTML = '<option value="">-- เลือกโครงการ --</option>';
  
  filtered.forEach(p => {
    prjSel.innerHTML += `<option value="${p.id}">${p.name} (${p.capacity_kwp} kWp)</option>`;
  });
  
  if (filtered.length > 0) {
    prjSel.value = filtered[0].id;
    onLiffProjectChange();
  }
}

async function onLiffProjectChange() {
  const prjId = document.getElementById('liff-project-select').value;
  if (!prjId) return;
  
  try {
    const res = await fetch(`/api/projects/${prjId}`);
    liffCurrentProject = await res.json();
    
    // Show Info Pill
    const pill = document.getElementById('liff-project-pill');
    pill.classList.remove('hidden');
    document.getElementById('liff-info-bu').innerText = liffCurrentProject.business_unit;
    document.getElementById('liff-info-cap').innerText = `${liffCurrentProject.capacity_kwp} kWp (${liffCurrentProject.installation_type})`;
    document.getElementById('liff-info-progress').innerText = `${liffCurrentProject.actual_progress_pct}% (แผน: ${liffCurrentProject.planned_progress_pct}%)`;
    
    // Populate Milestones
    const mSel = document.getElementById('liff-milestone-select');
    mSel.innerHTML = '<option value="">-- เลือกรายการงาน (Milestone) --</option>';
    
    (liffCurrentProject.milestones || []).forEach(m => {
      mSel.innerHTML += `<option value="${m.name}">${m.name} [น้ำหนัก ${(m.weight*100).toFixed(1)}%]</option>`;
    });
    
    if (liffCurrentProject.milestones && liffCurrentProject.milestones.length > 0) {
      mSel.value = liffCurrentProject.milestones[0].name;
      onLiffMilestoneChange();
    }
  } catch (err) {
    console.error("Error fetching project detail in LIFF:", err);
  }
}

function onLiffMilestoneChange() {
  if (!liffCurrentProject) return;
  const mName = document.getElementById('liff-milestone-select').value;
  const m = (liffCurrentProject.milestones || []).find(x => x.name === mName);
  
  const mInfo = document.getElementById('liff-milestone-info');
  if (m) {
    mInfo.classList.remove('hidden');
    document.getElementById('liff-m-weight').innerText = (m.weight * 100).toFixed(1) + '%';
    
    const statusEl = document.getElementById('liff-m-status');
    const pctVal = Math.round(m.actual_pct * 100);
    
    setLiffPct(pctVal);
    
    if (m.status === 'COMPLETED') {
      statusEl.className = 'px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-semibold';
      statusEl.innerText = 'เสร็จสมบูรณ์';
    } else if (m.status === 'IN_PROGRESS') {
      statusEl.className = 'px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 font-semibold';
      statusEl.innerText = 'กำลังดำเนินงาน';
    } else {
      statusEl.className = 'px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold';
      statusEl.innerText = 'รอดำเนินการ';
    }
    
    if (m.actual_start) document.getElementById('liff-start-date').value = m.actual_start;
    document.getElementById('liff-finish-date').value = (pctVal >= 100 && m.actual_finish) ? m.actual_finish : '';
  } else {
    mInfo.classList.add('hidden');
  }
}

function setLiffPct(val) {
  document.getElementById('liff-pct-slider').value = val;
  document.getElementById('liff-pct-val').innerText = val + '%';
  const finishInput = document.getElementById('liff-finish-date');
  if (val >= 100) {
    if (finishInput && !finishInput.value) {
      finishInput.value = new Date().toISOString().split('T')[0];
    }
  } else {
    if (finishInput) finishInput.value = '';
  }
}

async function submitLiffForm() {
  if (!liffCurrentProject) {
    alert("กรุณาเลือกโครงการก่อน");
    return;
  }
  
  const mName = document.getElementById('liff-milestone-select').value;
  if (!mName) {
    alert("กรุณาเลือกรายการงาน (Milestone)");
    return;
  }
  
  const pct = parseFloat(document.getElementById('liff-pct-slider').value);
  const startDate = document.getElementById('liff-start-date').value;
  const finishDate = document.getElementById('liff-finish-date').value;
  const note = document.getElementById('liff-note').value;
  const pwdInput = document.getElementById('liff-password');
  const pwd = (pwdInput && pwdInput.value.trim()) ? pwdInput.value.trim() : 'KPGEditor';
  const savedSheetUrl = localStorage.getItem('kpgreenergy_webapp_url') || localStorage.getItem('kpgreenergy_gsheet_url') || '';
  
  const payload = {
    project_id: liffCurrentProject.id,
    project_name: liffCurrentProject.name,
    milestone_name: mName,
    actual_pct: pct,
    actual_start: startDate,
    actual_finish: finishDate,
    note: note || 'อัปเดตผ่าน LINE LIFF',
    updated_by: 'LINE LIFF User',
    password: pwd,
    sheet_url: savedSheetUrl
  };

  const btn = document.getElementById('liff-submit-btn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="animate-spin mr-2">⏳</span> กำลังบันทึกข้อมูล...`;
  
  try {
    const res = await fetch('/api/update-milestone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'การบันทึกไม่สำเร็จ');
    }
    
    document.getElementById('liff-success-desc').innerText = `อัปเดต ${liffCurrentProject.name} -> ${mName} (${pct}%) เรียบร้อยแล้ว`;
    document.getElementById('liff-success-modal').classList.remove('hidden');
    lucide.createIcons();
    
  } catch (err) {
    console.warn("Network error or offline mode. Queueing update locally:", err);
    
    // Save to offline queue
    const queue = getOfflineQueue();
    queue.push({
      ...payload,
      queued_at: new Date().toISOString()
    });
    saveOfflineQueue(queue);

    document.getElementById('liff-success-desc').innerText = `[โหมดออฟไลน์] บันทึก ${liffCurrentProject.name} -> ${mName} (${pct}%) ลงในเครื่องเรียบร้อยแล้ว! ระบบจะซิงค์ให้อัตโนมัติเมื่อต่ออินเทอร์เน็ต`;
    document.getElementById('liff-success-modal').classList.remove('hidden');
    lucide.createIcons();

  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check" class="w-5 h-5"></i> <span>บันทึกความคืบหน้าเข้าระบบ</span>`;
    lucide.createIcons();
  }
}

async function syncOfflineQueue() {
  const queue = getOfflineQueue();
  if (queue.length === 0) return;

  const btn = document.getElementById('liff-sync-queue-btn');
  if (btn) btn.innerText = 'กำลังซิงค์...';

  const remaining = [];
  let successCount = 0;

  for (const item of queue) {
    try {
      const res = await fetch('/api/update-milestone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      if (res.ok) {
        successCount++;
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  saveOfflineQueue(remaining);

  if (successCount > 0) {
    alert(`ซิงค์ข้อมูลออฟไลน์เข้าระบบสำเร็จแล้ว ${successCount} รายการ!`);
    onLiffProjectChange();
  }
}

function resetLiffForNext() {
  document.getElementById('liff-success-modal').classList.add('hidden');
  onLiffProjectChange();
}
