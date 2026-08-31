// State
let globalOverview = null;
let allProjects = [];
let currentProject = null;
let currentTab = 'overview';

// Charts references
let phaseBarChart = null;
let statusDonutChart = null;
let projectScurveChart = null;
let comparisonBarChart = null;

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
  
  await loadInitialData();
  if (currentProject) {
    await selectProject(currentProject.id);
  }
  
  setTimeout(() => {
    if (icon) icon.classList.remove('animate-spin');
    showToast('อัปเดตข้อมูลล่าสุดเรียบร้อยแล้ว');
  }, 400);
}

// Fetch Initial Data
async function loadInitialData() {
  try {
    const [overviewRes, projectsRes] = await Promise.all([
      fetch('/api/overview'),
      fetch('/api/projects')
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
    
    // Load new modules in parallel
    loadActivityLogs();
    loadBackupList();
    loadLineFlexPreview();
    
    // Select first project by default
    if (allProjects.length > 0 && !currentProject) {
      await selectProject(allProjects[0].id);
    }
    
  } catch (err) {
    console.error("Error loading data:", err);
    showToast("เกิดข้อผิดพลาดในการโหลดข้อมูล", "error");
  }
}

// Real-time Instant Search in Tab 2
function onProjectSearchInput(keyword) {
  const q = (keyword || '').toLowerCase().trim();
  const lotSel = document.getElementById('filter-lot');
  const buSel = document.getElementById('filter-bu');
  const selectedLot = lotSel ? lotSel.value : '';
  const selectedBu = buSel ? buSel.value : '';

  let filtered = allProjects;
  if (selectedLot) {
    filtered = filtered.filter(p => p.lot === selectedLot);
  }
  if (selectedBu) {
    filtered = filtered.filter(p => p.business_unit === selectedBu);
  }
  if (q) {
    filtered = filtered.filter(p => 
      p.name.toLowerCase().includes(q) || 
      (p.order_no && String(p.order_no).toLowerCase().includes(q)) ||
      (p.business_unit && p.business_unit.toLowerCase().includes(q)) ||
      (p.lot && p.lot.toLowerCase().includes(q)) ||
      (p.installation_type && p.installation_type.toLowerCase().includes(q))
    );
  }

  const matchCountEl = document.getElementById('search-match-count');
  if (matchCountEl) {
    matchCountEl.innerText = `${filtered.length} / ${allProjects.length} โครงการ`;
  }

  updateProjectDropdown(filtered);
  if (filtered.length > 0) {
    selectProject(filtered[0].id);
  }
}

// Render Top KPI Cards
function renderKPIs() {
  if (!globalOverview) return;
  
  document.getElementById('kpi-total-projects').innerText = globalOverview.total_projects;
  document.getElementById('kpi-phases-count').innerText = (globalOverview.phases || []).length;
  document.getElementById('kpi-total-capacity').innerText = globalOverview.total_capacity_mwp + ' MW';
  document.getElementById('kpi-capacity-kwp').innerText = Number(globalOverview.total_capacity_kwp).toLocaleString();
  
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

// Tab Switching
function switchTab(tabId) {
  currentTab = tabId;
  const tabs = ['overview', 'project', 'comparison', 'cctv', 'integration'];
  
  tabs.forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (t === tabId) {
      el.classList.remove('hidden');
      btn.className = 'py-3 px-1 border-b-2 border-amber-500 text-amber-400 flex items-center space-x-2 font-medium whitespace-nowrap';
    } else {
      el.classList.add('hidden');
      btn.className = 'py-3 px-1 border-b-2 border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700 flex items-center space-x-2 font-medium whitespace-nowrap';
    }
  });
  
  lucide.createIcons();
  
  // Trigger chart resizes
  if (tabId === 'overview' && phaseBarChart) phaseBarChart.render();
  if (tabId === 'project' && projectScurveChart) projectScurveChart.render();
  if (tabId === 'comparison') renderComparisonTab();
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
    const res = await fetch(`/api/projects/${projectId}`);
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
}

function renderProjectScurve(scurveData) {
  if (!scurveData || !scurveData.weeks || scurveData.weeks.length === 0) return;
  
  const options = {
    series: [
      {
        name: 'Planned Cumulative S-Curve (%)',
        type: 'line',
        data: scurveData.planned_cum
      },
      {
        name: 'Actual Cumulative S-Curve (%)',
        type: 'line',
        data: scurveData.actual_cum
      },
      {
        name: 'Planned Weekly (%)',
        type: 'column',
        data: scurveData.planned_weekly
      },
      {
        name: 'Actual Weekly (%)',
        type: 'column',
        data: scurveData.actual_weekly
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
    labels: scurveData.labels,
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
  
  const chartEl = document.getElementById('project-scurve-chart');
  if (chartEl) {
    if (projectScurveChart) projectScurveChart.destroy();
    projectScurveChart = new ApexCharts(chartEl, options);
    projectScurveChart.render();
  }
}

function renderMilestonesTable(milestones) {
  const tbody = document.getElementById('milestones-table-body');
  tbody.innerHTML = '';
  document.getElementById('milestones-count-label').innerText = `${milestones.length} งานทั้งหมด`;
  
  milestones.forEach((m, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition';
    
    const pctVal = Math.round(m.actual_pct * 100);
    const weightPct = (m.weight * 100).toFixed(1) + '%';
    const contribPct = (m.actual_contribution * 100).toFixed(2) + '%';
    
    let statusBadge = '';
    if (m.status === 'COMPLETED') {
      statusBadge = '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-semibold">เสร็จสิ้น</span>';
    } else if (m.status === 'IN_PROGRESS') {
      statusBadge = '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold">กำลังทำ</span>';
    } else {
      statusBadge = '<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold">รอดำเนินการ</span>';
    }
    
    let catBadge = '';
    if (m.category.includes('Permission')) {
      catBadge = '<span class="text-[10px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">งานราชการ</span>';
    } else if (m.category.includes('Engineering')) {
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
        <button onclick="openQuickUpdateModal('${m.name}', ${pctVal}, '${m.actual_start || ''}', '${m.actual_finish || ''}')" class="p-1 text-slate-400 hover:text-amber-600 rounded hover:bg-amber-50" title="แก้ไข">
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
function renderComparisonTab() {
  if (!allProjects || allProjects.length === 0) return;
  
  // 1. Populate Lot Filter Dropdown if needed
  const lotSel = document.getElementById('compare-lot-select');
  if (lotSel && globalOverview && globalOverview.lots) {
    const currentVal = lotSel.value;
    lotSel.innerHTML = '<option value="ALL">แสดงทุกโครงการ (Top 25 กำลังผลิต)</option>';
    globalOverview.lots.forEach(lot => {
      lotSel.innerHTML += `<option value="${lot}">${lot}</option>`;
    });
    if (currentVal) lotSel.value = currentVal;
  }
  
  const selectedLot = lotSel ? lotSel.value : 'ALL';
  
  // 2. Filter Projects for Comparison
  let targetProjects = [];
  if (selectedLot === 'ALL') {
    targetProjects = [...allProjects]
      .sort((a, b) => b.capacity_kwp - a.capacity_kwp)
      .slice(0, 25);
  } else {
    targetProjects = allProjects.filter(p => p.lot === selectedLot);
  }
  
  const categories = targetProjects.map(p => p.name.length > 22 ? p.name.substring(0, 22) + '...' : p.name);
  const plannedData = targetProjects.map(p => p.planned_progress_pct);
  const actualData = targetProjects.map(p => p.actual_progress_pct);
  
  // 3. Render ApexCharts Horizontal Bar Comparison
  const chartHeight = Math.max(400, targetProjects.length * 28);
  const compOptions = {
    series: [
      {
        name: 'แผนงาน (% Planned)',
        data: plannedData
      },
      {
        name: 'ผลงานจริง (% Actual)',
        data: actualData
      }
    ],
    chart: {
      type: 'bar',
      height: chartHeight,
      toolbar: { show: true, tools: { download: true } },
      fontFamily: 'Prompt, sans-serif'
    },
    plotOptions: {
      bar: {
        horizontal: true,
        dataLabels: { position: 'top' },
        borderRadius: 4,
        barHeight: '75%'
      }
    },
    colors: ['#2563eb', '#10b981'],
    dataLabels: {
      enabled: true,
      offsetX: 16,
      style: { fontSize: '9px', colors: ['#334155'], fontWeight: 600 },
      formatter: val => val + '%'
    },
    stroke: { show: true, width: 1, colors: ['#fff'] },
    xaxis: {
      categories: categories,
      max: 100,
      title: { text: '% ความก้าวหน้า' },
      labels: { formatter: val => Math.round(val) + '%' }
    },
    yaxis: {
      labels: {
        style: { fontSize: '11px', fontWeight: 600, colors: '#0f172a' },
        maxWidth: 180
      }
    },
    tooltip: {
      y: { formatter: val => val + '%' }
    },
    legend: {
      position: 'top',
      horizontalAlign: 'left',
      fontSize: '12px',
      markers: { radius: 3 }
    }
  };
  
  const compChartEl = document.getElementById('comparison-bar-chart');
  if (compChartEl) {
    if (comparisonBarChart) comparisonBarChart.destroy();
    comparisonBarChart = new ApexCharts(compChartEl, compOptions);
    comparisonBarChart.render();
  }
  
  // 4. Render Delayed Projects Watchlist Table
  const tbody = document.getElementById('delayed-table-body');
  if (tbody) {
    tbody.innerHTML = '';
    const delayedProjects = [...allProjects]
      .filter(p => p.variance_pct < -0.1 || p.status === 'DELAYED')
      .sort((a, b) => a.variance_pct - b.variance_pct);
      
    if (delayedProjects.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-6 text-emerald-700 font-semibold">
            🎉 ยอดเยี่ยมมาก! ไม่มีโครงการที่ล่าช้ากว่าแผนงานในขณะนี้
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
          <td class="py-3 px-3 font-mono font-medium">${p.capacity_kwp}</td>
          <td class="py-3 px-3 text-center font-mono text-blue-600 font-semibold">${p.planned_progress_pct}%</td>
          <td class="py-3 px-3 text-center font-mono text-emerald-600 font-semibold">${p.actual_progress_pct}%</td>
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
}

function openProjectFromComparison(projectId) {
  selectProject(projectId);
  switchTab('project');
}


// =========================================================================
// PDF REPORT GENERATOR (Exact 210mm x 297mm A4, Zero Left Shift)
// =========================================================================
async function generateProjectPDF() {
  if (!currentProject) {
    showToast('กรุณาเลือกโครงการก่อนสร้างรายงาน', 'error');
    return;
  }
  
  const btn = document.getElementById('btn-gen-pdf');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="animate-spin mr-1">⏳</span> กำลังสร้าง PDF 2 หน้าสมบูรณ์...`;
  
  const p = currentProject;
  const now = new Date();
  const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  
  // 1. Capture S-Curve Chart as Image
  let scurveImgUri = '';
  try {
    if (projectScurveChart && typeof projectScurveChart.dataURI === 'function') {
      const chartRes = await projectScurveChart.dataURI();
      scurveImgUri = chartRes.imgURI || '';
    }
  } catch (chartErr) {
    console.warn("Could not export chart as dataURI:", chartErr);
  }

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
          <div>หน้า 1 / 2 (รายละเอียดไซต์และกราฟ S-Curve)</div>
        </div>

      </div>

      <!-- ================= PAGE 2 (EXACT A4: 210mm x 297mm) ================= -->
      <div style="width: 210mm; height: 295mm; max-height: 295mm; padding: 8mm 10mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; background: #ffffff; overflow: hidden;">
        
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
          <div>หน้า 2 / 2 (ตารางขั้นตอนการดำเนินงานทั้งหมด)</div>
        </div>

      </div>

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
    showToast(`สร้างรายงาน PDF โครงการ ${p.name} 2 หน้าสมบูรณ์สำเร็จแล้ว!`);
  } catch (err) {
    console.error("PDF generation error:", err);
    window.print();
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    lucide.createIcons();
  }
}


// =========================================================================
// MODAL & QUICK UPDATE CONTROLLERS
// =========================================================================
function openQuickUpdateModal(milestoneName = null, pctVal = 100, actStart = '', actFinish = '') {
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
    }
  };
  
  if (milestoneName) {
    mSel.value = milestoneName;
  }
  
  // Set initial slider & dates
  setModalPct(pctVal);
  document.getElementById('modal-start-date').value = actStart || '';
  document.getElementById('modal-finish-date').value = (pctVal >= 100 && actFinish) ? actFinish : '';
  
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

// On page load, populate saved Google Sheet URL if any
document.addEventListener('DOMContentLoaded', () => {
  const savedUrl = localStorage.getItem('kpgreenergy_gsheet_url');
  const savedWebAppUrl = localStorage.getItem('kpgreenergy_webapp_url');
  const webappInput = document.getElementById('webapp-url-input');
  if (savedWebAppUrl && webappInput) {
    webappInput.value = savedWebAppUrl;
  } else {
    fetch('/api/get-webapp-url').then(r => r.json()).then(d => {
      if (d.webapp_url && webappInput) webappInput.value = d.webapp_url;
    }).catch(e => {});
  }
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
// ACTIVITY AUDIT LOGS MODULE
// =========================================================================
let currentActivityLogs = [];

async function loadActivityLogs() {
  try {
    const res = await fetch('/api/activity-logs?limit=50');
    const data = await res.json();
    currentActivityLogs = data.logs || [];
    renderActivityLogsTable(currentActivityLogs);
  } catch (err) {
    console.warn("Could not fetch activity logs:", err);
  }
}

function renderActivityLogsTable(logs) {
  const tab5Tbody = document.getElementById('tab5-activity-logs-body');
  const modalTbody = document.getElementById('modal-activity-logs-body');

  let rowsHtml = '';
  if (!logs || logs.length === 0) {
    rowsHtml = `
      <tr>
        <td colspan="6" class="text-center py-6 text-slate-400 text-xs">
          ยังไม่มีประวัติการแก้ไขข้อมูล (จะบันทึกอัตโนมัติเมื่อมีการอัปเดตงาน)
        </td>
      </tr>
    `;
  } else {
    logs.forEach(log => {
      let sourceBadge = '';
      if (log.source === 'LINE LIFF') {
        sourceBadge = '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-semibold">LINE</span>';
      } else if (log.source === 'Google Sheet') {
        sourceBadge = '<span class="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-semibold">Sheets</span>';
      } else if (log.source === 'Webhook') {
        sourceBadge = '<span class="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-[10px] font-semibold">Webhook</span>';
      } else {
        sourceBadge = '<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-semibold">Web</span>';
      }

      rowsHtml += `
        <tr class="hover:bg-slate-50 transition text-[11px]">
          <td class="py-2.5 px-3 font-mono text-slate-500">${log.timestamp || '-'}</td>
          <td class="py-2.5 px-3 font-semibold text-slate-800">${log.project_name || log.project_id}</td>
          <td class="py-2.5 px-3 text-slate-700">${log.milestone_name}</td>
          <td class="py-2.5 px-2 text-center font-bold text-emerald-600">${log.actual_pct}%</td>
          <td class="py-2.5 px-3 text-slate-600">${log.updated_by}</td>
          <td class="py-2.5 px-2 text-center">${sourceBadge}</td>
        </tr>
      `;
    });
  }

  if (tab5Tbody) tab5Tbody.innerHTML = rowsHtml;
  if (modalTbody) modalTbody.innerHTML = rowsHtml;
}

function openActivityLogModal() {
  loadActivityLogs();
  const modal = document.getElementById('activity-log-modal');
  if (modal) modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeActivityLogModal() {
  const modal = document.getElementById('activity-log-modal');
  if (modal) modal.classList.add('hidden');
}

// =========================================================================
// BACKUP SNAPSHOTS MODULE
// =========================================================================
async function loadBackupList() {
  try {
    const res = await fetch('/api/backups');
    const data = await res.json();
    const backups = data.backups || [];
    const container = document.getElementById('backups-list-container');
    if (!container) return;

    if (backups.length === 0) {
      container.innerHTML = `<p class="text-[11px] text-slate-400">ยังไม่มี Snapshot สำรองข้อมูล</p>`;
      return;
    }

    let html = '';
    backups.slice(0, 4).forEach(b => {
      html += `
        <div class="p-2 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-[11px]">
          <div class="flex items-center gap-2">
            <i data-lucide="file-check-2" class="w-3.5 h-3.5 text-indigo-600"></i>
            <span class="font-mono font-medium text-slate-700">${b.filename}</span>
          </div>
          <span class="text-slate-400">${b.size_kb} KB</span>
        </div>
      `;
    });
    container.innerHTML = html;
    lucide.createIcons();
  } catch (err) {
    console.warn("Could not load backup list:", err);
  }
}

async function triggerManualBackup() {
  const btn = document.getElementById('btn-create-backup');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin mr-1">⏳</span> กำลังสร้าง Snapshot...`;
  }

  try {
    const res = await fetch('/api/backups', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'สร้าง Snapshot สำรองข้อมูลสำเร็จแล้ว!');
      await loadBackupList();
    } else {
      throw new Error(data.detail || 'Failed');
    }
  } catch (err) {
    showToast('สร้าง Backup ล้มเหลว: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      lucide.createIcons();
    }
  }
}

// =========================================================================
// LINE FLEX MESSAGE PREVIEW & COPY
// =========================================================================
let currentFlexPayload = null;

async function loadLineFlexPreview(projectId = null) {
  try {
    const targetPrjId = projectId || (currentProject ? currentProject.id : '');
    const res = await fetch(`/api/line-flex-preview?project_id=${targetPrjId}`);
    const data = await res.json();
    currentFlexPayload = data.flex_message;
    const previewEl = document.getElementById('flex-json-preview');
    if (previewEl) {
      previewEl.innerText = JSON.stringify(currentFlexPayload, null, 2);
    }
  } catch (err) {
    console.warn("Could not load Flex preview:", err);
  }
}

async function copyLineFlexJson() {
  if (!currentFlexPayload) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(currentFlexPayload, null, 2));
    showToast('คัดลอก JSON Flex Message สำหรับ LINE สำเร็จแล้ว!');
  } catch (err) {
    showToast('คัดลอกไม่สำเร็จ: ' + err.message, 'error');
  }
}

// =========================================================================
// CCTV STREAMING & SNAPSHOT CONTROLLER
// =========================================================================
let currentCctvConfig = null;
let hlsPlayers = {};

function onCctvProjectChange() {
  const prjId = document.getElementById('cctv-project-select').value;
  reloadAllCctvCameras(prjId);
}

async function reloadAllCctvCameras(projectId = null) {
  const prjId = projectId || document.getElementById('cctv-project-select')?.value || 'default';
  
  try {
    const res = await fetch(`/api/cctv-config?project_id=${prjId}`);
    currentCctvConfig = await res.json();
    const cameras = currentCctvConfig.cameras || [];

    cameras.forEach((cam, idx) => {
      const camNum = idx + 1;
      const videoEl = document.getElementById(`cctv-video-${camNum}`);
      const placeholderEl = document.getElementById(`cctv-placeholder-${camNum}`);
      const titleEl = document.getElementById(`cam-title-${camNum}`);

      if (titleEl) titleEl.innerText = cam.name || `CAM 0${camNum}`;

      if (cam.url && videoEl && placeholderEl) {
        placeholderEl.classList.add('hidden');
        videoEl.classList.remove('hidden');

        if (Hls.isSupported() && cam.url.includes('.m3u8')) {
          if (hlsPlayers[camNum]) {
            hlsPlayers[camNum].destroy();
          }
          const hls = new Hls();
          hls.loadSource(cam.url);
          hls.attachMedia(videoEl);
          hlsPlayers[camNum] = hls;
        } else {
          videoEl.src = cam.url;
        }
        videoEl.play().catch(e => console.log(`Autoplay prevented for CAM ${camNum}:`, e));
      } else if (videoEl && placeholderEl) {
        videoEl.classList.add('hidden');
        placeholderEl.classList.remove('hidden');
      }
    });

  } catch (err) {
    console.warn("Error initializing CCTV streams:", err);
  }
}

function openCctvConfigModal() {
  const modal = document.getElementById('cctv-config-modal');
  if (!modal) return;

  if (currentCctvConfig && currentCctvConfig.cameras) {
    currentCctvConfig.cameras.forEach((cam, idx) => {
      const input = document.getElementById(`cfg-cam-${idx+1}`);
      if (input) input.value = cam.url || '';
    });
  }

  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeCctvConfigModal() {
  const modal = document.getElementById('cctv-config-modal');
  if (modal) modal.classList.add('hidden');
}

async function handleCctvConfigSubmit(e) {
  e.preventDefault();
  const prjId = document.getElementById('cctv-project-select')?.value || 'default';
  
  const cameras = [
    {"id": "cam_1", "name": "CAM 01 - Main Array", "url": document.getElementById('cfg-cam-1').value.trim(), "type": "hls", "status": "Online", "resolution": "1080p FHD"},
    {"id": "cam_2", "name": "CAM 02 - Inverter Station", "url": document.getElementById('cfg-cam-2').value.trim(), "type": "hls", "status": "Online", "resolution": "1080p FHD"},
    {"id": "cam_3", "name": "CAM 03 - Gate & Logistics", "url": document.getElementById('cfg-cam-3').value.trim(), "type": "hls", "status": "Online", "resolution": "1080p FHD"},
    {"id": "cam_4", "name": "CAM 04 - PTZ Overview", "url": document.getElementById('cfg-cam-4').value.trim(), "type": "hls", "status": "Standby", "resolution": "4K UHD"}
  ];

  try {
    const res = await fetch('/api/cctv-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: prjId, cameras: cameras })
    });
    const data = await res.json();
    if (res.ok) {
      closeCctvConfigModal();
      showToast('บันทึกการตั้งค่ากล้อง CCTV เรียบร้อยแล้ว!');
      await reloadAllCctvCameras(prjId);
    } else {
      throw new Error(data.detail || 'Save failed');
    }
  } catch (err) {
    showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
  }
}

function captureCctvSnapshot(camNum) {
  const video = document.getElementById(`cctv-video-${camNum}`);
  const title = document.getElementById(`cam-title-${camNum}`)?.innerText || `CAM_0${camNum}`;
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const prjName = currentProject ? currentProject.name.replace(/\s+/g, '_') : 'KPGreenergy';

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  if (video && !video.classList.contains('hidden') && video.videoWidth > 0) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } else {
    // Generate professional styled snapshot placeholder with project metadata
    ctx.fillStyle = '#043327';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#064e3b';
    ctx.fillRect(40, 40, canvas.width - 80, canvas.height - 80);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('⚡ KPGreenergy CCTV Snapshot', 70, 100);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(`โครงการ: ${currentProject ? currentProject.name : 'Solar Project'}`, 70, 160);

    ctx.fillStyle = '#a7f3d0';
    ctx.font = '22px sans-serif';
    ctx.fillText(`กล้อง: ${title}`, 70, 210);
    ctx.fillText(`วัน-เวลาที่บันทึก: ${now.toLocaleString('th-TH')}`, 70, 250);
    ctx.fillText(`กำลังการผลิต: ${currentProject ? currentProject.capacity_kwp + ' kWp' : '-'}`, 70, 290);
    ctx.fillText(`ความคืบหน้าจริง: ${currentProject ? currentProject.actual_progress_pct + '%' : '-'}`, 70, 330);
  }

  // Draw Timestamp Banner on Bottom
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, canvas.height - 50, canvas.width, 50);
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 18px monospace';
  ctx.fillText(`● REC | ${prjName} | ${title} | ${now.toLocaleString('th-TH')}`, 30, canvas.height - 20);

  // Trigger Download
  const link = document.createElement('a');
  link.download = `Snapshot_${prjName}_CAM0${camNum}_${dateStr}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();

  showToast(`บันทึกภาพ Snapshot ${title} เรียบร้อยแล้ว!`);
}