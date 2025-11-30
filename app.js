/* ==========================
   app.js
   功能總覽：
   - fetch Google Sheet 公開 CSV
   - 解析 CSV 為物件陣列
   - 計算剩餘天數（遇 "-" 表示無保存期限）
   - 根據剩餘天數決定狀態（安全/即將過期/過期）
   - 渲染：儀表板、要注意的物品、兩欄清單
   - 支援排序、類別篩選、重新整理按鈕
   ========================== */

/* --------------------------
   IMPORTANT:
   把這裡替換成你 Google Sheet -> Publish to web 產生的 CSV 連結
   範例格式: https://docs.google.com/spreadsheets/d/e/<PUB_E_ID>/pub?output=csv&gid=<GID>
   -------------------------- */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSuvEfe8FiL71hQlZKOuKaDt6wkxeYUdDQBxN4suOusW3FXo4KZDYV4bEPvfBM62vHxaSzHl-7RtL98/pub?gid=1431903663&single=true&output=csv";

/* --------------------------
   全域參數與 DOM 參照
   -------------------------- */
const ICON_MAP = 
{
  "食物":"🍱",
  "飲水":"🥛",
  "藥品":"💊",
  "防護":"🩹",
  "衛生":"🧻",
  "照明":"🔦",
  "工具":"🧰",
  "其他":"📦"
};

const listColLeft = document.getElementById('list-col-left');
const listColRight = document.getElementById('list-col-right');
const urgentList = document.getElementById('urgent-list');
const totalCountEl = document.getElementById('total-count');
const safeCountEl = document.getElementById('safe-count');
const soonCountEl = document.getElementById('soon-count');
const expiredCountEl = document.getElementById('expired-count');
const sortSelect = document.getElementById('sort-select');
const filterSelect = document.getElementById('filter-select');
const refreshBtn = document.getElementById('refresh-btn');

let items = []; // 來源資料

/* --------------------------
   CSV 解析（簡單） -> 回傳物件陣列
   注意：CSV 的標題預期為：
   名稱,類別,數量,到期日(YYYY-MM-DD),備註
   -------------------------- */
async function fetchAndParseCSV() {
  if (CSV_URL.includes("<YOUR_PUB_ID>")) {
    alert("請先在 app.js 中把 CSV_URL 換成你 own 的 Google Sheet 公開 CSV 連結（參考程式內註解）。");
    return [];
  }
  const resp = await fetch(CSV_URL);
  const text = await resp.text();
  // split lines，簡單 CSV 處理（不含複雜引號多逗號情形）
  const lines = text.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const data = lines.slice(1).map((line) => {
    const cols = line.split(',').map(c => c.trim());
    // 保險：若欄位數不同，補空字串
    while (cols.length < headers.length) cols.push('');
    const obj = {};
    headers.forEach((h,i) => obj[h] = cols[i] || '');
    return obj;
  });
  return data;
}

/* --------------------------
   計算剩餘天數
   - 若到期日為 '-' 或空值 => 無保存期限
   - 回傳 {daysLeft: number|null, status: 'safe'|'soon'|'expired'|'noexpiry'}
   狀態定義：
     safe: >= 90
     soon: 31 - 89
     expired: <=30 或 已過期
   -------------------------- */
function computeExpiryInfo(expiryStr) {
  if (!expiryStr || expiryStr.trim() === '-' ) return { daysLeft: null, status: 'noexpiry' };
  // 解析 YYYY-MM-DD
  const today = new Date();
  today.setHours(0,0,0,0);
  const parts = expiryStr.split('-').map(s => parseInt(s,10));
  if (parts.length !== 3 || parts.some(isNaN)) return { daysLeft: null, status: 'noexpiry' };
  const expiry = new Date(parts[0], parts[1]-1, parts[2]);
  expiry.setHours(0,0,0,0);
  const diffMs = expiry - today;
  const diffDays = Math.ceil(diffMs / (1000*60*60*24));
  let status = 'safe';
  if (diffDays === null) status = 'noexpiry';
  else if (diffDays <= 30) status = 'expired';
  else if (diffDays <= 89) status = 'soon';
  else status = 'safe';
  return { daysLeft: diffDays, status };
}

/* --------------------------
   渲染函式
   -------------------------- */
function renderAll() {
  // apply filter
  const selectedFilter = filterSelect.value;
  let filtered = items.slice();
  if (selectedFilter && selectedFilter !== 'all') {
    filtered = filtered.filter(i => (i['類別'] === selectedFilter));
  }

  // apply sort
  const sortMode = sortSelect.value;
  if (sortMode === 'category') {
    filtered.sort((a,b) => (a['類別'] || '').localeCompare(b['類別'] || ''));
  } else if (sortMode === 'expiry') {
    filtered.sort((a,b) => {
      const ad = a._meta.daysLeft === null ? 99999 : a._meta.daysLeft;
      const bd = b._meta.daysLeft === null ? 99999 : b._meta.daysLeft;
      return ad - bd;
    });
  }

  // stats
  const total = items.length;
  const safe = items.filter(i => i._meta.status === 'safe').length;
  const soon = items.filter(i => i._meta.status === 'soon').length;
  const expired = items.filter(i => i._meta.status === 'expired').length;
  totalCountEl.textContent = total;
  safeCountEl.textContent = safe;
  soonCountEl.textContent = soon;
  expiredCountEl.textContent = expired;

  // urgent list: 包含 status === expired || daysLeft <= 30
  const urgents = items.filter(i => (i._meta.status === 'expired' || (i._meta.daysLeft !== null && i._meta.daysLeft <= 30)))
                       .sort((a,b) => {
                         const ad = a._meta.daysLeft === null ? 99999 : a._meta.daysLeft;
                         const bd = b._meta.daysLeft === null ? 99999 : b._meta.daysLeft;
                         return ad - bd;
                       });
  urgentList.innerHTML = '';
  if (urgents.length === 0) {
    urgentList.innerHTML = '<div class="urgent-item small">目前沒有緊急或到期項目</div>';
  } else {
    urgents.forEach(i => {
      const d = i._meta.daysLeft;
      const label = d === null ? '無保存期限' : (d >=0 ? `剩 ${d} 天` : `已過期 ${Math.abs(d)} 天`);
      const div = document.createElement('div');
      div.className = 'urgent-item';
      div.innerHTML = `<div><strong>${i['名稱']}</strong><div class="meta">${i['類別']} · ${i['數量'] || ''}</div></div><div class="meta">${label}</div>`;
      urgentList.appendChild(div);
    });
  }

  // render list into two columns (alternating)
  listColLeft.innerHTML = '';
  listColRight.innerHTML = '';
  filtered.forEach((it, idx) => {
    const card = createItemCard(it, idx+1);
    if (idx % 2 === 0) listColLeft.appendChild(card);
    else listColRight.appendChild(card);
  });
}

/* create item card DOM */
function createItemCard(item, index) {
  const div = document.createElement('div');
  div.className = 'item-card';
  const icon = ICON_MAP[item['類別']] || '📦';
  const daysLeft = item._meta.daysLeft;
  let statusClass = 'status-green';
  let statusText = '安全';
  if (item._meta.status === 'noexpiry') { statusText = '無保存期限'; statusClass = 'status-green'; }
  else if (item._meta.status === 'safe') { statusText = '安全'; statusClass = 'status-green'; }
  else if (item._meta.status === 'soon') { statusText = '即將到期'; statusClass = 'status-yellow'; }
  else if (item._meta.status === 'expired') { statusText = '已過期/≤30天'; statusClass = 'status-red'; }

  const left = document.createElement('div');
  left.className = 'item-left';
  left.innerHTML = `<div>${icon}</div><div style="font-size:12px;margin-top:6px;color:#666;">#${index}</div>`;

  const body = document.createElement('div');
  body.className = 'item-body';
  const nameLine = document.createElement('div');
  nameLine.className = 'item-title';
  nameLine.innerHTML = `<span>${item['名稱']}</span><span class="item-qty">${item['數量'] ? 'x'+item['數量'] : ''}</span>`;

  const meta = document.createElement('div');
  meta.className = 'item-meta';
  const cat = document.createElement('div');
  cat.textContent = item['類別'];
  const expiry = document.createElement('div');
  expiry.innerHTML = `<strong class="item-expiry">${item['到期日(YYYY-MM-DD)'] || '—'}</strong>`;
  const days = document.createElement('div');
  days.textContent = (daysLeft === null) ? '無保存期限' : (daysLeft >= 0 ? `剩 ${daysLeft} 天` : `已過期 ${Math.abs(daysLeft)} 天`);
  const status = document.createElement('div');
  status.innerHTML = `<span class="status-pill ${statusClass}">${statusText}</span>`;
  const note = document.createElement('div');
  note.textContent = item['備註'] || '';

  meta.appendChild(cat);
  meta.appendChild(expiry);
  meta.appendChild(days);
  meta.appendChild(status);

  body.appendChild(nameLine);
  body.appendChild(meta);
  if (note.textContent) {
    const noteDiv = document.createElement('div');
    noteDiv.style.marginTop = '8px';
    noteDiv.style.fontSize = '13px';
    noteDiv.style.color = '#666';
    noteDiv.textContent = '備註：' + note.textContent;
    body.appendChild(noteDiv);
  }

  div.appendChild(left);
  div.appendChild(body);
  return div;
}

/* --------------------------
   初始化：fetch -> 處理 -> render
   -------------------------- */
async function init() {
  const raw = await fetchAndParseCSV();
  if (!raw || raw.length === 0) {
    // already alerted inside fetchAndParseCSV if CSV_URL not set
    return;
  }
  // map & calculate meta
  items = raw.map(r => {
    const meta = computeExpiryInfo(r['到期日(YYYY-MM-DD)']);
    return { ...r, _meta: meta };
  });
  renderAll();
}

/* --------------------------
   事件綁定
   -------------------------- */
sortSelect.addEventListener('change', ()=> renderAll());
filterSelect.addEventListener('change', ()=> renderAll());
refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "更新中...";
  try {
    // 重新抓一次 CSV 與更新 items
    const raw = await fetchAndParseCSV();
    items = raw.map(r => ({ ...r, _meta: computeExpiryInfo(r['到期日(YYYY-MM-DD)']) }));
    renderAll();
  } catch (e) {
    console.error(e);
    alert('更新失敗，請檢查 CSV URL 是否正確或是否已公開發佈。');
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "重新整理";
  }
});

/* --------------------------
   自動啟動
   -------------------------- */
window.addEventListener('load', init);
