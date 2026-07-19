// ---------- Storage ----------
const DB = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.error(e); }
  }
};

let state = {
  flocks: DB.get('flocks', []),
  logs: DB.get('logs', []),
  finance: DB.get('finance', []),
  vaccines: DB.get('vaccines', []),
  activeFlockId: DB.get('activeFlockId', null),
  tab: 'dashboard',
  lang: DB.get('lang', null), // null = not yet chosen, triggers language picker
  isPro: DB.get('isPro', false),
};
if (!state.activeFlockId && state.flocks.length) state.activeFlockId = state.flocks[0].id;

const BREEDS_KEYS = {
  layer: { key: 'layers', eggRateMin: 0.7, eggRateMax: 0.9, mortalityWeeklyMax: 0.5 },
  broiler: { key: 'broilers', eggRateMin: 0, eggRateMax: 0, mortalityWeeklyMax: 1 },
  duck: { key: 'ducks', eggRateMin: 0.5, eggRateMax: 0.75, mortalityWeeklyMax: 0.6 },
  mixed: { key: 'mixed', eggRateMin: 0.5, eggRateMax: 0.85, mortalityWeeklyMax: 0.75 },
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(state.lang || undefined, { month: 'short', day: 'numeric' });
const esc = (s) => (s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---------- FEATURE GATES ----------
// Free tier: 1 flock, basic logging, "everything looks steady"-only status (no detailed alerts),
// 7-day trend view, no export.
// Pro tier (unlocked via Billing.purchase()): unlimited flocks, full smart alerts, 30-day trends, export.
const FREE_FLOCK_LIMIT = 1;

function isProUser() { return state.isPro === true; }

function persist() {
  DB.set('flocks', state.flocks);
  DB.set('logs', state.logs);
  DB.set('finance', state.finance);
  DB.set('vaccines', state.vaccines);
  DB.set('activeFlockId', state.activeFlockId);
  DB.set('lang', state.lang);
  DB.set('isPro', state.isPro);
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> ${esc(msg)}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

// ---------- Analysis engine (full version — gated behind Pro at render time) ----------
function analyzeFlock(flock) {
  const flockLogs = state.logs.filter(l => l.flockId === flock.id).sort((a, b) => a.date.localeCompare(b.date));
  const benchmark = BREEDS_KEYS[flock.breed] || BREEDS_KEYS.mixed;
  const alerts = [];
  const sum = (arr, key) => arr.reduce((s, l) => s + (Number(l[key]) || 0), 0);

  const last7 = flockLogs.filter(l => l.date >= daysAgoISO(7));
  const prior7 = flockLogs.filter(l => l.date < daysAgoISO(7) && l.date >= daysAgoISO(14));
  const eggsLast7 = sum(last7, 'eggs');
  const eggsPrior7 = sum(prior7, 'eggs');
  const currentBirds = flock.startCount - sum(flockLogs, 'mortality');

  if (last7.length >= 3 && prior7.length >= 3 && eggsPrior7 > 0) {
    const pct = ((eggsLast7 - eggsPrior7) / eggsPrior7) * 100;
    if (pct <= -15) alerts.push({ level: 'warning', title: 'Egg production dropped', detail: `Down ${Math.abs(pct).toFixed(0)}% vs. the previous week. Common causes: heat stress, feed change, disease, molting, or fewer daylight hours.` });
    else if (pct >= 20) alerts.push({ level: 'good', title: 'Egg production is up', detail: `Up ${pct.toFixed(0)}% vs. the previous week. Keep doing what you're doing.` });
  }

  if (benchmark.eggRateMax > 0 && currentBirds > 0 && last7.length >= 3) {
    const rate = eggsLast7 / (currentBirds * last7.length);
    if (rate < benchmark.eggRateMin) alerts.push({ level: 'warning', title: 'Egg rate below healthy range', detail: `Averaging ${rate.toFixed(2)} eggs/bird/day, below the typical ${benchmark.eggRateMin}–${benchmark.eggRateMax} range. Worth checking feed quality, water access, and lighting.` });
  }

  const mortalityLast7 = sum(last7, 'mortality');
  if (mortalityLast7 > 0 && flock.startCount > 0) {
    const pctLost = (mortalityLast7 / flock.startCount) * 100;
    if (pctLost >= benchmark.mortalityWeeklyMax) alerts.push({ level: 'danger', title: 'Mortality is unusually high', detail: `Lost ${mortalityLast7} bird${mortalityLast7 === 1 ? '' : 's'} this week (${pctLost.toFixed(1)}% of flock). Consider isolating affected birds and consulting a vet promptly.` });
  }

  const feedLast7 = sum(last7, 'feedKg');
  const feedPrior7 = sum(prior7, 'feedKg');
  if (feedLast7 > 0 && feedPrior7 > 0) {
    const pct = ((feedLast7 - feedPrior7) / feedPrior7) * 100;
    if (pct >= 25) alerts.push({ level: 'info', title: 'Feed use rising', detail: `Feed given is up ${pct.toFixed(0)}% vs. last week. Check for waste or spillage if bird count hasn't grown to match.` });
  }

  const flockFinance = state.finance.filter(f => f.flockId === flock.id);
  const income = sum(flockFinance.filter(f => f.type === 'income'), 'amount');
  const expense = sum(flockFinance.filter(f => f.type === 'expense'), 'amount');

  // Vaccination due/overdue alerts
  const flockVaccines = state.vaccines.filter(v => v.flockId === flock.id && !v.done);
  flockVaccines.forEach(v => {
    const daysUntil = Math.round((new Date(v.date) - new Date(todayISO())) / 86400000);
    if (daysUntil < 0) {
      alerts.unshift({ level: 'danger', title: `${esc(v.name)} ${t('vaccineOverdueAlert')}`, detail: t('daysOverdue', { n: Math.abs(daysUntil) }) });
    } else if (daysUntil <= 3) {
      alerts.unshift({ level: 'warning', title: `${esc(v.name)} ${t('vaccineDueSoon')}`, detail: daysUntil === 0 ? t('today_') : t('daysAway', { n: daysUntil }) });
    }
  });

  if (alerts.length === 0) alerts.push({ level: 'good', title: t('everythingSteady'), detail: t('noUnusual') });

  return { alerts, currentBirds, eggsLast7, mortalityLast7, income, expense, profit: income - expense };
}

// ---------- Sparkline ----------
function sparkline(data, color, fillColor, width = 300, height = 48) {
  if (!data || data.length < 2 || data.every(v => v === 0)) {
    return `<div style="height:${height}px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#93A093">${t('notEnoughData')}</div>`;
  }
  const max = Math.max(...data, 0.0001), min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => [i * stepX, height - ((v - min) / range) * (height - 8) - 4]);
  const line = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const area = `${line} L${pts[pts.length - 1][0]},${height} L0,${height} Z`;
  const last = pts[pts.length - 1];
  return `<svg class="spark" width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    <path d="${area}" fill="${fillColor}" />
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="${color}" />
  </svg>`;
}

const icons = {
  lock: '<path d="M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Z"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  sparkle: '<path d="M12 2l1.9 5.8L20 9.5l-6.1 1.7L12 17l-1.9-5.8L4 9.5l6.1-1.7L12 2z"/>',
  syringe: '<line x1="18" y1="2" x2="22" y2="6"/><path d="M4 14l6-6 4 4-6 6-4-4z"/><path d="M14 4l6 6"/><line x1="2" y1="22" x2="6" y2="18"/><line x1="9" y1="9" x2="7" y2="11"/><line x1="12" y1="12" x2="10" y2="14"/>',
  calculator: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10.01"/><line x1="12" y1="10" x2="12" y2="10.01"/><line x1="16" y1="10" x2="16" y2="10.01"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/><line x1="8" y1="18" x2="16" y2="18"/>',
  check2: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
};
function icon(name, size = 18, extra = '') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ${extra}>${icons[name]}</svg>`;
}

// ---------- Render ----------
const app = document.getElementById('app');

function render() {
  if (!state.lang) { renderLanguagePicker(true); return; }
  if (state.flocks.length === 0) { renderOnboarding(); return; }

  const flock = state.flocks.find(f => f.id === state.activeFlockId) || state.flocks[0];
  state.activeFlockId = flock.id;

  app.innerHTML = `
    <header class="top">
      <button class="flock-picker" id="openSwitcher">
        <div>
          <div class="flock-label">${t('flock')}</div>
          <div style="display:flex;align-items:center;gap:4px">
            <span class="flock-name display">${esc(flock.name)}</span>
            ${icon('chevronDown', 18, 'style="color:#0C3521;margin-top:2px"')}
          </div>
        </div>
      </button>
      <div class="header-actions">
        ${!isProUser() ? `<button class="icon-btn" id="proBtn" aria-label="Upgrade" style="color:#D97D0E">${icon('sparkle', 18)}</button>` : ''}
        <button class="icon-btn" id="langBtn" aria-label="${t('selectLanguage')}">${icon('globe', 18)}</button>
        <button class="icon-btn" id="exportBtn" aria-label="Download backup">${icon('download', 18)}</button>
      </div>
    </header>
    <main id="main"></main>
    <nav class="bottom">
      <div class="nav-inner nav-inner-6">
        ${navBtn('dashboard', t('navFarm'), icons.grid)}
        ${navBtn('log', t('navLog'), icons.list)}
        ${navBtn('vaccines', t('navVaccines'), icons.syringe)}
        ${navBtn('calc', t('navCalc'), icons.calculator)}
        ${navBtn('finance', t('navMoney'), icons.dollar)}
        ${navBtn('reports', t('navReports'), icons.trend)}
      </div>
    </nav>
  `;

  document.getElementById('openSwitcher').onclick = () => renderSwitcherSheet();
  document.getElementById('exportBtn').onclick = () => guardExport();
  document.getElementById('langBtn').onclick = () => renderLanguagePicker(false);
  const proBtn = document.getElementById('proBtn');
  if (proBtn) proBtn.onclick = () => renderPaywallSheet();
  document.querySelectorAll('.nav-btn').forEach(b => b.onclick = () => { if (b.dataset.tab !== 'calc') activeCalc = null; state.tab = b.dataset.tab; render(); });

  const main = document.getElementById('main');
  if (state.tab === 'dashboard') {
    main.innerHTML = dashboardHTML(flock);
    const dashUpgradeBtn = document.getElementById('dashUpgradeBtn');
    if (dashUpgradeBtn) dashUpgradeBtn.onclick = () => renderPaywallSheet();
  }
  if (state.tab === 'log') { main.innerHTML = logFormHTML(flock); wireLogForm(flock); }
  if (state.tab === 'finance') { main.innerHTML = financeHTML(flock); wireFinance(); }
  if (state.tab === 'reports') { main.innerHTML = reportsHTML(flock); wireReports(flock); }
  if (state.tab === 'vaccines') { main.innerHTML = vaccinesHTML(flock); wireVaccines(flock); }
  if (state.tab === 'calc') { main.innerHTML = calcHTML(); wireCalc(); }

  // Every screen may include an Ads.block() banner (free tier only) — request fill
  // once per render, after the slot(s) for the current screen exist in the DOM.
  if (!isProUser()) Ads.requestAd();
}

function navBtn(tab, label, iconPaths) {
  const active = state.tab === tab;
  return `<button class="nav-btn ${active ? 'active' : ''}" data-tab="${tab}">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">${iconPaths}</svg>
    <span>${label}</span>
  </button>`;
}

// ---------- Dashboard ----------
function dashboardHTML(flock) {
  const flockLogs = state.logs.filter(l => l.flockId === flock.id);
  const todayLog = flockLogs.find(l => l.date === todayISO());

  // Free tier: only ever show "steady" message, not real analysis.
  // Pro tier: full rule-based alerts.
  let alertsHTML;
  let statsBlock;
  if (isProUser()) {
    const a = analyzeFlock(flock);
    alertsHTML = a.alerts.map(alertHTML).join('');
    statsBlock = dashboardStats(flock, a);
  } else {
    alertsHTML = `
      <div class="card" style="position:relative;padding-bottom:44px">
        ${alertHTML({ level: 'good', title: t('everythingSteady'), detail: t('noUnusual') })}
        <div style="position:absolute;bottom:10px;left:16px;right:16px;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)">
          ${icon('lock', 14)} ${t('freeAlertLimit')}
        </div>
      </div>
    `;
    const a = analyzeFlock(flock); // still compute basic totals, just not gated alerts
    statsBlock = dashboardStats(flock, a);
  }

  const days = isProUser() ? 30 : 7;
  const flockLogsSorted = flockLogs;
  const eggTrend = Array.from({ length: days }, (_, i) => {
    const d = daysAgoISO(days - 1 - i);
    const e = flockLogsSorted.find(l => l.date === d);
    return e ? Number(e.eggs) || 0 : 0;
  });
  const feedTrend = Array.from({ length: days }, (_, i) => {
    const d = daysAgoISO(days - 1 - i);
    const e = flockLogsSorted.find(l => l.date === d);
    return e ? Number(e.feedKg) || 0 : 0;
  });

  return `
    <div class="pulse">
      <div class="pulse-title">${t('today')}</div>
      <div class="pulse-grid">
        <div class="pulse-stat"><div style="color:#FC991D">🥚</div><div class="pulse-val display">${todayLog ? todayLog.eggs || 0 : '—'}</div><div class="pulse-lbl">${t('eggs')}</div></div>
        <div class="pulse-stat"><div style="color:#8FBF7A">🌾</div><div class="pulse-val display">${todayLog && todayLog.feedKg ? todayLog.feedKg + 'kg' : '—'}</div><div class="pulse-lbl">${t('feed')}</div></div>
        <div class="pulse-stat"><div style="color:#E88B6D">💀</div><div class="pulse-val display">${todayLog ? todayLog.mortality || 0 : 0}</div><div class="pulse-lbl">${t('lost')}</div></div>
      </div>
      ${!todayLog ? `<div class="pulse-hint">${t('noLogToday')}</div>` : ''}
    </div>

    ${alertsHTML}
    ${statsBlock}

    <div class="card">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-weight:700;font-size:14px">${t('eggProduction')}</span><span style="font-size:12px;color:#93A093">${isProUser() ? t('days14').replace('14', '30') : t('last7Days')}</span>
      </div>
      ${sparkline(eggTrend, '#0C3521', 'rgba(12,53,33,0.1)')}
    </div>
    <div class="card" style="${!isProUser() ? 'padding-bottom:16px' : ''}">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-weight:700;font-size:14px">${t('feedGiven')}</span><span style="font-size:12px;color:#93A093">${isProUser() ? t('days14').replace('14', '30') : t('last7Days')}</span>
      </div>
      ${sparkline(feedTrend, '#4C7A3E', 'rgba(76,122,62,0.1)')}
    </div>

    ${Ads.block()}

    ${!isProUser() ? `
    <div class="card" style="text-align:center;background:linear-gradient(135deg,#0C3521,#092A19);border:none">
      <div style="color:#fff;font-weight:700;font-size:15px;margin-bottom:4px">${t('unlockFull')}</div>
      <div style="color:#E8C9A0;font-size:12px;margin-bottom:12px;line-height:1.4">${t('unlockDesc')}</div>
      <button id="dashUpgradeBtn" class="btn-gold tap">${icon('sparkle', 18)} ${t('unlockBtn')}</button>
    </div>` : ''}
  `;
}

function dashboardStats(flock, a) {
  return `
    <div class="stat-grid">
      <div class="card" style="margin-bottom:0"><div class="stat-label">${t('currentFlock')}</div><div class="stat-val display">${a.currentBirds}</div><div class="stat-sub">${t('ofStarted', { n: flock.startCount })}</div></div>
      <div class="card" style="margin-bottom:0"><div class="stat-label">${t('weekEggs')}</div><div class="stat-val display">${a.eggsLast7}</div><div class="stat-sub">${t('last7Days')}</div></div>
    </div>
    <div style="height:12px"></div>
    <div class="stat-grid">
      <div class="card" style="margin-bottom:0"><div class="stat-label">${t('income')}</div><div class="stat-val display" style="color:#4C7A3E">$${a.income.toFixed(0)}</div><div class="stat-sub">${t('allTime')}</div></div>
      <div class="card" style="margin-bottom:0"><div class="stat-label">${t('profit')}</div><div class="stat-val display" style="color:${a.profit >= 0 ? '#4C7A3E' : '#E82920'}">$${a.profit.toFixed(0)}</div><div class="stat-sub">${t('incomeMinusExpenses')}</div></div>
    </div>
    <div style="height:12px"></div>
  `;
}

function alertHTML(a) {
  const iconPath = a.level === 'good' ? icons.trend : '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
  const colors = { good: '#4C7A3E', warning: '#E82920', danger: '#A81F17', info: '#4A6B8A' };
  return `<div class="alert alert-${a.level}">
    <div style="color:${colors[a.level]};flex-shrink:0;margin-top:2px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${iconPath}</svg></div>
    <div><div class="alert-title">${esc(a.title)}</div><div class="alert-detail">${esc(a.detail)}</div></div>
  </div>`;
}

// ---------- Daily log ----------
function logFormHTML(flock) {
  const flockLogs = state.logs.filter(l => l.flockId === flock.id).sort((a, b) => b.date.localeCompare(a.date));
  const lastLog = flockLogs[0];
  const todayLog = flockLogs.find(l => l.date === todayISO());
  return `
    <div style="font-size:14px;color:#55614F;font-weight:500;margin-bottom:16px">${fmtDate(todayISO())} · ${esc(flock.name)}</div>
    <div class="field-card">
      <div>🥚</div>
      <div style="flex:1"><div class="field-label">${t('eggsCollected')}</div><input id="f-eggs" class="field-input" inputmode="numeric" placeholder="0" value="${todayLog ? todayLog.eggs ?? '' : ''}"/></div>
    </div>
    <div class="field-card">
      <div>🌾</div>
      <div style="flex:1"><div class="field-label">${t('feedGivenKg')}</div><input id="f-feed" class="field-input" inputmode="decimal" placeholder="0" value="${todayLog ? todayLog.feedKg ?? '' : (lastLog ? lastLog.feedKg ?? '' : '')}"/></div>
    </div>
    <div class="field-card">
      <div>💀</div>
      <div style="flex:1"><div class="field-label">${t('birdsLostToday')}</div><div id="f-mortality-val" class="display" style="font-size:26px">${todayLog ? todayLog.mortality || 0 : 0}</div></div>
      <button id="mort-minus" class="stepper-btn" style="background:#EAF0E6;color:#0C3521">−</button>
      <button id="mort-plus" class="stepper-btn" style="background:#0C3521;color:#fff">+</button>
    </div>
    <label class="form-label">${t('notesOptional')}</label>
    <textarea id="f-notes" class="notes" rows="3" placeholder="${t('notesPlaceholder')}">${todayLog ? esc(todayLog.notes || '') : ''}</textarea>
    <div style="height:14px"></div>
    <button id="saveLogBtn" class="btn-primary tap">${t('saveLog')}</button>
    <div style="height:14px"></div>
    ${Ads.block()}
  `;
}

function wireLogForm(flock) {
  let mortality = Number(document.getElementById('f-mortality-val').textContent) || 0;
  document.getElementById('mort-minus').onclick = () => { mortality = Math.max(0, mortality - 1); document.getElementById('f-mortality-val').textContent = mortality; };
  document.getElementById('mort-plus').onclick = () => { mortality += 1; document.getElementById('f-mortality-val').textContent = mortality; };
  document.getElementById('f-eggs').oninput = (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); };
  document.getElementById('f-feed').oninput = (e) => { e.target.value = e.target.value.replace(/[^0-9.]/g, ''); };

  document.getElementById('saveLogBtn').onclick = () => {
    const eggs = Number(document.getElementById('f-eggs').value) || 0;
    const feedKg = Number(document.getElementById('f-feed').value) || 0;
    const notes = document.getElementById('f-notes').value;
    const idx = state.logs.findIndex(l => l.flockId === flock.id && l.date === todayISO());
    const entry = { id: idx >= 0 ? state.logs[idx].id : uid(), flockId: flock.id, date: todayISO(), eggs, feedKg, mortality, notes };
    if (idx >= 0) state.logs[idx] = entry; else state.logs.push(entry);
    persist();
    showToast(t('savedLog'));
    state.tab = 'dashboard';
    render();
  };
}

// ---------- Finance ----------
function financeHTML(flock) {
  const entries = state.finance.filter(f => f.flockId === flock.id).sort((a, b) => b.date.localeCompare(a.date));
  const totalIncome = entries.filter(f => f.type === 'income').reduce((s, f) => s + Number(f.amount), 0);
  const totalExpense = entries.filter(f => f.type === 'expense').reduce((s, f) => s + Number(f.amount), 0);
  return `
    <div class="stat-grid">
      <div class="card" style="margin-bottom:0"><div class="stat-label">${t('income')}</div><div class="stat-val display" style="color:#4C7A3E">$${totalIncome.toFixed(0)}</div><div class="stat-sub">${t('allTime')}</div></div>
      <div class="card" style="margin-bottom:0"><div class="stat-label">${t('expenses')}</div><div class="stat-val display" style="color:#E82920">$${totalExpense.toFixed(0)}</div><div class="stat-sub">${t('allTime')}</div></div>
    </div>
    <div style="height:12px"></div>
    <button id="addFinBtn" class="btn-primary tap">${icon('plus', 20)} ${t('addIncomeExpense')}</button>
    <div style="height:14px"></div>
    ${Ads.block()}
    ${entries.length === 0 ? `<div class="empty-state">${t('noEntriesYet')}</div>` : entries.map(f => `
      <div class="fin-entry">
        <div><div class="fin-cat">${esc(f.category)}</div><div class="fin-date">${fmtDate(f.date)}${f.notes ? ' · ' + esc(f.notes) : ''}</div></div>
        <div class="fin-amt" style="color:${f.type === 'income' ? '#4C7A3E' : '#E82920'}">${f.type === 'income' ? '+' : '−'}$${Number(f.amount).toFixed(0)}</div>
      </div>`).join('')}
  `;
}

function wireFinance() { document.getElementById('addFinBtn').onclick = renderFinanceSheet; }

function renderFinanceSheet() {
  const EXPENSE_KEYS = ['catFeed', 'catMedicine', 'catVaccination', 'catEquipment', 'catLabor', 'catOther'];
  const INCOME_KEYS = ['catEggSales', 'catBirdSales', 'catOtherIncome'];
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  let type = 'expense';
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-header"><h2>${t('addEntry')}</h2><button class="close-btn" id="closeSheet">${icon('x', 20)}</button></div>
      <div class="type-toggle">
        <button class="type-btn income" id="typeIncome">${t('incomeLabel')}</button>
        <button class="type-btn expense active" id="typeExpense">${t('expenseLabel')}</button>
      </div>
      <label class="form-label">${t('category')}</label>
      <div class="chip-row" id="catRow"></div>
      <label class="form-label">${t('amount')}</label>
      <input id="finAmount" class="form-input tap display" style="font-size:26px;margin-bottom:16px" inputmode="decimal" placeholder="0"/>
      <label class="form-label">${t('notesOptional')}</label>
      <input id="finNotes" class="form-input tap" style="margin-bottom:20px" placeholder="${t('notesFinPlaceholder')}"/>
      <button id="saveFin" class="btn-primary tap">${t('saveEntry')}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  let categoryKey = EXPENSE_KEYS[0];
  function renderCats() {
    const keys = type === 'income' ? INCOME_KEYS : EXPENSE_KEYS;
    if (!keys.includes(categoryKey)) categoryKey = keys[0];
    document.getElementById('catRow').innerHTML = keys.map(k => `<button class="chip ${k === categoryKey ? 'active' : ''}" data-cat="${k}">${t(k)}</button>`).join('');
    document.querySelectorAll('#catRow .chip').forEach(b => b.onclick = () => { categoryKey = b.dataset.cat; renderCats(); });
  }
  renderCats();

  document.getElementById('typeIncome').onclick = () => { type = 'income'; document.getElementById('typeIncome').classList.add('active'); document.getElementById('typeExpense').classList.remove('active'); renderCats(); };
  document.getElementById('typeExpense').onclick = () => { type = 'expense'; document.getElementById('typeExpense').classList.add('active'); document.getElementById('typeIncome').classList.remove('active'); renderCats(); };
  document.getElementById('finAmount').oninput = (e) => { e.target.value = e.target.value.replace(/[^0-9.]/g, ''); };
  document.getElementById('closeSheet').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  document.getElementById('saveFin').onclick = () => {
    const amount = Number(document.getElementById('finAmount').value);
    if (!amount) return;
    const notes = document.getElementById('finNotes').value;
    state.finance.push({ id: uid(), flockId: state.activeFlockId, date: todayISO(), type, category: t(categoryKey), amount, notes });
    persist();
    overlay.remove();
    showToast(t('entryRecorded'));
    render();
  };
}

// ---------- Reports ----------
function reportsHTML(flock) {
  const allLogs = state.logs.filter(l => l.flockId === flock.id).sort((a, b) => b.date.localeCompare(a.date));
  const logs = isProUser() ? allLogs : allLogs.filter(l => l.date >= daysAgoISO(7));
  const totalEggs = logs.reduce((s, l) => s + (Number(l.eggs) || 0), 0);
  const totalFeed = logs.reduce((s, l) => s + (Number(l.feedKg) || 0), 0);
  const totalMortality = logs.reduce((s, l) => s + (Number(l.mortality) || 0), 0);
  return `
    <div class="card">
      <div style="font-weight:700;font-size:14px;margin-bottom:12px">${t('allTimeSummary')}${!isProUser() ? ` (${t('last7Days')})` : ''}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center">
        <div><div class="display" style="font-size:24px;color:#0C3521">${totalEggs}</div><div style="font-size:11px;color:#93A093">${t('totalEggs')}</div></div>
        <div><div class="display" style="font-size:24px;color:#4C7A3E">${totalFeed.toFixed(0)}kg</div><div style="font-size:11px;color:#93A093">${t('feedUsed')}</div></div>
        <div><div class="display" style="font-size:24px;color:#E82920">${totalMortality}</div><div style="font-size:11px;color:#93A093">${t('lost')}</div></div>
      </div>
    </div>

    ${Ads.block()}

    ${isProUser() ? `
      <button id="csvBtn" class="btn-secondary tap">${icon('download', 18)} ${t('exportCSV')}</button>
      <div style="height:14px"></div>
    ` : `
      <div class="card" style="position:relative">
        <div style="filter:blur(3px);opacity:0.5;pointer-events:none">
          <button class="btn-secondary tap">${icon('download', 18)} ${t('exportCSV')}</button>
        </div>
        <div class="locked-overlay">
          <div class="lock-icon-badge">${icon('lock', 20)}</div>
          <div class="lo-title">${t('freeExportLimit')}</div>
          <button class="lo-btn" id="unlockExportBtn">${t('upgradeToUnlock')}</button>
        </div>
      </div>
    `}

    <div style="font-weight:700;font-size:14px;margin-bottom:8px">${t('dailyHistory')}${!isProUser() ? ` <span class="pro-badge" style="margin-left:6px">${t('freeTrendLimit')}</span>` : ''}</div>
    ${logs.length === 0 ? `<div class="empty-state">${t('noLogsYet')}</div>` : logs.map(l => `
      <div class="log-entry">
        <div class="log-date">${fmtDate(l.date)}</div>
        <div class="log-row"><span>🥚 ${l.eggs || 0}</span><span>🌾 ${l.feedKg || 0}kg</span>${l.mortality > 0 ? `<span style="color:#E82920">💀 ${l.mortality}</span>` : ''}</div>
        ${l.notes ? `<div class="log-notes">${esc(l.notes)}</div>` : ''}
      </div>`).join('')}
  `;
}

function wireReports(flock) {
  const csvBtn = document.getElementById('csvBtn');
  if (csvBtn) csvBtn.onclick = () => exportCSV(flock);
  const unlockExportBtn = document.getElementById('unlockExportBtn');
  if (unlockExportBtn) unlockExportBtn.onclick = () => renderPaywallSheet();
}

function guardExport() {
  if (!isProUser()) { renderPaywallSheet(); return; }
  exportJSON();
}

function exportCSV(flock) {
  const logs = state.logs.filter(l => l.flockId === flock.id).sort((a, b) => a.date.localeCompare(b.date));
  const header = 'Date,Eggs,Feed (kg),Mortality,Notes\n';
  const rows = logs.map(l => `${l.date},${l.eggs || 0},${l.feedKg || 0},${l.mortality || 0},"${(l.notes || '').replace(/"/g, "'")}"`).join('\n');
  downloadBlob(header + rows, `${flock.name}-logs-${todayISO()}.csv`, 'text/csv');
  showToast(t('csvExported'));
}

function exportJSON() {
  const payload = { flocks: state.flocks, logs: state.logs, finance: state.finance, vaccines: state.vaccines, exportedAt: new Date().toISOString() };
  downloadBlob(JSON.stringify(payload, null, 2), `poultry-backup-${todayISO()}.json`, 'application/json');
  showToast(t('backupDownloaded'));
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ---------- Vaccination scheduling ----------
// Standard schedule template — common layer/broiler reference points.
// Farmers can add/edit/remove freely; this is just a helpful starting point, not a
// veterinary prescription.
const VACCINE_TEMPLATE = [
  { name: 'Marek\'s Disease', dayOffset: 1 },
  { name: 'Newcastle Disease (ND) — 1st dose', dayOffset: 7 },
  { name: 'Infectious Bursal Disease (Gumboro) — 1st dose', dayOffset: 14 },
  { name: 'Newcastle Disease (ND) — booster', dayOffset: 21 },
  { name: 'Infectious Bursal Disease (Gumboro) — booster', dayOffset: 28 },
  { name: 'Fowl Pox', dayOffset: 35 },
  { name: 'Newcastle Disease (ND) — 2nd booster', dayOffset: 63 },
];

function vaccinesHTML(flock) {
  const list = state.vaccines.filter(v => v.flockId === flock.id).sort((a, b) => a.date.localeCompare(b.date));
  const today = todayISO();
  return `
    <button id="addVaccineBtn" class="btn-primary tap">${icon('plus', 20)} ${t('addVaccine')}</button>
    <div style="height:10px"></div>
    ${list.length === 0 ? `<button id="useTemplateBtn" class="btn-secondary tap">${icon('syringe', 18)} ${t('useTemplate')}</button><div style="height:14px"></div>` : ''}
    ${Ads.block()}
    ${list.length === 0 ? `<div class="empty-state">${t('noVaccinesScheduled')}</div>` : list.map(v => {
      const daysUntil = Math.round((new Date(v.date) - new Date(today)) / 86400000);
      let statusLabel, statusColor;
      if (v.done) { statusLabel = t('done'); statusColor = '#4C7A3E'; }
      else if (daysUntil < 0) { statusLabel = t('overdue'); statusColor = '#E82920'; }
      else { statusLabel = t('upcoming'); statusColor = '#4A6B8A'; }
      return `
      <div class="log-entry" style="${v.done ? 'opacity:0.6' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div>
            <div class="log-date">${esc(v.name)}</div>
            <div class="log-row"><span>${icon('clock', 13)} ${fmtDate(v.date)}</span><span style="color:${statusColor};font-weight:600">${statusLabel}</span></div>
          </div>
          ${!v.done ? `<button class="stepper-btn" data-vid="${v.id}" style="background:#EEF3EA;color:#4C7A3E;width:36px;height:36px" aria-label="${t('markDone')}">${icon('check2', 16)}</button>` : ''}
        </div>
      </div>`;
    }).join('')}
  `;
}

function wireVaccines(flock) {
  document.getElementById('addVaccineBtn').onclick = () => renderAddVaccineSheet(flock);
  const templateBtn = document.getElementById('useTemplateBtn');
  if (templateBtn) templateBtn.onclick = () => {
    const base = new Date(todayISO());
    VACCINE_TEMPLATE.forEach(item => {
      const d = new Date(base);
      d.setDate(d.getDate() + item.dayOffset);
      state.vaccines.push({ id: uid(), flockId: flock.id, name: item.name, date: d.toISOString().slice(0, 10), done: false });
    });
    persist();
    showToast(t('templateApplied'));
    render();
  };
  document.querySelectorAll('[data-vid]').forEach(btn => btn.onclick = () => {
    const v = state.vaccines.find(x => x.id === btn.dataset.vid);
    if (v) { v.done = true; persist(); render(); }
  });
}

function renderAddVaccineSheet(flock) {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-header"><h2>${t('addVaccine')}</h2><button class="close-btn" id="closeVax">${icon('x', 20)}</button></div>
      <label class="form-label">${t('vaccineName')}</label>
      <input id="vx-name" class="form-input tap" style="margin-bottom:16px" placeholder="${t('vaccineNamePlaceholder')}"/>
      <label class="form-label">${t('scheduledDate')}</label>
      <input id="vx-date" type="date" class="form-input tap" style="margin-bottom:20px" value="${todayISO()}"/>
      <button id="vx-submit" class="btn-primary tap" disabled>${icon('plus', 20)} ${t('addVaccine')}</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('closeVax').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const nameEl = document.getElementById('vx-name');
  const dateEl = document.getElementById('vx-date');
  const submitBtn = document.getElementById('vx-submit');
  nameEl.oninput = () => { submitBtn.disabled = !nameEl.value.trim(); };
  submitBtn.onclick = () => {
    if (!nameEl.value.trim()) return;
    state.vaccines.push({ id: uid(), flockId: flock.id, name: nameEl.value.trim(), date: dateEl.value || todayISO(), done: false });
    persist();
    overlay.remove();
    showToast(t('vaccineSaved'));
    render();
  };
}

// ---------- Calculators ----------
const CALC_TOOLS = [
  { id: 'fcr', icon: 'trend', titleKey: 'calcFCR', descKey: 'calcFCRDesc' },
  { id: 'feed', icon: 'list', titleKey: 'calcFeed', descKey: 'calcFeedDesc' },
  { id: 'water', icon: 'download', titleKey: 'calcWater', descKey: 'calcWaterDesc' },
  { id: 'thi', icon: 'sparkle', titleKey: 'calcTHI', descKey: 'calcTHIDesc' },
  { id: 'density', icon: 'grid', titleKey: 'calcDensity', descKey: 'calcDensityDesc' },
  { id: 'equipment', icon: 'calculator', titleKey: 'calcEquipment', descKey: 'calcEquipmentDesc' },
  { id: 'ventilation', icon: 'globe', titleKey: 'calcVentilation', descKey: 'calcVentilationDesc' },
  { id: 'dilution', icon: 'syringe', titleKey: 'calcDilution', descKey: 'calcDilutionDesc' },
  { id: 'bedding', icon: 'list', titleKey: 'calcBedding', descKey: 'calcBeddingDesc' },
  { id: 'epef', icon: 'trend', titleKey: 'calcEPEF', descKey: 'calcEPEFDesc' },
];

let activeCalc = null;

function calcHTML() {
  if (activeCalc) return calcDetailHTML(activeCalc);
  return `
    <div style="font-size:14px;color:#55614F;font-weight:600;margin-bottom:12px">${t('calcTitle')}</div>
    ${CALC_TOOLS.map(tool => `
      <button class="log-entry tap" style="width:100%;text-align:left;display:flex;align-items:center;gap:12px" data-calc="${tool.id}">
        <div style="width:40px;height:40px;border-radius:10px;background:#EAF0E6;color:#0C3521;display:flex;align-items:center;justify-content:center;flex-shrink:0">${icon(tool.icon, 20)}</div>
        <div>
          <div class="log-date" style="margin-bottom:1px">${t(tool.titleKey)}</div>
          <div style="font-size:12px;color:#93A093">${t(tool.descKey)}</div>
        </div>
      </button>
    `).join('')}
    <div style="height:4px"></div>
    ${Ads.block()}
  `;
}

function wireCalc() {
  if (activeCalc) { wireCalcDetail(activeCalc); return; }
  document.querySelectorAll('[data-calc]').forEach(b => b.onclick = () => { activeCalc = b.dataset.calc; render(); });
}

function calcResultHTML(res, extraLine) {
  if (!res) return '';
  const colors = { good: '#4C7A3E', warning: '#E82920', danger: '#A81F17', info: '#4A6B8A' };
  const bgs = { good: '#EEF3EA', warning: '#FBF1E2', danger: '#FBEBE6', info: '#EDF1F5' };
  return `
    <div class="card" style="background:${bgs[res.level]};border-color:${colors[res.level]}33">
      <div class="stat-label">${t('yourResult')}</div>
      <div class="stat-val display" style="color:${colors[res.level]}">${res.value}${res.unit ? ' ' + res.unit : ''}</div>
      ${res.benchmark ? `<div class="stat-sub">${t('standardRange')}: ${res.benchmark}</div>` : ''}
      ${extraLine ? `<div class="stat-sub">${extraLine}</div>` : ''}
      <div style="font-size:13px;color:${colors[res.level]};margin-top:8px;line-height:1.4;font-weight:600">${t(res.feedbackKey)}</div>
    </div>
  `;
}

function calcDetailHTML(id) {
  const tool = CALC_TOOLS.find(x => x.id === id);
  const back = `<button id="calcBack" class="btn-ghost tap" style="justify-content:flex-start;padding-left:0;margin-bottom:4px">← ${t('calcTitle')}</button>`;
  const title = `<div style="font-weight:700;font-size:18px;margin-bottom:14px">${t(tool.titleKey)}</div>`;

  const fields = {
    fcr: `
      ${numField('c-feed', t('feedConsumed'))}
      ${numField('c-weight', t('weightGained'))}
      ${numField('c-age', t('ageInDays'))}
    `,
    feed: `${numField('c-birds', t('birdCount'))} ${numField('c-age', t('ageInDays'))}`,
    water: `${numField('c-birds', t('birdCount'))} ${numField('c-age', t('ageInDays'))} ${boolField('c-hot', t('hotClimate'))}`,
    thi: `${numField('c-temp', t('temperature'))} ${numField('c-humidity', t('humidity'))}`,
    density: `${numField('c-birds', t('birdCount'))} ${breedField('c-breed')} ${numField('c-area', t('shedArea'))}`,
    equipment: `${numField('c-birds', t('birdCount'))}`,
    ventilation: `${numField('c-birds', t('birdCount'))} ${numField('c-weight', t('avgWeight'))}`,
    dilution: `
      <div class="alert alert-info" style="margin-bottom:14px"><div style="color:#4A6B8A">${icon('syringe', 16)}</div><div class="alert-detail" style="color:#1F2A22">${t('dilutionWarning')}</div></div>
      ${numField('c-dose', t('doseAmount'))}
      ${textField('c-unit', t('doseUnit'), 'mL')}
      ${numField('c-dosewater', t('doseWaterVolume'))}
      ${numField('c-actualwater', t('actualWaterVolume'))}
    `,
    bedding: `${numField('c-birds', t('birdCount'))} ${boolField('c-winter', t('isWinter'))}`,
    epef: `${numField('c-livability', t('livabilityPct'))} ${numField('c-weight', t('avgWeight'))} ${numField('c-age', t('ageInDays'))} ${numField('c-fcr', 'FCR')}`,
  };

  return `
    ${back}
    ${title}
    ${fields[id] || ''}
    <button id="calcRun" class="btn-primary tap">${t('calculate')}</button>
    <div id="calcResultBox" style="margin-top:14px"></div>
    <div style="height:6px"></div>
    ${Ads.block()}
  `;
}

function numField(id, label) {
  return `<div class="field-card"><div style="flex:1"><div class="field-label">${label}</div><input id="${id}" class="field-input" style="font-size:20px" inputmode="decimal" placeholder="0"/></div></div>`;
}
function textField(id, label, placeholder) {
  return `<div class="field-card"><div style="flex:1"><div class="field-label">${label}</div><input id="${id}" class="field-input" style="font-size:20px" placeholder="${placeholder || ''}"/></div></div>`;
}
function boolField(id, label) {
  return `
    <div class="field-card">
      <div style="flex:1"><div class="field-label">${label}</div></div>
      <button class="chip" data-bool="${id}" data-val="false" id="${id}-no">${t('no')}</button>
      <button class="chip active" data-bool="${id}" data-val="true" id="${id}-yes">${t('yes')}</button>
    </div>
  `;
}
function breedField(id) {
  return `
    <div class="field-card">
      <div style="flex:1"><div class="field-label">${t('birdType')}</div></div>
      <select id="${id}" class="form-input" style="width:auto;height:40px">
        <option value="layer">${t('layers')}</option>
        <option value="broiler">${t('broilers')}</option>
      </select>
    </div>
  `;
}

function getNum(id) { const el = document.getElementById(id); return el ? parseFloat(el.value) || 0 : 0; }
function getText(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function getBool(id) {
  const yesBtn = document.getElementById(`${id}-yes`);
  return yesBtn ? yesBtn.classList.contains('active') : false;
}

function wireCalcDetail(id) {
  document.getElementById('calcBack').onclick = () => { activeCalc = null; render(); };
  document.querySelectorAll('[data-bool]').forEach(btn => btn.onclick = () => {
    const group = btn.dataset.bool;
    document.getElementById(`${group}-yes`).classList.toggle('active', btn.dataset.val === 'true');
    document.getElementById(`${group}-no`).classList.toggle('active', btn.dataset.val === 'false');
  });

  document.getElementById('calcRun').onclick = () => {
    let res = null, extra = '';
    if (id === 'fcr') res = Calc.fcr(getNum('c-feed'), getNum('c-weight'), getNum('c-age'));
    if (id === 'feed') res = Calc.feedRequirement(getNum('c-birds'), getNum('c-age'));
    if (id === 'water') res = Calc.waterRequirement(getNum('c-birds'), getNum('c-age'), getBool('c-hot'));
    if (id === 'thi') res = Calc.thi(getNum('c-temp'), getNum('c-humidity'));
    if (id === 'density') res = Calc.stockingDensity(getNum('c-birds'), getText('c-breed'), getNum('c-area'));
    if (id === 'equipment') {
      const eq = Calc.equipment(getNum('c-birds'));
      if (eq) {
        res = { value: '', unit: '', level: 'info', feedbackKey: 'equipmentInfo' };
        extra = `${eq.panFeeders} pan feeders · ${eq.bellDrinkers} bell drinkers · ${eq.nippleDrinkers} nipple drinkers`;
      }
    }
    if (id === 'ventilation') res = Calc.ventilation(getNum('c-birds'), getNum('c-weight'));
    if (id === 'dilution') res = Calc.dilution(getNum('c-dose'), getText('c-unit') || 'units', getNum('c-dosewater'), getNum('c-actualwater'));
    if (id === 'bedding') res = Calc.bedding(getNum('c-birds'), getBool('c-winter'));
    if (id === 'epef') res = Calc.epef(getNum('c-livability'), getNum('c-weight'), getNum('c-age'), getNum('c-fcr'));

    document.getElementById('calcResultBox').innerHTML = res ? calcResultHTML(res, extra) : `<div class="empty-state">—</div>`;
  };
}

// ---------- Flock switcher (free tier capped at 1 flock) ----------
function renderSwitcherSheet() {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-header"><h2>${t('yourFlocks')}</h2><button class="close-btn" id="closeSw">${icon('x', 20)}</button></div>
      <div id="flockList"></div>
      <button id="addFlockFromSw" class="btn-secondary tap">${icon('plus', 18)} ${t('addAnotherFlock')}</button>
      ${!isProUser() ? `<div style="text-align:center;font-size:12px;color:var(--muted);margin-top:10px">${t('freeFlockLimit')}</div>` : ''}
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('flockList').innerHTML = state.flocks.map(f => `
    <button class="flock-item ${f.id === state.activeFlockId ? 'active' : ''}" data-id="${f.id}">
      <span class="fi-name">${esc(f.name)}</span>
      <span class="fi-sub">${t(BREEDS_KEYS[f.breed]?.key || 'mixed')} · ${f.startCount}</span>
    </button>`).join('');
  document.querySelectorAll('.flock-item').forEach(b => b.onclick = () => { state.activeFlockId = b.dataset.id; persist(); overlay.remove(); render(); });
  document.getElementById('closeSw').onclick = () => overlay.remove();
  document.getElementById('addFlockFromSw').onclick = () => {
    overlay.remove();
    if (!isProUser() && state.flocks.length >= FREE_FLOCK_LIMIT) { renderPaywallSheet(); return; }
    renderAddFlockSheet();
  };
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

function renderAddFlockSheet() {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-header"><h2>${t('addFlock')}</h2><button class="close-btn" id="closeAdd">${icon('x', 20)}</button></div>
      ${addFlockFormHTML()}
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('closeAdd').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  wireAddFlockForm(() => { overlay.remove(); render(); });
}

function addFlockFormHTML() {
  return `
    <label class="form-label">${t('flockName')}</label>
    <input id="nf-name" class="form-input tap" style="margin-bottom:16px" placeholder="${t('flockNamePlaceholder')}"/>
    <label class="form-label">${t('birdType')}</label>
    <div class="breed-grid" id="breedGrid"></div>
    <label class="form-label">${t('howManyBirds')}</label>
    <input id="nf-count" class="form-input tap" style="margin-bottom:20px" inputmode="numeric" placeholder="${t('birdCountPlaceholder')}"/>
    <button id="nf-submit" class="btn-primary tap" disabled>${icon('plus', 20)} ${t('startTracking')}</button>
  `;
}

function wireAddFlockForm(onDone) {
  let breed = 'layer';
  const grid = document.getElementById('breedGrid');
  grid.innerHTML = Object.entries(BREEDS_KEYS).map(([k, b]) => `<button class="breed-btn ${k === breed ? 'active' : ''}" data-breed="${k}">${t(b.key)}</button>`).join('');
  function refreshBreed() { grid.querySelectorAll('.breed-btn').forEach(b => b.classList.toggle('active', b.dataset.breed === breed)); }
  grid.querySelectorAll('.breed-btn').forEach(b => b.onclick = () => { breed = b.dataset.breed; refreshBreed(); });

  const nameEl = document.getElementById('nf-name');
  const countEl = document.getElementById('nf-count');
  const submitBtn = document.getElementById('nf-submit');
  countEl.oninput = (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); checkValid(); };
  nameEl.oninput = checkValid;
  function checkValid() { submitBtn.disabled = !(nameEl.value.trim() && countEl.value); }

  submitBtn.onclick = () => {
    if (!nameEl.value.trim() || !countEl.value) return;
    if (!isProUser() && state.flocks.length >= FREE_FLOCK_LIMIT) { renderPaywallSheet(); return; }
    const flock = { id: uid(), name: nameEl.value.trim(), breed, startCount: Number(countEl.value), createdAt: todayISO() };
    state.flocks.push(flock);
    state.activeFlockId = flock.id;
    persist();
    showToast(t('flockAdded'));
    onDone();
  };
}

// ---------- Onboarding ----------
function renderOnboarding() {
  app.innerHTML = `
    <div class="center-screen">
      <div class="onboard-hero">
        <div style="font-size:48px">🐣</div>
        <h1 class="display">${t('appName')}</h1>
        <p>${t('tagline')}</p>
      </div>
      <div class="card">${addFlockFormHTML()}</div>
      <button id="onboardLangBtn" class="btn-ghost tap lang-select-btn" style="justify-content:center;margin-top:8px">${icon('globe', 16)} ${LANGUAGES.find(l => l.code === state.lang)?.label || 'English'}</button>
    </div>
  `;
  wireAddFlockForm(render);
  document.getElementById('onboardLangBtn').onclick = () => renderLanguagePicker(false);
}

// ---------- Language picker ----------
function renderLanguagePicker(isFirstRun) {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.style.alignItems = isFirstRun ? 'center' : 'flex-end';
  overlay.innerHTML = `
    <div class="sheet" style="${isFirstRun ? 'border-radius:24px;max-width:400px' : ''}">
      <div class="sheet-header"><h2>${t('selectLanguage')}</h2>${!isFirstRun ? `<button class="close-btn" id="closeLang">${icon('x', 20)}</button>` : ''}</div>
      <div id="langList"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('langList').innerHTML = LANGUAGES.map(l => `
    <button class="lang-item ${l.code === state.lang ? 'active' : ''}" data-code="${l.code}">
      <span>${l.label}</span>
      ${l.code === state.lang ? icon('check', 18) : ''}
    </button>`).join('');
  document.querySelectorAll('.lang-item').forEach(b => b.onclick = () => {
    state.lang = b.dataset.code;
    persist();
    overlay.remove();
    render();
  });
  const closeBtn = document.getElementById('closeLang');
  if (closeBtn) closeBtn.onclick = () => overlay.remove();
  if (!isFirstRun) overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

// ---------- Paywall ----------
async function renderPaywallSheet() {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  const price = await Billing.getPrice();
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-header"><div></div><button class="close-btn" id="closePaywall">${icon('x', 20)}</button></div>
      <div class="paywall-hero">
        <div class="pw-icon">🐣</div>
        <h2>${t('unlockFull')}</h2>
        <p>${t('unlockDesc')}</p>
      </div>
      <div class="paywall-feature-list">
        <div class="paywall-feature">${icon('check', 18)} ${t('freeFlockLimit').split('.')[0]}… ${t('yourFlocks')}: unlimited</div>
        <div class="paywall-feature">${icon('check', 18)} ${t('freeAlertLimit')}</div>
        <div class="paywall-feature">${icon('check', 18)} ${t('freeTrendLimit')}</div>
        <div class="paywall-feature">${icon('check', 18)} ${t('freeExportLimit')}</div>
      </div>
      <div class="paywall-price">${t('unlockPrice')} · ${price}</div>
      <button id="purchaseBtn" class="btn-gold tap">${icon('sparkle', 18)} ${t('unlockBtn')}</button>
      <button id="laterBtn" class="btn-ghost tap">${t('maybeLater')}</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('closePaywall').onclick = () => overlay.remove();
  document.getElementById('laterBtn').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  document.getElementById('purchaseBtn').onclick = async () => {
    const btn = document.getElementById('purchaseBtn');
    btn.disabled = true;
    const result = await Billing.purchase();
    btn.disabled = false;
    if (result.success) {
      state.isPro = true;
      persist();
      overlay.remove();
      showToast('🎉 ' + t('unlockFull'));
      render();
    }
  };
}

// ---------- Init ----------
(async function boot() {
  await Billing.init().catch(() => {});
  render();
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
