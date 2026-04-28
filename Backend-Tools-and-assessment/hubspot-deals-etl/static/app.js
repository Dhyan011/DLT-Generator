const API = '';
let allJobs = [];
let currentScanId = null;
let pollInterval = null;
let dealOffset = 0;
const DEAL_LIMIT = 50;
let jobOffset = 0;
const JOB_LIMIT = 20;

// Chart Instances
let dashboardChartInst = null;
let statsJobsChartInst = null;
let statsRecordsChartInst = null;

// ── NAVIGATION ──
window.showPage = function(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + name + "'")) n.classList.add('active');
  });
  const titles = { dashboard: 'Dashboard', extraction: 'New Extraction', jobs: 'Extraction Jobs', deals: 'Deals Records', statistics: 'Statistics', maintenance: 'Maintenance' };
  document.getElementById('pageTitle').textContent = titles[name] || name;
  if (name === 'dashboard') loadDashboard();
  if (name === 'jobs') loadJobs();
  if (name === 'statistics') loadStats();
}

window.refreshCurrent = function() {
  const active = document.querySelector('.page.active');
  if (active) {
    const id = active.id.replace('page-', '');
    if (id === 'dashboard') loadDashboard();
    if (id === 'jobs') loadJobs();
    if (id === 'statistics') loadStats();
  }
}

// ── API HELPERS ──
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  return r.json();
}

// ── HEALTH CHECK ──
window.checkHealth = async function() {
  try {
    const d = await api('GET', '/api/health');
    const dot = document.getElementById('healthDot');
    const txt = document.getElementById('healthText');
    if (d.status === 'healthy') {
      dot.className = 'health-dot healthy';
      txt.textContent = 'Service Healthy';
    } else {
      dot.className = 'health-dot unhealthy';
      txt.textContent = 'Unhealthy';
    }
  } catch {
    document.getElementById('healthDot').className = 'health-dot unhealthy';
    document.getElementById('healthText').textContent = 'Offline';
  }
}

// ── DASHBOARD ──
async function loadDashboard() {
  try {
    const d = await api('GET', '/api/scan/statistics');
    const stats = d.data || d;
    document.getElementById('statTotal').textContent = stats.total_scans ?? stats.total ?? '—';
    document.getElementById('statCompleted').textContent = stats.completed_scans ?? stats.completed ?? '—';
    document.getElementById('statRunning').textContent = (stats.in_progress_scans ?? stats.in_progress) || 0;
    document.getElementById('statRecords').textContent = (stats.total_records_extracted ?? stats.records ?? 0).toLocaleString();

    // Render Dashboard Chart
    const completed = stats.completed_scans ?? stats.completed ?? 0;
    const failed = stats.failed_scans ?? stats.failed ?? 0;
    const running = (stats.in_progress_scans ?? stats.in_progress) || 0;
    const pending = stats.pending_scans ?? stats.pending ?? 0;
    
    if (dashboardChartInst) dashboardChartInst.destroy();
    const ctx = document.getElementById('dashboardStatusChart').getContext('2d');
    dashboardChartInst = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Completed', 'Failed', 'In Progress', 'Pending'],
        datasets: [{
          data: [completed, failed, running, pending],
          backgroundColor: ['#2e844a', '#d93f3c', '#d56b08', '#747474'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { family: 'Inter', size: 11 } } } },
        cutout: '75%'
      }
    });

  } catch { }

  try {
    const d = await api('GET', '/api/scan/list?limit=10&offset=0');
    const jobs = d.data?.scans || d.scans || d.data || [];
    const tbody = document.getElementById('recentJobsTable');
    if (!jobs.length) { tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No jobs yet. Start your first extraction!</td></tr>'; return; }
    tbody.innerHTML = jobs.map(j => `
      <tr>
        <td><strong>${j.scanId || j.scan_id}</strong></td>
        <td>${j.organizationId || j.organization_id || '—'}</td>
        <td>${badge(j.status)}</td>
        <td>${(j.recordsExtracted ?? j.records_extracted ?? 0).toLocaleString()}</td>
        <td>${fDur(j.duration)}</td>
        <td class="text-sm text-muted">${fDate(j.startTime || j.start_time)}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="openJobPanel('${j.scanId || j.scan_id}')">Details</button>
        </td>
      </tr>`).join('');
  } catch { }
}

// ── JOBS ──
window.loadJobs = async function() {
  const d = await api('GET', `/api/scan/list?limit=100&offset=0`);
  allJobs = d.data?.scans || d.scans || d.data || [];
  renderJobs();
}

window.filterJobs = function() {
  const q = document.getElementById('jobSearch').value.toLowerCase();
  const status = document.getElementById('jobStatusFilter').value;
  const filtered = allJobs.filter(j => {
    const id = (j.scanId || j.scan_id || '').toLowerCase();
    const org = (j.organizationId || j.organization_id || '').toLowerCase();
    const matchQ = !q || id.includes(q) || org.includes(q);
    const matchS = !status || j.status === status;
    return matchQ && matchS;
  });
  renderJobList(filtered);
}

function renderJobs() { renderJobList(allJobs); }

function renderJobList(jobs) {
  const tbody = document.getElementById('jobsTable');
  document.getElementById('jobCount').textContent = `${jobs.length} jobs`;
  if (!jobs.length) { tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No jobs found</td></tr>'; return; }
  tbody.innerHTML = jobs.map(j => {
    const id = j.scanId || j.scan_id;
    return `<tr>
      <td><strong>${id}</strong></td>
      <td>${j.organizationId || j.organization_id || '—'}</td>
      <td>${badge(j.status)}</td>
      <td>${(j.recordsExtracted ?? j.records_extracted ?? 0).toLocaleString()}</td>
      <td>${fDur(j.duration)}</td>
      <td class="text-sm text-muted">${fDate(j.startTime || j.start_time)}</td>
      <td class="text-sm text-muted">${fDate(j.endTime || j.end_time)}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="openJobPanel('${id}')">Details</button>
        ${j.status === 'in_progress' ? `<button class="btn btn-outline btn-sm" onclick="pauseJob('${id}')">⏸</button><button class="btn btn-danger btn-sm" onclick="cancelJob('${id}')">✕</button>` : ''}
        ${j.status === 'paused' ? `<button class="btn btn-primary btn-sm" onclick="resumeJob('${id}')">▶</button>` : ''}
        ${['completed','failed','cancelled'].includes(j.status) ? `<button class="btn btn-icon" onclick="removeJob('${id}')" title="Remove">🗑</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

// ── JOB PANEL ──
window.openJobPanel = async function(scanId) {
  document.getElementById('panelOverlay').classList.add('open');
  document.getElementById('sidePanel').classList.add('open');
  document.getElementById('panelBody').innerHTML = '<div style="text-align:center;padding:40px;color:var(--sf-muted)">Loading...</div>';

  const d = await api('GET', `/api/scan/${scanId}/status`);
  const j = d.data || d;

  document.getElementById('panelActions').innerHTML = `
    ${j.status === 'in_progress' ? `<button class="btn btn-outline" onclick="pauseJob('${scanId}')">⏸ Pause</button><button class="btn btn-danger" onclick="cancelJob('${scanId}')">✕ Cancel</button>` : ''}
    ${j.status === 'paused' ? `<button class="btn btn-primary" onclick="resumeJob('${scanId}')">▶ Resume</button>` : ''}
    ${['completed','failed','cancelled'].includes(j.status) ? `<button class="btn btn-outline" onclick="loadDealsForScan('${scanId}')">📋 View Deals</button><button class="btn btn-danger btn-sm" onclick="removeJob('${scanId}');closePanel()">🗑 Remove</button>` : ''}
    <button class="btn btn-outline" onclick="closePanel()">Close</button>
  `;

  const cp = j.checkpointInfo?.latestCheckpoint;
  document.getElementById('panelBody').innerHTML = `
    <div class="info-grid">
      <div class="info-item"><label>Scan ID</label><p>${j.scanId || scanId}</p></div>
      <div class="info-item"><label>Status</label><p>${badge(j.status)}</p></div>
      <div class="info-item"><label>Organization</label><p>${j.organizationId || '—'}</p></div>
      <div class="info-item"><label>Type</label><p>${j.type || '—'}</p></div>
      <div class="info-item"><label>Records Extracted</label><p><strong>${(j.recordsExtracted ?? 0).toLocaleString()}</strong></p></div>
      <div class="info-item"><label>Duration</label><p>${fDur(j.duration)}</p></div>
      <div class="info-item"><label>Started</label><p>${fDate(j.startTime)}</p></div>
      <div class="info-item"><label>Ended</label><p>${fDate(j.endTime) || '—'}</p></div>
    </div>
    ${j.errorMessage ? `<div style="background:#fdf2f2;border:1px solid #f5c6cb;border-radius:4px;padding:12px;margin-bottom:16px;font-size:12px;color:var(--sf-danger)"><strong>Error:</strong> ${j.errorMessage}</div>` : ''}
    ${j.metadata ? `
    <div class="panel-section">
      <h4>Pipeline Info</h4>
      <div class="info-grid">
        <div class="info-item"><label>Pipeline</label><p>${j.metadata.pipeline_name || '—'}</p></div>
        <div class="info-item"><label>Dataset</label><p>${j.metadata.dataset_name || '—'}</p></div>
        <div class="info-item"><label>Destination</label><p>${j.metadata.destination || '—'}</p></div>
        <div class="info-item"><label>Source</label><p>${j.metadata.source_type || '—'}</p></div>
      </div>
    </div>` : ''}
    ${cp ? `
    <div class="panel-section">
      <h4>Latest Checkpoint</h4>
      <div class="checkpoint-item">
        <strong>${cp.phase}</strong>
        <div>Records processed: <strong>${cp.recordsProcessed?.toLocaleString()}</strong></div>
        <div>Page: ${cp.pageNumber ?? '—'} &nbsp;|&nbsp; Batch size: ${cp.batchSize ?? '—'}</div>
        <div class="text-sm text-muted" style="margin-top:4px">${fDate(j.checkpointInfo?.lastCheckpointAt)}</div>
      </div>
    </div>` : ''}
    ${j.config?.filters?.properties ? `
    <div class="panel-section">
      <h4>Extracted Properties</h4>
      <div>${j.config.filters.properties.map(p => `<span class="tag">${p}</span>`).join('')}</div>
    </div>` : ''}
  `;
}

window.closePanel = function() {
  document.getElementById('panelOverlay').classList.remove('open');
  document.getElementById('sidePanel').classList.remove('open');
}

// ── DEALS ──
window.loadDeals = async function() {
  const scanId = document.getElementById('dealScanFilter').value.trim();
  if (!scanId) { toast('Enter a Scan ID to load deals', 'error'); return; }
  dealOffset = 0;
  await window.fetchDeals(scanId, 0);
}

window.loadDealsForScan = function(scanId) {
  closePanel();
  showPage('deals');
  document.getElementById('dealScanFilter').value = scanId;
  setTimeout(() => window.loadDeals(), 100);
}

window.fetchDeals = async function(scanId, offset) {
  const tbody = document.getElementById('dealsTable');
  tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Loading...</td></tr>';
  const d = await api('GET', `/api/results/${scanId}/result?tableName=hubspot_deals&limit=${DEAL_LIMIT}&offset=${offset}`);
  const records = d.data?.records || [];
  const total = d.data?.pagination?.total || 0;
  document.getElementById('dealCount').textContent = `${total.toLocaleString()} records`;

  if (!records.length) {
    if (total > 0 && offset > 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No more deals on this page.</td></tr>';
    } else {
        tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No deals found for this scan</td></tr>';
    }
    renderDealPagination(scanId, total, offset);
    return;
  }

  tbody.innerHTML = records.map(r => `
    <tr>
      <td class="text-sm text-muted">${r.deal_id || '—'}</td>
      <td><strong>${r.deal_name || '—'}</strong></td>
      <td>${stageBadge(r.deal_stage)}</td>
      <td>${r.amount != null ? '$' + Number(r.amount).toLocaleString() : '—'}</td>
      <td>${r.close_date || '—'}</td>
      <td class="text-sm">${r.owner_id || '—'}</td>
      <td>${r.is_closed_won ? '✅' : r.is_closed ? '❌' : '—'}</td>
      <td class="text-sm text-muted">${fDate(r._extracted_at)}</td>
    </tr>`).join('');

  renderDealPagination(scanId, total, offset);
}

function renderDealPagination(scanId, total, offset) {
  const pages = Math.ceil(total / DEAL_LIMIT);
  const cur = Math.floor(offset / DEAL_LIMIT);
  const el = document.getElementById('dealPagination');
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = `<button class="page-btn" onclick="fetchDeals('${scanId}',${Math.max(0,offset-DEAL_LIMIT)})" ${cur===0?'disabled':''}>‹</button>`;
  for (let i = 0; i < Math.min(pages,7); i++) {
    html += `<button class="page-btn ${i===cur?'active':''}" onclick="fetchDeals('${scanId}',${i*DEAL_LIMIT})">${i+1}</button>`;
  }
  html += `<button class="page-btn" onclick="fetchDeals('${scanId}',${offset+DEAL_LIMIT})" ${cur>=pages-1?'disabled':''}>›</button>`;
  el.innerHTML = html;
}

window.searchDeals = function() {
  const q = document.getElementById('dealSearch').value.toLowerCase();
  document.querySelectorAll('#dealsTable tr').forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// ── STATISTICS ──
async function loadStats() {
  try {
    const d = await api('GET', '/api/scan/statistics');
    const s = d.data || d;
    document.getElementById('statsGrid').innerHTML = `
      <div class="stat-card blue"><div class="stat-label">Total Jobs</div><div class="stat-value">${s.total_scans ?? s.total ?? '—'}</div></div>
      <div class="stat-card green"><div class="stat-label">Completed</div><div class="stat-value">${s.completed_scans ?? s.completed ?? '—'}</div></div>
      <div class="stat-card orange"><div class="stat-label">Failed</div><div class="stat-value">${s.failed_scans ?? s.failed ?? 0}</div></div>
      <div class="stat-card purple"><div class="stat-label">Total Records</div><div class="stat-value">${(s.total_records_extracted ?? 0).toLocaleString()}</div></div>
    `;
    const byOrg = s.by_organization || s.organizations || [];

    // Render Org Charts
    if (statsJobsChartInst) statsJobsChartInst.destroy();
    if (statsRecordsChartInst) statsRecordsChartInst.destroy();
    
    if (byOrg.length > 0) {
      const labels = byOrg.map(o => o.organizationId || o.organization_id || 'Unknown');
      
      statsJobsChartInst = new Chart(document.getElementById('statsOrgJobsChart').getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Total Jobs', data: byOrg.map(o => o.total || 0), backgroundColor: '#0176d3', barThickness: 24, borderRadius: 2
          }, {
            label: 'Failed Jobs', data: byOrg.map(o => o.failed || 0), backgroundColor: '#d93f3c', barThickness: 24, borderRadius: 2
          }]
        },
        options: { 
          responsive: true, maintainAspectRatio: false, 
          scales: { 
            y: { beginAtZero: true, grid: { color: '#f0f0f0' } },
            x: { grid: { display: false } }
          },
          plugins: { legend: { labels: { font: { family: 'Inter', size: 12 } } } }
        }
      });

      statsRecordsChartInst = new Chart(document.getElementById('statsOrgRecordsChart').getContext('2d'), {
        type: 'pie',
        data: {
          labels,
          datasets: [{
            data: byOrg.map(o => o.records || 0),
            backgroundColor: ['#0176d3', '#1b96ff', '#005fb2', '#004a8b', '#009d6f', '#00bfa5'],
            borderWidth: 2, borderColor: '#fff'
          }]
        },
        options: { 
          responsive: true, maintainAspectRatio: false, 
          plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { family: 'Inter', size: 11 } } } } 
        }
      });
    }

    const tbody = document.getElementById('statsTable');
    if (!byOrg.length) { tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No statistics available</td></tr>'; return; }
    tbody.innerHTML = byOrg.map(o => `
      <tr>
        <td><strong>${o.organizationId || o.organization_id || '—'}</strong></td>
        <td>${o.total ?? '—'}</td>
        <td>${o.completed ?? '—'}</td>
        <td>${o.failed ?? 0}</td>
        <td>${(o.records ?? 0).toLocaleString()}</td>
        <td class="text-sm text-muted">${fDate(o.last_run)}</td>
      </tr>`).join('');
  } catch(e) { console.error(e); }
}

// ── EXTRACTION FORM ──
window.addProperty = function() {
  const input = document.getElementById('propInput');
  const val = input.value.trim();
  if (!val) return;
  const span = document.createElement('span');
  span.className = 'tag'; span.textContent = val + ' ×';
  span.onclick = () => window.removeTag(span);
  document.getElementById('propertyTags').appendChild(span);
  input.value = '';
}

window.removeTag = function(el) { el.remove(); }

function getProperties() {
  return [...document.querySelectorAll('#propertyTags .tag')].map(t => t.textContent.replace(' ×','').trim()).filter(Boolean);
}

window.resetForm = function() {
  document.getElementById('fScanId').value = '';
  document.getElementById('fOrgId').value = '';
  document.getElementById('fToken').value = '';
  document.getElementById('fArchived').value = 'false';
  document.getElementById('liveJobCard').style.display = 'none';
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

window.startExtraction = async function() {
  const scanId = document.getElementById('fScanId').value.trim();
  const orgId = document.getElementById('fOrgId').value.trim();
  const token = document.getElementById('fToken').value.trim();
  if (!scanId || !orgId || !token) { toast('Scan ID, Organization ID, and Token are required', 'error'); return; }
  const props = getProperties();

  const payload = {
    config: {
      scanId, organizationId: orgId, type: ['user'],
      auth: { accessToken: token },
      filters: { properties: props.length ? props : undefined, includeArchived: document.getElementById('fArchived').value === 'true' }
    }
  };

  const d = await api('POST', '/api/scan/start', payload);
  if (d.success === false) { toast(d.error || d.message || 'Failed to start job', 'error'); return; }

  toast('Extraction started for ' + scanId, 'success');
  currentScanId = scanId;
  document.getElementById('liveJobCard').style.display = 'block';
  document.getElementById('liveId').textContent = scanId;
  startPolling(scanId);
}

function startPolling(scanId) {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => pollJob(scanId), 2000);
  pollJob(scanId);
}

async function pollJob(scanId) {
  const d = await api('GET', `/api/scan/${scanId}/status`);
  const j = d.data || d;
  document.getElementById('liveStatus').innerHTML = badge(j.status);
  document.getElementById('liveRecords').textContent = (j.recordsExtracted ?? 0).toLocaleString();
  document.getElementById('liveDuration').textContent = fDur(j.duration);
  const cp = j.checkpointInfo?.latestCheckpoint;
  document.getElementById('livePhase').textContent = cp ? `Phase: ${cp.phase}` : '';
  const prog = j.status === 'completed' ? 100 : j.status === 'in_progress' ? 60 : 0;
  document.getElementById('liveProgress').style.width = prog + '%';
  if (['completed','failed','cancelled'].includes(j.status)) {
    clearInterval(pollInterval); pollInterval = null;
    if (j.status === 'completed') toast(`Extraction complete — ${j.recordsExtracted} records loaded`, 'success');
    if (j.status === 'failed') toast('Extraction failed: ' + (j.errorMessage || 'Unknown error'), 'error');
  }
}

// ── JOB ACTIONS ──
window.pauseJob = async function(scanId) {
  const d = await api('POST', `/api/scan/${scanId}/pause`);
  toast(d.message || 'Job paused', 'info');
  window.loadJobs();
}

window.cancelJob = async function(scanId) {
  if (!confirm(`Cancel job "${scanId}"?`)) return;
  const d = await api('POST', `/api/scan/${scanId}/cancel`);
  toast(d.message || 'Job cancelled', 'info');
  window.loadJobs();
}

window.resumeJob = async function(scanId) {
  toast('Resume not yet implemented via API', 'info');
}

window.removeJob = async function(scanId) {
  if (!confirm(`Permanently remove job "${scanId}" and all associated data?`)) return;
  await api('DELETE', `/api/scan/${scanId}/remove`);
  toast('Job removed', 'info');
  window.loadJobs();
}

// ── MAINTENANCE ──
window.runCleanup = async function() {
  const days = parseInt(document.getElementById('cleanupDays').value) || 7;
  const d = await api('POST', '/api/maintenance/cleanup', { daysOld: days });
  toast(d.message || `Removed jobs older than ${days} days`, 'success');
}

window.detectCrashed = async function() {
  const timeout = parseInt(document.getElementById('crashTimeout').value) || 10;
  const d = await api('POST', `/api/maintenance/detect-crashed?timeoutMinutes=${timeout}`);
  const el = document.getElementById('crashResult');
  const crashed = d.data?.crashed_jobs || d.crashed || [];
  el.innerHTML = crashed.length
    ? `<div style="color:var(--sf-danger);font-weight:600;margin-bottom:8px">Found ${crashed.length} crashed jobs:</div>` + crashed.map(j => `<div class="checkpoint-item"><strong>${j.scanId || j.scan_id}</strong> — ${fDate(j.startTime || j.start_time)}</div>`).join('')
    : `<div style="color:var(--sf-success);font-weight:500">✅ No crashed jobs detected</div>`;
}

// ── HELPERS ──
function badge(status) {
  const s = (status || 'unknown').toLowerCase().replace(' ','_');
  const labels = {completed:'Completed',in_progress:'In Progress',pending:'Pending',failed:'Failed',cancelled:'Cancelled',paused:'Paused'};
  return `<span class="badge ${s}"><span class="badge-dot"></span>${labels[s] || status}</span>`;
}

function stageBadge(stage) {
  if (!stage) return '—';
  const map = {qualifiedtobuy:'Qualified',presentationscheduled:'Presentation',decisionmakerboughtin:'Decision',closedwon:'Won',closedlost:'Lost'};
  const label = map[stage] || stage;
  const cls = stage === 'closedwon' ? 'completed' : stage === 'closedlost' ? 'failed' : 'pending';
  return `<span class="badge ${cls}">${label}</span>`;
}

function fDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
  catch { return d; }
}

function fDur(s) {
  if (s == null) return '—';
  if (s < 60) return s.toFixed(1) + 's';
  return Math.floor(s/60) + 'm ' + (s%60).toFixed(0) + 's';
}

function toast(msg, type='info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-text">${msg}</span><span class="toast-close" onclick="this.parentElement.remove()">✕</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
    checkHealth();
    setInterval(checkHealth, 30000);
    loadDashboard();
});
