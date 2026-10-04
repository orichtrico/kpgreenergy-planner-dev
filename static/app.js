// State
let globalOverview = null;
let allProjects = [];
let currentProject = null;
let currentTab = 'overview';
let cachedWeightMatrix = {};

// Charts references
let phaseBarChart = null;
let statusDonutChart = null;
let projectScurveChart = null;
let comparisonBarChart = null;
let lotScurveChart = null;
let scurveViewMode = 'cutoff'; // 'cutoff' | 'full'

async function setScurveViewMode(mode) {
  scurveViewMode = mode;
  const cutoffBtn = document.getElementById('scurve-view-cutoff-btn');
  const fullBtn = document.getElementById('scurve-view-full-btn');
  if (cutoffBtn && fullBtn) {
    if (mode === 'cutoff') {
      cutoffBtn.className = 'px-2.5 py-1 rounded-md text-slate-800 bg-white font-bold shadow-xs transition-all flex items-center gap-1.5 border border-slate-200/80';
      fullBtn.className = 'px-2.5 py-1 rounded-md text-slate-500 hover:text-slate-700 transition-all flex items-center gap-1.5';
    } else {
      fullBtn.className = 'px-2.5 py-1 rounded-md text-slate-800 bg-white font-bold shadow-xs transition-all flex items-center gap-1.5 border border-slate-200/80';
      cutoffBtn.className = 'px-2.5 py-1 rounded-md text-slate-500 hover:text-slate-700 transition-all flex items-center gap-1.5';
    }
  }
  await renderComparisonTab();
}
window.setScurveViewMode = setScurveViewMode;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  await loadInitialData();
  
  // Set current URL in LIFF integration box
  const liffUrlEl = document.getElementById('liff-url-text');
  if (liffUrlEl) {
    liffUrlEl.innerText = window.location.origin + '/liff';
  }
});

// Toast notification helper
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  const toastIcon = document.getElementById('toast-icon');
  
  toastMsg.innerText = msg;
  toastIcon.innerHTML = type === 'success' 
    ? `<i data-lucide="check-circle-2" class="w-5 h-5 text-emerald-400"></i>`
    : `<i data-lucide="alert-circle" class="w-5 h-5 text-rose-400"></i>`;
    
  toast.classList.remove('hidden');
  lucide.createIcons();
  
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

// Refresh all data
async function refreshData() {
  const icon = document.getElementById('refresh-icon');
  if (icon) icon.classList.add('animate-spin');
  
  try {
    await fetch('/api/sync-latest?t=' + Date.now(), { cache: 'no-store' });
  } catch(e) {}
  
  await loadInitialData();
  if (currentProject) {
    await selectProject(currentProject.id);
  }
  
  setTimeout(() => {
    if (icon) icon.classList.remove('animate-spin');
    showToast('ซิงค์และอัปเดตข้อมูลล่าสุดจาก Google Sheet เรียบร้อยแล้ว');
  }, 400);
}

// Fetch Initial Data
async function loadInitialData() {
  try {
    const [overviewRes, projectsRes] = await Promise.all([
      fetch('/api/overview?t=' + Date.now(), { cache: 'no-store' }),
      fetch('/api/projects?t=' + Date.now(), { cache: 'no-store' })
    ]);
    
    globalOverview = await overviewRes.json();
    const pData = await projectsRes.json();
    allProjects = pData.projects || [];
    
    renderKPIs();
    populateFilters();
    renderPhaseOverviewTab();
    renderComparisonTab();
    populateSimulatorDropdowns();
    populateCctvDropdown();
    populatePhotoProjectDropdown();
    
    // Initial fetch of issues
    fetchIssuesData().then(updateIssuesNavBadge).catch(() => {});
    
    // Select first project by default
    if (allProjects.length > 0 && !currentProject) {
      await selectProject(allProjects[0].id);
    }
    
    // Fetch initial data version
    try {
      const liveRes = await fetch('/api/live-status?t=' + Date.now(), { cache: 'no-store' });
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        currentDataVersion = liveData.version;
      }
    } catch(e) {}
    
  } catch (err) {
    console.error("Error loading data:", err);
    showToast("เกิดข้อผิดพลาดในการโหลดข้อมูล", "error");
  }
}

// Render Top KPI Cards
function renderKPIs() {
  if (!globalOverview) return;
  
  document.getElementById('kpi-total-projects').innerText = globalOverview.total_projects;
  document.getElementById('kpi-phases-count').innerText = (globalOverview.phases || []).length;
  document.getElementById('kpi-total-capacity').innerText = globalOverview.total_capacity_mwp + ' MW';
  document.getElementById('kpi-capacity-kwp').innerText = Number(globalOverview.total_capacity_kwp).toLocaleString();

  // Energized Sites Metric
  if (globalOverview.energized) {
    const engSitesEl = document.getElementById('kpi-energized-sites');
    if (engSitesEl) engSitesEl.innerText = `${globalOverview.energized.total_energized_sites} ไซต์`;
    
    const engPctEl = document.getElementById('kpi-energized-pct');
    if (engPctEl) engPctEl.innerText = `(${globalOverview.energized.pct_sites}%)`;
    
    const engMwpEl = document.getElementById('kpi-energized-mwp');
    if (engMwpEl) engMwpEl.innerText = `${globalOverview.energized.total_energized_mwp} MWp`;
  }
  
  document.getElementById('kpi-actual-progress').innerText = globalOverview.avg_actual_progress_pct + '%';
  document.getElementById('kpi-planned-progress').innerText = '/ ' + globalOverview.avg_planned_progress_pct + '%';
  
  const varPct = globalOverview.variance_pct;
  const varBadge = document.getElementById('kpi-variance-badge');
  if (varPct >= 0) {
    varBadge.innerHTML = `<span class="text-emerald-600 font-semibold">▲ เร็วกว่าแผน +${varPct}%</span>`;
  } else {
    varBadge.innerHTML = `<span class="text-rose-600 font-semibold">▼ ช้ากว่าแผน ${varPct}%</span>`;
  }
  
  document.getElementById('kpi-completed').innerText = `${globalOverview.completed_count} เสร็จ`;
  document.getElementById('kpi-ontrack').innerText = `${globalOverview.on_track_count} ปกติ`;
  document.getElementById('kpi-delayed').innerText = `${globalOverview.delayed_count} ล่าช้า`;
  
  const now = new Date();
  document.getElementById('kpi-update-time').innerText = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

// Populate Filter dropdowns
function populateFilters() {
  const lotSel = document.getElementById('filter-lot');
  const buSel = document.getElementById('filter-bu');
  const compareLotSel = document.getElementById('compare-lot-select');
  
  lotSel.innerHTML = '<option value="">-- ทุกล็อต / เฟส --</option>';
  compareLotSel.innerHTML = '<option value="ALL">แสดงทุกโครงการ (Top 25)</option>';
  (globalOverview.lots || []).forEach(lot => {
    lotSel.innerHTML += `<option value="${lot}">${lot}</option>`;
    compareLotSel.innerHTML += `<option value="${lot}">เฉพาะ ${lot}</option>`;
  });
  
  buSel.innerHTML = '<option value="">-- ทุกกลุ่มธุรกิจ --</option>';
  (globalOverview.business_units || []).forEach(bu => {
    buSel.innerHTML += `<option value="${bu}">${bu}</option>`;
  });
  
  updateProjectDropdown(allProjects);
}

function populateCctvDropdown() {
  const cctvSel = document.getElementById('cctv-project-select');
  if (!cctvSel) return;
  cctvSel.innerHTML = '<option value="">-- เลือกโครงการที่ต้องการดูกล้อง --</option>';
  allProjects.forEach(p => {
    cctvSel.innerHTML += `<option value="${p.id}">[${p.lot}] ${p.name}</option>`;
  });
}

function updateProjectDropdown(projectsList) {
  const prjSel = document.getElementById('select-project');
  prjSel.innerHTML = '';
  projectsList.forEach(p => {
    prjSel.innerHTML += `<option value="${p.id}">[${p.lot}] ${p.name} (${p.capacity_kwp} kWp)</option>`;
  });
  if (currentProject) {
    prjSel.value = currentProject.id;
  }
}

function switchTab(tabId) {
  currentTab = tabId;
  const tabs = ['overview', 'project', 'comparison', 'issues', 'cctv', 'photos', 'integration'];
  
  tabs.forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (el && btn) {
      if (t === tabId) {
        el.classList.remove('hidden');
        btn.className = 'py-3 px-1 border-b-2 border-amber-400 text-amber-300 flex items-center space-x-2 font-medium whitespace-nowrap';
      } else {
        el.classList.add('hidden');
        btn.className = 'py-3 px-1 border-b-2 border-transparent text-emerald-200/80 hover:text-white hover:border-emerald-400 flex items-center space-x-2 font-medium whitespace-nowrap';
      }
    }
  });
  
  lucide.createIcons();
  
  // Trigger chart resizes with slight delay so DOM layout is visible
  setTimeout(() => {
    if (tabId === 'overview') {
      if (phaseBarChart) phaseBarChart.render();
      if (statusDonutChart) statusDonutChart.render();
    } else if (tabId === 'project') {
      if (currentProject) {
        renderProjectDetail();
      }
    } else if (tabId === 'comparison') {
      renderComparisonTab();
    } else if (tabId === 'issues') {
      renderIssuesTab();
    } else if (tabId === 'photos') {
      renderPhotosTab();
    }
  }, 50);
}


// =========================================================================
// TAB 1: PHASE OVERVIEW
// =========================================================================
function renderPhaseOverviewTab() {
  if (!globalOverview) return;
  
  const phases = globalOverview.phases || [];
  
  // 1. Render Phase Bar Chart
  const phaseCategories = phases.map(p => p.lot);
  const plannedSeries = phases.map(p => p.avg_planned_progress);
  const actualSeries = phases.map(p => p.avg_actual_progress);
  
  const barOptions = {
    series: [
      { name: 'แผนงาน (Planned %)', data: plannedSeries },
      { name: 'ผลงานจริง (Actual %)', data: actualSeries }
    ],
    chart: {
      type: 'bar',
      height: '100%',
      toolbar: { show: false },
      fontFamily: 'Prompt, sans-serif'
    },
    colors: ['#3b82f6', '#10b981'],
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '55%',
        borderRadius: 4
      }
    },
    dataLabels: {
      enabled: false
    },
    stroke: {
      show: true,
      width: 2,
      colors: ['transparent']
    },
    xaxis: {
      categories: phaseCategories,
      labels: { style: { fontSize: '11px', colors: '#64748b' } }
    },
    yaxis: {
      max: 100,
      title: { text: '% ความก้าวหน้า' },
      labels: { formatter: val => Math.round(val) + '%' }
    },
    fill: { opacity: 1 },
    tooltip: {
      y: { formatter: val => val + '%' }
    },
    legend: { position: 'top', fontSize: '12px' }
  };
  
  const chartEl = document.getElementById('phase-bar-chart');
  if (chartEl) {
    if (phaseBarChart) phaseBarChart.destroy();
    phaseBarChart = new ApexCharts(chartEl, barOptions);
    phaseBarChart.render();
  }
  
  // 2. Render Status Donut Chart
  const donutOptions = {
    series: [globalOverview.completed_count, globalOverview.on_track_count, globalOverview.delayed_count],
    labels: ['เสร็จสมบูรณ์', 'ตามแผนงาน', 'ล่าช้ากว่าแผน'],
    colors: ['#10b981', '#3b82f6', '#f43f5e'],
    chart: {
      type: 'donut',
      height: 220,
      fontFamily: 'Prompt, sans-serif'
    },
    legend: { show: false },
    dataLabels: { enabled: true, formatter: (val) => Math.round(val) + '%' },
    plotOptions: {
      pie: {
        donut: {
          size: '70%',
          labels: {
            show: true,
            total: {
              show: true,
              label: 'โครงการ',
              fontSize: '12px',
              color: '#64748b',
              formatter: () => globalOverview.total_projects
            }
          }
        }
      }
    }
  };
  
  const donutEl = document.getElementById('status-donut-chart');
  if (donutEl) {
    if (statusDonutChart) statusDonutChart.destroy();
    statusDonutChart = new ApexCharts(donutEl, donutOptions);
    statusDonutChart.render();
  }
  
  document.getElementById('donut-stat-completed').innerText = globalOverview.completed_count;
  document.getElementById('donut-stat-ontrack').innerText = globalOverview.on_track_count;
  document.getElementById('donut-stat-delayed').innerText = globalOverview.delayed_count;
  
  // 3. Render Phase Cards Grid
  const container = document.getElementById('phase-cards-container');
  container.innerHTML = '';
  
  phases.forEach(phase => {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm hover:shadow-md transition cursor-pointer';
    card.onclick = () => filterByPhaseAndOpen(phase.lot);
    
    const diff = round(phase.avg_actual_progress - phase.avg_planned_progress, 1);
    const diffBadge = diff >= 0
      ? `<span class="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">▲ +${diff}%</span>`
      : `<span class="text-xs font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">▼ ${diff}%</span>`;
      
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800">${phase.lot}</span>
        ${diffBadge}
      </div>
      
      <div class="mt-3">
        <div class="flex items-baseline justify-between">
          <h4 class="font-bold text-slate-800 text-lg">${phase.project_count} โครงการ</h4>
          <span class="text-xs font-medium text-slate-500">${phase.total_capacity_kwp.toLocaleString()} kWp</span>
        </div>
      </div>
      
      <!-- Progress bar -->
      <div class="mt-4 space-y-1.5">
        <div class="flex justify-between text-xs font-medium">
          <span class="text-slate-600">ผลงานจริง: <strong class="text-emerald-600">${phase.avg_actual_progress}%</strong></span>
          <span class="text-slate-400">แผน: ${phase.avg_planned_progress}%</span>
        </div>
        <div class="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
          <div class="bg-gradient-to-r from-emerald-500 to-teal-400 h-2.5 rounded-full transition-all" style="width: ${Math.min(100, phase.avg_actual_progress)}%"></div>
        </div>
      </div>
      
      <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span>เสร็จ: ${phase.completed_count} | ช้า: ${phase.delayed_count}</span>
        <span class="text-amber-600 font-medium hover:underline flex items-center gap-0.5">
          ดูรายละเอียด <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
        </span>
      </div>
    `;
    container.appendChild(card);
  });
  
  lucide.createIcons();
}

function filterByPhaseAndOpen(lotName) {
  document.getElementById('filter-lot').value = lotName;
  onLotChange();
  switchTab('project');
}

// =========================================================================
// TAB 2: PROJECT DETAIL & S-CURVE
// =========================================================================
function onLotChange() {
  const lotVal = document.getElementById('filter-lot').value;
  const buVal = document.getElementById('filter-bu').value;
  
  const filtered = allProjects.filter(p => {
    if (lotVal && p.lot !== lotVal) return false;
    if (buVal && p.business_unit !== buVal) return false;
    return true;
  });
  
  updateProjectDropdown(filtered);
  if (filtered.length > 0) {
    selectProject(filtered[0].id);
  }
}

function onBuChange() {
  onLotChange();
}

function onProjectSelect() {
  const prjId = document.getElementById('select-project').value;
  if (prjId) {
    selectProject(prjId);
  }
}

async function selectProject(projectId) {
  try {
    const res = await fetch(`/api/projects/${projectId}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error("Project not found");
    currentProject = await res.json();
    renderProjectDetail();
  } catch (err) {
    console.error("Error fetching project:", err);
  }
}

function renderProjectDetail() {
  if (!currentProject) return;
  const p = currentProject;
  
  document.getElementById('prj-lot-badge').innerText = p.lot;
  document.getElementById('prj-bu-badge').innerText = p.business_unit;
  document.getElementById('prj-type-badge').innerText = `Type ${p.type_code}`;
  document.getElementById('prj-name').innerText = p.name;
  document.getElementById('prj-install-type').innerText = `${p.installation_type} • ${p.capacity_kwp} kWp`;
  
  document.getElementById('prj-act-pct').innerText = p.actual_progress_pct + '%';
  document.getElementById('prj-plan-pct').innerText = '/ ' + p.planned_progress_pct + '%';
  
  const pill = document.getElementById('prj-status-pill');
  if (p.status === 'COMPLETED') {
    pill.className = 'inline-block mt-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800';
    pill.innerText = 'เสร็จสมบูรณ์';
  } else if (p.status === 'DELAYED') {
    pill.className = 'inline-block mt-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800';
    pill.innerText = `ล่าช้า ${p.variance_pct}%`;
  } else {
    pill.className = 'inline-block mt-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800';
    pill.innerText = 'ตามแผนงาน';
  }
  
  document.getElementById('prj-plan-start').innerText = p.planned_start || '-';
  document.getElementById('prj-plan-finish').innerText = p.planned_finish || '-';
  document.getElementById('prj-act-start').innerText = p.actual_start || '-';
  document.getElementById('prj-act-finish').innerText = p.actual_finish || '-';
  
  // Render S-Curve
  renderProjectScurve(p.s_curve);
  
  // Render Milestone Table
  renderMilestonesTable(p.milestones || []);
  
  // Check and render site issue alert if any
  checkAndRenderProjectIssues(p.id);
}

function renderProjectScurve(scurveData) {
  const chartEl = document.getElementById('project-scurve-chart');
  if (!chartEl) return;
  
  if (!scurveData || !scurveData.weeks || scurveData.weeks.length === 0) {
    chartEl.innerHTML = '<div class="flex items-center justify-center h-full text-slate-400 text-sm font-medium">ไม่มีข้อมูล S-Curve สำหรับโครงการนี้</div>';
    return;
  }
  
  const options = {
    series: [
      {
        name: 'Planned Cumulative S-Curve (%)',
        type: 'line',
        data: scurveData.planned_cum || []
      },
      {
        name: 'Actual Cumulative S-Curve (%)',
        type: 'line',
        data: scurveData.actual_cum || []
      },
      {
        name: 'Planned Weekly (%)',
        type: 'column',
        data: scurveData.planned_weekly || []
      },
      {
        name: 'Actual Weekly (%)',
        type: 'column',
        data: scurveData.actual_weekly || []
      }
    ],
    chart: {
      height: '100%',
      type: 'line',
      stacked: false,
      toolbar: {
        show: true,
        tools: { download: true, zoom: true, reset: true }
      },
      fontFamily: 'Prompt, sans-serif'
    },
    stroke: {
      width: [3.5, 3.5, 0, 0],
      curve: 'smooth',
      dashArray: [0, 0, 0, 0]
    },
    colors: ['#2563eb', '#10b981', '#93c5fd', '#6ee7b7'],
    fill: {
      opacity: [1, 1, 0.35, 0.45]
    },
    labels: scurveData.labels || [],
    xaxis: {
      type: 'category',
      labels: {
        rotate: -45,
        rotateAlways: false,
        style: { fontSize: '10px', colors: '#64748b' }
      }
    },
    yaxis: [
      {
        title: { text: 'Cumulative %' },
        min: 0,
        max: 100,
        labels: { formatter: val => Math.round(val) + '%' }
      },
      {
        opposite: true,
        show: false,
        min: 0,
        max: 100
      },
      {
        opposite: true,
        title: { text: 'Weekly %' },
        min: 0,
        max: 30,
        labels: { formatter: val => val ? val.toFixed(1) + '%' : '' }
      },
      {
        opposite: true,
        show: false,
        min: 0,
        max: 30
      }
    ],
    tooltip: {
      shared: true,
      intersect: false,
      y: {
        formatter: function (y) {
          if (typeof y !== "undefined" && y !== null) {
            return y.toFixed(2) + "%";
          }
          return "-";
        }
      }
    },
    legend: {
      position: 'top',
      fontSize: '12px'
    }
  };
  
  if (projectScurveChart) {
    try { projectScurveChart.destroy(); } catch (e) {}
  }
  chartEl.innerHTML = '';
  projectScurveChart = new ApexCharts(chartEl, options);
  projectScurveChart.render();
}

function renderMilestonesTable(milestones) {
  const tbody = document.getElementById('milestones-table-body');
  tbody.innerHTML = '';
  document.getElementById('milestones-count-label').innerText = `${milestones.length} งานทั้งหมด`;
  
  milestones.forEach((m, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition';
    
    const pctVal = Math.round((m.actual_pct || 0) * 100);
    const weightPct = ((m.weight || 0) * 100).toFixed(1) + '%';
    const contribPct = ((m.actual_contribution || 0) * 100).toFixed(2) + '%';
    
    let statusBadge = '';
    if (m.status === 'COMPLETED') {
      statusBadge = '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-semibold">เสร็จสิ้น</span>';
    } else if (m.status === 'IN_PROGRESS') {
      statusBadge = '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold">กำลังทำ</span>';
    } else {
      statusBadge = '<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold">รอดำเนินการ</span>';
    }
    
    let catBadge = '';
    const catStr = String(m.category || '');
    if (catStr.includes('Permission') || catStr.includes('ราชการ')) {
      catBadge = '<span class="text-[10px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">งานราชการ</span>';
    } else if (catStr.includes('Engineering') || catStr.includes('ออกแบบ')) {
      catBadge = '<span class="text-[10px] text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded">ออกแบบ</span>';
    } else {
      catBadge = '<span class="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded">ก่อสร้าง</span>';
    }

    
    tr.innerHTML = `
      <td class="py-3 px-4 font-medium text-slate-900">${m.name}</td>
      <td class="py-3 px-3">${catBadge}</td>
      <td class="py-3 px-3 text-center font-mono font-semibold text-slate-700">${weightPct}</td>
      <td class="py-3 px-3 text-slate-500 font-mono">${m.planned_start || '-'} <br><span class="text-slate-400">ถึง</span> ${m.planned_finish || '-'}</td>
      <td class="py-3 px-3 text-slate-700 font-mono">${m.actual_start || '-'} <br><span class="text-slate-400">ถึง</span> ${(pctVal >= 100 && m.actual_finish) ? m.actual_finish : '-'}</td>
      <td class="py-3 px-4">
        <div class="flex items-center space-x-2">
          <div class="w-20 bg-slate-100 rounded-full h-2 overflow-hidden">
            <div class="bg-amber-500 h-2 rounded-full" style="width: ${pctVal}%"></div>
          </div>
          <span class="font-bold text-slate-800 w-8 text-right">${pctVal}%</span>
        </div>
      </td>
      <td class="py-3 px-3 text-center font-mono font-semibold text-emerald-600">${contribPct}</td>
      <td class="py-3 px-3 text-center">${statusBadge}</td>
      <td class="py-3 px-3 text-center">
        <button onclick="openQuickUpdateModalByIndex(${idx})" class="p-1 text-slate-400 hover:text-amber-600 rounded hover:bg-amber-50" title="แก้ไข">
          <i data-lucide="edit-2" class="w-4 h-4"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  lucide.createIcons();
}

// =========================================================================
// =========================================================================
// TAB 3: MULTI-PROJECT COMPARISON & ANALYTICS
// =========================================================================
let cachedLotProgressData = null;
let currentLotFilter = 'ALL';

async function renderComparisonTab() {
  if (!allProjects || allProjects.length === 0) return;
  
  const lotSel = document.getElementById('compare-lot-select');
  const weekSel = document.getElementById('compare-week-select');
  const modeSel = document.getElementById('compare-mode-select');
  const sortSel = document.getElementById('compare-sort-select');
  
  // 1. Populate Lot Filter Dropdown if needed
  if (lotSel && globalOverview && globalOverview.lots) {
    const currentVal = lotSel.value;
    if (lotSel.options.length <= 1) {
      lotSel.innerHTML = '<option value="ALL">ทุกล็อต (All Lots)</option>';
      globalOverview.lots.forEach(lot => {
        lotSel.innerHTML += `<option value="${lot}">Lot: ${lot}</option>`;
      });
      if (currentVal && currentVal !== 'ALL') {
        lotSel.value = currentVal;
      } else if (globalOverview.lots.includes('LOT4')) {
        lotSel.value = 'LOT4'; // Recommended default
      }
    }
  }
  
  const selectedLot = lotSel ? lotSel.value : 'ALL';
  currentLotFilter = selectedLot;

  // 2. Fetch or retrieve weekly progress data from API
  let lotData = null;
  try {
    const res = await fetch(`/api/lot-weekly-progress?lot=${encodeURIComponent(selectedLot)}&t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      lotData = await res.json();
      cachedLotProgressData = lotData;
    }
  } catch (err) {
    console.warn("Could not fetch lot weekly progress, falling back to cached:", err);
  }

  if (!lotData && cachedLotProgressData) {
    lotData = cachedLotProgressData;
  }
  
  if (!lotData) return;

  // 3. Populate Week Filter Dropdown dynamically matching lotData weeks
  const targetWeekCount = lotData.week_labels ? lotData.week_labels.length : 0;
  const currentOptionsCount = weekSel ? (weekSel.options.length - 2) : 0;

  if (weekSel && targetWeekCount > 0 && (currentOptionsCount !== targetWeekCount || lotSel?.dataset?.prevLot !== selectedLot)) {
    const curWeekVal = weekSel.value;
    if (lotSel) lotSel.dataset.prevLot = selectedLot;

    const cwi = lotData.current_week_index !== undefined ? lotData.current_week_index : 0;
    const curWeekName = (lotData.week_labels && lotData.week_labels[cwi]) ? ` (${lotData.week_labels[cwi]})` : '';

    weekSel.innerHTML = `<option value="latest">📌 สัปดาห์ปัจจุบัน${curWeekName} (As of Today)</option>`;
    weekSel.innerHTML += `<option value="all">🌐 แสดงตลอดโครงการ (ทั้งหมด ${targetWeekCount} สัปดาห์)</option>`;
    lotData.week_labels.forEach((wLabel, idx) => {
      weekSel.innerHTML += `<option value="${idx}">สัปดาห์ที่ ${idx + 1}: ${wLabel}</option>`;
    });

    if (curWeekVal === 'all') {
      weekSel.value = 'all';
    } else if (curWeekVal !== 'latest') {
      const pIdx = parseInt(curWeekVal);
      if (!isNaN(pIdx) && pIdx >= 0 && pIdx < targetWeekCount) {
        weekSel.value = String(pIdx);
      } else {
        weekSel.value = 'latest';
      }
    } else {
      weekSel.value = 'latest';
    }
  }

  const selectedWeek = weekSel ? weekSel.value : 'latest';
  const selectedMode = modeSel ? modeSel.value : 'cumulative';
  const selectedSort = sortSel ? sortSel.value : 'capacity_desc';

  // Safe week index clamped within available lot week range
  let wIdx = null;
  if (selectedWeek === 'all') {
    wIdx = targetWeekCount > 0 ? targetWeekCount - 1 : 0;
  } else if (selectedWeek !== 'latest') {
    const parsed = parseInt(selectedWeek);
    if (!isNaN(parsed) && parsed >= 0) {
      const maxW = targetWeekCount > 0 ? targetWeekCount - 1 : 0;
      wIdx = Math.max(0, Math.min(parsed, maxW));
    }
  }

  // 4. Extract site progress data based on chosen Week & Mode
  const sites = (lotData.sites || []).map(s => {
    let pVal = s.planned_progress_pct || 0;
    let aVal = s.actual_progress_pct || 0;

    if (wIdx !== null) {
      if (selectedMode === 'weekly') {
        const wpLen = s.weekly_planned ? s.weekly_planned.length : 0;
        const waLen = s.weekly_actual ? s.weekly_actual.length : 0;
        pVal = (wIdx < wpLen && s.weekly_planned[wIdx] !== undefined) ? s.weekly_planned[wIdx] : 0;
        aVal = (wIdx < waLen && s.weekly_actual[wIdx] !== undefined) ? s.weekly_actual[wIdx] : 0;
      } else {
        const cpLen = s.cumulative_planned ? s.cumulative_planned.length : 0;
        const caLen = s.cumulative_actual ? s.cumulative_actual.length : 0;
        if (cpLen > 0) {
          const safeP = Math.min(wIdx, cpLen - 1);
          pVal = s.cumulative_planned[safeP] !== undefined ? s.cumulative_planned[safeP] : (s.planned_progress_pct || 0);
        }
        if (caLen > 0) {
          const safeA = Math.min(wIdx, caLen - 1);
          aVal = s.cumulative_actual[safeA] !== undefined ? s.cumulative_actual[safeA] : (s.actual_progress_pct || 0);
        }
      }
    }

    const varVal = roundNumber(aVal - pVal, 2);
    return {
      ...s,
      display_plan: Math.max(0, Math.min(100, pVal)),
      display_actual: Math.max(0, Math.min(100, aVal)),
      display_variance: varVal
    };
  });

  // 5. Apply Sorting
  if (selectedSort === 'capacity_desc') {
    sites.sort((a, b) => (b.capacity_kwp || 0) - (a.capacity_kwp || 0));
  } else if (selectedSort === 'name_asc') {
    sites.sort((a, b) => a.name.localeCompare(b.name, 'th'));
  } else if (selectedSort === 'variance_asc') {
    sites.sort((a, b) => a.display_variance - b.display_variance);
  } else if (selectedSort === 'actual_desc') {
    sites.sort((a, b) => b.display_actual - a.display_actual);
  }

  // 6. Update Lot Summary KPI Cards
  const totalSites = sites.length;
  const totalCapKwp = sites.reduce((sum, s) => sum + (s.capacity_kwp || 0), 0);
  const avgPlan = totalCapKwp > 0 ? sites.reduce((sum, s) => sum + (s.display_plan * s.capacity_kwp), 0) / totalCapKwp : 0;
  const avgAct = totalCapKwp > 0 ? sites.reduce((sum, s) => sum + (s.display_actual * s.capacity_kwp), 0) / totalCapKwp : 0;
  const avgVar = avgAct - avgPlan;

  const kpiSitesEl = document.getElementById('lot-kpi-sites');
  if (kpiSitesEl) kpiSitesEl.innerText = `${totalSites} ไซต์`;

  const kpiCapEl = document.getElementById('lot-kpi-capacity');
  if (kpiCapEl) kpiCapEl.innerText = `${totalCapKwp.toLocaleString('th-TH', { maximumFractionDigits: 1 })} kWp (${(totalCapKwp / 1000).toFixed(2)} MWp)`;

  const kpiPlanEl = document.getElementById('lot-kpi-plan');
  if (kpiPlanEl) kpiPlanEl.innerText = `${avgPlan.toFixed(1)}%`;

  const kpiActEl = document.getElementById('lot-kpi-actual');
  if (kpiActEl) kpiActEl.innerText = `${avgAct.toFixed(1)}%`;

  const kpiVarEl = document.getElementById('lot-kpi-variance');
  if (kpiVarEl) {
    kpiVarEl.innerText = `${avgVar >= 0 ? '+' : ''}${avgVar.toFixed(1)}%`;
    kpiVarEl.className = avgVar >= 0 
      ? 'text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800'
      : 'text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800';
  }

  // Update Section Header Titles
  const chartTitleEl = document.getElementById('chart-lot-title');
  if (chartTitleEl) {
    chartTitleEl.innerText = `กราฟแท่งแนวตั้งเปรียบเทียบ Plan & Actual: ${selectedLot === 'ALL' ? 'ทุกล็อต (104 ไซต์)' : 'Lot ' + selectedLot} (${totalSites} ไซต์)`;
  }
  const chartSubEl = document.getElementById('chart-lot-subtitle');
  if (chartSubEl) {
    const selectedWeekText = (weekSel && weekSel.selectedIndex >= 0 && weekSel.options[weekSel.selectedIndex]) ? weekSel.options[weekSel.selectedIndex].text : 'สัปดาห์ปัจจุบัน';
    chartSubEl.innerText = `แกน X แสดงชื่อไซต์และขนาดกำลังการผลิต (kWp) • โหมด: ${selectedMode === 'weekly' ? 'เฉพาะสัปดาห์' : 'สะสม'} (${selectedWeek === 'latest' ? 'สัปดาห์ปัจจุบัน' : selectedWeekText})`;
  }

  // 6.1 Render 3-Category Delay Breakdown Cards (Permission, Design, Construction)
  const catContainer = document.getElementById('lot-category-cards-container');
  if (catContainer) {
    let breakdownList = [];
    const isWeeklyMode = (selectedMode === 'weekly');
    let weekLabelText = 'สัปดาห์ปัจจุบัน (As of Today)';

    if (wIdx !== null && lotData.category_breakdown_by_week && lotData.category_breakdown_by_week.length > 0) {
      const safeCatIdx = Math.min(wIdx, lotData.category_breakdown_by_week.length - 1);
      breakdownList = lotData.category_breakdown_by_week[safeCatIdx] || lotData.category_breakdown || [];
      if (weekSel && weekSel.options && weekSel.selectedIndex >= 0 && weekSel.options[weekSel.selectedIndex]) {
        weekLabelText = weekSel.options[weekSel.selectedIndex].text;
      } else if (lotData.week_labels && lotData.week_labels[safeCatIdx]) {
        weekLabelText = `สัปดาห์ที่ ${safeCatIdx + 1}: ${lotData.week_labels[safeCatIdx]}`;
      }
    } else {
      if (lotData.current_week_index !== undefined && lotData.category_breakdown_by_week && lotData.category_breakdown_by_week[lotData.current_week_index]) {
        breakdownList = lotData.category_breakdown_by_week[lotData.current_week_index];
      } else {
        breakdownList = lotData.category_breakdown || [];
      }
      if (lotData.current_week_index !== undefined && lotData.week_labels && lotData.week_labels[lotData.current_week_index]) {
        weekLabelText = `สัปดาห์ปัจจุบัน: ${lotData.week_labels[lotData.current_week_index]}`;
      }
    }

    // Update Category Header Subtitle & Badge
    const catSubEl = document.getElementById('lot-category-subtitle');
    if (catSubEl) {
      catSubEl.innerHTML = `แบ่งตาม: งานขออนุญาตราชการ, งานออกแบบวิศวกรรม, งานก่อสร้างและติดตั้ง • <span class="font-semibold text-emerald-700">ข้อมูล ณ: ${weekLabelText}</span> <span class="text-slate-400 font-medium">(${isWeeklyMode ? 'เฉพาะสัปดาห์' : 'สะสม'})</span>`;
    }
    const catBadgeEl = document.getElementById('lot-category-badge');
    if (catBadgeEl) {
      catBadgeEl.innerText = `Lot: ${selectedLot === 'ALL' ? 'ทุกล็อต' : selectedLot} (${totalSites} ไซต์)`;
    }

    const catIcons = {
      "งานราชการ": "file-check",
      "งานออกแบบ": "compass",
      "งานก่อสร้าง": "hard-hat"
    };
    const catBgGradients = {
      "งานราชการ": "from-blue-50/70 to-indigo-50/40 border-blue-200/80",
      "งานออกแบบ": "from-sky-50/70 to-cyan-50/40 border-sky-200/80",
      "งานก่อสร้าง": "from-emerald-50/70 to-amber-50/40 border-emerald-200/80"
    };
    const catIconColors = {
      "งานราชการ": "bg-blue-100 text-blue-700",
      "งานออกแบบ": "bg-sky-100 text-sky-700",
      "งานก่อสร้าง": "bg-amber-100 text-amber-700"
    };

    catContainer.innerHTML = breakdownList.map(cat => {
      const sName = cat.short_name || "หมวดงาน";
      const iconName = catIcons[sName] || "layers";
      const gradClass = catBgGradients[sName] || "from-slate-50 to-white border-slate-200";
      const iconCol = catIconColors[sName] || "bg-slate-100 text-slate-700";

      const planContrib = isWeeklyMode ? (cat.weekly_planned_contribution_pct !== undefined ? cat.weekly_planned_contribution_pct : 0) : (cat.planned_contribution_pct || 0);
      const actContrib = isWeeklyMode ? (cat.weekly_actual_contribution_pct !== undefined ? cat.weekly_actual_contribution_pct : 0) : (cat.actual_contribution_pct || 0);
      const varContrib = isWeeklyMode ? (cat.weekly_variance_pct !== undefined ? cat.weekly_variance_pct : roundNumber(actContrib - planContrib, 2)) : (cat.variance_pct || 0);
      const curStatus = isWeeklyMode ? (cat.weekly_status || (varContrib >= 0 ? 'ON_TRACK' : (varContrib < -1 ? 'DELAYED' : 'SLIGHT_DELAY'))) : (cat.status || 'ON_TRACK');

      let statusBadge = "";
      if (curStatus === 'ON_TRACK') {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1 shrink-0">✓ ตามแผน (${varContrib >= 0 ? '+' : ''}${varContrib}%)</span>`;
      } else if (curStatus === 'SLIGHT_DELAY') {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1 shrink-0">⚠ ล่าช้าเล็กน้อย (${varContrib}%)</span>`;
      } else {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1 shrink-0">⛔ ล่าช้ากว่าแผน (${varContrib}%)</span>`;
      }

      const barColor = curStatus === 'DELAYED' ? 'bg-rose-500' : (curStatus === 'SLIGHT_DELAY' ? 'bg-amber-500' : 'bg-emerald-600');

      return `
        <div class="bg-gradient-to-br ${gradClass} rounded-2xl p-4 border shadow-sm flex flex-col justify-between space-y-3">
          <div>
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-2.5">
                <div class="w-9 h-9 rounded-xl ${iconCol} flex items-center justify-center shrink-0">
                  <i data-lucide="${iconName}" class="w-5 h-5"></i>
                </div>
                <div>
                  <h5 class="font-bold text-slate-900 text-xs sm:text-sm leading-tight">${cat.category}</h5>
                  <p class="text-[11px] text-slate-500 mt-0.5">น้ำหนักใน Lot: <span class="font-bold font-mono text-slate-800">${cat.weight_pct}%</span></p>
                </div>
              </div>
              ${statusBadge}
            </div>

            <!-- Progress in category -->
            <div class="mt-3 space-y-1.5">
              <div class="flex justify-between text-[11px]">
                <span class="text-slate-600 font-medium">ความคืบหน้าในหมวดนี้:</span>
                <span class="font-bold font-mono text-slate-800">${cat.cat_actual_pct}% <span class="text-slate-400 font-normal">/ แผน ${cat.cat_planned_pct}%</span></span>
              </div>
              <div class="w-full bg-slate-200/80 rounded-full h-2 relative overflow-hidden">
                <div class="bg-slate-400/50 h-2 rounded-full absolute top-0 left-0" style="width: ${Math.min(100, Math.max(0, cat.cat_planned_pct || 0))}%"></div>
                <div class="${barColor} h-2 rounded-full absolute top-0 left-0" style="width: ${Math.min(100, Math.max(0, cat.cat_actual_pct || 0))}%"></div>
              </div>
            </div>
          </div>

          <!-- Contribution & Variance Stats -->
          <div class="pt-2.5 border-t border-slate-200/60 grid grid-cols-3 gap-2 text-center text-[11px]">
            <div class="bg-white/80 rounded-xl p-1.5 border border-slate-100 shadow-xs">
              <div class="text-slate-400 text-[10px]">${isWeeklyMode ? 'แผนสัปดาห์นี้' : 'แผนสะสม'}</div>
              <div class="font-bold font-mono text-[#2563eb] text-xs mt-0.5">${planContrib}%</div>
            </div>
            <div class="bg-white/80 rounded-xl p-1.5 border border-slate-100 shadow-xs">
              <div class="text-slate-400 text-[10px]">${isWeeklyMode ? 'ทำจริงสัปดาห์นี้' : 'ทำจริงสะสม'}</div>
              <div class="font-bold font-mono text-[#10b981] text-xs mt-0.5">${actContrib}%</div>
            </div>
            <div class="bg-white/80 rounded-xl p-1.5 border border-slate-100 shadow-xs">
              <div class="text-slate-400 text-[10px]">${isWeeklyMode ? 'ผลต่างสัปดาห์นี้' : 'ความล่าช้า/ผลต่าง'}</div>
              <div class="font-bold font-mono ${varContrib >= 0 ? 'text-emerald-600' : 'text-rose-600'} text-xs mt-0.5">
                ${varContrib >= 0 ? '+' : ''}${varContrib}%
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  // 6.2 Render Lot Cumulative S-Curve Chart
  const scurveData = lotData.scurve || {};
  const scurveLabels = scurveData.labels || [];
  const plannedCum = scurveData.planned_cum || [];
  const actualCum = scurveData.actual_cum || [];

  // Determine cutoff index based on chosen week
  let cutoffIdx = scurveLabels.length;
  if (selectedWeek === 'all') {
    cutoffIdx = scurveLabels.length;
  } else if (wIdx !== null) {
    cutoffIdx = Math.min(wIdx + 1, scurveLabels.length);
  } else if (lotData.current_week_index !== undefined) {
    cutoffIdx = Math.min(lotData.current_week_index + 1, scurveLabels.length);
  }

  const safeCutoff = Math.max(1, Math.min(cutoffIdx, scurveLabels.length));

  const scurveTitleEl = document.getElementById('lot-scurve-title');
  if (scurveTitleEl) {
    scurveTitleEl.innerText = `กราฟ S-Curve ความก้าวหน้าสะสม: ${selectedLot === 'ALL' ? 'ทุกล็อต (104 ไซต์)' : 'Lot ' + selectedLot} (${totalSites} ไซต์)`;
  }

  let displayedLabels = [];
  let displayedPlanned = [];
  let displayedActual = [];
  let xaxisAnnotations = [];

  if (scurveViewMode === 'cutoff' && scurveLabels.length > 0) {
    // Cutoff mode: S-curve strictly displays up to selected week
    displayedLabels = scurveLabels.slice(0, safeCutoff);
    displayedPlanned = plannedCum.slice(0, safeCutoff);
    displayedActual = actualCum.slice(0, safeCutoff);

    const cutoffLabelEl = document.getElementById('scurve-view-cutoff-label');
    if (cutoffLabelEl) {
      cutoffLabelEl.innerText = `ถึงสัปดาห์ที่เลือก (W${safeCutoff})`;
    }
  } else {
    // Full project view: show all weeks on X-axis and Plan to end, Actual stops at safeCutoff
    displayedLabels = scurveLabels;
    displayedPlanned = plannedCum;
    displayedActual = actualCum.map((val, idx) => (idx < safeCutoff ? val : null));

    if (safeCutoff > 0 && safeCutoff <= scurveLabels.length) {
      const targetLabel = scurveLabels[safeCutoff - 1];
      xaxisAnnotations = [
        {
          x: targetLabel,
          borderColor: '#043327',
          strokeDashArray: 4,
          label: {
            borderColor: '#043327',
            style: { color: '#fff', background: '#043327', fontSize: '10px', fontWeight: 'bold' },
            text: `สัปดาห์ที่เลือก: W${safeCutoff}`
          }
        }
      ];
    }
  }

  const scurveSubtitleEl = document.getElementById('lot-scurve-subtitle');
  if (scurveSubtitleEl) {
    const endLabel = displayedLabels.length > 0 ? displayedLabels[displayedLabels.length - 1] : '';
    if (scurveViewMode === 'cutoff' && safeCutoff < scurveLabels.length) {
      scurveSubtitleEl.innerHTML = `แสดงข้อมูลสะสมตั้งแต่ <span class="font-semibold text-slate-700">W1</span> ถึง <span class="font-semibold text-emerald-700">${endLabel}</span> (ตัดแสดงถึงสัปดาห์ที่เลือก ${safeCutoff}/${scurveLabels.length} สัปดาห์) • เส้นสีฟ้า = แผน (% Plan), เส้นสีเขียว = ผลงานจริง (% Actual)`;
    } else {
      scurveSubtitleEl.innerHTML = `แสดงข้อมูลสะสมตลอดทั้งโครงการ (<span class="font-semibold text-slate-700">ทั้งหมด ${scurveLabels.length} สัปดาห์</span>) • เส้นสีฟ้า = แผน (% Plan), เส้นสีเขียว = ผลงานจริง (% Actual)`;
    }
  }

  const scurveOptions = {
    series: [
      {
        name: 'แผนงานสะสม (% Plan)',
        data: displayedPlanned
      },
      {
        name: 'ผลงานจริงสะสม (% Actual)',
        data: displayedActual
      }
    ],
    chart: {
      height: 320,
      type: 'line',
      toolbar: {
        show: true,
        tools: { download: true, selection: false, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true }
      },
      fontFamily: 'Prompt, sans-serif'
    },
    colors: ['#2563eb', '#10b981'], // Plan: Blue (#2563eb), Actual: Green (#10b981)
    stroke: {
      width: [3, 3.5],
      curve: 'smooth',
      dashArray: [4, 0]
    },
    markers: {
      size: displayedLabels.length <= 30 ? [3, 4] : [1, 2],
      strokeWidth: 2,
      hover: { size: 6 }
    },
    xaxis: {
      categories: displayedLabels,
      labels: {
        rotate: -45,
        rotateAlways: displayedLabels.length > 12,
        style: { fontSize: '10px', colors: '#64748b' }
      },
      tickAmount: Math.min(24, Math.max(1, displayedLabels.length))
    },
    yaxis: {
      min: 0,
      max: 100,
      labels: { formatter: val => `${Math.round(val)}%` },
      title: { text: '% ความก้าวหน้าสะสม', style: { fontSize: '11px', fontWeight: 600, color: '#475569' } }
    },
    tooltip: {
      shared: true,
      intersect: false,
      y: {
        formatter: val => (val !== null && val !== undefined) ? `${Number(val).toFixed(2)}%` : '-'
      }
    },
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      fontSize: '12px'
    },
    grid: {
      borderColor: '#f1f5f9',
      strokeDashArray: 3
    },
    annotations: {
      xaxis: xaxisAnnotations
    }
  };

  const lotScurveEl = document.getElementById('lot-scurve-chart');
  if (lotScurveEl) {
    if (lotScurveChart) lotScurveChart.destroy();
    lotScurveChart = new ApexCharts(lotScurveEl, scurveOptions);
    lotScurveChart.render();
    window.lotScurveChart = lotScurveChart;
  }

  // 7. Build Multi-Line Categories: Line 1 = Site Name, Line 2 = Capacity (kWp)
  const categories = sites.map(s => {
    const shortName = s.name.length > 22 ? s.name.substring(0, 20) + '...' : s.name;
    const capStr = `${Number(s.capacity_kwp || 0).toLocaleString()} kWp`;
    return [shortName, capStr];
  });

  const plannedSeries = sites.map(s => roundNumber(s.display_plan, 1));
  const actualSeries = sites.map(s => roundNumber(s.display_actual, 1));

  // Dynamic width calculation for horizontal scrolling if many sites
  const chartWrapper = document.getElementById('comparison-bar-chart-wrapper');
  if (chartWrapper) {
    const minWidth = Math.max(750, sites.length * 52);
    chartWrapper.style.minWidth = `${minWidth}px`;
  }

  // 8. Render ApexCharts Vertical Column Chart
  const compOptions = {
    series: [
      {
        name: 'แผนงาน (% Plan)',
        data: plannedSeries
      },
      {
        name: 'ผลงานจริง (% Actual)',
        data: actualSeries
      }
    ],
    chart: {
      type: 'bar',
      height: 440,
      toolbar: { 
        show: true, 
        tools: { download: true, selection: false, zoom: false, zoomin: false, zoomout: false, pan: false } 
      },
      fontFamily: 'Prompt, sans-serif'
    },
    plotOptions: {
      bar: {
        horizontal: false, // VERTICAL COLUMN CHART
        columnWidth: sites.length > 20 ? '80%' : (sites.length > 10 ? '60%' : '40%'),
        borderRadius: 4,
        dataLabels: { position: 'top' }
      }
    },
    colors: ['#2563eb', '#10b981'], // Plan: Blue (#2563eb), Actual: Green (#10b981)
    dataLabels: {
      enabled: sites.length <= 32,
      offsetY: -18,
      style: { fontSize: '9px', fontWeight: 700, colors: ['#0f172a'] },
      formatter: val => (val !== null && val !== undefined) ? `${Math.round(val)}%` : '0%'
    },
    stroke: { show: true, width: 1, colors: ['#fff'] },
    xaxis: {
      categories: categories,
      labels: {
        rotate: -45,
        rotateAlways: sites.length > 6,
        style: { fontSize: '11px', fontWeight: 600, colors: '#0f172a' }
      },
      axisBorder: { show: true, color: '#cbd5e1' }
    },
    yaxis: {
      max: selectedMode === 'cumulative' ? 100 : undefined,
      labels: { formatter: val => `${Math.round(val)}%` },
      title: { text: '% ความก้าวหน้า', style: { fontSize: '11px', fontWeight: 600, color: '#475569' } }
    },
    tooltip: {
      shared: true,
      intersect: false,
      custom: function({ series, seriesIndex, dataPointIndex, w }) {
        const s = sites[dataPointIndex];
        if (!s) return '';
        const pVal = series[0][dataPointIndex];
        const aVal = series[1][dataPointIndex];
        const diff = (aVal - pVal).toFixed(1);
        const isDelayed = (aVal - pVal) < -0.1;
        return `
          <div class="p-3 bg-white text-slate-900 shadow-xl rounded-xl border border-slate-200 text-xs font-sans min-w-[230px]">
            <div class="font-bold text-slate-900 border-b pb-1.5 mb-2 flex items-center justify-between">
              <span class="truncate max-w-[170px] text-sm">${s.name}</span>
              <span class="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-800 rounded font-semibold">${s.lot || '-'}</span>
            </div>
            <div class="space-y-1.5 text-[11px]">
              <div class="flex justify-between items-center"><span class="text-slate-500">ขนาดกำลังผลิต:</span> <span class="font-bold font-mono text-amber-600">${Number(s.capacity_kwp).toLocaleString()} kWp</span></div>
              <div class="flex justify-between items-center"><span class="text-slate-500">แผนงาน (% Plan):</span> <span class="font-bold font-mono text-[#043327]">${Number(pVal).toFixed(1)}%</span></div>
              <div class="flex justify-between items-center"><span class="text-slate-500">ผลงานจริง (% Actual):</span> <span class="font-bold font-mono text-[#d97706]">${Number(aVal).toFixed(1)}%</span></div>
              <div class="flex justify-between items-center pt-1.5 border-t border-slate-100">
                <span class="text-slate-500 font-medium">ผลต่าง (Variance):</span> 
                <span class="font-bold font-mono ${isDelayed ? 'text-rose-600' : 'text-emerald-600'}">${diff > 0 ? '+' : ''}${diff}%</span>
              </div>
            </div>
          </div>
        `;
      }
    },
    legend: {
      show: false // Custom legend is rendered in the card header
    }
  };
  
  const compChartEl = document.getElementById('comparison-bar-chart');
  if (compChartEl) {
    if (comparisonBarChart) comparisonBarChart.destroy();
    comparisonBarChart = new ApexCharts(compChartEl, compOptions);
    comparisonBarChart.render();
    window.comparisonBarChart = comparisonBarChart;
  }
  
  // 9. Render Lot Sites Detailed Table
  const sitesTableBody = document.getElementById('lot-sites-table-body');
  const lotTableCount = document.getElementById('lot-table-count');
  if (lotTableCount) lotTableCount.innerText = `${sites.length} ไซต์`;
  
  if (sitesTableBody) {
    sitesTableBody.innerHTML = '';
    sites.forEach((s, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50/80 transition';
      
      let statusBadge = '<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-semibold">ตามแผนงาน</span>';
      if (s.display_actual >= 99.9) {
        statusBadge = '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-semibold">เสร็จสมบูรณ์</span>';
      } else if (s.display_variance < -10) {
        statusBadge = '<span class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-semibold">ล่าช้ากว่าแผน</span>';
      } else if (s.display_variance < 0) {
        statusBadge = '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold">ล่าช้าเล็กน้อย</span>';
      } else {
        statusBadge = '<span class="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-semibold">ตามแผนงาน</span>';
      }
      
      const varColor = s.display_variance >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-bold';
      
      tr.innerHTML = `
        <td class="py-3 px-3 text-center text-slate-400 font-mono">${idx + 1}</td>
        <td class="py-3 px-4 font-bold text-slate-900 cursor-pointer hover:text-emerald-700" onclick="openProjectFromComparison('${s.id}')">${s.name}</td>
        <td class="py-3 px-3"><span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">${s.lot || '-'}</span></td>
        <td class="py-3 px-3 text-slate-600">${s.business_unit || '-'}</td>
        <td class="py-3 px-3 text-right font-mono font-bold text-amber-600">${Number(s.capacity_kwp).toLocaleString()}</td>
        <td class="py-3 px-3 text-center font-mono text-[#2563eb] font-semibold">${s.display_plan.toFixed(1)}%</td>
        <td class="py-3 px-3 text-center font-mono text-[#10b981] font-bold">${s.display_actual.toFixed(1)}%</td>
        <td class="py-3 px-3 text-center font-mono ${varColor}">${s.display_variance >= 0 ? '+' : ''}${s.display_variance.toFixed(1)}%</td>
        <td class="py-3 px-3 text-center">${statusBadge}</td>
        <td class="py-3 px-3 text-center">
          <button onclick="openProjectFromComparison('${s.id}')" class="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold transition flex items-center gap-1 mx-auto shadow-sm">
            <i data-lucide="external-link" class="w-3 h-3"></i>
            <span>ดูรายละเอียด</span>
          </button>
        </td>
      `;
      sitesTableBody.appendChild(tr);
    });
  }

  // 10. Render Delayed Projects Watchlist Table
  const tbody = document.getElementById('delayed-table-body');
  if (tbody) {
    tbody.innerHTML = '';
    const delayedProjects = [...allProjects]
      .filter(p => (p.variance_pct < -0.1 || p.status === 'DELAYED') && (selectedLot === 'ALL' || p.lot === selectedLot))
      .sort((a, b) => a.variance_pct - b.variance_pct);
      
    if (delayedProjects.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-6 text-emerald-700 font-semibold">
            🎉 ยอดเยี่ยมมาก! ไม่มีโครงการที่ล่าช้ากว่าแผนงานในล็อตนี้
          </td>
        </tr>
      `;
    } else {
      delayedProjects.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-rose-50/40 transition';
        tr.innerHTML = `
          <td class="py-3 px-4 font-bold text-slate-900">${p.name}</td>
          <td class="py-3 px-3 text-slate-600">${p.business_unit}</td>
          <td class="py-3 px-3"><span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">${p.lot}</span></td>
          <td class="py-3 px-3 text-right font-mono font-medium">${Number(p.capacity_kwp).toLocaleString()}</td>
          <td class="py-3 px-3 text-center font-mono text-[#2563eb] font-semibold">${p.planned_progress_pct}%</td>
          <td class="py-3 px-3 text-center font-mono text-[#10b981] font-semibold">${p.actual_progress_pct}%</td>
          <td class="py-3 px-3 text-center font-mono font-bold text-rose-600">${p.variance_pct}%</td>
          <td class="py-3 px-3 text-center">
            <button onclick="openProjectFromComparison('${p.id}')" class="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold transition">
              ดูโครงการ
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  lucide.createIcons();
}

function roundNumber(num, dec) {
  const f = Math.pow(10, dec || 2);
  return Math.round((num || 0) * f) / f;
}

function openProjectFromComparison(projectId) {
  selectProject(projectId);
  switchTab('project');
}


// =========================================================================
// =========================================================================
// S-CURVE CHART TO IMAGE UTILITIES (100% Reliable Offscreen Rendering)
// =========================================================================
async function getProjectScurveDataUri(scurveData, width = 760, height = 350) {
  if (!scurveData || !scurveData.weeks || scurveData.weeks.length === 0) {
    return '';
  }

  // Create temporary offscreen container with explicit pixel dimensions
  const tempDiv = document.createElement('div');
  tempDiv.id = 'temp-pdf-scurve-' + Date.now();
  tempDiv.style.position = 'fixed';
  tempDiv.style.left = '-99999px';
  tempDiv.style.top = '0';
  tempDiv.style.width = width + 'px';
  tempDiv.style.height = height + 'px';
  tempDiv.style.background = '#ffffff';
  tempDiv.style.zIndex = '-9999';
  document.body.appendChild(tempDiv);

  let uri = '';
  let tempChart = null;
  try {
    const options = {
      series: [
        {
          name: 'Planned Cumulative S-Curve (%)',
          type: 'line',
          data: scurveData.planned_cum || []
        },
        {
          name: 'Actual Cumulative S-Curve (%)',
          type: 'line',
          data: scurveData.actual_cum || []
        },
        {
          name: 'Planned Weekly (%)',
          type: 'column',
          data: scurveData.planned_weekly || []
        },
        {
          name: 'Actual Weekly (%)',
          type: 'column',
          data: scurveData.actual_weekly || []
        }
      ],
      chart: {
        width: width,
        height: height,
        type: 'line',
        stacked: false,
        animations: { enabled: false }, // Essential for instant canvas export
        toolbar: { show: false },
        fontFamily: 'Prompt, sans-serif'
      },
      stroke: {
        width: [3.5, 3.5, 0, 0],
        curve: 'smooth',
        dashArray: [0, 0, 0, 0]
      },
      colors: ['#2563eb', '#10b981', '#93c5fd', '#6ee7b7'],
      fill: {
        opacity: [1, 1, 0.45, 0.55]
      },
      labels: scurveData.labels || [],
      xaxis: {
        type: 'category',
        labels: {
          rotate: -45,
          rotateAlways: false,
          style: { fontSize: '9px', colors: '#64748b' }
        }
      },
      yaxis: [
        {
          title: { text: 'Cumulative %', style: { fontSize: '9px', color: '#64748b' } },
          min: 0,
          max: 100,
          labels: { formatter: val => Math.round(val) + '%' }
        },
        {
          opposite: true,
          show: false,
          min: 0,
          max: 100
        },
        {
          opposite: true,
          title: { text: 'Weekly %', style: { fontSize: '9px', color: '#64748b' } },
          min: 0,
          max: 30,
          labels: { formatter: val => val ? val.toFixed(1) + '%' : '' }
        },
        {
          opposite: true,
          show: false,
          min: 0,
          max: 30
        }
      ],
      legend: {
        position: 'top',
        fontSize: '11px'
      }
    };

    tempChart = new ApexCharts(tempDiv, options);
    await tempChart.render();
    
    // Wait a brief 100ms for layout to settle
    await new Promise(resolve => setTimeout(resolve, 100));

    if (typeof tempChart.dataURI === 'function') {
      const res = await tempChart.dataURI();
      uri = res.imgURI || '';
    }

    // Fallback: If dataURI is empty, convert SVG element directly to PNG data URL
    if (!uri) {
      const svgEl = tempDiv.querySelector('svg.apexcharts-svg');
      if (svgEl) {
        uri = await convertSvgElementToPngDataUri(svgEl, width, height);
      }
    }
  } catch (err) {
    console.warn("Could not generate off-screen S-Curve chart:", err);
  } finally {
    if (tempChart) {
      try { tempChart.destroy(); } catch (e) {}
    }
    if (tempDiv && tempDiv.parentNode) {
      tempDiv.parentNode.removeChild(tempDiv);
    }
  }
  return uri;
}

async function getLotScurveDataUri(lotData, isCutoffMode = true, width = 760, height = 320) {
  if (!lotData || !lotData.week_labels || lotData.week_labels.length === 0) {
    return '';
  }

  const tempDiv = document.createElement('div');
  tempDiv.id = 'temp-pdf-lot-scurve-' + Date.now();
  tempDiv.style.position = 'fixed';
  tempDiv.style.left = '-99999px';
  tempDiv.style.top = '0';
  tempDiv.style.width = width + 'px';
  tempDiv.style.height = height + 'px';
  tempDiv.style.background = '#ffffff';
  tempDiv.style.zIndex = '-9999';
  document.body.appendChild(tempDiv);

  let uri = '';
  let tempChart = null;
  try {
    const scurveLabels = lotData.week_labels || [];
    const plannedCum = lotData.planned_cum || [];
    const actualCum = lotData.actual_cum || [];

    let displayedLabels = scurveLabels;
    let displayedPlanned = plannedCum;
    let displayedActual = actualCum;

    const safeCutoff = (lotData.current_week_index !== undefined && lotData.current_week_index >= 0)
      ? Math.min(lotData.current_week_index + 1, scurveLabels.length)
      : scurveLabels.length;

    if (isCutoffMode && safeCutoff > 0 && safeCutoff <= scurveLabels.length) {
      displayedLabels = scurveLabels.slice(0, safeCutoff);
      displayedPlanned = plannedCum.slice(0, safeCutoff);
      displayedActual = actualCum.slice(0, safeCutoff);
    }

    const scurveOptions = {
      series: [
        {
          name: 'แผนงานสะสม (% Plan)',
          data: displayedPlanned
        },
        {
          name: 'ผลงานจริงสะสม (% Actual)',
          data: displayedActual
        }
      ],
      chart: {
        width: width,
        height: height,
        type: 'line',
        animations: { enabled: false },
        toolbar: { show: false },
        fontFamily: 'Prompt, sans-serif'
      },
      colors: ['#2563eb', '#10b981'],
      stroke: {
        width: [3, 3.5],
        curve: 'smooth',
        dashArray: [4, 0]
      },
      markers: {
        size: displayedLabels.length <= 30 ? [3, 4] : [1, 2],
        strokeWidth: 2
      },
      xaxis: {
        categories: displayedLabels,
        labels: {
          rotate: -45,
          rotateAlways: displayedLabels.length > 12,
          style: { fontSize: '9px', colors: '#64748b' }
        },
        tickAmount: Math.min(24, Math.max(1, displayedLabels.length))
      },
      yaxis: {
        min: 0,
        max: 100,
        labels: { formatter: val => `${Math.round(val)}%` },
        title: { text: '% ความก้าวหน้าสะสม', style: { fontSize: '9px', color: '#475569' } }
      },
      legend: {
        position: 'top',
        horizontalAlign: 'right',
        fontSize: '11px'
      },
      grid: {
        borderColor: '#f1f5f9',
        strokeDashArray: 3
      }
    };

    tempChart = new ApexCharts(tempDiv, scurveOptions);
    await tempChart.render();
    await new Promise(r => setTimeout(r, 100));

    if (typeof tempChart.dataURI === 'function') {
      const res = await tempChart.dataURI();
      uri = res.imgURI || '';
    }

    if (!uri) {
      const svgEl = tempDiv.querySelector('svg.apexcharts-svg');
      if (svgEl) {
        uri = await convertSvgElementToPngDataUri(svgEl, width, height);
      }
    }
  } catch (err) {
    console.warn("Could not export lot scurve offscreen:", err);
  } finally {
    if (tempChart) {
      try { tempChart.destroy(); } catch (e) {}
    }
    if (tempDiv && tempDiv.parentNode) {
      tempDiv.parentNode.removeChild(tempDiv);
    }
  }
  return uri;
}

function convertSvgElementToPngDataUri(svgElement, width, height) {
  return new Promise((resolve) => {
    try {
      const xml = new XMLSerializer().serializeToString(svgElement);
      const svg64 = btoa(unescape(encodeURIComponent(xml)));
      const image64 = 'data:image/svg+xml;base64,' + svg64;
      const img = new Image();
      img.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png', 0.95));
      };
      img.onerror = function () {
        resolve(image64);
      };
      img.src = image64;
    } catch (e) {
      console.warn("convertSvgElementToPngDataUri error:", e);
      resolve('');
    }
  });
}

// =========================================================================
// PDF REPORT GENERATOR (Exact 210mm x 297mm A4, Zero Left Shift)
// =========================================================================
async function generateProjectPDF() {
  const btn = document.getElementById('btn-gen-pdf');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin mr-1">⏳</span> กำลังเตรียมข้อมูลและสร้าง PDF...`;
  }
  
  // 0. Determine target project ID and fetch latest full project data
  let targetProjectId = (currentTab === 'photos' && currentPhotoProjectId) ? currentPhotoProjectId : (currentProject ? currentProject.id : (currentPhotoProjectId || (allProjects[0] ? allProjects[0].id : null)));
  if (!targetProjectId && currentProject) {
    targetProjectId = currentProject.id;
  }

  if (!targetProjectId) {
    showToast('กรุณาเลือกโครงการก่อนสร้างรายงาน', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    return;
  }

  let p = currentProject;
  try {
    const res = await fetch(`/api/projects/${targetProjectId}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      p = await res.json();
      currentProject = p;
    }
  } catch (e) {
    console.warn("Could not refresh project data for PDF:", e);
  }

  if (!p) {
    showToast('ไม่พบข้อมูลโครงการสำหรับสร้างรายงาน', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    return;
  }
  
  const now = new Date();
  const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  
  // 1. Capture S-Curve Chart as Image (Offscreen independent rendering)
  let scurveImgUri = '';
  try {
    scurveImgUri = await getProjectScurveDataUri(p.s_curve, 760, 350);
  } catch (chartErr) {
    console.warn("Could not export chart as dataURI:", chartErr);
  }

  // If offscreen capture was empty, fallback to existing chart instance if available
  if (!scurveImgUri && projectScurveChart && typeof projectScurveChart.dataURI === 'function') {
    try {
      const chartRes = await projectScurveChart.dataURI();
      scurveImgUri = chartRes.imgURI || '';
    } catch (e) {}
  }

  // 1.5 Fetch project photos if available
  let pdfPhotos = [];
  try {
    const photoRes = await fetch(`/api/projects/${p.id}/photos`);
    if (photoRes.ok) {
      const pData = await photoRes.json();
      pdfPhotos = pData.photos || [];
    }
  } catch (pErr) {
    console.warn("Could not load photos for PDF:", pErr);
  }

  const hasPhotos = (pdfPhotos || []).some(x => Boolean(x.photo_url || x.drive_file_id));
  const totalPages = hasPhotos ? 3 : 2;

  // 2. Build Milestone Rows for all 33 items (Precise 210mm printable width)
  let milestoneRows = '';
  (p.milestones || []).forEach((m, idx) => {
    const pct = Math.round(m.actual_pct * 100);
    const weight = (m.weight * 100).toFixed(1);
    const contrib = (m.actual_contribution * 100).toFixed(2);
    const bgRow = (idx % 2 === 1) ? '#f8fafc' : '#ffffff';
    
    let statusText = 'รอดำเนินการ';
    let statusColor = '#475569';
    let statusBg = '#f1f5f9';
    if (m.status === 'COMPLETED' || pct >= 100) {
      statusText = 'เสร็จสมบูรณ์';
      statusColor = '#065f46';
      statusBg = '#d1fae5';
    } else if (m.status === 'IN_PROGRESS' || pct > 0) {
      statusText = 'กำลังทำ';
      statusColor = '#92400e';
      statusBg = '#fef3c7';
    }
    
    const actFinishDisplay = (pct >= 100 && m.actual_finish) ? m.actual_finish : '-';
    
    milestoneRows += `
      <tr style="background: ${bgRow}; border-bottom: 1px solid #cbd5e1; font-size: 8px; line-height: 1.1;">
        <td style="padding: 3px 4px; text-align: center; color: #64748b; font-weight: 600; width: 5%;">${idx+1}</td>
        <td style="padding: 3px 6px; font-weight: 600; color: #0f172a; width: 33%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${m.name}</td>
        <td style="padding: 3px 4px; text-align: center; color: #475569; width: 7%;">${weight}%</td>
        <td style="padding: 3px 4px; text-align: center; color: #475569; font-family: monospace; width: 17%;">${m.planned_start || '-'} ~ ${m.planned_finish || '-'}</td>
        <td style="padding: 3px 4px; text-align: center; color: #0f172a; font-family: monospace; font-weight: 500; width: 17%;">${m.actual_start || '-'} ~ ${actFinishDisplay}</td>
        <td style="padding: 3px 4px; text-align: center; font-weight: bold; color: ${pct>=100 ? '#059669' : (pct>0 ? '#d97706' : '#94a3b8')}; width: 7%;">${pct}%</td>
        <td style="padding: 3px 4px; text-align: center; color: #2563eb; font-weight: 600; width: 7%;">${contrib}%</td>
        <td style="padding: 3px 4px; text-align: center; width: 7%;">
          <span style="background: ${statusBg}; color: ${statusColor}; padding: 1px 3px; border-radius: 3px; font-size: 7px; font-weight: 600; white-space: nowrap;">${statusText}</span>
        </td>
      </tr>
    `;
  });

  const reportContainer = document.getElementById('printable-report');
  reportContainer.innerHTML = `
    <div id="pdf-export-root" style="width: 210mm; margin: 0; padding: 0; background: #ffffff; color: #0f172a; font-family: 'Prompt', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-sizing: border-box;">
      
      <!-- ================= PAGE 1 (EXACT A4: 210mm x 297mm) ================= -->
      <div style="width: 210mm; height: 295mm; max-height: 295mm; padding: 8mm 10mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; background: #ffffff; overflow: hidden;">
        
        <div>
          <!-- Header Bar (Dark Green Theme) -->
          <div style="background: #043327; color: #ffffff; border-radius: 6px; padding: 8px 14px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="background: #f59e0b; width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px;">⚡</div>
              <div>
                <h1 style="font-size: 16px; font-weight: 800; margin: 0; color: #ffffff;">KPGreenergy Planner</h1>
                <p style="font-size: 9px; color: #a7f3d0; margin: 1px 0 0 0;">รายงานความก้าวหน้าโครงการพลังงานแสงอาทิตย์ (Executive Progress Report)</p>
              </div>
            </div>
            <div style="text-align: right; font-size: 9px; color: #e2e8f0;">
              <div>วันที่ออกรายงาน: <strong style="color: #ffffff;">${dateStr}</strong></div>
              <div style="margin-top: 1px;">กลุ่ม: <strong style="color: #fef08a;">${p.business_unit}</strong> | Lot: <strong style="color: #fef08a;">${p.lot}</strong></div>
            </div>
          </div>

          <!-- Project Identity Box -->
          <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 6px;">
              <div>
                <span style="font-size: 8px; text-transform: uppercase; font-weight: 700; color: #64748b;">ชื่อโครงการ / Project Name</span>
                <h2 style="font-size: 14px; font-weight: 800; margin: 1px 0 0 0; color: #043327;">${p.name}</h2>
              </div>
              <div style="text-align: right;">
                <span style="font-size: 8px; font-weight: 700; color: #64748b;">สถานะโครงการ</span><br>
                <span style="background: ${p.status==='COMPLETED' ? '#d1fae5' : (p.status==='DELAYED' ? '#ffe4e6' : '#dbeafe')}; color: ${p.status==='COMPLETED' ? '#065f46' : (p.status==='DELAYED' ? '#9f1239' : '#1e40af')}; padding: 2px 7px; border-radius: 9999px; font-size: 9.5px; font-weight: 700; display: inline-block; margin-top: 1px;">
                  ${p.status_th} (${p.variance_pct>=0 ? '+'+p.variance_pct : p.variance_pct}%)
                </span>
              </div>
            </div>

            <!-- Key Metrics 4 Columns -->
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; font-size: 9px;">
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 5px 8px;">
                <span style="color: #64748b; font-size: 8px;">กำลังการผลิต:</span><br>
                <strong style="color: #0f172a; font-size: 11.5px;">${p.capacity_kwp} kWp</strong>
              </div>
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 5px 8px;">
                <span style="color: #64748b; font-size: 8px;">ประเภทการติดตั้ง:</span><br>
                <strong style="color: #0f172a; font-size: 10.5px;">${p.installation_type}</strong>
              </div>
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 5px 8px;">
                <span style="color: #64748b; font-size: 8px;">ผลงานจริงสะสม:</span><br>
                <strong style="color: #059669; font-size: 11.5px;">${p.actual_progress_pct}%</strong>
              </div>
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 5px 8px;">
                <span style="color: #64748b; font-size: 8px;">แผนงานสะสม:</span><br>
                <strong style="color: #2563eb; font-size: 11.5px;">${p.planned_progress_pct}%</strong>
              </div>
            </div>

            <!-- Timeline details -->
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; font-size: 8.5px; border-top: 1px dashed #e2e8f0; margin-top: 6px; padding-top: 5px; color: #475569;">
              <div>📅 ระยะเวลาตามแผน: <strong>${p.planned_start || '-'}</strong> ถึง <strong>${p.planned_finish || '-'}</strong></div>
              <div>⚡ ระยะเวลาจริง: <strong>${p.actual_start || '-'}</strong> ถึง <strong>${p.actual_finish || '-'}</strong></div>
            </div>
          </div>

          <!-- S-Curve Section Header -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
            <h3 style="font-size: 12px; font-weight: 800; margin: 0; color: #043327;">
              📈 กราฟความคืบหน้าสะสมรายสัปดาห์ (Weekly S-Curve Performance)
            </h3>
            <div style="font-size: 8px; color: #64748b;">
              <span style="display: inline-block; width: 8px; height: 3px; background: #2563eb; margin-right: 2px;"></span>แผนสะสม
              <span style="display: inline-block; width: 8px; height: 3px; background: #10b981; margin: 0 2px 0 5px;"></span>จริงสะสม
              <span style="display: inline-block; width: 5px; height: 5px; background: #93c5fd; margin: 0 2px 0 5px;"></span>แผนรายสัปดาห์
              <span style="display: inline-block; width: 5px; height: 5px; background: #6ee7b7; margin: 0 2px 0 5px;"></span>จริงรายสัปดาห์
            </div>
          </div>

          <!-- Embedded S-Curve Chart Container (Strict 360px height) -->
          <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; text-align: center; margin-bottom: 10px;">
            ${scurveImgUri ? `
              <img src="${scurveImgUri}" style="width: 100%; height: 360px; object-fit: contain; display: block; margin: 0 auto;" />
            ` : `
              <div style="padding: 60px; color: #94a3b8; font-size: 11px;">(กราฟ S-Curve ความคืบหน้าสะสม)</div>
            `}
          </div>

          <!-- S-Curve KPI Summary Bar -->
          <div style="background: #f1f5f9; border-radius: 6px; padding: 7px 10px; display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; font-size: 9.5px; border: 1px solid #e2e8f0;">
            <div>
              <span style="color: #64748b;">แผนงานสะสมปัจจุบัน:</span><br>
              <strong style="color: #2563eb; font-size: 13px;">${p.planned_progress_pct}%</strong>
            </div>
            <div style="border-left: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1;">
              <span style="color: #64748b;">ผลงานจริงสะสมปัจจุบัน:</span><br>
              <strong style="color: #059669; font-size: 13px;">${p.actual_progress_pct}%</strong>
            </div>
            <div>
              <span style="color: #64748b;">ผลต่างความคืบหน้า (Variance):</span><br>
              <strong style="color: ${p.variance_pct<0 ? '#e11d48' : '#059669'}; font-size: 13px;">${p.variance_pct>=0 ? '+'+p.variance_pct : p.variance_pct}%</strong>
            </div>
          </div>

        </div>

        <!-- Page 1 Footer -->
        <div style="border-top: 1px solid #cbd5e1; padding-top: 5px; display: flex; justify-content: space-between; font-size: 7.5px; color: #94a3b8;">
          <div>KPGreenergy Planner • เอกสารรายงานความคืบหน้าโครงการอัตโนมัติ</div>
          <div>หน้า 1 / ${totalPages} (รายละเอียดไซต์และกราฟ S-Curve)</div>
        </div>

      </div>

      <!-- ================= PAGE 2 (EXACT A4: 210mm x 297mm) ================= -->
      <div style="width: 210mm; height: 295mm; max-height: 295mm; padding: 8mm 10mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; page-break-after: ${hasPhotos ? 'always' : 'auto'}; background: #ffffff; overflow: hidden;">
        
        <div>
          <!-- Header Page 2 -->
          <div style="border-bottom: 2px solid #043327; padding-bottom: 5px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
              <h3 style="font-size: 12.5px; font-weight: 800; margin: 0; color: #043327;">รายละเอียดขั้นตอนการดำเนินงานทั้งหมด (Milestones Breakdown - 33 รายการ)</h3>
              <p style="font-size: 8.5px; color: #64748b; margin: 1px 0 0 0;">โครงการ: <strong style="color: #0f172a;">${p.name}</strong> (${p.capacity_kwp} kWp)</p>
            </div>
            <div style="font-size: 8px; color: #64748b; text-align: right;">
              รวม <strong>33 ขั้นตอน</strong> (สิ้นสุดที่ Punch list)
            </div>
          </div>

          <!-- All 33 Milestones Table -->
          <table style="width: 100%; border-collapse: collapse; text-align: left; border: 1px solid #cbd5e1;">
            <thead>
              <tr style="background: #043327; color: #ffffff; font-size: 8px; font-weight: 700;">
                <th style="padding: 3px 4px; text-align: center; width: 5%;">ลำดับ</th>
                <th style="padding: 3px 6px; width: 33%;">รายการงาน (Milestone)</th>
                <th style="padding: 3px 4px; text-align: center; width: 7%;">น้ำหนัก</th>
                <th style="padding: 3px 4px; text-align: center; width: 17%;">แผนงานเริ่ม ~ เสร็จ</th>
                <th style="padding: 3px 4px; text-align: center; width: 17%;">วันจริงเริ่ม ~ เสร็จ</th>
                <th style="padding: 3px 4px; text-align: center; width: 7%;">% งาน</th>
                <th style="padding: 3px 4px; text-align: center; width: 7%;">% สะสม</th>
                <th style="padding: 3px 4px; text-align: center; width: 7%;">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              ${milestoneRows}
            </tbody>
          </table>

          <!-- Signatures Box -->
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 12px; font-size: 8px; color: #334155;">
            <div style="border: 1px solid #cbd5e1; border-radius: 5px; padding: 7px 10px; text-align: center; background: #fafafa;">
              <p style="margin: 0 0 24px 0; font-weight: 600;">ผู้รายงานข้อมูล / วิศวกรโครงการ (Project Engineer)</p>
              <p style="margin: 0; border-top: 1px dashed #94a3b8; padding-top: 3px;">(...........................................................................)</p>
              <p style="margin: 2px 0 0 0; color: #64748b;">วันที่ ..... / ..... / .........</p>
            </div>
            <div style="border: 1px solid #cbd5e1; border-radius: 5px; padding: 7px 10px; text-align: center; background: #fafafa;">
              <p style="margin: 0 0 24px 0; font-weight: 600;">ผู้จัดการโครงการ / ผู้ตรวจสอบ (Project Manager)</p>
              <p style="margin: 0; border-top: 1px dashed #94a3b8; padding-top: 3px;">(...........................................................................)</p>
              <p style="margin: 2px 0 0 0; color: #64748b;">วันที่ ..... / ..... / .........</p>
            </div>
          </div>

        </div>

        <!-- Page 2 Footer -->
        <div style="border-top: 1px solid #cbd5e1; padding-top: 5px; display: flex; justify-content: space-between; font-size: 7.5px; color: #94a3b8;">
          <div>KPGreenergy Planner • เอกสารรายงานความคืบหน้าโครงการอัตโนมัติ</div>
          <div>หน้า 2 / ${totalPages} (ตารางขั้นตอนการดำเนินงานทั้งหมด)</div>
        </div>

      </div>

      ${hasPhotos ? `
      <!-- ================= PAGE 3 (SITE PHOTOS: 210mm x 297mm) ================= -->
      <div style="width: 210mm; height: 295mm; max-height: 295mm; padding: 8mm 10mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; background: #ffffff; overflow: hidden;">
        
        <div>
          <!-- Header Page 3 -->
          <div style="border-bottom: 2px solid #043327; padding-bottom: 5px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
              <h3 style="font-size: 12.5px; font-weight: 800; margin: 0; color: #043327;">📸 ภาพถ่ายความคืบหน้าหน้างานจริง (Site Progress Photos - 6 จุดสำคัญ)</h3>
              <p style="font-size: 8.5px; color: #64748b; margin: 1px 0 0 0;">โครงการ: <strong style="color: #0f172a;">${p.name}</strong> (${p.capacity_kwp} kWp)</p>
            </div>
            <div style="font-size: 8px; color: #64748b; text-align: right;">
              วันที่ออกรายงาน: <strong>${dateStr}</strong>
            </div>
          </div>

          <!-- 6 Photos 2-Column Grid -->
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
            ${DEFAULT_PHOTO_CATEGORIES.map(cat => {
              const photo = (pdfPhotos || []).find(x => x.slot === cat.slot) || {};
              const imgUrl = photo.photo_url || (photo.drive_file_id ? `https://lh3.googleusercontent.com/d/${photo.drive_file_id}` : '');
              const pDate = photo.date || '-';
              const caption = photo.caption || 'ดำเนินงานตามแผนงาน';

              return `
                <div style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; background: #fafafa; display: flex; flex-direction: column; height: 78mm;">
                  
                  <!-- Slot Header -->
                  <div style="background: #043327; color: #ffffff; padding: 3px 6px; font-size: 7.5px; font-weight: 700; display: flex; justify-content: space-between; align-items: center;">
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65mm;">${cat.title}</span>
                    <span style="color: #fef08a; font-size: 7px;">${pDate}</span>
                  </div>

                  <!-- Image Container -->
                  <div style="height: 56mm; background: #e2e8f0; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                    ${imgUrl ? `
                      <img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
                    ` : `
                      <div style="color: #94a3b8; font-size: 8px; text-align: center;">(ยังไม่มีภาพถ่ายในจุดนี้)</div>
                    `}
                  </div>

                  <!-- Caption Box -->
                  <div style="padding: 3px 6px; font-size: 7px; color: #334155; flex-grow: 1; display: flex; align-items: center; background: #ffffff; border-top: 1px solid #e2e8f0; line-height: 1.15;">
                    <span style="font-weight: 600; color: #043327; margin-right: 3px;">บันทึก:</span>
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${caption}</span>
                  </div>

                </div>
              `;
            }).join('')}
          </div>

        </div>

        <!-- Page 3 Footer -->
        <div style="border-top: 1px solid #cbd5e1; padding-top: 5px; display: flex; justify-content: space-between; font-size: 7.5px; color: #94a3b8;">
          <div>KPGreenergy Planner • เอกสารรายงานความคืบหน้าโครงการอัตโนมัติ</div>
          <div>หน้า 3 / 3 (ภาพถ่ายความคืบหน้าหน้างานจริง 6 จุดสำคัญ)</div>
        </div>

      </div>
      ` : ''}

    </div>
  `;

  // 3. Perfect Export Options for html2pdf (210mm direct mapping, no margins)
  const filenameStr = "KPGreenergy_Report_" + p.name.replace(/\s+/g, '_') + "_" + now.toISOString().split('T')[0] + ".pdf";
  const elementToPrint = document.getElementById('pdf-export-root');
  
  const opt = {
    margin: 0,
    filename: filenameStr,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { 
      scale: 2, 
      useCORS: true, 
      logging: false,
      scrollY: 0,
      scrollX: 0
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  try {
    await html2pdf().set(opt).from(elementToPrint).save();
    showToast(`สร้างรายงาน PDF โครงการ ${p.name} (${totalPages} หน้า) สำเร็จแล้ว!`, 'success');
  } catch (err) {
    console.error("PDF generation error:", err);
    window.print();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    lucide.createIcons();
  }
}

// =========================================================================
// LOT PDF REPORT GENERATOR (Executive Multi-Page A4 Report)
// =========================================================================
async function generateLotPDF() {
  const lotSel = document.getElementById('compare-lot-select');
  const weekSel = document.getElementById('compare-week-select');
  const modeSel = document.getElementById('compare-mode-select');

  const selectedLot = lotSel ? lotSel.value : 'ALL';
  const lotDisplayName = selectedLot === 'ALL' ? 'ทุกล็อต (All Lots)' : `Lot ${selectedLot}`;
  const selectedWeekText = (weekSel && weekSel.options && weekSel.selectedIndex >= 0) ? weekSel.options[weekSel.selectedIndex].text : 'สัปดาห์ปัจจุบัน';
  const isWeeklyMode = modeSel ? modeSel.value === 'weekly' : false;

  const btn = document.getElementById('btn-gen-lot-pdf');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin mr-1">⏳</span> กำลังสร้าง Report ราย Lot...`;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

  // 1. Capture Lot S-Curve Chart as base64 image
  let scurveImgUri = '';
  const lotData = cachedLotProgressData || {};
  try {
    scurveImgUri = await getLotScurveDataUri(lotData, scurveViewMode === 'cutoff', 760, 320);
  } catch (err) {
    console.warn("Could not capture lot scurve offscreen:", err);
  }

  if (!scurveImgUri && lotScurveChart && typeof lotScurveChart.dataURI === 'function') {
    try {
      const res = await lotScurveChart.dataURI();
      scurveImgUri = res.imgURI || '';
    } catch (e) {}
  }

  // 2. Gather Lot Data & Summary Metrics
  const sites = lotData.sites || [];
  const totalSites = sites.length;
  const totalCapKwp = sites.reduce((sum, s) => sum + (Number(s.capacity_kwp) || 0), 0);
  const totalCapMwp = (totalCapKwp / 1000.0).toFixed(2);

  // Safe week index
  let wIdx = null;
  const targetWeekCount = lotData.week_labels ? lotData.week_labels.length : 0;
  if (weekSel && weekSel.value === 'all') {
    wIdx = targetWeekCount > 0 ? targetWeekCount - 1 : 0;
  } else if (weekSel && weekSel.value !== 'latest') {
    const parsed = parseInt(weekSel.value);
    if (!isNaN(parsed) && parsed >= 0) {
      wIdx = Math.max(0, Math.min(parsed, targetWeekCount > 0 ? targetWeekCount - 1 : 0));
    }
  }

  // Calculate Average Plan & Actual for this selected week
  let avgPlan = 0.0;
  let avgAct = 0.0;
  const processedSites = sites.map((s, idx) => {
    let pVal = s.planned_progress_pct || 0;
    let aVal = s.actual_progress_pct || 0;
    if (wIdx !== null) {
      if (isWeeklyMode) {
        pVal = (s.weekly_planned && s.weekly_planned[wIdx] !== undefined) ? s.weekly_planned[wIdx] : 0;
        aVal = (s.weekly_actual && s.weekly_actual[wIdx] !== undefined) ? s.weekly_actual[wIdx] : 0;
      } else {
        const cpLen = s.cumulative_planned ? s.cumulative_planned.length : 0;
        const caLen = s.cumulative_actual ? s.cumulative_actual.length : 0;
        if (cpLen > 0) pVal = s.cumulative_planned[Math.min(wIdx, cpLen - 1)] ?? pVal;
        if (caLen > 0) aVal = s.cumulative_actual[Math.min(wIdx, caLen - 1)] ?? aVal;
      }
    }
    const varVal = roundNumber(aVal - pVal, 2);
    return {
      ...s,
      rank: idx + 1,
      plan: Math.max(0, Math.min(100, pVal)),
      actual: Math.max(0, Math.min(100, aVal)),
      variance: varVal
    };
  });

  if (totalCapKwp > 0) {
    avgPlan = roundNumber(processedSites.reduce((sum, s) => sum + s.plan * (s.capacity_kwp || 0), 0) / totalCapKwp, 2);
    avgAct = roundNumber(processedSites.reduce((sum, s) => sum + s.actual * (s.capacity_kwp || 0), 0) / totalCapKwp, 2);
  }
  const avgVar = roundNumber(avgAct - avgPlan, 2);

  // 3. Gather 3 Category Breakdown
  let breakdownList = [];
  if (wIdx !== null && lotData.category_breakdown_by_week && lotData.category_breakdown_by_week[wIdx]) {
    breakdownList = lotData.category_breakdown_by_week[wIdx];
  } else if (lotData.current_week_index !== undefined && lotData.category_breakdown_by_week && lotData.category_breakdown_by_week[lotData.current_week_index]) {
    breakdownList = lotData.category_breakdown_by_week[lotData.current_week_index];
  } else {
    breakdownList = lotData.category_breakdown || [];
  }

  let catCardsHtml = '';
  breakdownList.forEach(c => {
    const sName = c.short_name || c.category;
    const plan = isWeeklyMode ? (c.weekly_planned_contribution_pct ?? 0) : (c.planned_contribution_pct ?? 0);
    const act = isWeeklyMode ? (c.weekly_actual_contribution_pct ?? 0) : (c.actual_contribution_pct ?? 0);
    const diff = isWeeklyMode ? (c.weekly_variance_pct ?? roundNumber(act - plan, 2)) : (c.variance_pct ?? 0);
    const badgeColor = diff >= 0 ? '#059669' : (diff < -5 ? '#e11d48' : '#d97706');
    const badgeBg = diff >= 0 ? '#d1fae5' : (diff < -5 ? '#ffe4e6' : '#fef3c7');
    const badgeText = diff >= 0 ? 'ตามแผน' : (diff < -5 ? 'ล่าช้ากว่าแผน' : 'ล่าช้าเล็กน้อย');

    catCardsHtml += `
      <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; flex: 1;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <strong style="font-size: 9px; color: #0f172a;">${sName} (${c.weight_pct}%)</strong>
          <span style="background: ${badgeBg}; color: ${badgeColor}; font-size: 7.5px; font-weight: 700; padding: 1px 4px; border-radius: 3px;">${badgeText} (${diff >= 0 ? '+' : ''}${diff}%)</span>
        </div>
        <div style="font-size: 8px; color: #64748b; display: flex; justify-content: space-between; margin-bottom: 2px;">
          <span>ความคืบหน้าในหมวด:</span>
          <strong style="color: #0f172a;">${c.cat_actual_pct}% / แผน ${c.cat_planned_pct}%</strong>
        </div>
        <div style="background: #e2e8f0; height: 5px; border-radius: 3px; position: relative; overflow: hidden;">
          <div style="background: #93c5fd; width: ${Math.min(100, Math.max(0, c.cat_planned_pct || 0))}%; height: 100%; position: absolute; top: 0; left: 0;"></div>
          <div style="background: ${badgeColor}; width: ${Math.min(100, Math.max(0, c.cat_actual_pct || 0))}%; height: 100%; position: absolute; top: 0; left: 0;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 8px; margin-top: 4px; border-top: 1px solid #e2e8f0; padding-top: 2px;">
          <span>แผน: <strong style="color: #2563eb;">${plan}%</strong></span>
          <span>ทำจริง: <strong style="color: #10b981;">${act}%</strong></span>
        </div>
      </div>
    `;
  });

  // 4. Build Site Rows for Tabular Breakdown
  let siteRowsHtml = '';
  processedSites.forEach((s, idx) => {
    const bgRow = (idx % 2 === 1) ? '#f8fafc' : '#ffffff';
    let statusBg = '#d1fae5';
    let statusCol = '#065f46';
    let statusTxt = 'ตามแผนงาน';

    if (s.actual >= 99.9) {
      statusBg = '#d1fae5'; statusCol = '#065f46'; statusTxt = 'เสร็จสมบูรณ์';
    } else if (s.variance < -10) {
      statusBg = '#ffe4e6'; statusCol = '#be123c'; statusTxt = 'ล่าช้ากว่าแผน';
    } else if (s.variance < 0) {
      statusBg = '#fef3c7'; statusCol = '#92400e'; statusTxt = 'ล่าช้าเล็กน้อย';
    } else {
      statusBg = '#eff6ff'; statusCol = '#1d4ed8'; statusTxt = 'ตามแผนงาน';
    }

    siteRowsHtml += `
      <tr style="background: ${bgRow}; border-bottom: 1px solid #e2e8f0; font-size: 8px; line-height: 1.15; page-break-inside: avoid;">
        <td style="padding: 3.5px 4px; text-align: center; color: #64748b; font-weight: 600; width: 5%;">${idx + 1}</td>
        <td style="padding: 3.5px 6px; font-weight: 700; color: #0f172a; width: 34%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.name}</td>
        <td style="padding: 3.5px 4px; text-align: center; color: #475569; width: 8%;"><span style="background: #fef3c7; color: #92400e; padding: 1px 4px; border-radius: 3px; font-weight: 600;">${s.lot || '-'}</span></td>
        <td style="padding: 3.5px 4px; text-align: center; color: #475569; width: 14%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.business_unit || '-'}</td>
        <td style="padding: 3.5px 6px; text-align: right; font-family: monospace; font-weight: 700; color: #b45309; width: 11%;">${Number(s.capacity_kwp).toLocaleString()}</td>
        <td style="padding: 3.5px 4px; text-align: center; font-family: monospace; font-weight: 700; color: #2563eb; width: 9%;">${s.plan.toFixed(1)}%</td>
        <td style="padding: 3.5px 4px; text-align: center; font-family: monospace; font-weight: 700; color: #10b981; width: 9%;">${s.actual.toFixed(1)}%</td>
        <td style="padding: 3.5px 4px; text-align: center; font-family: monospace; font-weight: 700; color: ${s.variance < 0 ? '#e11d48' : '#059669'}; width: 10%;">${s.variance >= 0 ? '+' : ''}${s.variance.toFixed(1)}%</td>
      </tr>
    `;
  });

  // 5. Construct Printable Container HTML
  const reportContainer = document.getElementById('printable-report');
  reportContainer.innerHTML = `
    <div id="pdf-lot-root" style="width: 210mm; margin: 0; padding: 0; background: #ffffff; color: #0f172a; font-family: 'Prompt', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-sizing: border-box;">
      
      <!-- ================= PAGE 1: EXECUTIVE LOT SUMMARY & S-CURVE ================= -->
      <div style="width: 210mm; height: 295mm; max-height: 295mm; padding: 8mm 10mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; background: #ffffff; overflow: hidden;">
        <div>
          <!-- Header Bar (Dark Green KPGreenergy Brand Theme) -->
          <div style="background: #043327; color: #ffffff; border-radius: 6px; padding: 8px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="background: #f59e0b; width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px;">⚡</div>
              <div>
                <h1 style="font-size: 15px; font-weight: 800; margin: 0; color: #ffffff;">KPGreenergy Planner</h1>
                <p style="font-size: 8.5px; color: #a7f3d0; margin: 1px 0 0 0;">รายงานสรุปความก้าวหน้าโครงการระดับ Lot (Lot Progress & Performance Report)</p>
              </div>
            </div>
            <div style="text-align: right; font-size: 8.5px; color: #e2e8f0;">
              <div>วันที่ออกรายงาน: <strong style="color: #ffffff;">${dateStr}</strong></div>
              <div style="margin-top: 1px;">ข้อมูล ณ: <strong style="color: #fef08a;">${selectedWeekText}</strong></div>
            </div>
          </div>

          <!-- Lot Identity & KPI Bar -->
          <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 10px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <span style="font-size: 7.5px; text-transform: uppercase; font-weight: 700; color: #64748b;">กลุ่มล็อตที่รายงาน / Selected Target</span>
              <h2 style="font-size: 14px; font-weight: 800; color: #043327; margin: 1px 0 0 0;">${lotDisplayName}</h2>
            </div>
            <div style="display: flex; gap: 10px; text-align: center;">
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 5px; padding: 3px 8px;">
                <div style="font-size: 7.5px; color: #64748b;">จำนวนไซต์งาน</div>
                <div style="font-size: 11px; font-weight: 800; color: #0f172a;">${totalSites} ไซต์</div>
              </div>
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 5px; padding: 3px 8px;">
                <div style="font-size: 7.5px; color: #64748b;">กำลังการผลิตรวม</div>
                <div style="font-size: 11px; font-weight: 800; color: #b45309;">${Number(totalCapKwp).toLocaleString()} kWp <span style="font-size: 8px; font-weight: normal; color: #64748b;">(${totalCapMwp} MW)</span></div>
              </div>
              <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 5px; padding: 3px 8px;">
                <div style="font-size: 7.5px; color: #1e40af;">แผนงานเฉลี่ย (% Plan)</div>
                <div style="font-size: 12px; font-weight: 800; color: #2563eb;">${avgPlan}%</div>
              </div>
              <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 5px; padding: 3px 8px;">
                <div style="font-size: 7.5px; color: #065f46;">ผลงานจริงเฉลี่ย (% Actual)</div>
                <div style="font-size: 12px; font-weight: 800; color: #10b981;">${avgAct}%</div>
              </div>
              <div style="background: ${avgVar < 0 ? '#fff1f2' : '#ecfdf5'}; border: 1px solid ${avgVar < 0 ? '#fecdd3' : '#a7f3d0'}; border-radius: 5px; padding: 3px 8px;">
                <div style="font-size: 7.5px; color: ${avgVar < 0 ? '#9f1239' : '#065f46'};">ผลต่าง (Variance)</div>
                <div style="font-size: 12px; font-weight: 800; color: ${avgVar < 0 ? '#e11d48' : '#059669'};">${avgVar >= 0 ? '+' : ''}${avgVar}%</div>
              </div>
            </div>
          </div>

          <!-- 3-Category Breakdown Section -->
          <div style="margin-bottom: 8px;">
            <div style="font-size: 9px; font-weight: 800; color: #0f172a; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
              <span>ความก้าวหน้าแยกตาม 3 หมวดหมู่งานหลัก (Category Delay Breakdown)</span>
              <span style="font-size: 8px; color: #64748b; font-weight: normal;">(ราชการ, ออกแบบ, ก่อสร้าง)</span>
            </div>
            <div style="display: flex; gap: 8px;">
              ${catCardsHtml}
            </div>
          </div>

          <!-- S-Curve Chart Block -->
          <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; background: #ffffff; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; margin-bottom: 4px;">
              <div>
                <strong style="font-size: 10px; color: #043327;">กราฟ S-Curve ความก้าวหน้าสะสม (Planned vs Actual S-Curve)</strong>
                <span style="font-size: 8px; color: #64748b; margin-left: 6px;">แสดงเปรียบเทียบแผนงาน (% Plan) และผลงานจริง (% Actual)</span>
              </div>
              <div style="font-size: 8px; display: flex; gap: 10px;">
                <span style="display: flex; align-items: center; gap: 4px; color: #334155; font-weight: 600;"><span style="display: inline-block; width: 12px; height: 3px; background: #2563eb; border-radius: 2px;"></span> แผนงานสะสม (% Plan)</span>
                <span style="display: flex; align-items: center; gap: 4px; color: #334155; font-weight: 600;"><span style="display: inline-block; width: 12px; height: 3px; background: #10b981; border-radius: 2px;"></span> ผลงานจริงสะสม (% Actual)</span>
              </div>
            </div>
            ${scurveImgUri ? `
              <img src="${scurveImgUri}" style="width: 100%; height: 320px; object-fit: contain; display: block; margin: 0 auto;" />
            ` : `
              <div style="height: 180px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 10px; background: #f8fafc; border-radius: 4px;">
                กราฟ S-Curve ความก้าวหน้าสะสม
              </div>
            `}
          </div>

          <!-- Summary Status Banner -->
          <div style="background: #f1f5f9; border-radius: 6px; padding: 6px 10px; display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; font-size: 9px; border: 1px solid #e2e8f0;">
            <div>
              <span style="color: #64748b;">แผนงานสะสมเฉลี่ย:</span><br>
              <strong style="color: #2563eb; font-size: 12px;">${avgPlan}%</strong>
            </div>
            <div style="border-left: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1;">
              <span style="color: #64748b;">ผลงานจริงสะสมเฉลี่ย:</span><br>
              <strong style="color: #10b981; font-size: 12px;">${avgAct}%</strong>
            </div>
            <div>
              <span style="color: #64748b;">สถานะภาพรวม Lot:</span><br>
              <strong style="color: ${avgVar < 0 ? '#e11d48' : '#059669'}; font-size: 12px;">${avgVar >= 0 ? '✓ ตามแผนงาน (+' + avgVar + '%)' : '⚠ ล่าช้ากว่าแผน (' + avgVar + '%)'}</strong>
            </div>
          </div>
        </div>

        <!-- Page 1 Footer -->
        <div style="border-top: 1px solid #cbd5e1; padding-top: 4px; display: flex; justify-content: space-between; font-size: 7.5px; color: #94a3b8;">
          <div>KPGreenergy Planner • เอกสารรายงานความคืบหน้าระดับ Lot อัตโนมัติ</div>
          <div>หน้า 1 (ภาพรวมผู้บริหาร, 3 หมวดหมู่งานหลัก และกราฟ S-Curve)</div>
        </div>
      </div>

      <!-- ================= PAGE 2+: SITE-BY-SITE PROGRESS BREAKDOWN ================= -->
      <div style="width: 210mm; min-height: 295mm; padding: 8mm 10mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; background: #ffffff;">
        <div>
          <!-- Header Page 2 -->
          <div style="border-bottom: 2px solid #043327; padding-bottom: 4px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
              <h3 style="font-size: 12px; font-weight: 800; margin: 0; color: #043327;">ตารางความก้าวหน้ารายไซต์ใน ${lotDisplayName} (Site-by-Site Progress Table)</h3>
              <p style="font-size: 8px; color: #64748b; margin: 1px 0 0 0;">ข้อมูล ณ: <strong style="color: #0f172a;">${selectedWeekText}</strong> • เรียงตามลำดับกำลังการผลิต / ความล่าช้า</p>
            </div>
            <div style="font-size: 8px; color: #64748b; text-align: right;">
              จำนวนทั้งหมด <strong>${totalSites} ไซต์งาน</strong> (${Number(totalCapKwp).toLocaleString()} kWp)
            </div>
          </div>

          <!-- Sites Table -->
          <table style="width: 100%; border-collapse: collapse; text-align: left; border: 1px solid #cbd5e1; margin-bottom: 10px;">
            <thead>
              <tr style="background: #043327; color: #ffffff; font-size: 7.5px; font-weight: 700;">
                <th style="padding: 3.5px 4px; text-align: center; width: 5%;">ลำดับ</th>
                <th style="padding: 3.5px 6px; width: 34%;">ชื่อไซต์งาน (Site Name)</th>
                <th style="padding: 3.5px 4px; text-align: center; width: 8%;">Lot</th>
                <th style="padding: 3.5px 4px; text-align: center; width: 14%;">กลุ่มธุรกิจ</th>
                <th style="padding: 3.5px 6px; text-align: right; width: 11%;">กำลังผลิต (kWp)</th>
                <th style="padding: 3.5px 4px; text-align: center; width: 9%;">% แผน</th>
                <th style="padding: 3.5px 4px; text-align: center; width: 9%;">% จริง</th>
                <th style="padding: 3.5px 4px; text-align: center; width: 10%;">% ผลต่าง</th>
              </tr>
            </thead>
            <tbody>
              ${siteRowsHtml}
            </tbody>
          </table>

          <!-- Signatures Box -->
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 14px; font-size: 8px; color: #334155; page-break-inside: avoid;">
            <div style="border: 1px solid #cbd5e1; border-radius: 5px; padding: 7px 10px; text-align: center; background: #fafafa;">
              <p style="margin: 0 0 22px 0; font-weight: 600;">ผู้รายงานข้อมูล / วิศวกรโครงการประจำ Lot (Project Engineer)</p>
              <p style="margin: 0; border-top: 1px dashed #94a3b8; padding-top: 3px;">(...........................................................................)</p>
              <p style="margin: 2px 0 0 0; color: #64748b;">วันที่ ..... / ..... / .........</p>
            </div>
            <div style="border: 1px solid #cbd5e1; border-radius: 5px; padding: 7px 10px; text-align: center; background: #fafafa;">
              <p style="margin: 0 0 22px 0; font-weight: 600;">ผู้ตรวจสอบ / ผู้จัดการโครงการ (Project Manager)</p>
              <p style="margin: 0; border-top: 1px dashed #94a3b8; padding-top: 3px;">(...........................................................................)</p>
              <p style="margin: 2px 0 0 0; color: #64748b;">วันที่ ..... / ..... / .........</p>
            </div>
          </div>
        </div>

        <!-- Page 2 Footer -->
        <div style="border-top: 1px solid #cbd5e1; padding-top: 4px; display: flex; justify-content: space-between; font-size: 7.5px; color: #94a3b8; margin-top: 10px;">
          <div>KPGreenergy Planner • เอกสารรายงานความคืบหน้าระดับ Lot อัตโนมัติ</div>
          <div>รายละเอียดความก้าวหน้าทุกไซต์งานประจำ Lot</div>
        </div>
      </div>

    </div>
  `;

  // 6. html2pdf Export
  const filenameStr = "KPGreenergy_Report_Lot_" + selectedLot.replace(/\s+/g, '_') + "_" + now.toISOString().split('T')[0] + ".pdf";
  const elementToPrint = document.getElementById('pdf-lot-root');

  const opt = {
    margin: 0,
    filename: filenameStr,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      scrollY: 0,
      scrollX: 0
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  try {
    if (typeof html2pdf !== 'undefined') {
      await html2pdf().set(opt).from(elementToPrint).save();
      showToast(`สร้างรายงาน PDF ของ ${lotDisplayName} สำเร็จแล้ว!`);
    } else {
      window.print();
    }
  } catch (err) {
    console.error("Lot PDF generation error:", err);
    window.print();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    lucide.createIcons();
  }
}
window.generateLotPDF = generateLotPDF;


// =========================================================================
// MODAL & QUICK UPDATE CONTROLLERS
// =========================================================================
function openQuickUpdateModalByIndex(idx) {
  if (!currentProject || !currentProject.milestones) return;
  const m = currentProject.milestones[idx];
  if (!m) return;
  const pctVal = Math.round((m.actual_pct || 0) * 100);
  openQuickUpdateModal(m.name, pctVal, m.actual_start || '', m.actual_finish || '', m.planned_start || '', m.planned_finish || '');
}
window.openQuickUpdateModalByIndex = openQuickUpdateModalByIndex;

function openQuickUpdateModal(milestoneName = null, pctVal = 100, actStart = '', actFinish = '', planStart = '', planFinish = '') {
  if (!currentProject) {
    showToast('กรุณาเลือกโครงการก่อนอัปเดตงาน', 'error');
    return;
  }
  
  const modal = document.getElementById('update-modal');
  if (!modal) return;
  
  document.getElementById('modal-subtitle').innerText = `โครงการ: ${currentProject.name} (${currentProject.lot})`;
  
  // Populate Milestones Dropdown
  const mSel = document.getElementById('modal-milestone-select');
  mSel.innerHTML = '';
  (currentProject.milestones || []).forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.innerText = `${m.name} [น้ำหนัก ${(m.weight*100).toFixed(1)}%]`;
    mSel.appendChild(opt);
  });
  
  // Hook onchange to populate values when milestone dropdown changes
  mSel.onchange = function() {
    const targetName = this.value;
    const foundM = (currentProject.milestones || []).find(x => x.name === targetName);
    if (foundM) {
      const p = Math.round(foundM.actual_pct * 100);
      setModalPct(p);
      document.getElementById('modal-start-date').value = foundM.actual_start || '';
      document.getElementById('modal-finish-date').value = (p >= 100 && foundM.actual_finish) ? foundM.actual_finish : '';
      const planStartEl = document.getElementById('modal-plan-start-date');
      const planFinishEl = document.getElementById('modal-plan-finish-date');
      if (planStartEl) planStartEl.value = foundM.planned_start || '';
      if (planFinishEl) planFinishEl.value = foundM.planned_finish || '';
    }
  };
  
  if (milestoneName) {
    mSel.value = milestoneName;
  }
  
  // Set initial slider & dates
  setModalPct(pctVal);
  document.getElementById('modal-start-date').value = actStart || '';
  document.getElementById('modal-finish-date').value = (pctVal >= 100 && actFinish) ? actFinish : '';
  
  // Set initial planned start & finish dates
  const curM = (currentProject.milestones || []).find(x => x.name === (milestoneName || mSel.value));
  const planStartEl = document.getElementById('modal-plan-start-date');
  const planFinishEl = document.getElementById('modal-plan-finish-date');
  if (planStartEl) planStartEl.value = planStart || (curM ? curM.planned_start : '') || '';
  if (planFinishEl) planFinishEl.value = planFinish || (curM ? curM.planned_finish : '') || '';

  // Auto-fill password if remembered in session
  const pwdInput = document.getElementById('modal-editor-password');
  const sessionPwd = sessionStorage.getItem('kpg_auth_pwd');
  if (pwdInput) {
    pwdInput.value = sessionPwd || 'KPGEditor';
  }
  
  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeQuickUpdateModal() {
  const modal = document.getElementById('update-modal');
  if (modal) modal.classList.add('hidden');
}

function setModalPct(val) {
  const slider = document.getElementById('modal-pct-slider');
  const display = document.getElementById('modal-pct-display');
  const finishInput = document.getElementById('modal-finish-date');
  
  if (slider) slider.value = val;
  if (display) display.innerText = val + '%';
  
  if (val >= 100) {
    if (finishInput && !finishInput.value) {
      finishInput.value = new Date().toISOString().split('T')[0];
    }
  } else {
    if (finishInput) finishInput.value = '';
  }
}

async function handleModalSubmit(e) {
  e.preventDefault();
  if (!currentProject) return;
  
  const mName = document.getElementById('modal-milestone-select').value;
  const pct = parseFloat(document.getElementById('modal-pct-slider').value);
  const startD = document.getElementById('modal-start-date').value;
  const finishD = document.getElementById('modal-finish-date').value;
  const planStartD = document.getElementById('modal-plan-start-date') ? document.getElementById('modal-plan-start-date').value : '';
  const planFinishD = document.getElementById('modal-plan-finish-date') ? document.getElementById('modal-plan-finish-date').value : '';
  const pwdInput = document.getElementById('modal-editor-password');
  const pwd = pwdInput ? pwdInput.value.trim() : '';
  const savedSheetUrl = localStorage.getItem('kpgreenergy_webapp_url') || localStorage.getItem('kpgreenergy_gsheet_url') || '';
  
  if (!pwd) {
    showToast('กรุณาใส่รหัสผ่าน KPGEditor เพื่อบันทึกข้อมูล', 'error');
    return;
  }
  
  const btn = document.getElementById('modal-submit-btn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="animate-spin mr-1">⏳</span> กำลังบันทึก...`;
  
  try {
    const res = await fetch('/api/update-milestone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: currentProject.id,
        milestone_name: mName,
        actual_pct: pct,
        actual_start: startD,
        actual_finish: finishD,
        planned_start: planStartD || null,
        planned_finish: planFinishD || null,
        password: pwd,
        sheet_url: savedSheetUrl,
        updated_by: 'Web Editor'
      })
    });
    
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'บันทึกไม่สำเร็จ');
    }
    
    closeQuickUpdateModal();
    showToast(data.message || `อัปเดต ${mName} สำเร็จแล้ว!`);
    
    // Remember password in session
    sessionStorage.setItem('kpg_auth_pwd', pwd);
    
    // Refresh UI
    await loadInitialData();
    await selectProject(currentProject.id);
    
  } catch (err) {
    console.error(err);
    showToast(err.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    lucide.createIcons();
  }
}

// =========================================================================
// TAB 5: INTEGRATION & SIMULATOR
// =========================================================================
function populateSimulatorDropdowns() {
  const simPrj = document.getElementById('sim-project-select');
  const simM = document.getElementById('sim-milestone-select');
  
  simPrj.innerHTML = '';
  allProjects.forEach(p => {
    simPrj.innerHTML += `<option value="${p.id}">${p.name}</option>`;
  });
  
  simM.innerHTML = '';
  if (currentProject && currentProject.milestones) {
    currentProject.milestones.forEach(m => {
      simM.innerHTML += `<option value="${m.name}">${m.name}</option>`;
    });
  }
}

async function submitSimulatorUpdate() {
  const prjId = document.getElementById('sim-project-select').value;
  const mName = document.getElementById('sim-milestone-select').value;
  const pct = parseFloat(document.getElementById('sim-pct-input').value);
  const resBox = document.getElementById('sim-result-box');
  
  try {
    const res = await fetch('/api/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_milestone',
        project_id: prjId,
        milestone_name: mName,
        actual_pct: pct,
        actual_start: new Date().toISOString().split('T')[0]
      })
    });
    
    const data = await res.json();
    resBox.classList.remove('hidden');
    resBox.innerText = `>>> Webhook Response (HTTP 200 OK):\n` + JSON.stringify(data, null, 2);
    showToast('ส่ง Webhook จำลองเรียบร้อย Dashboard อัปเดตแล้ว!');
    
    await loadInitialData();
    if (currentProject && currentProject.id === prjId) {
      await selectProject(prjId);
    }
  } catch (err) {
    resBox.classList.remove('hidden');
    resBox.innerText = `Error: ` + err.message;
  }
}

async function copyGasCode() {
  try {
    const res = await fetch('/api/google-apps-script-code');
    const data = await res.json();
    await navigator.clipboard.writeText(data.code);
    const btnText = document.getElementById('copy-gas-btn-text');
    btnText.innerText = 'คัดลอกเรียบร้อยแล้ว!';
    showToast('คัดลอกโค้ด Google Apps Script ไปที่คลิปบอร์ดแล้ว');
    setTimeout(() => {
      btnText.innerText = 'คัดลอกโค้ด Google Apps Script';
    }, 2500);
  } catch (err) {
    showToast('ไม่สามารถคัดลอกได้: ' + err.message, 'error');
  }
}

function round(val, decimals = 2) {
  return Number(Math.round(val + 'e' + decimals) + 'e-' + decimals);
}


// Google Sheets Live Sync
// Google Sheets Live Sync with Timeout Protection
async function saveAndSyncGoogleSheet() {
  const urlInput = document.getElementById('gsheet-url-input');
  const url = urlInput ? urlInput.value.trim() : '';
  if (!url) {
    showToast('กรุณาวางลิงก์ Google Sheet หรือ Web App URL', 'error');
    return;
  }
  
  localStorage.setItem('kpgreenergy_gsheet_url', url);
  const btn = document.getElementById('btn-sync-gsheet');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="animate-spin mr-1">⏳</span> กำลังซิงค์ข้อมูล...`;
  
  // Abort controller for 15s max timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  try {
    const res = await fetch('/api/sync-google-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_url: url }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'การซิงค์ไม่สำเร็จ');
    }
    
    showToast(data.message || 'ซิงค์ข้อมูลจาก Google Sheets สำเร็จเรียบร้อย!');
    await refreshData();
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("Sync error:", err);
    if (err.name === 'AbortError') {
      showToast('การเชื่อมต่อใช้เวลานานเกินไป กรุณาใช้ลิงก์แชร์ Google Sheet โดยตรงแทนครับ', 'error');
    } else {
      showToast(err.message || 'เกิดข้อผิดพลาดในการซิงค์ข้อมูล', 'error');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
    lucide.createIcons();
  }
}

// On page load, populate saved Google Sheet URL & sync active Web App URL
document.addEventListener('DOMContentLoaded', () => {
  const savedUrl = localStorage.getItem('kpgreenergy_gsheet_url');
  const webappInput = document.getElementById('webapp-url-input');
  
  fetch('/api/get-webapp-url').then(r => r.json()).then(d => {
    if (d.webapp_url) {
      if (webappInput) webappInput.value = d.webapp_url;
      localStorage.setItem('kpgreenergy_webapp_url', d.webapp_url);
    }
  }).catch(e => {});
  
  const inputEl = document.getElementById('gsheet-url-input');
  if (savedUrl && inputEl) {
    inputEl.value = savedUrl;
  }
});



// Save Web App URL for 2-Way Writing globally on Server and LocalStorage
async function saveWebAppUrl() {
  const inputEl = document.getElementById('webapp-url-input');
  const url = inputEl ? inputEl.value.trim() : '';
  if (!url) {
    showToast('กรุณาวาง URL ของ Web App จาก Apps Script', 'error');
    return;
  }
  
  localStorage.setItem('kpgreenergy_webapp_url', url);
  
  try {
    const res = await fetch('/api/save-webapp-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webapp_url: url })
    });
    const data = await res.json();
    showToast(data.message || 'บันทึกลิงก์เขียน 2-Way ถาวรบนเซิร์ฟเวอร์เรียบร้อยแล้ว!');
  } catch (err) {
    showToast('บันทึกบนเซิร์ฟเวอร์สำเร็จ (Local)');
  }
}

// =========================================================================
// ⚡ Real-Time Auto-Sync Polling (Google Sheet ➔ Web Dashboard)
// =========================================================================
let currentDataVersion = null;
let isPollingSync = false;

async function checkLiveStatus() {
  if (isPollingSync) return;
  
  // Don't interrupt user if they have the edit milestone modal open
  const editModal = document.getElementById('edit-milestone-modal');
  if (editModal && !editModal.classList.contains('hidden')) {
    return;
  }

  try {
    isPollingSync = true;
    const res = await fetch('/api/live-status?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    
    if (data && data.version !== undefined) {
      if (currentDataVersion === null) {
        currentDataVersion = data.version;
      } else if (data.version > currentDataVersion) {
        console.log(`[RealTimeSync] New version detected: ${currentDataVersion} -> ${data.version}`);
        currentDataVersion = data.version;
        await refreshDataSilently();
        showToast('⚡ ได้รับข้อมูลอัปเดตล่าสุดจาก Google Sheet เรียบร้อยแล้ว!', 'success');
      }
    }
  } catch (err) {
    // Silent fail on momentary network interruption
  } finally {
    isPollingSync = false;
  }
}

async function refreshDataSilently() {
  try {
    const [overviewRes, projectsRes] = await Promise.all([
      fetch('/api/overview?t=' + Date.now(), { cache: 'no-store' }),
      fetch('/api/projects?t=' + Date.now(), { cache: 'no-store' })
    ]);
    
    globalOverview = await overviewRes.json();
    const pData = await projectsRes.json();
    allProjects = pData.projects || [];
    
    renderKPIs();
    renderPhaseOverviewTab();
    renderComparisonTab();
    
    // Silently re-render currently selected project
    if (currentProject) {
      const activePrjId = currentProject.id;
      const updatedPrj = allProjects.find(p => p.id === activePrjId);
      if (updatedPrj) {
        await selectProject(updatedPrj.id);
      }
    }

    if (currentTab === 'issues') {
      renderIssuesTab();
    } else {
      fetchIssuesData().then(updateIssuesNavBadge).catch(() => {});
    }
  } catch (e) {
    console.error('[RealTimeSync] Silent refresh error:', e);
  }
}

// Start auto polling: every 7 seconds for fast real-time collaborative updates + instant on window focus
setInterval(checkLiveStatus, 7000);
window.addEventListener('focus', checkLiveStatus);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    checkLiveStatus();
  }
});


// =========================================================================
// TAB: WEEKLY ISSUES & ACTIONS LOG
// =========================================================================
let cachedIssues = [];
let allIssuesSummary = null;

async function fetchIssuesData() {
  try {
    const lotSel = document.getElementById('issue-filter-lot');
    const prjSel = document.getElementById('issue-filter-project');
    const statSel = document.getElementById('issue-filter-status');
    const catSel = document.getElementById('issue-filter-category');
    const searchInput = document.getElementById('issue-filter-search');

    const lotVal = lotSel ? lotSel.value : 'ALL';
    const prjVal = prjSel ? prjSel.value : 'ALL';
    const statVal = statSel ? statSel.value : 'ALL';
    const catVal = catSel ? catSel.value : 'ALL';
    const searchVal = searchInput ? searchInput.value.trim() : '';

    const queryParams = new URLSearchParams({
      lot: lotVal,
      project_id: prjVal,
      status: statVal,
      category: catVal,
      search: searchVal,
      t: Date.now()
    });

    const res = await fetch(`/api/issues?${queryParams.toString()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      cachedIssues = data.issues || [];
      allIssuesSummary = data.summary || {};
      return data;
    }
  } catch (err) {
    console.error('Error fetching issues:', err);
  }
  return null;
}

function updateIssuesNavBadge() {
  const summary = allIssuesSummary || {};
  const navBadge = document.getElementById('nav-issue-badge');
  if (navBadge) {
    const openCount = summary.open_issues !== undefined ? summary.open_issues : 0;
    if (openCount > 0) {
      navBadge.innerText = openCount;
      navBadge.classList.remove('hidden');
    } else {
      navBadge.classList.add('hidden');
    }
  }
}

async function renderIssuesTab() {
  const lotSel = document.getElementById('issue-filter-lot');
  const prjSel = document.getElementById('issue-filter-project');

  // 1. Populate Lot filter if needed
  if (lotSel && globalOverview && globalOverview.lots && lotSel.options.length <= 1) {
    const curVal = lotSel.value;
    lotSel.innerHTML = '<option value="ALL">ทุกล็อต (All Lots)</option>';
    globalOverview.lots.forEach(lot => {
      lotSel.innerHTML += `<option value="${lot}">Lot: ${lot}</option>`;
    });
    if (curVal) lotSel.value = curVal;
  }

  // 2. Populate Project filter if needed
  if (prjSel && allProjects && prjSel.options.length <= 1) {
    const curPrjVal = prjSel.value;
    prjSel.innerHTML = '<option value="ALL">ทุกโครงการ (All Sites)</option>';
    const sortedPrjs = [...allProjects].sort((a, b) => a.name.localeCompare(b.name, 'th'));
    sortedPrjs.forEach(p => {
      prjSel.innerHTML += `<option value="${p.id}">${p.name} (${p.lot})</option>`;
    });
    if (curPrjVal) prjSel.value = curPrjVal;
  }

  // 3. Fetch data from backend
  const data = await fetchIssuesData();
  const issues = cachedIssues || [];
  const summary = allIssuesSummary || {};

  // 4. Update KPI cards
  const kpiOpen = document.getElementById('issue-kpi-open');
  if (kpiOpen) kpiOpen.innerText = summary.open_issues !== undefined ? summary.open_issues : 0;

  const kpiHigh = document.getElementById('issue-kpi-high');
  if (kpiHigh) kpiHigh.innerText = summary.high_severity_open !== undefined ? summary.high_severity_open : 0;

  const kpiResolved = document.getElementById('issue-kpi-resolved');
  if (kpiResolved) kpiResolved.innerText = summary.resolved_issues !== undefined ? summary.resolved_issues : 0;

  const kpiSites = document.getElementById('issue-kpi-sites');
  if (kpiSites) kpiSites.innerText = `${summary.affected_sites || 0} ไซต์`;

  // Update Nav Badge
  updateIssuesNavBadge();

  // 5. Update count
  const listCount = document.getElementById('issue-list-count');
  if (listCount) listCount.innerText = `${issues.length} รายการ`;

  const tbody = document.getElementById('issues-table-body');
  const emptyState = document.getElementById('issues-empty-state');
  if (!tbody) return;

  if (issues.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  // 6. Render Table Rows
  tbody.innerHTML = issues.map(item => {
    const startDateFmt = formatDateDisplay(item.start_date);
    const endDateFmt = item.end_date ? formatDateDisplay(item.end_date) : null;
    
    // Status badges
    let statusBadge = '';
    if (item.status === 'RESOLVED') {
      statusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>แก้ไขแล้ว</span>';
    } else if (item.status === 'OPEN') {
      statusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800"><span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>รอดำเนินการ</span>';
    } else {
      statusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>กำลังแก้ไข</span>';
    }

    // Severity badges
    let sevBadge = '';
    if (item.severity === 'HIGH') {
      sevBadge = '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-100 text-rose-700">สูง (High)</span>';
    } else if (item.severity === 'MEDIUM') {
      sevBadge = '<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-800">ปานกลาง</span>';
    } else {
      sevBadge = '<span class="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600">ต่ำ</span>';
    }

    const endDateHtml = endDateFmt 
      ? `<span class="font-semibold text-emerald-700 text-xs">${endDateFmt}</span>`
      : `<span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-medium border border-amber-200/60">กำลังดำเนินการ</span>`;

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="p-3.5 align-top">
          <div class="font-mono font-bold text-slate-500 text-[11px]">${item.id}</div>
          <div class="font-bold text-slate-800 mt-0.5">${item.site_name}</div>
          <div class="flex items-center gap-1.5 mt-1">
            <span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold text-[10px]">${item.lot || 'General'}</span>
            ${item.project_id ? `<button onclick="jumpToProjectDetail('${item.project_id}')" class="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5"><i data-lucide="external-link" class="w-2.5 h-2.5"></i> ดู S-Curve</button>` : ''}
          </div>
        </td>
        <td class="p-3.5 align-top">
          <div class="font-medium text-slate-800 text-xs">${item.week || '-'}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">${item.category || 'ทั่วไป'}</div>
          <div class="text-[10px] text-slate-400 mt-1">ผู้รายงาน: ${item.reported_by || '-'}</div>
        </td>
        <td class="p-3.5 align-top whitespace-nowrap font-medium text-slate-700">
          ${startDateFmt}
        </td>
        <td class="p-3.5 align-top whitespace-nowrap">
          ${endDateHtml}
        </td>
        <td class="p-3.5 align-top">
          <div class="text-xs text-slate-800 font-medium leading-relaxed">${escapeHtml(item.description || '-')}</div>
        </td>
        <td class="p-3.5 align-top">
          <div class="text-xs text-slate-700 leading-relaxed bg-slate-50 p-2.5 rounded-xl border border-slate-200/60">
            ${item.action_plan ? escapeHtml(item.action_plan) : '<span class="text-slate-400 italic">ยังไม่ได้ระบุแนวทางแก้ไข</span>'}
          </div>
        </td>
        <td class="p-3.5 align-top text-center whitespace-nowrap">
          ${statusBadge}
        </td>
        <td class="p-3.5 align-top text-center whitespace-nowrap">
          ${sevBadge}
        </td>
        <td class="p-3.5 align-top text-center whitespace-nowrap">
          <div class="flex items-center justify-center space-x-1.5">
            <button onclick="openEditIssueModal('${item.id}')" class="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold text-xs flex items-center gap-1 transition shadow-sm" title="แก้ไขหรือปิดเคส">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
              <span>${item.status === 'RESOLVED' ? 'แก้ไข' : 'ปิดเคส/แก้ไข'}</span>
            </button>
            <button onclick="deleteIssue('${item.id}')" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition" title="ลบรายการ">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

function formatDateDisplay(dStr) {
  if (!dStr || dStr === '-' || dStr === 'None') return '-';
  try {
    const parts = dStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  } catch (e) {}
  return dStr;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

function openNewIssueModal(defaultProjectId = null) {
  const prjSelect = document.getElementById('issue-form-project');
  if (prjSelect && allProjects) {
    const sorted = [...allProjects].sort((a, b) => a.name.localeCompare(b.name, 'th'));
    prjSelect.innerHTML = '<option value="">-- กรุณาเลือกโครงการที่พบปัญหา --</option>' + 
      sorted.map(p => `<option value="${p.id}" data-name="${p.name}" data-lot="${p.lot}">${p.name} (${p.lot} • ${p.capacity_kwp} kWp)</option>`).join('');
    
    prjSelect.onchange = function() {
      const opt = prjSelect.options[prjSelect.selectedIndex];
      if (opt && opt.value) {
        const pName = opt.getAttribute('data-name') || opt.text;
        const pLot = opt.getAttribute('data-lot') || '';
        document.getElementById('modal-issue-subtitle').innerText = `โครงการ: ${pName} (${pLot})`;
      } else {
        document.getElementById('modal-issue-subtitle').innerText = 'กรอกรายละเอียดปัญหา วันเริ่ม-วันจบ และแนวทางแก้ไขประจำสัปดาห์';
      }
    };

    if (defaultProjectId) {
      prjSelect.value = defaultProjectId;
      prjSelect.dispatchEvent(new Event('change'));
    } else {
      prjSelect.value = '';
    }
  }

  document.getElementById('issue-form-id').value = '';
  document.getElementById('modal-issue-title').innerText = 'บันทึกรายงานปัญหาใหม่';
  document.getElementById('modal-issue-subtitle').innerText = 'กรอกรายละเอียดปัญหา วันเริ่ม-วันจบ และแนวทางแก้ไขประจำสัปดาห์';
  
  // Set current date as default start date
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('issue-form-start-date').value = today;
  document.getElementById('issue-form-end-date').value = '';
  
  // Suggest week label
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const y = String(now.getFullYear()).slice(-2);
  document.getElementById('issue-form-week').value = `สัปดาห์ ${d}/${m}/${y}`;

  document.getElementById('issue-form-category').value = 'งานขออนุญาตราชการ';
  document.getElementById('issue-form-desc').value = '';
  document.getElementById('issue-form-action').value = '';
  document.getElementById('issue-form-status').value = 'IN_PROGRESS';
  document.getElementById('issue-form-severity').value = 'MEDIUM';
  document.getElementById('issue-form-password').value = '';

  document.getElementById('modal-issue').classList.remove('hidden');
  lucide.createIcons();
}

function openEditIssueModal(issueId) {
  const issue = cachedIssues.find(i => i.id === issueId);
  if (!issue) return;

  openNewIssueModal(issue.project_id);

  document.getElementById('issue-form-id').value = issue.id;
  document.getElementById('modal-issue-title').innerText = `แก้ไข / อัปเดตปัญหา: ${issue.id}`;
  document.getElementById('modal-issue-subtitle').innerText = `โครงการ: ${issue.site_name} (${issue.lot})`;

  const prjSelect = document.getElementById('issue-form-project');
  if (prjSelect && issue.project_id) {
    prjSelect.value = issue.project_id;
  }

  document.getElementById('issue-form-week').value = issue.week || '';
  document.getElementById('issue-form-start-date').value = issue.start_date || '';
  document.getElementById('issue-form-end-date').value = issue.end_date || '';
  document.getElementById('issue-form-category').value = issue.category || 'งานทั่วไป';
  document.getElementById('issue-form-desc').value = issue.description || '';
  document.getElementById('issue-form-action').value = issue.action_plan || '';
  document.getElementById('issue-form-status').value = issue.status || 'IN_PROGRESS';
  document.getElementById('issue-form-severity').value = issue.severity || 'MEDIUM';
  document.getElementById('issue-form-reporter').value = issue.reported_by || '';
  document.getElementById('issue-form-password').value = '';

  document.getElementById('modal-issue').classList.remove('hidden');
  lucide.createIcons();
}

function closeIssueModal() {
  const modal = document.getElementById('modal-issue');
  if (modal) modal.classList.add('hidden');
}

async function handleIssueSubmit(e) {
  e.preventDefault();
  const issueId = document.getElementById('issue-form-id').value;
  const prjSelect = document.getElementById('issue-form-project');
  const selectedOpt = prjSelect.options[prjSelect.selectedIndex];

  const projectId = prjSelect.value;
  if (!projectId) {
    alert('กรุณาเลือกโครงการที่พบปัญหาจากรายการ');
    prjSelect.focus();
    return;
  }

  const siteName = selectedOpt ? selectedOpt.getAttribute('data-name') || selectedOpt.text : '';
  const lot = selectedOpt ? selectedOpt.getAttribute('data-lot') || '' : '';
  const week = document.getElementById('issue-form-week').value;
  const startDate = document.getElementById('issue-form-start-date').value;
  const endDate = document.getElementById('issue-form-end-date').value;
  const category = document.getElementById('issue-form-category').value;
  const desc = document.getElementById('issue-form-desc').value.trim();
  const actionPlan = document.getElementById('issue-form-action').value.trim();
  const status = document.getElementById('issue-form-status').value;
  const severity = document.getElementById('issue-form-severity').value;
  const reporter = document.getElementById('issue-form-reporter').value.trim();
  const password = document.getElementById('issue-form-password').value;

  if (!password) {
    alert('กรุณาระบุรหัสผ่าน KPGEditor เพื่อยืนยันการบันทึก');
    return;
  }

  const submitBtn = document.getElementById('modal-issue-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> กำลังบันทึก...';
  }

  try {
    let url = '/api/issues';
    let payload = {
      project_id: projectId,
      site_name: siteName,
      lot: lot,
      week: week,
      start_date: startDate,
      end_date: endDate || null,
      category: category,
      description: desc,
      action_plan: actionPlan,
      status: status,
      severity: severity,
      reported_by: reporter,
      password: password
    };

    if (issueId) {
      url = `/api/issues/${issueId}/update`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const resData = await res.json();
    if (res.ok && resData.success) {
      showToast(resData.message || 'บันทึกข้อมูลเรียบร้อยแล้ว!', 'success');
      closeIssueModal();
      await renderIssuesTab();
      // Also update project detail if currently on that project
      if (currentProject) {
        checkAndRenderProjectIssues(currentProject.id);
      }
    } else {
      alert('เกิดข้อผิดพลาด: ' + (resData.detail || resData.message || 'ไม่สามารถบันทึกได้'));
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์: ' + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i> <span>บันทึกรายงานปัญหา</span>';
      lucide.createIcons();
    }
  }
}

async function deleteIssue(issueId) {
  const pwd = prompt(`ยืนยันการลบรายการปัญหา ${issueId}?\nกรุณาใส่รหัสผ่าน KPGEditor:`);
  if (!pwd) return;

  try {
    const res = await fetch(`/api/issues/${issueId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });

    const resData = await res.json();
    if (res.ok && resData.success) {
      showToast(resData.message || 'ลบรายการปัญหาเรียบร้อยแล้ว', 'success');
      await renderIssuesTab();
    } else {
      alert('ลบไม่สำเร็จ: ' + (resData.detail || 'รหัสผ่านไม่ถูกต้อง'));
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

function jumpToProjectDetail(projectId) {
  selectProject(projectId);
  switchTab('project');
}

function viewSiteIssuesInTab() {
  if (currentProject) {
    switchTab('issues');
    const prjSel = document.getElementById('issue-filter-project');
    if (prjSel) {
      prjSel.value = currentProject.id;
      renderIssuesTab();
    }
  }
}

function checkAndRenderProjectIssues(projectId) {
  const banner = document.getElementById('prj-issue-banner');
  if (!banner) return;

  const siteIssues = (cachedIssues || []).filter(i => i.project_id === projectId && i.status !== 'RESOLVED');
  if (siteIssues.length > 0) {
    banner.classList.remove('hidden');
    const titleEl = document.getElementById('prj-issue-banner-title');
    const descEl = document.getElementById('prj-issue-banner-desc');
    if (titleEl) titleEl.innerText = `⚠️ ไซต์นี้มีปัญหาค้างอยู่ ${siteIssues.length} รายการ (ระดับ: ${siteIssues[0].severity})`;
    if (descEl) descEl.innerText = siteIssues[0].description;
  } else {
    banner.classList.add('hidden');
  }
}

// =========================================================================
// TAB 6: SITE PHOTOS MANAGEMENT (APPROACH A: GOOGLE DRIVE + APPS SCRIPT)
// =========================================================================
let currentPhotoProjectId = null;
let currentProjectPhotos = [];
let pendingSlotImages = {};

const DEFAULT_PHOTO_CATEGORIES = [
  { slot: 1, title: 'ภาพรวมหน้างาน (Overall Site Overview)', desc: 'สภาพพื้นที่โดยรวม, อาคาร/หลังคา, ทางเข้าออกไซต์', icon: 'eye' },
  { slot: 2, title: 'งานโครงสร้างและฐานราก (Mounting & Civil Structure)', desc: 'รางยึด, เสา, ฐานคอนกรีต, ราง Roof Mounting', icon: 'box' },
  { slot: 3, title: 'งานติดตั้งแผงโซลาร์เซลล์ (Solar PV Modules)', desc: 'การวางแผง, การจัดเรียง String, สภาพแผงบนหลังคา', icon: 'sun' },
  { slot: 4, title: 'งานอินเวอร์เตอร์และรางสายไฟ (Inverter & Cable Trays)', desc: 'ตู้ Inverter, เดินท่อร้อยสาย, Cable Ladder', icon: 'cpu' },
  { slot: 5, title: 'จุดเชื่อมต่อระบบไฟฟ้า (MDB / Substation & Grid Connection)', desc: 'จุดต่อไฟเข้าตู้หลัก MDB, หม้อแปลง, CT/PT', icon: 'zap' },
  { slot: 6, title: 'งานทดสอบและตรวจรับความปลอดภัย (Testing & Safety Activities)', desc: 'ฉนวนกันความร้อน, ป้ายเตือน, อุปกรณ์เซฟตี้, เครื่องมือวัด', icon: 'shield-check' }
];

async function renderPhotosTab() {
  if (!currentPhotoProjectId && currentProject) {
    currentPhotoProjectId = currentProject.id;
  } else if (!currentPhotoProjectId && allProjects && allProjects.length > 0) {
    currentPhotoProjectId = allProjects[0].id;
  }
  
  populatePhotoProjectDropdown();
  if (currentPhotoProjectId) {
    await loadProjectPhotos(currentPhotoProjectId);
  }
}

function populatePhotoProjectDropdown() {
  const lotFilterEl = document.getElementById('photo-lot-filter');
  const lotFilter = lotFilterEl ? lotFilterEl.value : 'ALL';
  const prjSelect = document.getElementById('photo-project-select');
  if (!prjSelect || !allProjects || allProjects.length === 0) return;

  // Populate lot filter dynamically from global lots
  if (lotFilterEl && globalOverview && Array.isArray(globalOverview.lots) && globalOverview.lots.length > 0) {
    const curVal = lotFilterEl.value || 'ALL';
    let lotOptionsHtml = '<option value="ALL">ทุก Lot</option>';
    globalOverview.lots.forEach(l => {
      lotOptionsHtml += `<option value="${l}">${l}</option>`;
    });
    if (lotFilterEl.options.length <= 1) {
      lotFilterEl.innerHTML = lotOptionsHtml;
      lotFilterEl.value = curVal;
    }
  }

  const currentVal = currentPhotoProjectId || (currentProject ? currentProject.id : allProjects[0].id);
  let filtered = allProjects;
  if (lotFilter && lotFilter !== 'ALL') {
    filtered = filtered.filter(p => (p.lot || '').toUpperCase() === lotFilter.toUpperCase());
  }
  if (filtered.length === 0) {
    filtered = allProjects;
  }

  prjSelect.innerHTML = filtered.map(p => {
    const isSel = String(p.id) === String(currentVal) ? 'selected' : '';
    return `<option value="${p.id}" ${isSel}>${p.name} (${p.lot || '-'})</option>`;
  }).join('');

  if (filtered.length > 0) {
    const matched = filtered.find(p => String(p.id) === String(currentVal));
    if (matched) {
      currentPhotoProjectId = matched.id;
      prjSelect.value = matched.id;
    } else {
      currentPhotoProjectId = filtered[0].id;
      prjSelect.value = filtered[0].id;
    }
  }
}

function onPhotoLotFilterChange() {
  populatePhotoProjectDropdown();
  const prjSelect = document.getElementById('photo-project-select');
  if (prjSelect && prjSelect.value) {
    currentPhotoProjectId = prjSelect.value;
    loadProjectPhotos(currentPhotoProjectId);
  }
}

function onPhotoProjectChange() {
  const prjSelect = document.getElementById('photo-project-select');
  if (prjSelect && prjSelect.value) {
    currentPhotoProjectId = prjSelect.value;
    if (typeof selectProject === 'function') {
      const p = (allProjects || []).find(x => String(x.id) === String(currentPhotoProjectId));
      if (p) currentProject = p;
    }
    loadProjectPhotos(currentPhotoProjectId);
  }
}

async function reloadCurrentProjectPhotos() {
  if (currentPhotoProjectId) {
    await loadProjectPhotos(currentPhotoProjectId);
    showToast('รีเฟรชข้อมูลภาพถ่ายเรียบร้อย', 'success');
  }
}

async function loadProjectPhotos(projectId) {
  if (!projectId) return;
  
  const prj = (allProjects || []).find(p => String(p.id) === String(projectId)) || currentProject;

  const headerName = document.getElementById('photo-header-name');
  const headerLot = document.getElementById('photo-header-lot');
  const headerDetails = document.getElementById('photo-header-details');
  const headerActualPct = document.getElementById('photo-header-actual-pct');
  const headerCount = document.getElementById('photo-header-count');

  if (prj) {
    if (headerName) headerName.innerText = prj.name;
    if (headerLot) headerLot.innerText = prj.lot || 'Lot -';
    if (headerDetails) headerDetails.innerText = `กำลังการผลิต: ${prj.capacity_kwp || '-'} kWp | ประเภท: ${prj.installation_type || '-'} | แผน: ${prj.planned_progress_pct || 0}%`;
    if (headerActualPct) headerActualPct.innerText = `${prj.actual_progress_pct || 0}%`;
  }

  const gridEl = document.getElementById('photo-cards-grid');
  if (gridEl) {
    gridEl.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400 text-sm"><span class="animate-spin inline-block mr-2">⏳</span> กำลังโหลดข้อมูลภาพถ่ายโครงการ...</div>`;
  }

  try {
    const res = await fetch(`/api/projects/${projectId}/photos`);
    if (res.ok) {
      const data = await res.json();
      currentProjectPhotos = data.photos || [];
    } else {
      currentProjectPhotos = [];
    }
  } catch (err) {
    console.warn("Could not fetch photos from server:", err);
    currentProjectPhotos = [];
  }

  const uploadedCount = (currentProjectPhotos || []).filter(p => p.photo_url || p.drive_file_id || pendingSlotImages[p.slot]).length;
  if (headerCount) headerCount.innerText = `${uploadedCount} / 6 รูป`;

  renderPhotoCards(currentProjectPhotos, prj);
}

function renderPhotoCards(photos, prj) {
  const gridEl = document.getElementById('photo-cards-grid');
  if (!gridEl) return;

  const todayStr = new Date().toISOString().split('T')[0];

  const html = DEFAULT_PHOTO_CATEGORIES.map(cat => {
    const slotNum = cat.slot;
    const photo = (photos || []).find(p => p.slot === slotNum) || {};
    const hasPhoto = Boolean(photo.photo_url || photo.drive_file_id || pendingSlotImages[slotNum]);
    const photoUrl = pendingSlotImages[slotNum] || photo.photo_url || (photo.drive_file_id ? `https://lh3.googleusercontent.com/d/${photo.drive_file_id}` : '');
    const photoDate = photo.date || todayStr;
    const photoCaption = photo.caption || '';
    const updatedBy = photo.updated_by || 'วิศวกรหน้างาน';
    const updatedAt = photo.updated_at ? photo.updated_at.split(' ')[0] : '';

    return `
      <div class="bg-white rounded-2xl border ${hasPhoto ? 'border-emerald-200 shadow-sm' : 'border-slate-200'} p-5 flex flex-col justify-between space-y-4 hover:shadow-md transition">
        
        <!-- Card Header -->
        <div>
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${hasPhoto ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
              Slot ${slotNum}
            </span>
            ${hasPhoto ? `
              <span class="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
                <span>มีรูปแล้ว</span>
              </span>
            ` : `
              <span class="text-[11px] text-slate-400">ยังไม่มีรูป</span>
            `}
          </div>
          <h4 class="font-bold text-slate-900 text-sm leading-tight">${cat.title}</h4>
          <p class="text-[11px] text-slate-500 mt-0.5">${cat.desc}</p>
        </div>

        <!-- Photo Image Preview Container -->
        <div id="photo-preview-container-${slotNum}" class="relative w-full h-48 bg-slate-100 rounded-xl overflow-hidden border border-slate-200 flex items-center justify-center group">
          ${hasPhoto && photoUrl ? `
            <img id="photo-img-tag-${slotNum}" src="${photoUrl}" alt="${cat.title}" class="w-full h-full object-cover cursor-pointer transition duration-300 group-hover:scale-105" onclick="openPhotoLightbox(${slotNum})" />
            
            <!-- Hover Action Overlay -->
            <div class="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
              <button onclick="openPhotoLightbox(${slotNum})" class="p-2 bg-white/90 hover:bg-white text-slate-900 rounded-lg shadow text-xs font-medium flex items-center gap-1" title="ดูรูปขนาดใหญ่">
                <i data-lucide="maximize-2" class="w-4 h-4"></i>
              </button>
              ${photo.drive_file_id ? `
                <a href="https://drive.google.com/file/d/${photo.drive_file_id}/view" target="_blank" class="p-2 bg-emerald-600/90 hover:bg-emerald-600 text-white rounded-lg shadow text-xs font-medium flex items-center gap-1" title="เปิดใน Google Drive">
                  <i data-lucide="external-link" class="w-4 h-4"></i>
                </a>
              ` : ''}
              <button onclick="deletePhotoSlot(${slotNum})" class="p-2 bg-rose-600/90 hover:bg-rose-600 text-white rounded-lg shadow text-xs font-medium flex items-center gap-1" title="ลบรูปภาพ">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          ` : `
            <div class="flex flex-col items-center justify-center text-slate-400 p-4 text-center cursor-pointer" onclick="document.getElementById('photo-input-${slotNum}').click()">
              <i data-lucide="image-plus" class="w-8 h-8 text-slate-300 mb-1"></i>
              <span class="text-xs font-medium text-slate-600">คลิกเลือกภาพ หรือถ่ายรูป</span>
              <span class="text-[10px] text-slate-400 mt-0.5">ระบบจะบีบอัดรูปภาพอัตโนมัติ</span>
            </div>
          `}
          
          <input type="file" id="photo-input-${slotNum}" accept="image/*" class="hidden" onchange="handlePhotoSlotFileSelected(${slotNum}, this)" />
        </div>

        <!-- Form Details -->
        <div class="space-y-2.5 text-xs">
          <div>
            <label class="block text-[11px] font-semibold text-slate-700 mb-1">วันที่ถ่ายภาพ</label>
            <input type="date" id="photo-date-${slotNum}" value="${photoDate}" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500 font-medium" />
          </div>

          <div>
            <label class="block text-[11px] font-semibold text-slate-700 mb-1">คำบรรยาย / บันทึกหน้างาน</label>
            <textarea id="photo-caption-${slotNum}" rows="2" placeholder="ระบุรายละเอียด เช่น ติดตั้งเสร็จ 100%, พร้อมตรวจรับ" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500">${photoCaption}</textarea>
          </div>

          <!-- Bottom Action Buttons -->
          <div class="flex items-center gap-2 pt-1">
            <button type="button" onclick="document.getElementById('photo-input-${slotNum}').click()" class="flex-1 py-2 px-3 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium flex items-center justify-center gap-1.5 transition">
              <i data-lucide="camera" class="w-3.5 h-3.5 text-emerald-600"></i>
              <span>${hasPhoto ? 'เปลี่ยนรูป' : 'เลือกรูป'}</span>
            </button>
            <button type="button" id="btn-save-photo-${slotNum}" onclick="savePhotoSlotData(${slotNum})" class="py-2 px-4 rounded-xl bg-[#043327] hover:bg-[#064e3b] text-white font-semibold flex items-center justify-center gap-1.5 shadow-sm transition">
              <i data-lucide="save" class="w-3.5 h-3.5"></i>
              <span>บันทึก</span>
            </button>
          </div>

          ${hasPhoto && updatedAt ? `
            <div class="text-[10px] text-slate-400 text-right">อัปเดต: ${updatedAt} โดย ${updatedBy}</div>
          ` : ''}

        </div>

      </div>
    `;
  }).join('');

  gridEl.innerHTML = html;
  lucide.createIcons();
}

function compressImageClientSide(file, maxWidth = 1600, maxHeight = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

async function handlePhotoSlotFileSelected(slotNum, inputEl) {
  if (!inputEl.files || inputEl.files.length === 0) return;
  const file = inputEl.files[0];
  
  showToast(`กำลังประมวลผลและย่อขนาดภาพ Slot ${slotNum}...`, 'info');
  try {
    const compressedBase64 = await compressImageClientSide(file);
    pendingSlotImages[slotNum] = compressedBase64;
    
    // Instant DOM preview update so image displays IMMEDIATELY
    const previewContainer = document.getElementById(`photo-preview-container-${slotNum}`);
    if (previewContainer) {
      previewContainer.innerHTML = `
        <img id="photo-img-tag-${slotNum}" src="${compressedBase64}" alt="Slot ${slotNum}" class="w-full h-full object-cover cursor-pointer transition duration-300 group-hover:scale-105" onclick="openPhotoLightbox(${slotNum})" />
        <div class="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
          <button onclick="openPhotoLightbox(${slotNum})" class="p-2 bg-white/90 hover:bg-white text-slate-900 rounded-lg shadow text-xs font-medium flex items-center gap-1" title="ดูรูปขนาดใหญ่">
            <i data-lucide="maximize-2" class="w-4 h-4"></i>
          </button>
          <button onclick="deletePhotoSlot(${slotNum})" class="p-2 bg-rose-600/90 hover:bg-rose-600 text-white rounded-lg shadow text-xs font-medium flex items-center gap-1" title="ลบรูปภาพ">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
        <input type="file" id="photo-input-${slotNum}" accept="image/*" class="hidden" onchange="handlePhotoSlotFileSelected(${slotNum}, this)" />
      `;
      lucide.createIcons();
    }
    
    // Clear input so onchange triggers cleanly on re-selection
    inputEl.value = '';
    
    // Automatically save right away
    await savePhotoSlotData(slotNum);
  } catch (err) {
    console.error("Error processing photo file:", err);
    alert('ไม่สามารถประมวลผลไฟล์ภาพได้: ' + err.message);
  }
}

async function savePhotoSlotData(slotNum) {
  if (!currentPhotoProjectId) {
    if (currentProject) {
      currentPhotoProjectId = currentProject.id;
    } else if (allProjects && allProjects.length > 0) {
      currentPhotoProjectId = allProjects[0].id;
    } else {
      alert('กรุณาเลือกโครงการก่อนบันทึกภาพถ่าย');
      return;
    }
  }

  const btn = document.getElementById(`btn-save-photo-${slotNum}`);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin inline-block">⏳</span> บันทึก...`;
  }

  const dateVal = document.getElementById(`photo-date-${slotNum}`) ? document.getElementById(`photo-date-${slotNum}`).value : '';
  const captionVal = document.getElementById(`photo-caption-${slotNum}`) ? document.getElementById(`photo-caption-${slotNum}`).value : '';
  const imageBase64 = pendingSlotImages[slotNum] || null;

  const prj = (allProjects || []).find(p => String(p.id) === String(currentPhotoProjectId)) || currentProject;
  const cat = DEFAULT_PHOTO_CATEGORIES.find(c => c.slot === slotNum);

  const payload = {
    project_id: String(currentPhotoProjectId),
    project_name: prj ? prj.name : `Project ${currentPhotoProjectId}`,
    slot: slotNum,
    title: cat ? cat.title : `Slot ${slotNum}`,
    date: dateVal || new Date().toISOString().split('T')[0],
    caption: captionVal || '',
    updated_by: 'วิศวกรโครงการ',
    password: ''
  };

  if (imageBase64) {
    payload.image_base64 = imageBase64;
  }

  try {
    const res = await fetch(`/api/projects/${currentPhotoProjectId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const resData = await res.json();
    if (res.ok && resData.success) {
      delete pendingSlotImages[slotNum];
      showToast(`บันทึกภาพถ่าย Slot ${slotNum} เรียบร้อยแล้ว!`, 'success');
      await loadProjectPhotos(currentPhotoProjectId);
    } else {
      alert('บันทึกไม่สำเร็จ: ' + (resData.detail || resData.message || 'เกิดข้อผิดพลาด'));
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการบันทึกภาพ: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

async function deletePhotoSlot(slotNum) {
  if (!confirm(`คุณต้องการลบภาพถ่ายใน Slot ${slotNum} ใช่หรือไม่?`)) return;

  delete pendingSlotImages[slotNum];
  try {
    const res = await fetch(`/api/projects/${currentPhotoProjectId}/photos/${slotNum}`, {
      method: 'DELETE'
    });
    const resData = await res.json();
    if (res.ok && resData.success) {
      showToast(`ลบภาพ Slot ${slotNum} เรียบร้อยแล้ว`, 'success');
      await loadProjectPhotos(currentPhotoProjectId);
    } else {
      alert('ลบไม่สำเร็จ: ' + (resData.detail || 'เกิดข้อผิดพลาด'));
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

function openPhotoLightbox(slotNum) {
  const modal = document.getElementById('photo-lightbox-modal');
  if (!modal) return;

  const photo = (currentProjectPhotos || []).find(p => p.slot === slotNum) || {};
  const cat = DEFAULT_PHOTO_CATEGORIES.find(c => c.slot === slotNum) || { title: `Slot ${slotNum}` };
  const photoUrl = pendingSlotImages[slotNum] || photo.photo_url || (photo.drive_file_id ? `https://lh3.googleusercontent.com/d/${photo.drive_file_id}` : '');
  const photoDate = photo.date || (document.getElementById(`photo-date-${slotNum}`) ? document.getElementById(`photo-date-${slotNum}`).value : '');
  const photoCaption = photo.caption || (document.getElementById(`photo-caption-${slotNum}`) ? document.getElementById(`photo-caption-${slotNum}`).value : '');
  const driveId = photo.drive_file_id || '';

  const imgEl = document.getElementById('lightbox-img');
  const titleEl = document.getElementById('lightbox-title');
  const dateEl = document.getElementById('lightbox-date');
  const captionEl = document.getElementById('lightbox-caption');
  const driveLinkEl = document.getElementById('lightbox-drive-link');

  if (imgEl) imgEl.src = photoUrl;
  if (titleEl) titleEl.innerText = cat.title;
  if (dateEl) dateEl.innerText = photoDate ? `วันที่ถ่ายภาพ: ${photoDate}` : '';
  if (captionEl) captionEl.innerText = photoCaption ? `คำบรรยาย: ${photoCaption}` : 'ไม่มีคำบรรยายเพิ่มเติม';

  if (driveLinkEl) {
    if (driveId) {
      driveLinkEl.href = `https://drive.google.com/file/d/${driveId}/view`;
      driveLinkEl.classList.remove('hidden');
    } else {
      driveLinkEl.classList.add('hidden');
    }
  }

  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closePhotoLightbox() {
  const modal = document.getElementById('photo-lightbox-modal');
  if (modal) modal.classList.add('hidden');
}

// Expose Photo functions to window
window.renderPhotosTab = renderPhotosTab;
window.populatePhotoProjectDropdown = populatePhotoProjectDropdown;
window.onPhotoLotFilterChange = onPhotoLotFilterChange;
window.onPhotoProjectChange = onPhotoProjectChange;
window.reloadCurrentProjectPhotos = reloadCurrentProjectPhotos;
window.loadProjectPhotos = loadProjectPhotos;
window.handlePhotoSlotFileSelected = handlePhotoSlotFileSelected;
window.savePhotoSlotData = savePhotoSlotData;
window.deletePhotoSlot = deletePhotoSlot;
window.openPhotoLightbox = openPhotoLightbox;
window.closePhotoLightbox = closePhotoLightbox;

// =========================================================================
// ➕ ADD NEW PROJECT SITE (APPROACH C) - CAL PROGRESS & MILESTONE DATES
// =========================================================================

// Resolve 1..42 Type Code according to sheet 'Cal Progress'
function resolveAddPrjTypeCode(installType, capacityKwp, voltageLevel) {
  const it = String(installType || '').trim().toLowerCase();
  const cap = parseFloat(capacityKwp) || 100.0;
  const vl = String(voltageLevel || 'LV').trim().toUpperCase();
  const isMv = (vl === 'MV');

  if (it.includes('roof') && !it.includes('car')) {
    if (!isMv) {
      return cap < 250 ? 1 : (cap < 1000 ? 2 : 3);
    } else {
      return cap < 250 ? 22 : (cap < 1000 ? 23 : 24);
    }
  } else if (it.includes('car')) {
    if (!isMv) {
      return cap < 250 ? 19 : (cap < 1000 ? 20 : 21);
    } else {
      return cap < 250 ? 40 : (cap < 1000 ? 41 : 42);
    }
  } else if (it.includes('farm') && !it.includes('float')) {
    if (!isMv) {
      return cap < 250 ? 4 : (cap < 1000 ? 7 : 8);
    } else {
      return cap < 250 ? 25 : (cap < 1000 ? 28 : 29);
    }
  } else if (it.includes('fish') || it.includes('บ่อ')) {
    if (!isMv) {
      return cap < 250 ? 9 : (cap < 1000 ? 12 : 13);
    } else {
      return cap < 250 ? 30 : (cap < 1000 ? 33 : 34);
    }
  } else if (it.includes('float')) {
    if (it.includes('farm')) {
      return isMv ? 39 : 18;
    }
    if (!isMv) {
      return cap < 250 ? 14 : (cap < 1000 ? 17 : 18);
    } else {
      return cap < 250 ? 35 : (cap < 1000 ? 38 : 39);
    }
  }
  return 1;
}

let addPrjDebounceTimer = null;
function onAddPrjParamChange() {
  clearTimeout(addPrjDebounceTimer);
  addPrjDebounceTimer = setTimeout(() => {
    applyAddPrjParamChange();
  }, 100);
}

async function applyAddPrjParamChange() {
  const installEl = document.getElementById('add-prj-install-type');
  const capEl = document.getElementById('add-prj-capacity');
  const voltEl = document.getElementById('add-prj-voltage-level');
  const typeCodeEl = document.getElementById('add-prj-type-code');
  const typeBadgeEl = document.getElementById('add-prj-type-badge');
  const typeDescTextEl = document.getElementById('add-prj-type-desc-text');

  const installType = installEl ? installEl.value : 'Solar Rooftop';
  const cap = parseFloat(capEl ? capEl.value : 100) || 100;
  const volt = voltEl ? voltEl.value : 'LV';

  const typeCode = resolveAddPrjTypeCode(installType, cap, volt);
  if (typeCodeEl) typeCodeEl.value = typeCode;
  if (typeBadgeEl) typeBadgeEl.innerText = `Type ${typeCode} (${volt})`;

  const voltLabel = volt === 'LV' ? 'แรงดันต่ำ (ตู้ MDB เดิม)' : 'แรงดันปานกลาง (หม้อแปลง Step-Up)';
  if (typeDescTextEl) {
    typeDescTextEl.innerText = `Type ${typeCode}: ${installType} [${voltLabel}] - Cal Progress`;
  }

  await populateMilestoneWeightsFromCalProgress(typeCode, installType, cap, volt);
}

async function populateMilestoneWeightsFromCalProgress(typeCode, installType, cap, volt) {
  let weights = null;
  try {
    const res = await fetch(`/api/cal-progress-weights?installation_type=${encodeURIComponent(installType)}&capacity_kwp=${cap}&voltage_level=${volt}`);
    if (res.ok) {
      const data = await res.json();
      weights = data.weights;
    }
  } catch (e) {
    console.warn('Failed to fetch cal-progress-weights from API, using client fallback:', e);
  }

  if (!weights && cachedWeightMatrix && cachedWeightMatrix[String(typeCode)]) {
    weights = cachedWeightMatrix[String(typeCode)];
  }

  if (!weights) return;

  const weightInputs = document.querySelectorAll('.add-prj-ms-weight');
  weightInputs.forEach(inp => {
    const mName = inp.dataset.name;
    if (mName && weights[mName] !== undefined) {
      inp.value = (weights[mName] * 100).toFixed(1);
    }
  });

  calculateAddPrjWeightTotal();
}

function resetMilestoneWeightsFromCalProgress() {
  const installEl = document.getElementById('add-prj-install-type');
  const capEl = document.getElementById('add-prj-capacity');
  const voltEl = document.getElementById('add-prj-voltage-level');
  const installType = installEl ? installEl.value : 'Solar Rooftop';
  const cap = parseFloat(capEl ? capEl.value : 100) || 100;
  const volt = voltEl ? voltEl.value : 'LV';
  const typeCode = resolveAddPrjTypeCode(installType, cap, volt);

  populateMilestoneWeightsFromCalProgress(typeCode, installType, cap, volt);
  showToast('รีเซ็ตน้ำหนักตามตาราง Cal Progress เรียบร้อยแล้ว', 'info');
}

function calculateAddPrjWeightTotal() {
  const weightInputs = document.querySelectorAll('.add-prj-ms-weight');
  let total = 0.0;
  weightInputs.forEach(inp => {
    const val = parseFloat(inp.value);
    if (!isNaN(val)) total += val;
  });

  const totalEl = document.getElementById('add-prj-weight-total');
  const statusEl = document.getElementById('add-prj-weight-status');
  if (!totalEl || !statusEl) return;

  const roundTotal = Math.round(total * 10) / 10;
  totalEl.innerText = `${roundTotal.toFixed(1)}%`;

  if (Math.abs(roundTotal - 100.0) <= 0.2) {
    totalEl.className = 'font-bold font-mono px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800';
    statusEl.innerHTML = '<i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-600"></i> <span class="text-emerald-700">ถูกต้องครบ 100%</span>';
  } else {
    totalEl.className = 'font-bold font-mono px-2 py-0.5 rounded-lg bg-amber-100 text-amber-900 border border-amber-300';
    statusEl.innerHTML = `<i data-lucide="alert-circle" class="w-3.5 h-3.5 text-amber-600"></i> <span class="text-amber-700 font-semibold">น้ำหนักรวม ${roundTotal.toFixed(1)}% (ควรเท่ากับ 100%)</span>`;
  }
  lucide.createIcons();
}

function openAddProjectModal() {
  const modal = document.getElementById('add-project-modal');
  if (!modal) {
    console.error('Modal #add-project-modal not found');
    return;
  }

  // 1. Show modal immediately
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  try {
    // Auto-calculate next order_no
    const maxOrder = (allProjects || []).reduce((max, p) => {
      const o = parseInt(p.order_no);
      return !isNaN(o) && o > max ? o : max;
    }, 0);
    const nextOrderEl = document.getElementById('add-prj-order');
    if (nextOrderEl) nextOrderEl.value = maxOrder > 0 ? maxOrder + 1 : ((allProjects ? allProjects.length : 0) + 1);

    // Populate Lot select with existing lots
    const lotSelect = document.getElementById('add-prj-lot-select');
    if (lotSelect) {
      const lotSet = new Set();
      (allProjects || []).forEach(p => {
        const l = (p.lot || '').trim();
        if (l && !l.toUpperCase().startsWith('CC')) lotSet.add(l);
      });
      ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4', 'Lot 5'].forEach(l => lotSet.add(l));
      const sortedLots = Array.from(lotSet).sort();

      lotSelect.innerHTML = sortedLots.map(l => `<option value="${l}">${l}</option>`).join('') +
        `<option value="__custom__">➕ ระบุ Lot ใหม่...</option>`;
    }

    // Hide custom lot text input
    const customLotInput = document.getElementById('add-prj-lot-custom');
    if (customLotInput) {
      customLotInput.value = '';
      customLotInput.classList.add('hidden');
      customLotInput.required = false;
    }

    // Pre-fill default dates: today and today + 90 days
    const today = new Date();
    const finish = new Date();
    finish.setDate(today.getDate() + 90);
    const startStr = today.toISOString().split('T')[0];
    const finishStr = finish.toISOString().split('T')[0];

    const planStartEl = document.getElementById('add-prj-plan-start');
    const planFinishEl = document.getElementById('add-prj-plan-finish');
    if (planStartEl) planStartEl.value = startStr;
    if (planFinishEl) planFinishEl.value = finishStr;

    // First build rows and set initial dates
    buildAddPrjMilestoneRows();
    updateAddPrjMilestoneDates();

    // Resolve type code and populate weights from Cal Progress
    applyAddPrjParamChange();

    // Pre-fill password from localStorage
    const pwdEl = document.getElementById('add-prj-password');
    if (pwdEl) {
      pwdEl.value = localStorage.getItem('kpg_editor_pwd') || 'KPGEditor';
    }

    lucide.createIcons();

    // Focus project name
    setTimeout(() => {
      const nameEl = document.getElementById('add-prj-name');
      if (nameEl) nameEl.focus();
    }, 100);
  } catch (err) {
    console.error('Error opening add project modal:', err);
  }
}

function closeAddProjectModal() {
  const modal = document.getElementById('add-project-modal');
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = '';
}

function handleAddLotChange() {
  const select = document.getElementById('add-prj-lot-select');
  const customInput = document.getElementById('add-prj-lot-custom');
  if (!select || !customInput) return;

  if (select.value === '__custom__') {
    customInput.classList.remove('hidden');
    customInput.required = true;
    customInput.focus();
  } else {
    customInput.classList.add('hidden');
    customInput.required = false;
  }
}

// 33 Standard Milestone Names Fallback
const DEFAULT_MILESTONE_NAMES = [
  'CPF ส่งมอบพื้นที่และยินยอมการใช้ที่ดิน ATV', 'อ.1', 'รง.4', 'Mini COP REPORT ( ERC )',
  'COP REPORT ( ERC )', 'พค.2', 'ใบยกเว้นผลิตไฟฟ้า', 'ใบผลิตไฟฟ้า', 'ขนานไฟฟ้า',
  'Soiling Test/Water Test/ Roofing Test', 'For Construction Design', 'Pocurement',
  'Site Prepareration and Mobilization', '0.Inverter Station/Pump Station construction',
  '1.MDB&INVERTER Shelf', '2.Foundation Installatioin', '3.Mounting structure installation',
  '4.Fence&Gate', '5.PV module installation', '6.Inverter Installation',
  '7.Electrical Panel Installation', '8.Electrical Conduit and Rackway Installation',
  '9.Grounding System Installation', '10.Cabling & Termination PV to Inverters',
  '11.Cabling & Termination Inverters to SMDB', '12.Weather Station Installation',
  '13.Cabling & Termination SMDB to Ex MDB (Tie IN)', '14.Transformer Installation and Tie in',
  '15.Protection Relay Panel & CT PT MV/LV', '16.Cabling & Termination Protection System',
  '17.Water conduit and pump system Installation', 'Testing & Commissioning', 'Punch list'
];

function buildAddPrjMilestoneRows() {
  const tbody = document.getElementById('add-prj-milestones-tbody');
  if (!tbody) return;

  const refPrj = (allProjects && allProjects.find(p => p.milestones && p.milestones.length === 33)) || (allProjects && allProjects[0]) || {};
  const standardMilestones = refPrj.milestones || [];

  const typeCodeEl = document.getElementById('add-prj-type-code');
  const typeCode = typeCodeEl ? typeCodeEl.value : '1';
  const weights = (cachedWeightMatrix && cachedWeightMatrix[String(typeCode)]) || {};

  let rowsHtml = '';
  for (let idx = 0; idx < 33; idx++) {
    const m = standardMilestones[idx] || {};
    const name = m.name || DEFAULT_MILESTONE_NAMES[idx] || `Milestone ${idx + 1}`;
    const cat = m.category || 'งานทั่วไป';
    
    let wNum = 0.0;
    if (weights[name] !== undefined) {
      wNum = weights[name] * 100;
    } else if (m.weight !== undefined) {
      wNum = m.weight * 100;
    }
    const safeName = name.replace(/"/g, '&quot;');

    rowsHtml += `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100 last:border-b-0">
        <td class="py-1.5 px-2 text-center text-slate-400 font-mono text-[10px]">${idx + 1}</td>
        <td class="py-1.5 px-2 font-medium text-slate-800 text-[11px]">
          <div class="leading-tight">${name}</div>
          <span class="text-[9px] text-slate-400 font-normal">${cat}</span>
        </td>
        <td class="py-1.5 px-2 text-center">
          <div class="inline-flex items-center justify-center space-x-0.5">
            <input type="number" step="0.1" min="0" max="100" value="${wNum.toFixed(1)}" class="add-prj-ms-weight w-14 bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-emerald-500 rounded-lg px-1.5 py-1 text-center font-mono text-emerald-800 font-bold text-[11px] focus:ring-1 focus:ring-emerald-500 transition" data-index="${idx}" data-name="${safeName}" oninput="calculateAddPrjWeightTotal()">
            <span class="text-[10px] text-slate-400 font-semibold">%</span>
          </div>
        </td>
        <td class="py-1.5 px-2">
          <input type="date" class="add-prj-ms-start w-full bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-emerald-500 rounded-lg px-2 py-1 text-[11px] font-mono focus:ring-1 focus:ring-emerald-500 transition" data-index="${idx}" data-name="${safeName}">
        </td>
        <td class="py-1.5 px-2">
          <input type="date" class="add-prj-ms-finish w-full bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-emerald-500 rounded-lg px-2 py-1 text-[11px] font-mono focus:ring-1 focus:ring-emerald-500 transition" data-index="${idx}" data-name="${safeName}">
        </td>
      </tr>
    `;
  }
  tbody.innerHTML = rowsHtml;
  calculateAddPrjWeightTotal();
}

function updateAddPrjMilestoneDates() {
  const startEl = document.getElementById('add-prj-plan-start');
  const finishEl = document.getElementById('add-prj-plan-finish');
  if (!startEl || !finishEl || !startEl.value || !finishEl.value) return;

  const sDate = new Date(startEl.value);
  const fDate = new Date(finishEl.value);
  if (isNaN(sDate.getTime()) || isNaN(fDate.getTime())) return;

  const totalDays = Math.max(14, Math.round((fDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)));
  const startInputs = document.querySelectorAll('.add-prj-ms-start');
  const finishInputs = document.querySelectorAll('.add-prj-ms-finish');
  const numM = finishInputs.length || 33;

  for (let i = 0; i < numM; i++) {
    const offsetPct = (i / Math.max(1, numM - 1)) * 0.75;
    const durPct = 0.25;
    const mStartDays = Math.round(totalDays * offsetPct);
    const mDurDays = Math.max(5, Math.round(totalDays * durPct));
    let mFinishDays = mStartDays + mDurDays;
    if (i === numM - 1 || mFinishDays > totalDays) {
      mFinishDays = totalDays;
    }

    const mStartDate = new Date(sDate.getTime() + mStartDays * 24 * 60 * 60 * 1000);
    const mFinishDate = new Date(sDate.getTime() + mFinishDays * 24 * 60 * 60 * 1000);

    const sYYYY = mStartDate.getFullYear();
    const sMM = String(mStartDate.getMonth() + 1).padStart(2, '0');
    const sDD = String(mStartDate.getDate()).padStart(2, '0');

    const fYYYY = mFinishDate.getFullYear();
    const fMM = String(mFinishDate.getMonth() + 1).padStart(2, '0');
    const fDD = String(mFinishDate.getDate()).padStart(2, '0');

    if (startInputs[i]) startInputs[i].value = `${sYYYY}-${sMM}-${sDD}`;
    if (finishInputs[i]) finishInputs[i].value = `${fYYYY}-${fMM}-${fDD}`;
  }
}

async function submitAddProject(e) {
  e.preventDefault();

  const nameEl = document.getElementById('add-prj-name');
  const orderEl = document.getElementById('add-prj-order');
  const lotSelect = document.getElementById('add-prj-lot-select');
  const lotCustom = document.getElementById('add-prj-lot-custom');
  const capEl = document.getElementById('add-prj-capacity');
  const installEl = document.getElementById('add-prj-install-type');
  const voltEl = document.getElementById('add-prj-voltage-level');
  const buEl = document.getElementById('add-prj-bu');
  const typeCodeEl = document.getElementById('add-prj-type-code');
  const startEl = document.getElementById('add-prj-plan-start');
  const finishEl = document.getElementById('add-prj-plan-finish');
  const pwdEl = document.getElementById('add-prj-password');
  const submitBtn = document.getElementById('modal-add-prj-submit-btn');

  const name = (nameEl ? nameEl.value : '').trim();
  if (!name) {
    showToast('กรุณาระบุชื่อโครงการ', 'error');
    if (nameEl) nameEl.focus();
    return;
  }

  let lot = lotSelect ? lotSelect.value : 'Lot 1';
  if (lot === '__custom__') {
    lot = (lotCustom ? lotCustom.value : '').trim();
    if (!lot) {
      showToast('กรุณาระบุชื่อ Lot ใหม่', 'error');
      if (lotCustom) lotCustom.focus();
      return;
    }
  }

  const capacity = parseFloat(capEl ? capEl.value : 0);
  if (isNaN(capacity) || capacity <= 0) {
    showToast('กรุณาระบุกำลังการผลิต (kWp) ให้ถูกต้อง', 'error');
    if (capEl) capEl.focus();
    return;
  }

  const password = pwdEl ? pwdEl.value.trim() : '';
  if (!password) {
    showToast('กรุณาระบุรหัสผ่านผู้แก้ไข', 'error');
    if (pwdEl) pwdEl.focus();
    return;
  }
  localStorage.setItem('kpg_editor_pwd', password);

  // Collect individual milestone completion dates and weights
  const startInputs = document.querySelectorAll('.add-prj-ms-start');
  const finishInputs = document.querySelectorAll('.add-prj-ms-finish');
  const weightInputs = document.querySelectorAll('.add-prj-ms-weight');

  const customMilestones = [];
  finishInputs.forEach((input, i) => {
    const idx = parseInt(input.dataset.index);
    const mName = input.dataset.name;
    const pFinish = input.value;
    const pStart = startInputs[i] ? startInputs[i].value : null;
    const wVal = weightInputs[i] ? (parseFloat(weightInputs[i].value) / 100.0) : undefined;

    customMilestones.push({
      index: idx,
      name: mName,
      weight: !isNaN(wVal) ? wVal : undefined,
      planned_start: pStart || null,
      planned_finish: pFinish || null
    });
  });

  const payload = {
    name: name,
    order_no: orderEl && orderEl.value ? parseInt(orderEl.value) : null,
    lot: lot,
    capacity_kwp: capacity,
    installation_type: installEl ? installEl.value : 'Solar Rooftop',
    voltage_level: voltEl ? voltEl.value : 'LV',
    business_unit: (buEl && buEl.value.trim()) ? buEl.value.trim() : 'ทั่วไป',
    type_code: typeCodeEl ? parseInt(typeCodeEl.value) : 1,
    planned_start: startEl ? startEl.value : null,
    planned_finish: finishEl ? finishEl.value : null,
    password: password,
    milestones: customMilestones
  };

  const origBtnContent = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>กำลังบันทึกและสร้าง 33 Milestones...</span>`;
    lucide.createIcons();
  }

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'ไม่สามารถสร้างโครงการได้');
    }

    closeAddProjectModal();
    showToast(data.message || `เพิ่มไซต์งาน '${name}' สำเร็จแล้ว!`, 'success');

    // Reload all data
    await loadInitialData();

    // Navigate to Project Detail Tab (Tab 2) and select this new project immediately!
    const newProjectId = data.project ? data.project.id : null;
    if (newProjectId) {
      switchTab('project');
      await selectProject(newProjectId);
    }
  } catch (err) {
    console.error('Error creating project:', err);
    showToast(err.message || 'เกิดข้อผิดพลาดในการสร้างโครงการ', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origBtnContent;
      lucide.createIcons();
    }
  }
}

window.openAddProjectModal = openAddProjectModal;
window.closeAddProjectModal = closeAddProjectModal;
window.handleAddLotChange = handleAddLotChange;
window.onAddPrjParamChange = onAddPrjParamChange;
window.updateAddPrjMilestoneDates = updateAddPrjMilestoneDates;
window.resetMilestoneWeightsFromCalProgress = resetMilestoneWeightsFromCalProgress;
window.calculateAddPrjWeightTotal = calculateAddPrjWeightTotal;
window.submitAddProject = submitAddProject;

