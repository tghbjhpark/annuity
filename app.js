/**
 * ============================================================================
 * 연금 자산 매니저 (Pension Asset Manager) - Frontend Application (app.js)
 * ============================================================================
 *
 * [백엔드 연결 방법]
 * 1) 아래 DEFAULT_GAS_WEB_APP_URL 변수에 Google Apps Script 배포 URL을 직접 입력하거나,
 * 2) 웹 페이지 우측 상단 [API 설정] 모달에서 URL을 입력해 브라우저(localStorage)에 저장할 수 있습니다.
 *
 * [통신 규격]
 * Google Apps Script의 CORS Preflight(OPTIONS) 제약을 우회하기 위해
 * 모든 요청은 POST 메서드 및 `Content-Type: text/plain;charset=utf-8` 헤더로 JSON 문자열을 전송합니다.
 */

const DEFAULT_GAS_WEB_APP_URL = ''; // 예: 'https://script.google.com/macros/s/AKfycbx.../exec'

const STORAGE_KEYS = {
  GAS_URL: 'pension_app_gas_url_v1',
  DEMO_MODE: 'pension_app_demo_mode_v1',
  SESSION: 'pension_app_session_v1',
  DEMO_DB: 'pension_app_demo_db_v1'
};

// 국내 상장 대표 연금 ETF 기본 정보 (자동완성 및 데모 시세용)
const KRX_ETF_CATALOG = {
  '360750': { name: 'TIGER 미국S&P500', price: 19850 },
  '133690': { name: 'TIGER 미국나스닥100', price: 118400 },
  '069500': { name: 'KODEX 200', price: 35600 },
  '458730': { name: 'TIGER 미국배당다우존스', price: 11920 },
  '379800': { name: 'KODEX 미국S&P500TR', price: 18420 },
  '379810': { name: 'KODEX 미국나스닥100TR', price: 19350 },
  '381170': { name: 'TIGER 미국테크TOP10 INDXX', price: 22650 },
  '381180': { name: 'TIGER 미국필라델피아반도체나스닥', price: 18900 },
  '411060': { name: 'ACE KRX금현물', price: 17280 },
  '453850': { name: 'ACE 미국30년국채액티브(H)', price: 8640 },
  '446720': { name: 'SOL 미국배당다우존스', price: 11650 },
  '459580': { name: 'KODEX CD금리액티브(합성)', price: 1048500 }
};

// 차트 컬러 팔레트
const CHART_COLORS = [
  '#4f46e5', // indigo-600
  '#0ea5e9', // sky-500
  '#8b5cf6', // violet-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
  '#f97316', // orange-500
  '#84cc16'  // lime-500
];
const CASH_COLOR = '#10b981'; // emerald-500

// 애플리케이션 전역 상태
const state = {
  authMode: 'login', // 'login' | 'register'
  session: null,     // { user_id, token }
  selectedAccountId: 'ALL', // 'ALL' 또는 특정 account_id
  chartRange: 'ALL',        // '30' | '90' | 'ALL'
  compareAccounts: false,
  allocationMode: 'HOLDINGS_AND_CASH', // 'HOLDINGS_AND_CASH' | 'ACCOUNTS'
  cashModalMode: 'set',     // 'set' | 'deposit' | 'withdraw'
  dashboard: {
    accounts: [],
    holdings: [],
    snapshots: [],
    price_map: {},
    server_time: null,
    today_date: getTodayKstString()
  }
};

// Chart.js 인스턴스 참조
let trendChartInstance = null;
let doughnutChartInstance = null;

/* ============================================================================
 * 초기화 및 이벤트 바인딩
 * ============================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  updateConnectionStatusUI();
  restoreSessionAndInit();
});

function bindEvents() {
  // 상단 버튼
  document.getElementById('btnOpenSettings').addEventListener('click', openSettingsModal);
  document.getElementById('btnManualSnapshot').addEventListener('click', triggerManualSnapshot);
  document.getElementById('btnRefreshDashboard').addEventListener('click', () => loadDashboardData(true));
  document.getElementById('btnLogout').addEventListener('click', handleLogout);

  // 로그인 / 회원가입 폼
  document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);

  // 계좌 뷰 드롭다운 전환
  document.getElementById('accountSelectDropdown').addEventListener('change', (e) => {
    selectAccountView(e.target.value);
  });

  // 차트 컨트롤 이벤트
  document.getElementById('chkCompareAccounts').addEventListener('change', (e) => {
    state.compareAccounts = e.target.checked;
    renderTrendChart();
  });

  document.querySelectorAll('.chart-range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.chartRange = btn.getAttribute('data-range') || 'ALL';
      document.querySelectorAll('.chart-range-btn').forEach((b) => {
        const active = b.getAttribute('data-range') === state.chartRange;
        b.className = active
          ? 'chart-range-btn px-2.5 py-1 rounded-md font-semibold bg-white text-slate-900 shadow-sm'
          : 'chart-range-btn px-2.5 py-1 rounded-md font-medium text-slate-600 hover:text-slate-900';
      });
      renderTrendChart();
    });
  });

  document.getElementById('allocationModeSelect').addEventListener('change', (e) => {
    state.allocationMode = e.target.value;
    renderAllocationChart();
  });

  // 모달 폼 제출
  document.getElementById('accountForm').addEventListener('submit', handleAccountFormSubmit);
  document.getElementById('cashForm').addEventListener('submit', handleCashFormSubmit);
  document.getElementById('holdingForm').addEventListener('submit', handleHoldingFormSubmit);
  document.getElementById('settingsForm').addEventListener('submit', handleSettingsFormSubmit);

  // 현금 모달 실시간 미리보기
  document.getElementById('cashAccountSelect').addEventListener('change', updateCashModalPreview);
  document.getElementById('inputCashAmount').addEventListener('input', updateCashModalPreview);

  // 종목 모달 종목코드 입력 시 종목명 자동 완성 및 매수원금 미리보기
  document.getElementById('inputTicker').addEventListener('input', (e) => {
    const raw = e.target.value.trim();
    if (raw.length === 6 && KRX_ETF_CATALOG[raw]) {
      const nameInput = document.getElementById('inputTickerName');
      if (!nameInput.value.trim()) {
        nameInput.value = KRX_ETF_CATALOG[raw].name;
      }
      const avgInput = document.getElementById('inputAvgPrice');
      if (!avgInput.value) {
        avgInput.value = KRX_ETF_CATALOG[raw].price;
        updateHoldingModalPreview();
      }
    }
  });
  document.getElementById('inputQuantity').addEventListener('input', updateHoldingModalPreview);
  document.getElementById('inputAvgPrice').addEventListener('input', updateHoldingModalPreview);
}

/* ============================================================================
 * 설정 및 API 통신 (CORS 우회용 POST text/plain;charset=utf-8)
 * ============================================================================ */

function getConfiguredGasUrl() {
  const saved = localStorage.getItem(STORAGE_KEYS.GAS_URL);
  if (saved && saved.trim()) return saved.trim();
  return (DEFAULT_GAS_WEB_APP_URL || '').trim();
}

function isDemoMode() {
  return localStorage.getItem(STORAGE_KEYS.DEMO_MODE) === 'true';
}

function updateConnectionStatusUI() {
  const url = getConfiguredGasUrl();
  const demo = isDemoMode();
  const dot = document.getElementById('connectionDot');
  const text = document.getElementById('connectionText');
  const badge = document.getElementById('connectionBadge');
  const notice = document.getElementById('authUrlNotice');

  if (demo) {
    dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500';
    text.textContent = '로컬 데모 모드';
    badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200';
    if (notice) notice.classList.add('hidden');
  } else if (url) {
    dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500';
    text.textContent = 'Google Sheets 연동됨';
    badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200';
    if (notice) notice.classList.add('hidden');
  } else {
    dot.className = 'w-1.5 h-1.5 rounded-full bg-rose-500';
    text.textContent = 'GAS URL 미설정';
    badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200';
    if (notice) notice.classList.remove('hidden');
  }
}

/**
 * Google Apps Script 백엔드 호출 함수
 * 모든 요청은 POST + Content-Type: text/plain;charset=utf-8 사용
 */
async function callApi(action, payload = {}, loadingText = '데이터 처리 중...') {
  const fullPayload = {
    action,
    ...(state.session ? { user_id: state.session.user_id, token: state.session.token, password_hash: state.session.token } : {}),
    ...payload
  };

  if (isDemoMode()) {
    showLoader(loadingText, '로컬 데모 데이터베이스에서 처리하고 있습니다');
    try {
      await new Promise((r) => setTimeout(r, 180));
      return handleDemoApiRequest(fullPayload);
    } finally {
      hideLoader();
    }
  }

  const gasUrl = getConfiguredGasUrl();
  if (!gasUrl) {
    openSettingsModal();
    throw new Error('Google Apps Script 웹 앱 URL이 설정되지 않았습니다. [API 설정]에서 URL을 입력하거나 데모 모드를 켜주세요.');
  }

  showLoader(loadingText, 'Google Sheets 서버와 안전하게 통신 중입니다');
  try {
    const response = await fetch(gasUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(fullPayload),
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(`HTTP 오류 (${response.status}): 웹 앱 배포 권한(모든 사용자/Anyone)을 확인해주세요.`);
    }

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (parseErr) {
      throw new Error('응답을 JSON으로 파싱할 수 없습니다. GAS 웹 앱이 [모든 사용자(Anyone)] 권한으로 배포되었는지 확인해주세요.');
    }

    if (result && result.code === 'UNAUTHORIZED') {
      clearSession();
      showAuthView();
      throw new Error(result.message || '인증 세션이 만료되었습니다. 다시 로그인해주세요.');
    }

    return result;
  } finally {
    hideLoader();
  }
}

/* ============================================================================
 * SHA-256 비밀번호 해싱 (Web Crypto API + 순수 JS 폴백)
 * ============================================================================ */

async function sha256(message) {
  const text = String(message || '');
  if (window.crypto && window.crypto.subtle) {
    try {
      const msgBuffer = new TextEncoder().encode(text);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      // file:// 등 비보안 컨텍스트일 경우 순수 JS SHA-256 폴백 사용
    }
  }
  return sha256Fallback(text);
}

function sha256Fallback(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i, j;
  let result = '';
  const words = [];
  const utf8Ascii = unescape(encodeURIComponent(ascii));
  const asciiBitLength = utf8Ascii[lengthProperty] * 8;

  let hash = sha256Fallback.h = sha256Fallback.h || [];
  const k = sha256Fallback.k = sha256Fallback.k || [];
  let primeCounter = k[lengthProperty];

  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  hash = hash.slice(0, 8);
  let padded = utf8Ascii + '\x80';
  while ((padded[lengthProperty] % 64) - 56) padded += '\x00';
  for (i = 0; i < padded[lengthProperty]; i++) {
    j = padded.charCodeAt(i);
    words[i >> 2] |= j << ((3 - (i % 4)) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    for (i = 0; i < 64; i++) {
      const i2 = i + j;
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? 0 : '') + b.toString(16);
    }
  }
  return result;
}

/* ============================================================================
 * 인증 (로그인 / 회원가입 / 세션 유지)
 * ============================================================================ */

function switchAuthTab(mode) {
  state.authMode = mode === 'register' ? 'register' : 'login';
  const isRegister = state.authMode === 'register';

  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabRegisterBtn = document.getElementById('tabRegisterBtn');
  const confirmWrap = document.getElementById('authConfirmWrap');
  const confirmInput = document.getElementById('authPasswordConfirm');
  const submitText = document.getElementById('authSubmitText');

  if (isRegister) {
    tabRegisterBtn.className = 'py-2 text-xs font-semibold rounded-lg bg-white text-slate-900 shadow-sm transition';
    tabLoginBtn.className = 'py-2 text-xs font-semibold rounded-lg text-slate-600 hover:text-slate-900 transition';
    confirmWrap.classList.remove('hidden');
    confirmInput.required = true;
    submitText.textContent = '새 계정 생성 및 시작하기';
  } else {
    tabLoginBtn.className = 'py-2 text-xs font-semibold rounded-lg bg-white text-slate-900 shadow-sm transition';
    tabRegisterBtn.className = 'py-2 text-xs font-semibold rounded-lg text-slate-600 hover:text-slate-900 transition';
    confirmWrap.classList.add('hidden');
    confirmInput.required = false;
    submitText.textContent = '로그인';
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const userId = document.getElementById('authUserId').value.trim();
  const password = document.getElementById('authPassword').value;
  const passwordConfirm = document.getElementById('authPasswordConfirm').value;

  if (!userId || userId.length < 2) {
    showToast('아이디를 2자 이상 입력해주세요.', 'error');
    return;
  }
  if (!password || password.length < 4) {
    showToast('비밀번호를 4자 이상 입력해주세요.', 'error');
    return;
  }
  if (state.authMode === 'register' && password !== passwordConfirm) {
    showToast('비밀번호와 비밀번호 확인이 일치하지 않습니다.', 'error');
    return;
  }

  try {
    const passwordHash = await sha256(password);
    const action = state.authMode === 'register' ? 'register' : 'login';
    const loadingMsg = state.authMode === 'register' ? '회원가입 처리 중...' : '로그인 인증 중...';

    const res = await callApi(action, {
      user_id: userId,
      password_hash: passwordHash
    }, loadingMsg);

    if (!res || !res.success) {
      showToast((res && res.message) || '인증에 실패했습니다.', 'error');
      return;
    }

    const sessionData = {
      user_id: res.data.user_id || userId,
      token: res.data.token || passwordHash
    };
    saveSession(sessionData);
    showToast(res.message || '환영합니다!', 'success');

    document.getElementById('authForm').reset();
    showDashboardView();
    await loadDashboardData(false);
  } catch (err) {
    showToast(err.message || '오류가 발생했습니다.', 'error');
  }
}

function saveSession(sessionObj) {
  state.session = sessionObj;
  localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(sessionObj));
}

function clearSession() {
  state.session = null;
  localStorage.removeItem(STORAGE_KEYS.SESSION);
}

async function restoreSessionAndInit() {
  const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
  if (!raw) {
    showAuthView();
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.user_id && parsed.token) {
      state.session = parsed;
      showDashboardView();
      await loadDashboardData(false);
    } else {
      clearSession();
      showAuthView();
    }
  } catch (_) {
    clearSession();
    showAuthView();
  }
}

function handleLogout() {
  clearSession();
  state.selectedAccountId = 'ALL';
  showAuthView();
  showToast('로그아웃되었습니다.', 'info');
}

function showAuthView() {
  document.getElementById('authSection').classList.remove('hidden');
  document.getElementById('dashboardSection').classList.add('hidden');
  const controls = document.getElementById('headerAuthControls');
  controls.classList.add('hidden');
  controls.classList.remove('flex');
  updateConnectionStatusUI();
}

function showDashboardView() {
  document.getElementById('authSection').classList.add('hidden');
  document.getElementById('dashboardSection').classList.remove('hidden');
  const controls = document.getElementById('headerAuthControls');
  controls.classList.remove('hidden');
  controls.classList.add('flex');

  if (state.session) {
    document.getElementById('currentUserBadge').textContent = state.session.user_id;
  }
  updateConnectionStatusUI();
}

/* ============================================================================
 * 대시보드 데이터 로드 및 전체 UI 렌더링
 * ============================================================================ */

async function loadDashboardData(showSuccessToast = false) {
  if (!state.session) return;
  try {
    const res = await callApi('getDashboardData', {}, '연금 자산 및 실시간 ETF 시세 불러오는 중...');
    if (!res || !res.success) {
      showToast((res && res.message) || '데이터를 불러오지 못했습니다.', 'error');
      return;
    }
    applyDashboardData(res.data);
    if (showSuccessToast) {
      showToast('최신 시세 및 자산 데이터를 동기화했습니다.', 'success');
    }
  } catch (err) {
    showToast(err.message || '데이터 조회 실패', 'error');
  }
}

function applyDashboardData(data) {
  if (!data) return;
  state.dashboard = {
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    holdings: Array.isArray(data.holdings) ? data.holdings : [],
    snapshots: Array.isArray(data.snapshots) ? data.snapshots : [],
    price_map: data.price_map || {},
    server_time: data.server_time || new Date().toISOString(),
    today_date: data.today_date || getTodayKstString()
  };

  // 현재 선택된 계좌가 삭제되었으면 ALL로 복귀
  if (state.selectedAccountId !== 'ALL') {
    const exists = state.dashboard.accounts.some((a) => a.account_id === state.selectedAccountId);
    if (!exists) {
      state.selectedAccountId = 'ALL';
    }
  }

  renderAllDashboardComponents();
}

function renderAllDashboardComponents() {
  renderAccountFilterBar();
  renderSummaryCards();
  renderTrendChart();
  renderAllocationChart();
  renderAccountsGrid();
  renderHoldingsTable();
}

function selectAccountView(accountId) {
  state.selectedAccountId = accountId || 'ALL';
  renderAllDashboardComponents();
}

/* ============================================================================
 * 1. 상단 뷰 전환 바 (탭 + 드롭다운)
 * ============================================================================ */

function renderAccountFilterBar() {
  const accounts = state.dashboard.accounts;
  const activeId = state.selectedAccountId;

  // 탭 버튼 렌더링
  const tabsContainer = document.getElementById('accountTabsContainer');
  const allTabItems = [
    { account_id: 'ALL', account_name: '전체 계좌 통합 보기' },
    ...accounts
  ];

  tabsContainer.innerHTML = allTabItems.map((item) => {
    const isActive = item.account_id === activeId;
    const btnClass = isActive
      ? 'px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white shadow-sm whitespace-nowrap transition'
      : 'px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200/80 whitespace-nowrap transition';
    return `<button type="button" onclick="selectAccountView('${escapeAttr(item.account_id)}')" class="${btnClass}">${escapeHtml(item.account_name)}</button>`;
  }).join('');

  // 드롭다운 동기화
  const dropdown = document.getElementById('accountSelectDropdown');
  dropdown.innerHTML = allTabItems.map((item) => {
    const selected = item.account_id === activeId ? 'selected' : '';
    return `<option value="${escapeAttr(item.account_id)}" ${selected}>${escapeHtml(item.account_name)}</option>`;
  }).join('');

  // 개별 계좌 선택 시 [선택 계좌 삭제] 버튼 표시
  const deleteBtn = document.getElementById('btnDeleteCurrentAccount');
  if (activeId !== 'ALL') {
    deleteBtn.classList.remove('hidden');
    deleteBtn.classList.add('inline-flex');
  } else {
    deleteBtn.classList.add('hidden');
    deleteBtn.classList.remove('inline-flex');
  }
}

/* ============================================================================
 * 2. 요약 카드 3종 렌더링
 * ============================================================================ */

function getFilteredDataForCurrentView() {
  const activeId = state.selectedAccountId;
  const accounts = activeId === 'ALL'
    ? state.dashboard.accounts
    : state.dashboard.accounts.filter((a) => a.account_id === activeId);

  const holdings = activeId === 'ALL'
    ? state.dashboard.holdings
    : state.dashboard.holdings.filter((h) => h.account_id === activeId);

  const cashSum = accounts.reduce((acc, cur) => acc + (Number(cur.cash_balance) || 0), 0);
  const stockEvalSum = holdings.reduce((acc, cur) => acc + (Number(cur.eval_amount) || 0), 0);
  const principalSum = holdings.reduce((acc, cur) => acc + (Number(cur.principal_amount) || 0), 0);
  const totalAsset = stockEvalSum + cashSum;
  const profitSum = stockEvalSum - principalSum;
  const profitRate = principalSum > 0 ? (profitSum / principalSum) * 100 : 0;

  return {
    accounts,
    holdings,
    cashSum,
    stockEvalSum,
    principalSum,
    totalAsset,
    profitSum,
    profitRate
  };
}

function renderSummaryCards() {
  const {
    accounts,
    holdings,
    cashSum,
    stockEvalSum,
    principalSum,
    totalAsset,
    profitSum,
    profitRate
  } = getFilteredDataForCurrentView();

  const activeAccount = state.dashboard.accounts.find((a) => a.account_id === state.selectedAccountId);
  document.getElementById('summaryViewLabel').textContent = activeAccount
    ? `${activeAccount.account_name} 총자산`
    : '전체 계좌 통합 총자산';

  document.getElementById('summaryAccountCountBadge').textContent =
    state.selectedAccountId === 'ALL' ? `${accounts.length}개 계좌` : '개별 계좌 뷰';

  document.getElementById('summaryTotalAsset').textContent = formatKRW(totalAsset);

  const stockRatio = totalAsset > 0 ? ((stockEvalSum / totalAsset) * 100).toFixed(1) : '0.0';
  const cashRatio = totalAsset > 0 ? ((cashSum / totalAsset) * 100).toFixed(1) : '0.0';
  document.getElementById('summaryStockRatio').textContent = `${stockRatio}%`;
  document.getElementById('summaryCashRatio').textContent = `${cashRatio}%`;

  // 동기화 시각
  if (state.dashboard.server_time) {
    const timePart = String(state.dashboard.server_time).slice(11, 19);
    document.getElementById('lastSyncedTime').textContent = timePart ? `${timePart} 기준` : '동기화 완료';
  }

  // 주식 평가금액 및 손익
  document.getElementById('summaryHoldingCountBadge').textContent = `${holdings.length}종목`;
  document.getElementById('summaryStockEval').textContent = formatKRW(stockEvalSum);
  document.getElementById('summaryPrincipal').textContent = formatKRW(principalSum);

  const profitBadge = document.getElementById('summaryProfitBadge');
  const sign = profitSum > 0 ? '+' : '';
  profitBadge.textContent = `${sign}${formatKRW(profitSum)} (${sign}${profitRate.toFixed(2)}%)`;
  if (profitSum > 0) {
    profitBadge.className = 'font-bold tabular-nums text-rose-600';
  } else if (profitSum < 0) {
    profitBadge.className = 'font-bold tabular-nums text-blue-600';
  } else {
    profitBadge.className = 'font-semibold tabular-nums text-slate-600';
  }

  // 현금 합계 및 최근 스냅샷 날짜
  document.getElementById('summaryCashAmount').textContent = formatKRW(cashSum);

  const snapshots = state.dashboard.snapshots;
  if (snapshots.length > 0) {
    const latestDate = snapshots[snapshots.length - 1].date;
    document.getElementById('latestSnapshotDate').textContent = latestDate;
  } else {
    document.getElementById('latestSnapshotDate').textContent = '기록 없음';
  }
}

/* ============================================================================
 * 3. 시계열 자산 추이 라인 차트 (Chart.js)
 * ============================================================================ */

function renderTrendChart() {
  const canvas = document.getElementById('assetTrendChart');
  const emptyState = document.getElementById('trendEmptyState');
  const subtitle = document.getElementById('lineChartSubtitle');
  const allSnapshots = state.dashboard.snapshots || [];

  // 날짜 목록 추출 (오름차순)
  let uniqueDates = Array.from(new Set(allSnapshots.map((s) => s.date))).sort();
  if (state.chartRange === '30' && uniqueDates.length > 30) {
    uniqueDates = uniqueDates.slice(-30);
  } else if (state.chartRange === '90' && uniqueDates.length > 90) {
    uniqueDates = uniqueDates.slice(-90);
  }

  if (uniqueDates.length === 0) {
    emptyState.classList.remove('hidden');
    if (trendChartInstance) {
      trendChartInstance.destroy();
      trendChartInstance = null;
    }
    return;
  }
  emptyState.classList.add('hidden');

  let datasets = [];

  if (state.compareAccounts && state.dashboard.accounts.length > 0) {
    subtitle.textContent = '전체 합산(ALL) 및 개별 계좌별 일별 총자산 변화 비교';
    // 1) 전체 계좌 통합 라인
    const allMap = buildSnapshotLookup(allSnapshots, 'ALL');
    datasets.push({
      label: '전체 통합 총자산',
      data: uniqueDates.map((d) => (allMap[d] ? allMap[d].total_asset : null)),
      borderColor: '#0f172a',
      backgroundColor: 'rgba(15, 23, 42, 0.08)',
      borderWidth: 2.5,
      tension: 0.25,
      pointRadius: 3,
      spanGaps: true
    });

    // 2) 각 계좌별 라인
    state.dashboard.accounts.forEach((acc, idx) => {
      const accMap = buildSnapshotLookup(allSnapshots, acc.account_id);
      const color = CHART_COLORS[idx % CHART_COLORS.length];
      datasets.push({
        label: acc.account_name,
        data: uniqueDates.map((d) => (accMap[d] ? accMap[d].total_asset : null)),
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        borderDash: [4, 3],
        tension: 0.25,
        pointRadius: 2.5,
        spanGaps: true
      });
    });
  } else {
    const targetAccId = state.selectedAccountId || 'ALL';
    const targetAccObj = state.dashboard.accounts.find((a) => a.account_id === targetAccId);
    const viewName = targetAccObj ? targetAccObj.account_name : '전체 통합';
    subtitle.textContent = `${viewName} 기준 일별 총자산 · 주식 평가금 · 현금 추이`;

    const snapMap = buildSnapshotLookup(allSnapshots, targetAccId);

    datasets = [
      {
        label: `${viewName} 총자산`,
        data: uniqueDates.map((d) => (snapMap[d] ? snapMap[d].total_asset : null)),
        borderColor: '#4f46e5',
        backgroundColor: 'rgba(79, 70, 229, 0.10)',
        fill: true,
        borderWidth: 2.5,
        tension: 0.25,
        pointRadius: 3.5,
        spanGaps: true
      },
      {
        label: '주식(ETF) 평가금',
        data: uniqueDates.map((d) => (snapMap[d] ? snapMap[d].eval_amount : null)),
        borderColor: '#0ea5e9',
        backgroundColor: '#0ea5e9',
        fill: false,
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 2.5,
        spanGaps: true
      },
      {
        label: '보유 현금',
        data: uniqueDates.map((d) => (snapMap[d] ? snapMap[d].cash_amount : null)),
        borderColor: CASH_COLOR,
        backgroundColor: CASH_COLOR,
        fill: false,
        borderWidth: 1.8,
        borderDash: [4, 4],
        tension: 0.25,
        pointRadius: 2,
        spanGaps: true
      }
    ];
  }

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  trendChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: uniqueDates,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            boxWidth: 10,
            usePointStyle: true,
            font: { size: 11, family: 'Pretendard, sans-serif' }
          }
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const val = ctx.parsed.y;
              if (val === null || val === undefined) return `${ctx.dataset.label}: 데이터 없음`;
              return `${ctx.dataset.label}: ${formatKRW(val)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 } }
        },
        y: {
          beginAtZero: false,
          grid: { color: '#f1f5f9' },
          ticks: {
            font: { size: 11 },
            callback(value) {
              return formatCompactKRW(value);
            }
          }
        }
      }
    }
  });
}

function buildSnapshotLookup(snapshots, accountId) {
  const map = {};
  if (accountId === 'ALL') {
    // 1) account_id === 'ALL' 레코드 우선 적용
    snapshots.forEach((s) => {
      if (s.account_id === 'ALL') {
        map[s.date] = {
          eval_amount: Number(s.eval_amount) || 0,
          cash_amount: Number(s.cash_amount) || 0,
          total_asset: Number(s.total_asset) || 0
        };
      }
    });
    // 2) 만약 특정 날짜에 'ALL' 레코드가 없고 개별 계좌 레코드만 있다면 프런트엔드에서 자동 합산
    const byDateAccSum = {};
    snapshots.forEach((s) => {
      if (s.account_id !== 'ALL') {
        if (!byDateAccSum[s.date]) {
          byDateAccSum[s.date] = { eval_amount: 0, cash_amount: 0, total_asset: 0 };
        }
        byDateAccSum[s.date].eval_amount += Number(s.eval_amount) || 0;
        byDateAccSum[s.date].cash_amount += Number(s.cash_amount) || 0;
        byDateAccSum[s.date].total_asset += Number(s.total_asset) || 0;
      }
    });
    Object.keys(byDateAccSum).forEach((d) => {
      if (!map[d]) {
        map[d] = byDateAccSum[d];
      }
    });
  } else {
    snapshots.forEach((s) => {
      if (s.account_id === accountId) {
        map[s.date] = {
          eval_amount: Number(s.eval_amount) || 0,
          cash_amount: Number(s.cash_amount) || 0,
          total_asset: Number(s.total_asset) || 0
        };
      }
    });
  }
  return map;
}

/* ============================================================================
 * 4. 자산 비중 도넛 차트 (Chart.js)
 * ============================================================================ */

function renderAllocationChart() {
  const canvas = document.getElementById('allocationDoughnutChart');
  const emptyState = document.getElementById('allocationEmptyState');
  const legendList = document.getElementById('allocationLegendList');

  const { accounts, holdings, cashSum, totalAsset } = getFilteredDataForCurrentView();

  const items = []; // { label, amount, color }

  if (state.allocationMode === 'ACCOUNTS') {
    accounts.forEach((acc, idx) => {
      const accHoldings = state.dashboard.holdings.filter((h) => h.account_id === acc.account_id);
      const accStockSum = accHoldings.reduce((s, h) => s + (Number(h.eval_amount) || 0), 0);
      const accTotal = accStockSum + (Number(acc.cash_balance) || 0);
      if (accTotal > 0) {
        items.push({
          label: acc.account_name,
          amount: accTotal,
          color: CHART_COLORS[idx % CHART_COLORS.length]
        });
      }
    });
  } else {
    // 종목별 합산 (여러 계좌에 동일 ETF 보유 시 종목코드 기준으로 합산)
    const groupedByTicker = {};
    holdings.forEach((h) => {
      const key = h.ticker;
      if (!groupedByTicker[key]) {
        groupedByTicker[key] = {
          ticker: h.ticker,
          name: h.ticker_name,
          amount: 0
        };
      }
      groupedByTicker[key].amount += Number(h.eval_amount) || 0;
    });

    const sortedHoldings = Object.values(groupedByTicker)
      .filter((g) => g.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    sortedHoldings.forEach((g, idx) => {
      items.push({
        label: `${g.name} (${g.ticker})`,
        amount: g.amount,
        color: CHART_COLORS[idx % CHART_COLORS.length]
      });
    });

    if (cashSum > 0) {
      items.push({
        label: '보유 현금 (예수금)',
        amount: cashSum,
        color: CASH_COLOR
      });
    }
  }

  if (items.length === 0 || totalAsset <= 0) {
    emptyState.classList.remove('hidden');
    legendList.innerHTML = `<p class="text-xs text-slate-400 text-center py-8">계좌에 현금이나 보유 종목을 등록하면 자산 비중이 표시됩니다.</p>`;
    if (doughnutChartInstance) {
      doughnutChartInstance.destroy();
      doughnutChartInstance = null;
    }
    return;
  }

  emptyState.classList.add('hidden');

  if (doughnutChartInstance) {
    doughnutChartInstance.destroy();
  }

  doughnutChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: items.map((i) => i.label),
      datasets: [
        {
          data: items.map((i) => i.amount),
          backgroundColor: items.map((i) => i.color),
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '64%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const val = ctx.parsed || 0;
              const pct = totalAsset > 0 ? ((val / totalAsset) * 100).toFixed(1) : '0.0';
              return `${ctx.label}: ${formatKRW(val)} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  // 우측 커스텀 비중 범례 리스트 렌더링
  legendList.innerHTML = items.map((item) => {
    const pct = totalAsset > 0 ? ((item.amount / totalAsset) * 100).toFixed(1) : '0.0';
    return `
      <div class="flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-slate-50 transition">
        <div class="flex items-center gap-2 min-w-0">
          <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${item.color}"></span>
          <span class="text-slate-700 font-medium truncate" title="${escapeAttr(item.label)}">${escapeHtml(item.label)}</span>
        </div>
        <div class="text-right shrink-0 tabular-nums">
          <span class="font-bold text-slate-900">${pct}%</span>
          <span class="block text-[11px] text-slate-400">${formatKRW(item.amount)}</span>
        </div>
      </div>
    `;
  }).join('');
}

/* ============================================================================
 * 5. 계좌별 카드 그리드 렌더링
 * ============================================================================ */

function renderAccountsGrid() {
  const container = document.getElementById('accountsGrid');
  const accounts = state.dashboard.accounts;

  if (accounts.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-10 px-4 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
        <p class="text-sm font-semibold text-slate-700">등록된 연금 계좌가 없습니다</p>
        <p class="text-xs text-slate-500 mt-1 mb-4">연금저축 또는 IRP 계좌를 먼저 추가해 관리를 시작해보세요.</p>
        <button type="button" onclick="openAccountModal()" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition">
          + 첫 연금 계좌 추가하기
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = accounts.map((acc) => {
    const isSelected = state.selectedAccountId === acc.account_id;
    const accHoldings = state.dashboard.holdings.filter((h) => h.account_id === acc.account_id);
    const stockEval = accHoldings.reduce((sum, h) => sum + (Number(h.eval_amount) || 0), 0);
    const principal = accHoldings.reduce((sum, h) => sum + (Number(h.principal_amount) || 0), 0);
    const cash = Number(acc.cash_balance) || 0;
    const total = stockEval + cash;
    const profit = stockEval - principal;
    const profitRate = principal > 0 ? (profit / principal) * 100 : 0;
    const sign = profit > 0 ? '+' : '';
    const profitColor = profit > 0 ? 'text-rose-600' : profit < 0 ? 'text-blue-600' : 'text-slate-500';

    const borderClass = isSelected
      ? 'border-2 border-indigo-600 bg-indigo-50/20 shadow-sm'
      : 'border border-slate-200/80 bg-white hover:border-slate-300';

    return `
      <div class="rounded-2xl p-4 transition flex flex-col justify-between ${borderClass}">
        <div>
          <div class="flex items-start justify-between gap-2">
            <button type="button" onclick="selectAccountView('${escapeAttr(acc.account_id)}')" class="text-left group">
              <div class="flex items-center gap-1.5">
                <h4 class="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition">${escapeHtml(acc.account_name)}</h4>
                ${isSelected ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-600 text-white">선택됨</span>' : ''}
              </div>
              <p class="text-[11px] text-slate-400 mt-0.5">보유 ${accHoldings.length}종목</p>
            </button>

            <div class="flex items-center gap-1">
              <button type="button" onclick="openCashModal('${escapeAttr(acc.account_id)}')" class="px-2 py-1 rounded-lg text-[11px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition" title="현금 입출금/수정">
                현금관리
              </button>
              <button type="button" onclick="confirmDeleteAccount('${escapeAttr(acc.account_id)}', '${escapeAttr(acc.account_name)}')" class="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition" title="계좌 삭제">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>

          <p class="text-xl font-bold text-slate-900 mt-3 tabular-nums">${formatKRW(total)}</p>
        </div>

        <div class="mt-3 pt-3 border-t border-slate-100 space-y-1 text-xs tabular-nums">
          <div class="flex justify-between">
            <span class="text-slate-500">주식 평가금 (${sign}${profitRate.toFixed(2)}%)</span>
            <span class="font-semibold ${profitColor}">${formatKRW(stockEval)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">보유 현금 (예수금)</span>
            <span class="font-semibold text-slate-700">${formatKRW(cash)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ============================================================================
 * 6. 보유 종목 테이블 렌더링
 * ============================================================================ */

function renderHoldingsTable() {
  const tbody = document.getElementById('holdingsTableBody');
  const badge = document.getElementById('holdingsTableFilterBadge');

  const { holdings, totalAsset } = getFilteredDataForCurrentView();
  const accountMap = {};
  state.dashboard.accounts.forEach((a) => {
    accountMap[a.account_id] = a.account_name;
  });

  if (state.selectedAccountId === 'ALL') {
    badge.textContent = '전체 계좌 통합';
  } else {
    badge.textContent = accountMap[state.selectedAccountId] || '선택 계좌';
  }

  if (holdings.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-12 px-4 text-center text-slate-500">
          <p class="text-sm font-semibold text-slate-700">등록된 보유 종목이 없습니다</p>
          <p class="text-xs text-slate-400 mt-1 mb-3">국내 상장 ETF 6자리 종목코드(예: 360750, 133690, 069500)를 추가해 실시간 평가금액을 확인하세요.</p>
          <button type="button" onclick="openHoldingModal()" class="px-3.5 py-2 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-semibold hover:bg-indigo-100 transition">
            + 보유 종목 추가하기
          </button>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = holdings.map((h) => {
    const accName = accountMap[h.account_id] || '미확인 계좌';
    const profit = Number(h.profit_amount) || 0;
    const profitRate = Number(h.profit_rate) || 0;
    const sign = profit > 0 ? '+' : '';
    const profitClass = profit > 0
      ? 'text-rose-600 font-semibold'
      : profit < 0
      ? 'text-blue-600 font-semibold'
      : 'text-slate-600';

    const weightPct = totalAsset > 0 ? ((Number(h.eval_amount) / totalAsset) * 100).toFixed(1) : '0.0';

    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="py-3.5 px-4 whitespace-nowrap">
          <span class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium">${escapeHtml(accName)}</span>
        </td>
        <td class="py-3.5 px-4">
          <div class="font-semibold text-slate-900">${escapeHtml(h.ticker_name)}</div>
          <div class="inline-flex items-center gap-1 mt-0.5">
            <span class="font-mono text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold">${escapeHtml(h.ticker)}</span>
            <span class="text-[11px] text-slate-400">${h.is_realtime_price ? 'KRX 시세 연동' : '평단가 기준'}</span>
          </div>
        </td>
        <td class="py-3.5 px-4 text-right tabular-nums font-medium text-slate-800">
          ${formatNumber(h.quantity)}주
        </td>
        <td class="py-3.5 px-4 text-right tabular-nums text-slate-600">
          ${formatKRW(h.avg_price)}
        </td>
        <td class="py-3.5 px-4 text-right tabular-nums font-semibold text-slate-900">
          ${formatKRW(h.current_price)}
        </td>
        <td class="py-3.5 px-4 text-right tabular-nums">
          <div class="font-bold text-slate-900">${formatKRW(h.eval_amount)}</div>
          <div class="text-[11px] text-slate-400">원금 ${formatKRW(h.principal_amount)}</div>
        </td>
        <td class="py-3.5 px-4 text-right tabular-nums ${profitClass}">
          <div>${sign}${formatKRW(profit)}</div>
          <div class="text-xs">(${sign}${profitRate.toFixed(2)}%)</div>
        </td>
        <td class="py-3.5 px-4 text-right tabular-nums">
          <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">${weightPct}%</span>
        </td>
        <td class="py-3.5 px-4 text-center whitespace-nowrap">
          <div class="inline-flex items-center gap-1">
            <button type="button" onclick="openHoldingModal('${escapeAttr(h.holding_id)}')" class="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition">
              수정
            </button>
            <button type="button" onclick="confirmDeleteHolding('${escapeAttr(h.holding_id)}', '${escapeAttr(h.ticker_name)}')" class="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition">
              삭제
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/* ============================================================================
 * 7. 계좌 추가 / 삭제 및 현금 입출금 모달 제어
 * ============================================================================ */

function openAccountModal() {
  document.getElementById('accountForm').reset();
  document.getElementById('inputInitialCash').value = '0';
  showModal('accountModal');
  setTimeout(() => document.getElementById('inputAccountName').focus(), 50);
}

function closeAccountModal() {
  hideModal('accountModal');
}

function fillAccountNamePreset(presetName) {
  document.getElementById('inputAccountName').value = presetName;
  document.getElementById('inputAccountName').focus();
}

async function handleAccountFormSubmit(e) {
  e.preventDefault();
  const accountName = document.getElementById('inputAccountName').value.trim();
  const cashBalance = Number(document.getElementById('inputInitialCash').value) || 0;

  if (!accountName) {
    showToast('계좌명을 입력해주세요.', 'error');
    return;
  }

  try {
    const res = await callApi('addAccount', {
      account_name: accountName,
      cash_balance: cashBalance
    }, '새 연금 계좌를 생성하는 중...');

    if (!res || !res.success) {
      showToast((res && res.message) || '계좌 생성 실패', 'error');
      return;
    }

    closeAccountModal();
    showToast(res.message || '계좌가 생성되었습니다.', 'success');
    if (res.data) {
      applyDashboardData(res.data);
    } else {
      await loadDashboardData(false);
    }
  } catch (err) {
    showToast(err.message || '계좌 추가 중 오류 발생', 'error');
  }
}

async function confirmDeleteCurrentAccount() {
  if (state.selectedAccountId === 'ALL') return;
  const acc = state.dashboard.accounts.find((a) => a.account_id === state.selectedAccountId);
  if (!acc) return;
  await confirmDeleteAccount(acc.account_id, acc.account_name);
}

async function confirmDeleteAccount(accountId, accountName) {
  const ok = window.confirm(
    `[${accountName}] 계좌를 정말 삭제하시겠습니까?\n\n계좌 삭제 시 해당 계좌에 등록된 하위 보유 종목들도 함께 삭제됩니다.`
  );
  if (!ok) return;

  try {
    const res = await callApi('deleteAccount', { account_id: accountId }, '계좌 및 하위 종목 정리 중...');
    if (!res || !res.success) {
      showToast((res && res.message) || '계좌 삭제 실패', 'error');
      return;
    }
    showToast(res.message || '계좌가 삭제되었습니다.', 'info');
    if (res.data) {
      applyDashboardData(res.data);
    } else {
      await loadDashboardData(false);
    }
  } catch (err) {
    showToast(err.message || '계좌 삭제 중 오류 발생', 'error');
  }
}

/* ----- 현금 입출금 / 잔액 수정 모달 ----- */

function openCashModal(preferredAccountId) {
  const accounts = state.dashboard.accounts;
  if (accounts.length === 0) {
    showToast('먼저 연금 계좌를 추가해주세요.', 'info');
    openAccountModal();
    return;
  }

  const selectEl = document.getElementById('cashAccountSelect');
  const defaultId = preferredAccountId || (state.selectedAccountId !== 'ALL' ? state.selectedAccountId : accounts[0].account_id);

  selectEl.innerHTML = accounts.map((acc) => {
    const selected = acc.account_id === defaultId ? 'selected' : '';
    return `<option value="${escapeAttr(acc.account_id)}" ${selected}>${escapeHtml(acc.account_name)}</option>`;
  }).join('');

  setCashModalMode('set');
  showModal('cashModal');
}

function closeCashModal() {
  hideModal('cashModal');
}

function setCashModalMode(mode) {
  state.cashModalMode = mode || 'set';
  document.querySelectorAll('.cash-mode-btn').forEach((btn) => {
    const active = btn.getAttribute('data-cash-mode') === state.cashModalMode;
    btn.className = active
      ? 'cash-mode-btn py-2 px-3 rounded-xl text-xs font-semibold border border-indigo-600 bg-indigo-50 text-indigo-700'
      : 'cash-mode-btn py-2 px-3 rounded-xl text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50';
  });

  const label = document.getElementById('cashInputLabel');
  const input = document.getElementById('inputCashAmount');
  const selectedId = document.getElementById('cashAccountSelect').value;
  const acc = state.dashboard.accounts.find((a) => a.account_id === selectedId);
  const currentCash = acc ? Number(acc.cash_balance) || 0 : 0;

  if (state.cashModalMode === 'set') {
    label.textContent = '변경할 최종 현금 잔액 (원)';
    input.value = currentCash;
  } else if (state.cashModalMode === 'deposit') {
    label.textContent = '추가 입금할 금액 (원)';
    input.value = '';
  } else {
    label.textContent = '출금(차감)할 금액 (원)';
    input.value = '';
  }
  updateCashModalPreview();
}

function adjustCashInput(delta, resetToZero = false) {
  const input = document.getElementById('inputCashAmount');
  if (resetToZero) {
    input.value = 0;
  } else {
    const cur = Number(input.value) || 0;
    input.value = cur + delta;
  }
  updateCashModalPreview();
}

function updateCashModalPreview() {
  const selectedId = document.getElementById('cashAccountSelect').value;
  const acc = state.dashboard.accounts.find((a) => a.account_id === selectedId);
  const currentCash = acc ? Number(acc.cash_balance) || 0 : 0;
  const inputVal = Number(document.getElementById('inputCashAmount').value) || 0;

  document.getElementById('cashCurrentBalanceDisplay').textContent = formatKRW(currentCash);

  let preview = currentCash;
  if (state.cashModalMode === 'set') {
    preview = inputVal;
  } else if (state.cashModalMode === 'deposit') {
    preview = currentCash + inputVal;
  } else if (state.cashModalMode === 'withdraw') {
    preview = currentCash - inputVal;
  }

  const previewEl = document.getElementById('cashPreviewBalanceDisplay');
  previewEl.textContent = formatKRW(preview);
  previewEl.className = preview < 0
    ? 'text-sm text-rose-600 font-bold tabular-nums'
    : 'text-sm text-emerald-900 font-bold tabular-nums';
}

async function handleCashFormSubmit(e) {
  e.preventDefault();
  const accountId = document.getElementById('cashAccountSelect').value;
  const amount = Number(document.getElementById('inputCashAmount').value);

  if (!accountId || isNaN(amount) || amount < 0) {
    showToast('유효한 금액을 입력해주세요.', 'error');
    return;
  }

  try {
    const res = await callApi('updateCash', {
      account_id: accountId,
      mode: state.cashModalMode,
      cash_balance: amount
    }, '현금 잔액 반영 중...');

    if (!res || !res.success) {
      showToast((res && res.message) || '현금 수정 실패', 'error');
      return;
    }

    closeCashModal();
    showToast(res.message || '현금 보유액이 업데이트되었습니다.', 'success');
    if (res.data) {
      applyDashboardData(res.data);
    } else {
      await loadDashboardData(false);
    }
  } catch (err) {
    showToast(err.message || '현금 수정 중 오류 발생', 'error');
  }
}

/* ============================================================================
 * 8. 보유 종목 추가 / 수정 / 삭제 모달 제어
 * ============================================================================ */

function openHoldingModal(holdingId) {
  const accounts = state.dashboard.accounts;
  if (accounts.length === 0) {
    showToast('종목을 추가하려면 먼저 연금 계좌를 생성해주세요.', 'info');
    openAccountModal();
    return;
  }

  const form = document.getElementById('holdingForm');
  form.reset();

  const selectEl = document.getElementById('holdingAccountSelect');
  const defaultAccountId = state.selectedAccountId !== 'ALL' ? state.selectedAccountId : accounts[0].account_id;

  selectEl.innerHTML = accounts.map((acc) => {
    const selected = acc.account_id === defaultAccountId ? 'selected' : '';
    return `<option value="${escapeAttr(acc.account_id)}" ${selected}>${escapeHtml(acc.account_name)}</option>`;
  }).join('');

  if (holdingId) {
    const existing = state.dashboard.holdings.find((h) => h.holding_id === holdingId);
    if (existing) {
      document.getElementById('holdingModalTitle').textContent = '보유 종목 수정';
      document.getElementById('inputHoldingId').value = existing.holding_id;
      selectEl.value = existing.account_id;
      document.getElementById('inputTicker').value = existing.ticker;
      document.getElementById('inputTickerName').value = existing.ticker_name;
      document.getElementById('inputQuantity').value = existing.quantity;
      document.getElementById('inputAvgPrice').value = existing.avg_price;
    }
  } else {
    document.getElementById('holdingModalTitle').textContent = '보유 종목 추가';
    document.getElementById('inputHoldingId').value = '';
  }

  updateHoldingModalPreview();
  showModal('holdingModal');
}

function closeHoldingModal() {
  hideModal('holdingModal');
}

function selectEtfPreset(ticker, name) {
  document.getElementById('inputTicker').value = ticker;
  document.getElementById('inputTickerName').value = name;
  const avgInput = document.getElementById('inputAvgPrice');
  if (!avgInput.value && KRX_ETF_CATALOG[ticker]) {
    avgInput.value = KRX_ETF_CATALOG[ticker].price;
  }
  updateHoldingModalPreview();
  document.getElementById('inputQuantity').focus();
}

function updateHoldingModalPreview() {
  const qty = Number(document.getElementById('inputQuantity').value) || 0;
  const avg = Number(document.getElementById('inputAvgPrice').value) || 0;
  document.getElementById('holdingModalPrincipalPreview').textContent = formatKRW(Math.round(qty * avg));
}

async function handleHoldingFormSubmit(e) {
  e.preventDefault();
  const holdingId = document.getElementById('inputHoldingId').value.trim();
  const accountId = document.getElementById('holdingAccountSelect').value;
  let ticker = document.getElementById('inputTicker').value.trim().toUpperCase();
  const tickerName = document.getElementById('inputTickerName').value.trim();
  const quantity = Number(document.getElementById('inputQuantity').value);
  const avgPrice = Number(document.getElementById('inputAvgPrice').value) || 0;

  // 숫자형 코드가 6자리 미만으로 입력된 경우 앞자리 0 패딩 보존
  if (/^\d+$/.test(ticker) && ticker.length <= 6) {
    ticker = ticker.padStart(6, '0');
  }

  if (!/^[0-9A-Z]{6}$/.test(ticker)) {
    showToast('종목코드는 6자리(예: 360750, 069500)로 입력해주세요.', 'error');
    return;
  }
  if (!quantity || quantity <= 0) {
    showToast('보유 수량은 0보다 커야 합니다.', 'error');
    return;
  }

  try {
    const res = await callApi('upsertHolding', {
      holding_id: holdingId,
      account_id: accountId,
      ticker,
      ticker_name: tickerName,
      quantity,
      avg_price: avgPrice
    }, 'PriceCache 시세 연동 및 보유 종목 저장 중...');

    if (!res || !res.success) {
      showToast((res && res.message) || '종목 저장 실패', 'error');
      return;
    }

    closeHoldingModal();
    showToast(res.message || '보유 종목이 저장되었습니다.', 'success');
    if (res.data) {
      applyDashboardData(res.data);
    } else {
      await loadDashboardData(false);
    }
  } catch (err) {
    showToast(err.message || '종목 저장 중 오류 발생', 'error');
  }
}

async function confirmDeleteHolding(holdingId, tickerName) {
  const ok = window.confirm(`[${tickerName}] 종목을 보유 목록에서 삭제하시겠습니까?`);
  if (!ok) return;

  try {
    const res = await callApi('deleteHolding', { holding_id: holdingId }, '보유 종목 삭제 중...');
    if (!res || !res.success) {
      showToast((res && res.message) || '종목 삭제 실패', 'error');
      return;
    }
    showToast(res.message || '종목이 삭제되었습니다.', 'info');
    if (res.data) {
      applyDashboardData(res.data);
    } else {
      await loadDashboardData(false);
    }
  } catch (err) {
    showToast(err.message || '종목 삭제 중 오류 발생', 'error');
  }
}

/* ============================================================================
 * 9. 수동 스냅샷 ([지금 스냅샷 찍기])
 * ============================================================================ */

async function triggerManualSnapshot() {
  if (!state.session) return;
  try {
    const res = await callApi('manualSnapshot', {}, '오늘 자 자산 스냅샷을 계산하여 기록하는 중...');
    if (!res || !res.success) {
      showToast((res && res.message) || '스냅샷 기록 실패', 'error');
      return;
    }
    showToast(res.message || '오늘 자 스냅샷이 기록되었습니다.', 'success');
    if (res.data) {
      applyDashboardData(res.data);
    } else {
      await loadDashboardData(false);
    }
  } catch (err) {
    showToast(err.message || '스냅샷 기록 중 오류 발생', 'error');
  }
}

/* ============================================================================
 * 10. API 설정 모달 및 로컬 데모 모드
 * ============================================================================ */

function openSettingsModal() {
  document.getElementById('inputGasUrl').value = getConfiguredGasUrl();
  document.getElementById('chkDemoMode').checked = isDemoMode();
  showModal('settingsModal');
}

function closeSettingsModal() {
  hideModal('settingsModal');
}

async function handleSettingsFormSubmit(e) {
  e.preventDefault();
  const url = document.getElementById('inputGasUrl').value.trim();
  const demo = document.getElementById('chkDemoMode').checked;

  localStorage.setItem(STORAGE_KEYS.GAS_URL, url);
  localStorage.setItem(STORAGE_KEYS.DEMO_MODE, demo ? 'true' : 'false');

  updateConnectionStatusUI();
  closeSettingsModal();
  showToast(demo ? '로컬 데모 모드로 설정되었습니다.' : 'Google Apps Script URL 설정이 저장되었습니다.', 'success');

  if (state.session) {
    await loadDashboardData(false);
  }
}

async function testGasConnection() {
  const url = document.getElementById('inputGasUrl').value.trim();
  if (!url) {
    showToast('테스트할 Google Apps Script 웹 앱 URL을 입력해주세요.', 'error');
    return;
  }

  showLoader('연결 테스트 중...', 'GAS 서버에 Ping 요청을 보내고 있습니다');
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'ping' }),
      redirect: 'follow'
    });
    const data = await response.json();
    if (data && data.success) {
      showToast(`연결 성공! 서버 시각: ${data.serverTime || '정상'}`, 'success');
    } else {
      showToast('응답은 수신되었으나 예상 포맷이 아닙니다.', 'error');
    }
  } catch (err) {
    showToast('연결 실패: URL 또는 웹 앱 배포 권한(Anyone)을 확인해주세요.', 'error');
  } finally {
    hideLoader();
  }
}

async function enableDemoModeAndLogin() {
  localStorage.setItem(STORAGE_KEYS.DEMO_MODE, 'true');
  ensureDemoDatabaseSeeded();
  const demoHash = await sha256('demo1234');
  saveSession({ user_id: 'demo', token: demoHash });
  updateConnectionStatusUI();
  showDashboardView();
  await loadDashboardData(false);
  showToast('샘플 연금 포트폴리오(데모 모드)로 로그인되었습니다.', 'success');
}

/* ============================================================================
 * 로컬 데모 데이터베이스 엔진 (GAS 배포 전 즉시 테스트용)
 * ============================================================================ */

function ensureDemoDatabaseSeeded() {
  const existing = localStorage.getItem(STORAGE_KEYS.DEMO_DB);
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && Array.isArray(parsed.accounts)) return parsed;
    } catch (_) {}
  }

  const today = getTodayKstString();
  const pastDates = [];
  for (let i = 14; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    pastDates.push(formatDateYmd(d));
  }

  const acc1 = 'acc-pension-1';
  const acc2 = 'acc-irp-1';

  const snapshots = [];
  pastDates.forEach((dateStr, idx) => {
    const growthFactor = 1 + (idx - 7) * 0.004;
    const eval1 = Math.round(14500000 * growthFactor);
    const cash1 = 1500000;
    const eval2 = Math.round(8200000 * growthFactor);
    const cash2 = 800000;

    snapshots.push({
      snapshot_id: `snap-1-${idx}`,
      date: dateStr,
      user_id: 'demo',
      account_id: acc1,
      eval_amount: eval1,
      cash_amount: cash1,
      total_asset: eval1 + cash1
    });
    snapshots.push({
      snapshot_id: `snap-2-${idx}`,
      date: dateStr,
      user_id: 'demo',
      account_id: acc2,
      eval_amount: eval2,
      cash_amount: cash2,
      total_asset: eval2 + cash2
    });
    snapshots.push({
      snapshot_id: `snap-all-${idx}`,
      date: dateStr,
      user_id: 'demo',
      account_id: 'ALL',
      eval_amount: eval1 + eval2,
      cash_amount: cash1 + cash2,
      total_asset: eval1 + cash1 + eval2 + cash2
    });
  });

  const seeded = {
    users: [{ user_id: 'demo', password_hash: '', created_at: today }],
    accounts: [
      { account_id: acc1, user_id: 'demo', account_name: '미래에셋 연금저축1', cash_balance: 1500000, created_at: today },
      { account_id: acc2, user_id: 'demo', account_name: '삼성증권 IRP', cash_balance: 800000, created_at: today }
    ],
    holdings: [
      { holding_id: 'hold-1', account_id: acc1, user_id: 'demo', ticker: '360750', ticker_name: 'TIGER 미국S&P500', quantity: 450, avg_price: 17200 },
      { holding_id: 'hold-2', account_id: acc1, user_id: 'demo', ticker: '133690', ticker_name: 'TIGER 미국나스닥100', quantity: 50, avg_price: 105000 },
      { holding_id: 'hold-3', account_id: acc2, user_id: 'demo', ticker: '458730', ticker_name: 'TIGER 미국배당다우존스', quantity: 400, avg_price: 11100 },
      { holding_id: 'hold-4', account_id: acc2, user_id: 'demo', ticker: '069500', ticker_name: 'KODEX 200', quantity: 100, avg_price: 34200 }
    ],
    price_cache: { ...KRX_ETF_CATALOG },
    snapshots
  };

  localStorage.setItem(STORAGE_KEYS.DEMO_DB, JSON.stringify(seeded));
  return seeded;
}

function handleDemoApiRequest(payload) {
  const db = ensureDemoDatabaseSeeded();
  const action = payload.action;
  const userId = String(payload.user_id || 'demo').trim();

  if (action === 'register' || action === 'login') {
    return {
      success: true,
      message: action === 'register' ? '데모 계정이 생성되었습니다.' : '데모 모드로 로그인되었습니다.',
      data: { user_id: userId, token: payload.password_hash || 'demo-token' }
    };
  }

  if (action === 'addAccount') {
    const newId = 'acc-' + Date.now();
    db.accounts.push({
      account_id: newId,
      user_id: userId,
      account_name: payload.account_name,
      cash_balance: Number(payload.cash_balance) || 0,
      created_at: new Date().toISOString()
    });
    saveDemoDb(db);
    return { success: true, message: '계좌가 추가되었습니다.', data: buildDemoDashboard(db, userId) };
  }

  if (action === 'deleteAccount') {
    db.accounts = db.accounts.filter((a) => !(a.account_id === payload.account_id && a.user_id === userId));
    db.holdings = db.holdings.filter((h) => !(h.account_id === payload.account_id && h.user_id === userId));
    db.snapshots = db.snapshots.filter((s) => !(s.account_id === payload.account_id && s.user_id === userId));
    saveDemoDb(db);
    return { success: true, message: '계좌와 하위 종목이 삭제되었습니다.', data: buildDemoDashboard(db, userId) };
  }

  if (action === 'updateCash') {
    const acc = db.accounts.find((a) => a.account_id === payload.account_id && a.user_id === userId);
    if (!acc) return { success: false, message: '계좌를 찾을 수 없습니다.' };
    const amt = Number(payload.cash_balance) || 0;
    if (payload.mode === 'deposit') acc.cash_balance += amt;
    else if (payload.mode === 'withdraw') acc.cash_balance = Math.max(0, acc.cash_balance - amt);
    else acc.cash_balance = amt;
    saveDemoDb(db);
    return { success: true, message: '현금 잔액이 반영되었습니다.', data: buildDemoDashboard(db, userId) };
  }

  if (action === 'upsertHolding') {
    const ticker = String(payload.ticker).padStart(6, '0');
    const catalogItem = db.price_cache[ticker] || KRX_ETF_CATALOG[ticker] || {
      name: payload.ticker_name || `ETF ${ticker}`,
      price: Number(payload.avg_price) || 10000
    };
    db.price_cache[ticker] = catalogItem;

    const tickerName = payload.ticker_name || catalogItem.name;
    let target = db.holdings.find((h) =>
      payload.holding_id
        ? h.holding_id === payload.holding_id
        : h.account_id === payload.account_id && h.ticker === ticker && h.user_id === userId
    );

    if (target) {
      target.account_id = payload.account_id;
      target.ticker = ticker;
      target.ticker_name = tickerName;
      target.quantity = Number(payload.quantity);
      target.avg_price = Number(payload.avg_price) || 0;
    } else {
      db.holdings.push({
        holding_id: 'hold-' + Date.now(),
        account_id: payload.account_id,
        user_id: userId,
        ticker,
        ticker_name: tickerName,
        quantity: Number(payload.quantity),
        avg_price: Number(payload.avg_price) || 0
      });
    }
    saveDemoDb(db);
    return { success: true, message: '보유 종목이 저장되었습니다.', data: buildDemoDashboard(db, userId) };
  }

  if (action === 'deleteHolding') {
    db.holdings = db.holdings.filter((h) => h.holding_id !== payload.holding_id);
    saveDemoDb(db);
    return { success: true, message: '종목이 삭제되었습니다.', data: buildDemoDashboard(db, userId) };
  }

  if (action === 'manualSnapshot') {
    const today = getTodayKstString();
    const dash = buildDemoDashboard(db, userId);
    let allEval = 0;
    let allCash = 0;

    dash.accounts.forEach((acc) => {
      const accHoldings = dash.holdings.filter((h) => h.account_id === acc.account_id);
      const evalSum = accHoldings.reduce((s, h) => s + h.eval_amount, 0);
      const cashSum = Number(acc.cash_balance) || 0;
      allEval += evalSum;
      allCash += cashSum;
      upsertDemoSnapshot(db, today, userId, acc.account_id, evalSum, cashSum);
    });
    upsertDemoSnapshot(db, today, userId, 'ALL', allEval, allCash);
    saveDemoDb(db);
    return {
      success: true,
      message: `${today} 기준 자산 스냅샷이 기록되었습니다.`,
      data: buildDemoDashboard(db, userId)
    };
  }

  return {
    success: true,
    data: buildDemoDashboard(db, userId)
  };
}

function upsertDemoSnapshot(db, date, userId, accountId, evalAmount, cashAmount) {
  const existing = db.snapshots.find((s) => s.date === date && s.user_id === userId && s.account_id === accountId);
  if (existing) {
    existing.eval_amount = evalAmount;
    existing.cash_amount = cashAmount;
    existing.total_asset = evalAmount + cashAmount;
  } else {
    db.snapshots.push({
      snapshot_id: 'snap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      date,
      user_id: userId,
      account_id: accountId,
      eval_amount: evalAmount,
      cash_amount: cashAmount,
      total_asset: evalAmount + cashAmount
    });
  }
}

function buildDemoDashboard(db, userId) {
  let accounts = db.accounts.filter((a) => a.user_id === userId);
  let holdingsRaw = db.holdings.filter((h) => h.user_id === userId);
  let snapshots = db.snapshots.filter((s) => s.user_id === userId);

  // 만약 demo가 아닌 다른 아이디로 데모 로그인 시 기본 계좌가 없으면 demo 데이터를 복제 제공
  if (accounts.length === 0 && userId !== 'demo') {
    accounts = db.accounts.filter((a) => a.user_id === 'demo').map((a) => ({ ...a, user_id: userId }));
    holdingsRaw = db.holdings.filter((h) => h.user_id === 'demo').map((h) => ({ ...h, user_id: userId }));
    snapshots = db.snapshots.filter((s) => s.user_id === 'demo').map((s) => ({ ...s, user_id: userId }));
  }

  const holdings = holdingsRaw.map((h) => {
    const pInfo = db.price_cache[h.ticker] || KRX_ETF_CATALOG[h.ticker] || { price: h.avg_price, name: h.ticker_name };
    const currentPrice = pInfo.price > 0 ? pInfo.price : h.avg_price;
    const evalAmount = Math.round(h.quantity * currentPrice);
    const principalAmount = Math.round(h.quantity * h.avg_price);
    const profitAmount = evalAmount - principalAmount;
    const profitRate = principalAmount > 0 ? Number(((profitAmount / principalAmount) * 100).toFixed(2)) : 0;

    return {
      ...h,
      current_price: currentPrice,
      is_realtime_price: true,
      eval_amount: evalAmount,
      principal_amount: principalAmount,
      profit_amount: profitAmount,
      profit_rate: profitRate
    };
  });

  return {
    accounts,
    holdings,
    snapshots: snapshots.sort((a, b) => a.date.localeCompare(b.date)),
    price_map: db.price_cache,
    server_time: new Date().toISOString(),
    today_date: getTodayKstString()
  };
}

function saveDemoDb(db) {
  localStorage.setItem(STORAGE_KEYS.DEMO_DB, JSON.stringify(db));
}

/* ============================================================================
 * 공통 UI 헬퍼 (로더, 모달, 토스트, 포맷터)
 * ============================================================================ */

function showLoader(title = '처리 중...', sub = '잠시만 기다려주세요') {
  document.getElementById('loaderTitle').textContent = title;
  document.getElementById('loaderSub').textContent = sub;
  const loader = document.getElementById('globalLoader');
  loader.classList.remove('hidden');
  loader.classList.add('flex');
}

function hideLoader() {
  const loader = document.getElementById('globalLoader');
  loader.classList.add('hidden');
  loader.classList.remove('flex');
}

function showModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  el.classList.add('flex');
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
  el.classList.remove('flex');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');

  const styles = {
    success: 'bg-slate-900 text-white border-emerald-500/40',
    error: 'bg-rose-600 text-white border-rose-400',
    info: 'bg-slate-800 text-white border-slate-700'
  };

  const icons = {
    success: '<svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
    error: '<svg class="w-4 h-4 text-white shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
    info: '<svg class="w-4 h-4 text-indigo-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
  };

  toast.className = `toast-enter pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl border text-xs font-medium ${styles[type] || styles.info}`;
  toast.innerHTML = `
    ${icons[type] || icons.info}
    <span class="flex-1 leading-relaxed">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3400);
}

function formatKRW(val) {
  const num = Math.round(Number(val) || 0);
  return num.toLocaleString('ko-KR') + '원';
}

function formatNumber(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('ko-KR');
}

function formatCompactKRW(val) {
  const num = Number(val) || 0;
  const abs = Math.abs(num);
  if (abs >= 100000000) {
    return (num / 100000000).toFixed(1) + '억';
  }
  if (abs >= 10000) {
    return Math.round(num / 10000).toLocaleString('ko-KR') + '만';
  }
  return num.toLocaleString('ko-KR');
}

function getTodayKstString() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 3600000);
  return formatDateYmd(kst);
}

function formatDateYmd(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

