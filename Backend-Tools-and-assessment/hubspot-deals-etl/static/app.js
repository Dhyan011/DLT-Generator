/* ═══════════ 3D HERO SCENE ═══════════ */
function initHeroScene() {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas || typeof THREE === 'undefined') return;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Particle field
  const count = 1500;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * 20;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0x667eea, size: 0.03, transparent: true, opacity: 0.7 });
  const particles = new THREE.Points(geo, mat);
  scene.add(particles);

  // Wireframe torus knot
  const torusGeo = new THREE.TorusKnotGeometry(2.5, 0.6, 100, 16);
  const torusMat = new THREE.MeshBasicMaterial({ color: 0x764ba2, wireframe: true, transparent: true, opacity: 0.15 });
  const torus = new THREE.Mesh(torusGeo, torusMat);
  scene.add(torus);

  // Floating rings
  for (let i = 0; i < 3; i++) {
    const ringGeo = new THREE.RingGeometry(3 + i * 1.2, 3.05 + i * 1.2, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x667eea, transparent: true, opacity: 0.08, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.random() * Math.PI;
    ring.rotation.y = Math.random() * Math.PI;
    scene.add(ring);
  }

  camera.position.z = 6;
  let mouseX = 0, mouseY = 0;
  document.addEventListener('mousemove', e => { mouseX = (e.clientX / window.innerWidth - 0.5) * 2; mouseY = (e.clientY / window.innerHeight - 0.5) * 2; });
  window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

  function animate() {
    if (document.getElementById('introScreen')?.classList.contains('gone')) return;
    requestAnimationFrame(animate);
    particles.rotation.y += 0.0008;
    particles.rotation.x += 0.0003;
    torus.rotation.x += 0.003;
    torus.rotation.y += 0.005;
    camera.position.x += (mouseX * 0.5 - camera.position.x) * 0.02;
    camera.position.y += (-mouseY * 0.5 - camera.position.y) * 0.02;
    camera.lookAt(scene.position);
    renderer.render(scene, camera);
  }
  animate();
}

// Counter animation
function animateCounters() {
  document.querySelectorAll('.intro-stat-value[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count);
    const duration = 2000;
    const start = performance.now();
    function update(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(eased * target).toLocaleString();
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  });
}

// Enter dashboard
window.enterDashboard = function() {
  const intro = document.getElementById('introScreen');
  intro.classList.add('exit');
  setTimeout(() => {
    intro.classList.add('gone');
    document.getElementById('appContainer').classList.remove('hidden');
    checkHealth();
    setInterval(checkHealth, 30000);
    loadDashboard();
  }, 800);
};

/* ═══════════ APP LOGIC ═══════════ */
const API = '';
let allJobs = [];
let currentScanId = null;
let pollInterval = null;
let dealOffset = 0;
const DEAL_LIMIT = 50;
let jobOffset = 0;
const JOB_LIMIT = 20;
let dashboardChartInst = null;
let statsJobsChartInst = null;
let statsRecordsChartInst = null;

window.showPage = function(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + name + "'")) n.classList.add('active');
  });
  const titles = { dashboard:'Dashboard', extraction:'New Extraction', jobs:'Extraction Jobs', deals:'Deals Records', statistics:'Statistics', maintenance:'Maintenance' };
  document.getElementById('pageTitle').textContent = titles[name] || name;
  if (name === 'dashboard') loadDashboard();
  if (name === 'jobs') loadJobs();
  if (name === 'statistics') loadStats();
};

window.refreshCurrent = function() {
  const active = document.querySelector('.page.active');
  if (active) { const id = active.id.replace('page-',''); if(id==='dashboard')loadDashboard(); if(id==='jobs')loadJobs(); if(id==='statistics')loadStats(); }
};

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  return r.json();
}

window.checkHealth = async function() {
  try {
    const d = await api('GET', '/api/health');
    const dot = document.getElementById('healthDot');
    const txt = document.getElementById('healthText');
    if (d.status === 'healthy') { dot.className='health-dot healthy'; txt.textContent='Service Healthy'; }
    else { dot.className='health-dot unhealthy'; txt.textContent='Unhealthy'; }
  } catch { document.getElementById('healthDot').className='health-dot unhealthy'; document.getElementById('healthText').textContent='Offline'; }
};

async function loadDashboard() {
  try {
    const d = await api('GET', '/api/scan/statistics');
    const s = d.data || d;
    document.getElementById('statTotal').textContent = s.total_scans ?? s.total ?? '—';
    document.getElementById('statCompleted').textContent = s.completed_scans ?? s.completed ?? '—';
    document.getElementById('statRunning').textContent = (s.in_progress_scans ?? s.in_progress) || 0;
    document.getElementById('statRecords').textContent = (s.total_records_extracted ?? s.records ?? 0).toLocaleString();
    const completed=s.completed_scans??s.completed??0, failed=s.failed_scans??s.failed??0, running=(s.in_progress_scans??s.in_progress)||0, pending=s.pending_scans??s.pending??0;
    if(dashboardChartInst)dashboardChartInst.destroy();
    dashboardChartInst = new Chart(document.getElementById('dashboardStatusChart').getContext('2d'), {
      type:'doughnut', data:{ labels:['Completed','Failed','In Progress','Pending'], datasets:[{ data:[completed,failed,running,pending], backgroundColor:['#22c55e','#ef4444','#3b82f6','#6b7280'], borderWidth:0 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ boxWidth:12, font:{family:'Inter',size:11} } } }, cutout:'75%' }
    });
  } catch {}
  try {
    const d = await api('GET', '/api/scan/list?limit=10&offset=0');
    const jobs = d.data?.scans || d.scans || d.data || [];
    const tbody = document.getElementById('recentJobsTable');
    if(!jobs.length){tbody.innerHTML='<tr><td colspan="7" class="table-empty">No jobs yet. Start your first extraction!</td></tr>';return;}
    tbody.innerHTML = jobs.map(j=>`<tr><td><strong>${j.scanId||j.scan_id}</strong></td><td>${j.organizationId||j.organization_id||'—'}</td><td>${badge(j.status)}</td><td>${(j.recordsExtracted??j.records_extracted??0).toLocaleString()}</td><td>${fDur(j.duration)}</td><td class="text-sm text-muted">${fDate(j.startTime||j.start_time)}</td><td><button class="btn btn-outline btn-sm" onclick="openJobPanel('${j.scanId||j.scan_id}')">Details</button></td></tr>`).join('');
  } catch {}
}

window.loadJobs = async function() {
  const d = await api('GET','/api/scan/list?limit=100&offset=0');
  allJobs = d.data?.scans || d.scans || d.data || [];
  renderJobs();
};
window.filterJobs = function() {
  const q=document.getElementById('jobSearch').value.toLowerCase(), status=document.getElementById('jobStatusFilter').value;
  renderJobList(allJobs.filter(j=>{const id=(j.scanId||j.scan_id||'').toLowerCase(),org=(j.organizationId||j.organization_id||'').toLowerCase();return(!q||id.includes(q)||org.includes(q))&&(!status||j.status===status);}));
};
function renderJobs(){renderJobList(allJobs)}
function renderJobList(jobs) {
  const tbody=document.getElementById('jobsTable'); document.getElementById('jobCount').textContent=`${jobs.length} jobs`;
  if(!jobs.length){tbody.innerHTML='<tr><td colspan="8" class="table-empty">No jobs found</td></tr>';return;}
  tbody.innerHTML=jobs.map(j=>{const id=j.scanId||j.scan_id;return`<tr><td><strong>${id}</strong></td><td>${j.organizationId||j.organization_id||'—'}</td><td>${badge(j.status)}</td><td>${(j.recordsExtracted??j.records_extracted??0).toLocaleString()}</td><td>${fDur(j.duration)}</td><td class="text-sm text-muted">${fDate(j.startTime||j.start_time)}</td><td class="text-sm text-muted">${fDate(j.endTime||j.end_time)}</td><td><button class="btn btn-outline btn-sm" onclick="openJobPanel('${id}')">Details</button>${j.status==='in_progress'?`<button class="btn btn-outline btn-sm" onclick="pauseJob('${id}')">⏸</button><button class="btn btn-danger btn-sm" onclick="cancelJob('${id}')">✕</button>`:''}${j.status==='paused'?`<button class="btn btn-primary btn-sm" onclick="resumeJob('${id}')">▶</button>`:''}${['completed','failed','cancelled'].includes(j.status)?`<button class="btn btn-icon" onclick="removeJob('${id}')" title="Remove">🗑</button>`:''}</td></tr>`;}).join('');
}

window.openJobPanel = async function(scanId) {
  document.getElementById('panelOverlay').classList.add('open');
  document.getElementById('sidePanel').classList.add('open');
  document.getElementById('panelBody').innerHTML='<div style="text-align:center;padding:40px;color:var(--sf-muted)">Loading...</div>';
  const d=await api('GET',`/api/scan/${scanId}/status`); const j=d.data||d;
  document.getElementById('panelActions').innerHTML=`${j.status==='in_progress'?`<button class="btn btn-outline" onclick="pauseJob('${scanId}')">⏸ Pause</button><button class="btn btn-danger" onclick="cancelJob('${scanId}')">✕ Cancel</button>`:''}${j.status==='paused'?`<button class="btn btn-primary" onclick="resumeJob('${scanId}')">▶ Resume</button>`:''}${['completed','failed','cancelled'].includes(j.status)?`<button class="btn btn-outline" onclick="loadDealsForScan('${scanId}')">📋 View Deals</button><button class="btn btn-danger btn-sm" onclick="removeJob('${scanId}');closePanel()">🗑 Remove</button>`:''}<button class="btn btn-outline" onclick="closePanel()">Close</button>`;
  const cp=j.checkpointInfo?.latestCheckpoint;
  document.getElementById('panelBody').innerHTML=`<div class="info-grid"><div class="info-item"><label>Scan ID</label><p>${j.scanId||scanId}</p></div><div class="info-item"><label>Status</label><p>${badge(j.status)}</p></div><div class="info-item"><label>Organization</label><p>${j.organizationId||'—'}</p></div><div class="info-item"><label>Type</label><p>${j.type||'—'}</p></div><div class="info-item"><label>Records Extracted</label><p><strong>${(j.recordsExtracted??0).toLocaleString()}</strong></p></div><div class="info-item"><label>Duration</label><p>${fDur(j.duration)}</p></div><div class="info-item"><label>Started</label><p>${fDate(j.startTime)}</p></div><div class="info-item"><label>Ended</label><p>${fDate(j.endTime)||'—'}</p></div></div>${j.errorMessage?`<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px;color:#dc2626"><strong>Error:</strong> ${j.errorMessage}</div>`:''}${j.metadata?`<div class="panel-section"><h4>Pipeline Info</h4><div class="info-grid"><div class="info-item"><label>Pipeline</label><p>${j.metadata.pipeline_name||'—'}</p></div><div class="info-item"><label>Dataset</label><p>${j.metadata.dataset_name||'—'}</p></div><div class="info-item"><label>Destination</label><p>${j.metadata.destination||'—'}</p></div><div class="info-item"><label>Source</label><p>${j.metadata.source_type||'—'}</p></div></div></div>`:''}${cp?`<div class="panel-section"><h4>Latest Checkpoint</h4><div class="checkpoint-item"><strong>${cp.phase}</strong><div>Records: <strong>${cp.recordsProcessed?.toLocaleString()}</strong></div><div>Page: ${cp.pageNumber??'—'} | Batch: ${cp.batchSize??'—'}</div><div class="text-sm text-muted" style="margin-top:4px">${fDate(j.checkpointInfo?.lastCheckpointAt)}</div></div></div>`:''}${j.config?.filters?.properties?`<div class="panel-section"><h4>Extracted Properties</h4><div>${j.config.filters.properties.map(p=>`<span class="tag">${p}</span>`).join('')}</div></div>`:''}`;
};
window.closePanel = function(){document.getElementById('panelOverlay').classList.remove('open');document.getElementById('sidePanel').classList.remove('open');};

window.loadDeals = async function(){const scanId=document.getElementById('dealScanFilter').value.trim();if(!scanId){toast('Enter a Scan ID','error');return;}dealOffset=0;await window.fetchDeals(scanId,0);};
window.loadDealsForScan = function(scanId){closePanel();showPage('deals');document.getElementById('dealScanFilter').value=scanId;setTimeout(()=>window.loadDeals(),100);};
window.fetchDeals = async function(scanId, offset) {
  const tbody=document.getElementById('dealsTable'); tbody.innerHTML='<tr><td colspan="8" class="table-empty">Loading...</td></tr>';
  const d=await api('GET',`/api/results/${scanId}/result?tableName=hubspot_deals&limit=${DEAL_LIMIT}&offset=${offset}`);
  const records=d.data?.records||[], total=d.data?.pagination?.total||0;
  document.getElementById('dealCount').textContent=`${total.toLocaleString()} records`;
  if(!records.length){tbody.innerHTML=`<tr><td colspan="8" class="table-empty">${total>0&&offset>0?'No more deals on this page.':'No deals found for this scan'}</td></tr>`;renderDealPagination(scanId,total,offset);return;}
  tbody.innerHTML=records.map(r=>`<tr><td class="text-sm text-muted">${r.deal_id||'—'}</td><td><strong>${r.deal_name||'—'}</strong></td><td>${stageBadge(r.deal_stage)}</td><td>${r.amount!=null?'$'+Number(r.amount).toLocaleString():'—'}</td><td>${r.close_date||'—'}</td><td class="text-sm">${r.owner_id||'—'}</td><td>${r.is_closed_won?'✅':r.is_closed?'❌':'—'}</td><td class="text-sm text-muted">${fDate(r._extracted_at)}</td></tr>`).join('');
  renderDealPagination(scanId,total,offset);
};
function renderDealPagination(scanId,total,offset){const pages=Math.ceil(total/DEAL_LIMIT),cur=Math.floor(offset/DEAL_LIMIT),el=document.getElementById('dealPagination');if(pages<=1){el.innerHTML='';return;}let h=`<button class="page-btn" onclick="fetchDeals('${scanId}',${Math.max(0,offset-DEAL_LIMIT)})" ${cur===0?'disabled':''}>‹</button>`;for(let i=0;i<Math.min(pages,7);i++)h+=`<button class="page-btn ${i===cur?'active':''}" onclick="fetchDeals('${scanId}',${i*DEAL_LIMIT})">${i+1}</button>`;h+=`<button class="page-btn" onclick="fetchDeals('${scanId}',${offset+DEAL_LIMIT})" ${cur>=pages-1?'disabled':''}>›</button>`;el.innerHTML=h;}
window.searchDeals = function(){const q=document.getElementById('dealSearch').value.toLowerCase();document.querySelectorAll('#dealsTable tr').forEach(r=>{r.style.display=r.textContent.toLowerCase().includes(q)?'':'none';});};

async function loadStats() {
  try {
    const d=await api('GET','/api/scan/statistics'); const s=d.data||d;
    document.getElementById('statsGrid').innerHTML=`<div class="stat-card blue"><div class="stat-label">Total Jobs</div><div class="stat-value">${s.total_scans??s.total??'—'}</div></div><div class="stat-card green"><div class="stat-label">Completed</div><div class="stat-value">${s.completed_scans??s.completed??'—'}</div></div><div class="stat-card orange"><div class="stat-label">Failed</div><div class="stat-value">${s.failed_scans??s.failed??0}</div></div><div class="stat-card purple"><div class="stat-label">Total Records</div><div class="stat-value">${(s.total_records_extracted??0).toLocaleString()}</div></div>`;
    const byOrg=s.by_organization||s.organizations||[];
    if(statsJobsChartInst)statsJobsChartInst.destroy();if(statsRecordsChartInst)statsRecordsChartInst.destroy();
    if(byOrg.length>0){const labels=byOrg.map(o=>o.organizationId||o.organization_id||'Unknown');
      statsJobsChartInst=new Chart(document.getElementById('statsOrgJobsChart').getContext('2d'),{type:'bar',data:{labels,datasets:[{label:'Total Jobs',data:byOrg.map(o=>o.total||0),backgroundColor:'#667eea',barThickness:24,borderRadius:4},{label:'Failed',data:byOrg.map(o=>o.failed||0),backgroundColor:'#ef4444',barThickness:24,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,grid:{color:'#f0f0f0'}},x:{grid:{display:false}}},plugins:{legend:{labels:{font:{family:'Inter',size:12}}}}}});
      statsRecordsChartInst=new Chart(document.getElementById('statsOrgRecordsChart').getContext('2d'),{type:'pie',data:{labels,datasets:[{data:byOrg.map(o=>o.records||0),backgroundColor:['#667eea','#a78bfa','#818cf8','#6366f1','#22c55e','#14b8a6'],borderWidth:2,borderColor:'#fff'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{boxWidth:12,font:{family:'Inter',size:11}}}}}});
    }
    const tbody=document.getElementById('statsTable');
    if(!byOrg.length){tbody.innerHTML='<tr><td colspan="6" class="table-empty">No statistics available</td></tr>';return;}
    tbody.innerHTML=byOrg.map(o=>`<tr><td><strong>${o.organizationId||o.organization_id||'—'}</strong></td><td>${o.total??'—'}</td><td>${o.completed??'—'}</td><td>${o.failed??0}</td><td>${(o.records??0).toLocaleString()}</td><td class="text-sm text-muted">${fDate(o.last_run)}</td></tr>`).join('');
  } catch(e){console.error(e);}
}

window.addProperty = function(){const input=document.getElementById('propInput'),val=input.value.trim();if(!val)return;const span=document.createElement('span');span.className='tag';span.textContent=val+' ×';span.onclick=()=>window.removeTag(span);document.getElementById('propertyTags').appendChild(span);input.value='';};
window.removeTag = function(el){el.remove();};
function getProperties(){return[...document.querySelectorAll('#propertyTags .tag')].map(t=>t.textContent.replace(' ×','').trim()).filter(Boolean);}
window.resetForm = function(){document.getElementById('fScanId').value='';document.getElementById('fOrgId').value='';document.getElementById('fToken').value='';document.getElementById('fArchived').value='false';document.getElementById('liveJobCard').style.display='none';if(pollInterval){clearInterval(pollInterval);pollInterval=null;}};

window.startExtraction = async function(){
  const scanId=document.getElementById('fScanId').value.trim(),orgId=document.getElementById('fOrgId').value.trim(),token=document.getElementById('fToken').value.trim();
  if(!scanId||!orgId||!token){toast('Scan ID, Organization ID, and Token are required','error');return;}
  const props=getProperties();
  const payload={config:{scanId,organizationId:orgId,type:['user'],auth:{accessToken:token},filters:{properties:props.length?props:undefined,includeArchived:document.getElementById('fArchived').value==='true'}}};
  const d=await api('POST','/api/scan/start',payload);
  if(d.success===false){toast(d.error||d.message||'Failed','error');return;}
  toast('Extraction started for '+scanId,'success');currentScanId=scanId;document.getElementById('liveJobCard').style.display='block';document.getElementById('liveId').textContent=scanId;startPolling(scanId);
};
function startPolling(scanId){if(pollInterval)clearInterval(pollInterval);pollInterval=setInterval(()=>pollJob(scanId),2000);pollJob(scanId);}
async function pollJob(scanId){const d=await api('GET',`/api/scan/${scanId}/status`);const j=d.data||d;document.getElementById('liveStatus').innerHTML=badge(j.status);document.getElementById('liveRecords').textContent=(j.recordsExtracted??0).toLocaleString();document.getElementById('liveDuration').textContent=fDur(j.duration);const cp=j.checkpointInfo?.latestCheckpoint;document.getElementById('livePhase').textContent=cp?`Phase: ${cp.phase}`:'';document.getElementById('liveProgress').style.width=(j.status==='completed'?100:j.status==='in_progress'?60:0)+'%';if(['completed','failed','cancelled'].includes(j.status)){clearInterval(pollInterval);pollInterval=null;if(j.status==='completed')toast(`Done — ${j.recordsExtracted} records`,'success');if(j.status==='failed')toast('Failed: '+(j.errorMessage||'Unknown'),'error');}}

window.pauseJob = async function(id){const d=await api('POST',`/api/scan/${id}/pause`);toast(d.message||'Paused','info');loadJobs();};
window.cancelJob = async function(id){if(!confirm(`Cancel "${id}"?`))return;const d=await api('POST',`/api/scan/${id}/cancel`);toast(d.message||'Cancelled','info');loadJobs();};
window.resumeJob = async function(){toast('Resume not yet implemented','info');};
window.removeJob = async function(id){if(!confirm(`Remove "${id}"?`))return;await api('DELETE',`/api/scan/${id}/remove`);toast('Removed','info');loadJobs();};
window.runCleanup = async function(){const days=parseInt(document.getElementById('cleanupDays').value)||7;const d=await api('POST','/api/maintenance/cleanup',{daysOld:days});toast(d.message||`Cleaned up ${days}d`,'success');};
window.detectCrashed = async function(){const t=parseInt(document.getElementById('crashTimeout').value)||10;const d=await api('POST',`/api/maintenance/detect-crashed?timeoutMinutes=${t}`);const el=document.getElementById('crashResult'),crashed=d.data?.crashed_jobs||d.crashed||[];el.innerHTML=crashed.length?`<div style="color:#dc2626;font-weight:600;margin-bottom:8px">Found ${crashed.length} crashed:</div>`+crashed.map(j=>`<div class="checkpoint-item"><strong>${j.scanId||j.scan_id}</strong> — ${fDate(j.startTime||j.start_time)}</div>`).join(''):`<div style="color:#22c55e;font-weight:500">✅ No crashed jobs</div>`;};

function badge(status){const s=(status||'unknown').toLowerCase().replace(' ','_');const l={completed:'Completed',in_progress:'In Progress',pending:'Pending',failed:'Failed',cancelled:'Cancelled',paused:'Paused'};return`<span class="badge ${s}"><span class="badge-dot"></span>${l[s]||status}</span>`;}
function stageBadge(stage){if(!stage)return'—';const m={qualifiedtobuy:'Qualified',presentationscheduled:'Presentation',decisionmakerboughtin:'Decision',closedwon:'Won',closedlost:'Lost'};const l=m[stage]||stage;const c=stage==='closedwon'?'completed':stage==='closedlost'?'failed':'pending';return`<span class="badge ${c}">${l}</span>`;}
function fDate(d){if(!d)return'—';try{return new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}catch{return d;}}
function fDur(s){if(s==null)return'—';if(s<60)return s.toFixed(1)+'s';return Math.floor(s/60)+'m '+(s%60).toFixed(0)+'s';}
function toast(msg,type='info'){const c=document.getElementById('toastContainer'),t=document.createElement('div');t.className=`toast ${type}`;t.innerHTML=`<span class="toast-text">${msg}</span><span class="toast-close" onclick="this.parentElement.remove()">✕</span>`;c.appendChild(t);setTimeout(()=>t.remove(),4000);}

/* ═══════════ INIT ═══════════ */
document.addEventListener('DOMContentLoaded', () => {
  initHeroScene();
  setTimeout(animateCounters, 1200);
});
