/**
 * ============================================================================
 * 연금 자산 관리 웹 앱 (Pension Asset Manager) - Google Apps Script Backend
 * ============================================================================
 * 
 * [초기 설정 방법]
 * 1. 구글 스프레드시트 생성 후 [확장 프로그램] -> [Apps Script]에 이 코드를 붙여넣습니다.
 * 2. 상단 함수 선택 드롭다운에서 `setupDatabase`를 선택하고 [실행]을 클릭합니다.
 * 3. 상단 함수 선택 드롭다운에서 `createDailyTrigger`를 선택하고 [실행]을 클릭합니다.
 * 4. 우측 상단 [배포] -> [새 배포] -> 유형: [웹 앱]
 *    - 다음 사용자 인증 정보로 실행(Execute as): 나(Me)
 *    - 액세스 권한이 있는 사용자(Who has access): 모든 사용자(Anyone)
 * 5. 발급된 웹 앱 URL을 프런트엔드(index.html / 설정 모달)에 입력합니다.
 */

const SHEET_NAMES = {
  USERS: 'Users',
  ACCOUNTS: 'Accounts',
  HOLDINGS: 'Holdings',
  PRICE_CACHE: 'PriceCache',
  SNAPSHOTS: 'Snapshots'
};

const TIMEZONE = 'Asia/Seoul';

// 자주 쓰이는 국내 상장 대표 연금 ETF 기본 사전 (GOOGLEFINANCE 이름 지연 시 폴백용)
const DEFAULT_KRX_ETF_NAMES = {
  '360750': 'TIGER 미국S&P500',
  '133690': 'TIGER 미국나스닥100',
  '069500': 'KODEX 200',
  '379800': 'KODEX 미국S&P500TR',
  '379810': 'KODEX 미국나스닥100TR',
  '381170': 'TIGER 미국테크TOP10 INDXX',
  '381180': 'TIGER 미국필라델피아반도체나스닥',
  '458730': 'TIGER 미국배당다우존스',
  '458760': 'TIGER 미국배당다우존스(H)',
  '441640': 'KODEX 미국배당프리미엄액티브',
  '446720': 'SOL 미국배당다우존스',
  '305540': 'TIGER 2차전지테마',
  '091160': 'KODEX 반도체',
  '453850': 'ACE 미국30년국채액티브(H)',
  '411060': 'ACE KRX금현물',
  '329750': 'TIGER 미국달러단기채권액티브',
  '459580': 'KODEX CD금리액티브(합성)',
  '423160': 'KODEX KOFR금리액티브(합성)'
};

/**
 * 1. 데이터베이스(시트 5개) 초기화 및 헤더 설정 함수
 * 최초 1회 수동 실행하거나 API 요청 시 시트가 없으면 자동 호출됩니다.
 */
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const schema = [
    {
      name: SHEET_NAMES.USERS,
      headers: ['user_id', 'password_hash', 'created_at'],
      textColumns: [1, 2],
      colWidths: [160, 420, 180]
    },
    {
      name: SHEET_NAMES.ACCOUNTS,
      headers: ['account_id', 'user_id', 'account_name', 'cash_balance', 'created_at'],
      textColumns: [1, 2, 3],
      colWidths: [280, 140, 180, 140, 180]
    },
    {
      name: SHEET_NAMES.HOLDINGS,
      headers: ['holding_id', 'account_id', 'user_id', 'ticker', 'ticker_name', 'quantity', 'avg_price'],
      textColumns: [1, 2, 3, 4, 5],
      colWidths: [280, 280, 140, 100, 220, 100, 120]
    },
    {
      name: SHEET_NAMES.PRICE_CACHE,
      headers: ['ticker', 'current_price', 'ticker_name'],
      textColumns: [1],
      colWidths: [120, 140, 240]
    },
    {
      name: SHEET_NAMES.SNAPSHOTS,
      headers: ['snapshot_id', 'date', 'user_id', 'account_id', 'eval_amount', 'cash_amount', 'total_asset'],
      textColumns: [1, 2, 3, 4],
      colWidths: [280, 120, 140, 280, 140, 140, 140]
    }
  ];

  schema.forEach(function(item) {
    let sheet = ss.getSheetByName(item.name);
    if (!sheet) {
      sheet = ss.insertSheet(item.name);
    }

    // 첫 행 헤더가 비어 있으면 헤더 입력 및 스타일 지정
    const firstRow = sheet.getRange(1, 1, 1, item.headers.length).getValues()[0];
    const isEmptyHeader = firstRow.every(function(cell) { return cell === '' || cell === null; });

    if (isEmptyHeader) {
      const headerRange = sheet.getRange(1, 1, 1, item.headers.length);
      headerRange.setValues([item.headers]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#0f172a');
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }

    // 문자열 포맷 유지가 필요한 컬럼('069500' 등 앞자리 0 보존)을 텍스트('@') 서식으로 설정
    const maxRows = Math.max(sheet.getMaxRows(), 100);
    item.textColumns.forEach(function(colIndex) {
      if (maxRows > 1) {
        sheet.getRange(2, colIndex, maxRows - 1, 1).setNumberFormat('@');
      }
    });

    // 컬럼 너비 보기 좋게 조정
    item.colWidths.forEach(function(width, idx) {
      sheet.setColumnWidth(idx + 1, width);
    });
  });

  // 기본 생성된 '시트1' 또는 'Sheet1'이 비어있다면 정리
  ['시트1', 'Sheet1'].forEach(function(defaultName) {
    const defaultSheet = ss.getSheetByName(defaultName);
    if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
      ss.deleteSheet(defaultSheet);
    }
  });

  SpreadsheetApp.flush();
  Logger.log('데이터베이스(5개 시트) 초기화가 완료되었습니다.');
  return { success: true, message: '데이터베이스 시트 5개 설정 완료' };
}

/**
 * 2. 매일 오후 5시(17:00~18:00 KST) 자동 스냅샷 트리거 등록 함수
 * 최초 1회 Apps Script 에디터에서 실행하세요.
 */
function createDailyTrigger() {
  const handlerName = 'takeDailySnapshot';
  const existingTriggers = ScriptApp.getProjectTriggers();

  // 중복 방지를 위해 기존 동일 핸들러 트리거 제거
  existingTriggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 매일 오후 5시 (17:00 ~ 18:00 KST) 실행 트리거 생성
  ScriptApp.newTrigger(handlerName)
    .timeBased()
    .everyDays(1)
    .atHour(17)
    .inTimezone(TIMEZONE)
    .create();

  Logger.log('매일 오후 5시(17:00~18:00 KST) 자동 스냅샷 트리거가 등록되었습니다.');
  return { success: true, message: '매일 17시 자동 스냅샷 트리거 등록 완료' };
}

/**
 * 웹 앱 상태 확인용 GET 핸들러 (브라우저에서 URL 직접 접속 시 확인용)
 */
function doGet(e) {
  return createJsonResponse({
    success: true,
    status: 'OK',
    service: 'Pension Asset Manager API (Google Apps Script)',
    timestamp: getNowIsoString(),
    message: 'API 서버가 정상 작동 중입니다. 프런트엔드 웹 앱에서 이 URL을 연결해 사용하세요.'
  });
}

/**
 * 3. 메인 API 라우터 (CORS Preflight 우회를 위해 text/plain POST JSON 수신)
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ success: false, message: '요청 본문(payload)이 비어 있습니다.' });
    }

    const payload = JSON.parse(e.postData.contents);
    const action = String(payload.action || '').trim();

    // 시트가 아직 생성되지 않은 경우 자동으로 초기화
    ensureDatabaseReady();

    switch (action) {
      case 'ping':
        return createJsonResponse({
          success: true,
          message: '연결 성공',
          serverTime: getNowIsoString()
        });

      case 'register':
        return createJsonResponse(handleRegister(payload));

      case 'login':
        return createJsonResponse(handleLogin(payload));

      case 'getDashboardData':
        return createJsonResponse(handleGetDashboardData(payload));

      case 'addAccount':
        return createJsonResponse(handleAddAccount(payload));

      case 'deleteAccount':
        return createJsonResponse(handleDeleteAccount(payload));

      case 'updateCash':
        return createJsonResponse(handleUpdateCash(payload));

      case 'upsertHolding':
        return createJsonResponse(handleUpsertHolding(payload));

      case 'deleteHolding':
        return createJsonResponse(handleDeleteHolding(payload));

      case 'manualSnapshot':
        return createJsonResponse(handleManualSnapshot(payload));

      default:
        return createJsonResponse({
          success: false,
          message: '알 수 없는 액션입니다: ' + action
        });
    }
  } catch (err) {
    return createJsonResponse({
      success: false,
      message: '서버 처리 중 오류가 발생했습니다: ' + (err && err.message ? err.message : String(err))
    });
  }
}

/* ============================================================================
 * 액션 핸들러 구현부
 * ============================================================================ */

/**
 * 회원가입 (Users 시트에 user_id, password_hash, created_at 저장)
 */
function handleRegister(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const userId = String(payload.user_id || '').trim();
    const passwordHash = resolvePasswordHash(payload);

    if (!userId || userId.length < 2) {
      return { success: false, message: '아이디는 2자 이상 입력해주세요.' };
    }
    if (!passwordHash) {
      return { success: false, message: '비밀번호 정보가 올바르지 않습니다.' };
    }

    const usersSheet = getSheet(SHEET_NAMES.USERS);
    const rows = getSheetDataRows(usersSheet);

    const exists = rows.some(function(row) {
      return String(row[0]).trim().toLowerCase() === userId.toLowerCase();
    });

    if (exists) {
      return { success: false, message: '이미 사용 중인 아이디입니다. 다른 아이디를 선택해주세요.' };
    }

    const createdAt = getNowIsoString();
    const nextRow = usersSheet.getLastRow() + 1;
    usersSheet.getRange(nextRow, 1, 1, 2).setNumberFormat('@');
    usersSheet.getRange(nextRow, 1, 1, 3).setValues([[userId, passwordHash, createdAt]]);
    SpreadsheetApp.flush();

    return {
      success: true,
      message: '회원가입이 완료되었습니다.',
      data: {
        user_id: userId,
        token: passwordHash,
        created_at: createdAt
      }
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 로그인 검증
 */
function handleLogin(payload) {
  const userId = String(payload.user_id || '').trim();
  const passwordHash = resolvePasswordHash(payload);

  if (!userId || !passwordHash) {
    return { success: false, message: '아이디와 비밀번호를 입력해주세요.' };
  }

  const authUser = verifyUserCredentials(userId, passwordHash);
  if (!authUser) {
    return { success: false, message: '아이디 또는 비밀번호가 일치하지 않습니다.' };
  }

  return {
    success: true,
    message: '로그인되었습니다.',
    data: {
      user_id: authUser.user_id,
      token: authUser.password_hash,
      created_at: authUser.created_at
    }
  };
}

/**
 * 대시보드 전체 데이터 조회
 */
function handleGetDashboardData(payload) {
  const auth = authenticateRequest(payload);
  if (!auth.ok) return auth.response;

  const dashboard = buildUserDashboardData(auth.user.user_id);
  return {
    success: true,
    data: dashboard
  };
}

/**
 * 계좌 추가
 */
function handleAddAccount(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const auth = authenticateRequest(payload);
    if (!auth.ok) return auth.response;

    const userId = auth.user.user_id;
    const accountName = String(payload.account_name || '').trim();
    const cashBalance = parseSafeNumber(payload.cash_balance, 0);

    if (!accountName) {
      return { success: false, message: '계좌명을 입력해주세요.' };
    }
    if (cashBalance < 0) {
      return { success: false, message: '보유 현금은 0원 이상이어야 합니다.' };
    }

    const accountsSheet = getSheet(SHEET_NAMES.ACCOUNTS);
    const accountId = Utilities.getUuid();
    const createdAt = getNowIsoString();

    const nextRow = accountsSheet.getLastRow() + 1;
    accountsSheet.getRange(nextRow, 1, 1, 3).setNumberFormat('@');
    accountsSheet.getRange(nextRow, 1, 1, 5).setValues([[
      accountId,
      userId,
      accountName,
      cashBalance,
      createdAt
    ]]);
    SpreadsheetApp.flush();

    const dashboard = buildUserDashboardData(userId);
    return {
      success: true,
      message: '계좌가 추가되었습니다.',
      account_id: accountId,
      data: dashboard
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 계좌 삭제 (하위 보유 종목 및 해당 계좌 스냅샷도 함께 정리)
 */
function handleDeleteAccount(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const auth = authenticateRequest(payload);
    if (!auth.ok) return auth.response;

    const userId = auth.user.user_id;
    const accountId = String(payload.account_id || '').trim();

    if (!accountId) {
      return { success: false, message: '삭제할 계좌 ID가 없습니다.' };
    }

    const accountsSheet = getSheet(SHEET_NAMES.ACCOUNTS);
    const accValues = accountsSheet.getDataRange().getValues();
    let foundAccount = false;

    for (let i = accValues.length - 1; i >= 1; i--) {
      if (String(accValues[i][0]).trim() === accountId && String(accValues[i][1]).trim() === userId) {
        accountsSheet.deleteRow(i + 1);
        foundAccount = true;
      }
    }

    if (!foundAccount) {
      return { success: false, message: '해당 계좌를 찾을 수 없거나 삭제 권한이 없습니다.' };
    }

    // 하위 보유 종목 삭제
    const holdingsSheet = getSheet(SHEET_NAMES.HOLDINGS);
    const holdValues = holdingsSheet.getDataRange().getValues();
    for (let i = holdValues.length - 1; i >= 1; i--) {
      if (String(holdValues[i][1]).trim() === accountId && String(holdValues[i][2]).trim() === userId) {
        holdingsSheet.deleteRow(i + 1);
      }
    }

    // 해당 계좌 개별 스냅샷 정리
    const snapshotsSheet = getSheet(SHEET_NAMES.SNAPSHOTS);
    const snapValues = snapshotsSheet.getDataRange().getValues();
    for (let i = snapValues.length - 1; i >= 1; i--) {
      if (String(snapValues[i][2]).trim() === userId && String(snapValues[i][3]).trim() === accountId) {
        snapshotsSheet.deleteRow(i + 1);
      }
    }

    SpreadsheetApp.flush();
    const dashboard = buildUserDashboardData(userId);
    return {
      success: true,
      message: '계좌와 하위 보유 종목이 삭제되었습니다.',
      data: dashboard
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 계좌별 현금(예수금) 수정 / 입출금 반영
 */
function handleUpdateCash(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const auth = authenticateRequest(payload);
    if (!auth.ok) return auth.response;

    const userId = auth.user.user_id;
    const accountId = String(payload.account_id || '').trim();
    const mode = String(payload.mode || 'set').trim(); // 'set' | 'deposit' | 'withdraw'
    const inputAmount = parseSafeNumber(payload.cash_balance !== undefined ? payload.cash_balance : payload.amount, NaN);

    if (!accountId) {
      return { success: false, message: '계좌를 선택해주세요.' };
    }
    if (isNaN(inputAmount)) {
      return { success: false, message: '유효한 금액을 입력해주세요.' };
    }

    const accountsSheet = getSheet(SHEET_NAMES.ACCOUNTS);
    const accValues = accountsSheet.getDataRange().getValues();
    let updated = false;
    let newBalance = 0;

    for (let i = 1; i < accValues.length; i++) {
      if (String(accValues[i][0]).trim() === accountId && String(accValues[i][1]).trim() === userId) {
        const currentCash = parseSafeNumber(accValues[i][3], 0);
        if (mode === 'deposit') {
          newBalance = currentCash + inputAmount;
        } else if (mode === 'withdraw') {
          newBalance = currentCash - inputAmount;
        } else {
          newBalance = inputAmount;
        }

        if (newBalance < 0) {
          return { success: false, message: '현금 잔액은 0원 미만이 될 수 없습니다.' };
        }

        accountsSheet.getRange(i + 1, 4).setValue(newBalance);
        updated = true;
        break;
      }
    }

    if (!updated) {
      return { success: false, message: '대상 계좌를 찾을 수 없습니다.' };
    }

    SpreadsheetApp.flush();
    const dashboard = buildUserDashboardData(userId);
    return {
      success: true,
      message: '현금 보유액이 반영되었습니다.',
      data: dashboard
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 보유 종목 추가 또는 수정 (PriceCache 자동 등록 및 최신 현재가 즉시 반영)
 */
function handleUpsertHolding(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const auth = authenticateRequest(payload);
    if (!auth.ok) return auth.response;

    const userId = auth.user.user_id;
    const holdingIdInput = String(payload.holding_id || '').trim();
    const accountId = String(payload.account_id || '').trim();
    const ticker = normalizeTicker(payload.ticker);
    let tickerName = String(payload.ticker_name || '').trim();
    const quantity = parseSafeNumber(payload.quantity, NaN);
    const avgPrice = parseSafeNumber(payload.avg_price, 0);

    if (!accountId) {
      return { success: false, message: '종목을 등록할 계좌를 선택해주세요.' };
    }
    if (!ticker || !/^[0-9A-Za-z]{6}$/.test(ticker)) {
      return { success: false, message: '종목코드는 6자리(예: 360750, 069500)로 입력해주세요.' };
    }
    if (isNaN(quantity) || quantity <= 0) {
      return { success: false, message: '보유 수량은 0보다 큰 숫자로 입력해주세요.' };
    }
    if (avgPrice < 0) {
      return { success: false, message: '매수 평단가는 0원 이상이어야 합니다.' };
    }

    // 계좌 소유권 확인
    const accountsSheet = getSheet(SHEET_NAMES.ACCOUNTS);
    const accRows = getSheetDataRows(accountsSheet);
    const ownsAccount = accRows.some(function(r) {
      return String(r[0]).trim() === accountId && String(r[1]).trim() === userId;
    });
    if (!ownsAccount) {
      return { success: false, message: '유효하지 않은 계좌입니다.' };
    }

    // PriceCache에 종목 등록 보장 및 시세/종목명 조회
    const cachedInfo = ensureTickerInPriceCache(ticker);
    if (!tickerName) {
      tickerName = cachedInfo.name || DEFAULT_KRX_ETF_NAMES[ticker] || ('ETF ' + ticker);
    }

    const holdingsSheet = getSheet(SHEET_NAMES.HOLDINGS);
    const holdValues = holdingsSheet.getDataRange().getValues();
    let targetRowIndex = -1;
    let finalHoldingId = holdingIdInput;

    // 1) holding_id가 지정된 경우 해당 행 탐색
    if (holdingIdInput) {
      for (let i = 1; i < holdValues.length; i++) {
        if (String(holdValues[i][0]).trim() === holdingIdInput && String(holdValues[i][2]).trim() === userId) {
          targetRowIndex = i + 1;
          break;
        }
      }
    } else {
      // 2) 신규 추가 시 같은 계좌에 동일 종목코드가 이미 있으면 해당 행 업데이트
      for (let i = 1; i < holdValues.length; i++) {
        const rowAccountId = String(holdValues[i][1]).trim();
        const rowUserId = String(holdValues[i][2]).trim();
        const rowTicker = normalizeTicker(holdValues[i][3]);
        if (rowAccountId === accountId && rowUserId === userId && rowTicker === ticker) {
          targetRowIndex = i + 1;
          finalHoldingId = String(holdValues[i][0]).trim();
          break;
        }
      }
    }

    if (targetRowIndex > 0) {
      holdingsSheet.getRange(targetRowIndex, 1, 1, 5).setNumberFormat('@');
      holdingsSheet.getRange(targetRowIndex, 1, 1, 7).setValues([[
        finalHoldingId,
        accountId,
        userId,
        ticker,
        tickerName,
        quantity,
        avgPrice
      ]]);
    } else {
      finalHoldingId = Utilities.getUuid();
      const nextRow = holdingsSheet.getLastRow() + 1;
      holdingsSheet.getRange(nextRow, 1, 1, 5).setNumberFormat('@');
      holdingsSheet.getRange(nextRow, 1, 1, 7).setValues([[
        finalHoldingId,
        accountId,
        userId,
        ticker,
        tickerName,
        quantity,
        avgPrice
      ]]);
    }

    SpreadsheetApp.flush();
    const dashboard = buildUserDashboardData(userId);
    return {
      success: true,
      message: '보유 종목 정보가 저장되었습니다.',
      holding_id: finalHoldingId,
      data: dashboard
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 보유 종목 삭제
 */
function handleDeleteHolding(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const auth = authenticateRequest(payload);
    if (!auth.ok) return auth.response;

    const userId = auth.user.user_id;
    const holdingId = String(payload.holding_id || '').trim();

    if (!holdingId) {
      return { success: false, message: '삭제할 종목 ID가 없습니다.' };
    }

    const holdingsSheet = getSheet(SHEET_NAMES.HOLDINGS);
    const holdValues = holdingsSheet.getDataRange().getValues();
    let deleted = false;

    for (let i = holdValues.length - 1; i >= 1; i--) {
      if (String(holdValues[i][0]).trim() === holdingId && String(holdValues[i][2]).trim() === userId) {
        holdingsSheet.deleteRow(i + 1);
        deleted = true;
        break;
      }
    }

    if (!deleted) {
      return { success: false, message: '삭제할 종목을 찾을 수 없습니다.' };
    }

    SpreadsheetApp.flush();
    const dashboard = buildUserDashboardData(userId);
    return {
      success: true,
      message: '보유 종목이 삭제되었습니다.',
      data: dashboard
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 수동 스냅샷 즉시 기록 핸들러 ([지금 스냅샷 찍기] 버튼용)
 */
function handleManualSnapshot(payload) {
  const auth = authenticateRequest(payload);
  if (!auth.ok) return auth.response;

  const userId = auth.user.user_id;
  const snapResult = takeDailySnapshot(userId);
  const dashboard = buildUserDashboardData(userId);

  return {
    success: true,
    message: snapResult.date + ' 기준 자산 스냅샷이 기록되었습니다.',
    snapshot: snapResult,
    data: dashboard
  };
}

/**
 * 4. 일별 자산 스냅샷 기록 함수 (매일 17시 자동 트리거 및 수동 스냅샷 겸용)
 * @param {string|Object} targetUserIdOrEvent - 특정 user_id 문자열 또는 GAS 트리거 이벤트 객체
 */
function takeDailySnapshot(targetUserIdOrEvent) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    ensureDatabaseReady();

    // GAS 트리거에서 실행될 때는 첫 인자로 이벤트 객체가 전달되므로 문자열 여부 확인
    const filterUserId = (typeof targetUserIdOrEvent === 'string' && targetUserIdOrEvent.trim() !== '')
      ? targetUserIdOrEvent.trim()
      : null;

    const todayStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');

    const usersSheet = getSheet(SHEET_NAMES.USERS);
    const accountsSheet = getSheet(SHEET_NAMES.ACCOUNTS);
    const holdingsSheet = getSheet(SHEET_NAMES.HOLDINGS);
    const snapshotsSheet = getSheet(SHEET_NAMES.SNAPSHOTS);

    const userRows = getSheetDataRows(usersSheet);
    const accountRows = getSheetDataRows(accountsSheet);
    const holdingRows = getSheetDataRows(holdingsSheet);

    // Holdings의 모든 종목코드가 PriceCache에 존재하는지 확인 및 시세 맵 로드
    const allTickers = [];
    holdingRows.forEach(function(r) {
      const t = normalizeTicker(r[3]);
      if (t && allTickers.indexOf(t) === -1) {
        allTickers.push(t);
      }
    });
    const priceMap = syncAndLoadPriceMap(allTickers);

    // 대상 사용자 목록 추출
    const targetUsers = [];
    if (filterUserId) {
      targetUsers.push(filterUserId);
    } else {
      userRows.forEach(function(r) {
        const uid = String(r[0] || '').trim();
        if (uid && targetUsers.indexOf(uid) === -1) {
          targetUsers.push(uid);
        }
      });
    }

    // 스냅샷 upsert할 레코드 배열 구성: { date, user_id, account_id, eval_amount, cash_amount, total_asset }
    const recordsToUpsert = [];

    targetUsers.forEach(function(uid) {
      const userAccounts = accountRows.filter(function(r) {
        return String(r[1]).trim() === uid;
      });
      const userHoldings = holdingRows.filter(function(r) {
        return String(r[2]).trim() === uid;
      });

      let totalUserEval = 0;
      let totalUserCash = 0;

      userAccounts.forEach(function(accRow) {
        const accId = String(accRow[0]).trim();
        const cashAmount = Math.round(parseSafeNumber(accRow[3], 0));

        // 해당 계좌의 보유 종목 평가금액 합산
        let accEvalAmount = 0;
        userHoldings.forEach(function(hRow) {
          if (String(hRow[1]).trim() === accId) {
            const ticker = normalizeTicker(hRow[3]);
            const qty = parseSafeNumber(hRow[5], 0);
            const avgPrice = parseSafeNumber(hRow[6], 0);
            const cachedPrice = (priceMap[ticker] && priceMap[ticker].price > 0)
              ? priceMap[ticker].price
              : avgPrice;
            accEvalAmount += Math.round(qty * cachedPrice);
          }
        });

        const accTotalAsset = accEvalAmount + cashAmount;
        totalUserEval += accEvalAmount;
        totalUserCash += cashAmount;

        recordsToUpsert.push({
          date: todayStr,
          user_id: uid,
          account_id: accId,
          eval_amount: accEvalAmount,
          cash_amount: cashAmount,
          total_asset: accTotalAsset
        });
      });

      // 사용자 전체 합산 스냅샷 (account_id: "ALL") 기록
      recordsToUpsert.push({
        date: todayStr,
        user_id: uid,
        account_id: 'ALL',
        eval_amount: totalUserEval,
        cash_amount: totalUserCash,
        total_asset: totalUserEval + totalUserCash
      });
    });

    // Snapshots 시트에서 동일 (date, user_id, account_id) 존재 시 덮어쓰기, 없으면 추가
    const snapValues = snapshotsSheet.getDataRange().getValues();
    recordsToUpsert.forEach(function(rec) {
      let matchedRowIndex = -1;
      let existingSnapId = '';

      for (let i = 1; i < snapValues.length; i++) {
        const rowDate = normalizeDateCell(snapValues[i][1]);
        const rowUser = String(snapValues[i][2]).trim();
        const rowAcc = String(snapValues[i][3]).trim();

        if (rowDate === rec.date && rowUser === rec.user_id && rowAcc === rec.account_id) {
          matchedRowIndex = i + 1;
          existingSnapId = String(snapValues[i][0]).trim() || Utilities.getUuid();
          break;
        }
      }

      if (matchedRowIndex > 0) {
        snapshotsSheet.getRange(matchedRowIndex, 1, 1, 4).setNumberFormat('@');
        snapshotsSheet.getRange(matchedRowIndex, 1, 1, 7).setValues([[
          existingSnapId,
          rec.date,
          rec.user_id,
          rec.account_id,
          rec.eval_amount,
          rec.cash_amount,
          rec.total_asset
        ]]);
      } else {
        const newSnapId = Utilities.getUuid();
        const nextRow = snapshotsSheet.getLastRow() + 1;
        snapshotsSheet.getRange(nextRow, 1, 1, 4).setNumberFormat('@');
        snapshotsSheet.getRange(nextRow, 1, 1, 7).setValues([[
          newSnapId,
          rec.date,
          rec.user_id,
          rec.account_id,
          rec.eval_amount,
          rec.cash_amount,
          rec.total_asset
        ]]);
        // 메모리 배열에도 반영하여 중복 방지
        snapValues.push([
          newSnapId,
          rec.date,
          rec.user_id,
          rec.account_id,
          rec.eval_amount,
          rec.cash_amount,
          rec.total_asset
        ]);
      }
    });

    SpreadsheetApp.flush();
    return {
      success: true,
      date: todayStr,
      updatedCount: recordsToUpsert.length
    };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================================
 * 내부 유틸리티 및 데이터 조합 함수
 * ============================================================================ */

/**
 * 특정 사용자의 대시보드 전체 데이터를 조합하여 반환
 */
function buildUserDashboardData(userId) {
  const accountsSheet = getSheet(SHEET_NAMES.ACCOUNTS);
  const holdingsSheet = getSheet(SHEET_NAMES.HOLDINGS);
  const snapshotsSheet = getSheet(SHEET_NAMES.SNAPSHOTS);

  const accountRows = getSheetDataRows(accountsSheet);
  const holdingRows = getSheetDataRows(holdingsSheet);
  const snapshotRows = getSheetDataRows(snapshotsSheet);

  // 사용자 계좌 필터링
  const accounts = accountRows
    .filter(function(r) { return String(r[1]).trim() === userId; })
    .map(function(r) {
      return {
        account_id: String(r[0]).trim(),
        user_id: String(r[1]).trim(),
        account_name: String(r[2]).trim(),
        cash_balance: Math.round(parseSafeNumber(r[3], 0)),
        created_at: String(r[4] || '')
      };
    });

  // 사용자 보유 종목 필터링 및 종목코드 수집
  const userHoldingRows = holdingRows.filter(function(r) {
    return String(r[2]).trim() === userId;
  });

  const userTickers = [];
  userHoldingRows.forEach(function(r) {
    const t = normalizeTicker(r[3]);
    if (t && userTickers.indexOf(t) === -1) {
      userTickers.push(t);
    }
  });

  // PriceCache 동기화 및 현재가 맵 조회
  const priceMap = syncAndLoadPriceMap(userTickers);

  // 보유 종목 리스트 및 평가금액 계산
  const holdings = userHoldingRows.map(function(r) {
    const holdingId = String(r[0]).trim();
    const accountId = String(r[1]).trim();
    const ticker = normalizeTicker(r[3]);
    const sheetTickerName = String(r[4] || '').trim();
    const quantity = parseSafeNumber(r[5], 0);
    const avgPrice = parseSafeNumber(r[6], 0);

    const cacheEntry = priceMap[ticker] || { price: 0, name: '' };
    // GOOGLEFINANCE가 일시적으로 0을 반환할 경우 평단가를 폴백 현재가로 사용하되 상태 표시
    const currentPrice = cacheEntry.price > 0 ? cacheEntry.price : avgPrice;
    const isRealtimePrice = cacheEntry.price > 0;
    const tickerName = sheetTickerName || cacheEntry.name || DEFAULT_KRX_ETF_NAMES[ticker] || ('ETF ' + ticker);

    const evalAmount = Math.round(quantity * currentPrice);
    const principalAmount = Math.round(quantity * avgPrice);
    const profitAmount = evalAmount - principalAmount;
    const profitRate = principalAmount > 0 ? ((profitAmount / principalAmount) * 100) : 0;

    return {
      holding_id: holdingId,
      account_id: accountId,
      user_id: userId,
      ticker: ticker,
      ticker_name: tickerName,
      quantity: quantity,
      avg_price: avgPrice,
      current_price: currentPrice,
      is_realtime_price: isRealtimePrice,
      eval_amount: evalAmount,
      principal_amount: principalAmount,
      profit_amount: profitAmount,
      profit_rate: Number(profitRate.toFixed(2))
    };
  });

  // 스냅샷 필터링 및 날짜 오름차순 정렬
  const snapshots = snapshotRows
    .filter(function(r) { return String(r[2]).trim() === userId; })
    .map(function(r) {
      return {
        snapshot_id: String(r[0]).trim(),
        date: normalizeDateCell(r[1]),
        user_id: String(r[2]).trim(),
        account_id: String(r[3]).trim(),
        eval_amount: Math.round(parseSafeNumber(r[4], 0)),
        cash_amount: Math.round(parseSafeNumber(r[5], 0)),
        total_asset: Math.round(parseSafeNumber(r[6], 0))
      };
    })
    .filter(function(s) { return !!s.date; })
    .sort(function(a, b) {
      return a.date.localeCompare(b.date);
    });

  return {
    accounts: accounts,
    holdings: holdings,
    snapshots: snapshots,
    price_map: priceMap,
    server_time: getNowIsoString(),
    today_date: Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd')
  };
}

/**
 * PriceCache 시트에 특정 종목코드가 없으면 추가하고 현재가/종목명 정보를 반환
 */
function ensureTickerInPriceCache(ticker) {
  const cleanTicker = normalizeTicker(ticker);
  const priceMap = syncAndLoadPriceMap([cleanTicker]);
  return priceMap[cleanTicker] || { price: 0, name: DEFAULT_KRX_ETF_NAMES[cleanTicker] || '' };
}

/**
 * 필요한 종목코드 배열을 PriceCache 시트에 중복 없이 등록하고 전체 시세 맵을 반환
 */
function syncAndLoadPriceMap(requiredTickers) {
  const priceSheet = getSheet(SHEET_NAMES.PRICE_CACHE);
  let rows = getSheetDataRows(priceSheet);

  const existingTickers = {};
  rows.forEach(function(r) {
    const t = normalizeTicker(r[0]);
    if (t) existingTickers[t] = true;
  });

  let addedNew = false;
  (requiredTickers || []).forEach(function(t) {
    const clean = normalizeTicker(t);
    if (clean && !existingTickers[clean]) {
      const rowNum = priceSheet.getLastRow() + 1;
      priceSheet.getRange(rowNum, 1).setNumberFormat('@').setValue(clean);
      priceSheet.getRange(rowNum, 2).setFormula('=IFERROR(GOOGLEFINANCE("KRX:"&A' + rowNum + ', "price"), 0)');
      priceSheet.getRange(rowNum, 3).setFormula('=IFERROR(GOOGLEFINANCE("KRX:"&A' + rowNum + ', "name"), "")');
      existingTickers[clean] = true;
      addedNew = true;
    }
  });

  if (addedNew) {
    SpreadsheetApp.flush();
    // 신규 종목의 GOOGLEFINANCE 수식 계산을 위해 짧은 대기 후 재플러시
    Utilities.sleep(800);
    SpreadsheetApp.flush();
    rows = getSheetDataRows(priceSheet);
  }

  const priceMap = {};
  rows.forEach(function(r) {
    const t = normalizeTicker(r[0]);
    if (!t) return;
    const rawPrice = parseSafeNumber(r[1], 0);
    const rawName = String(r[2] || '').trim() || DEFAULT_KRX_ETF_NAMES[t] || '';
    priceMap[t] = {
      price: rawPrice > 0 ? rawPrice : 0,
      name: rawName
    };
  });

  return priceMap;
}

/**
 * 사용자 인증 확인 헬퍼
 */
function authenticateRequest(payload) {
  const userId = String(payload.user_id || '').trim();
  const token = resolvePasswordHash(payload);

  if (!userId || !token) {
    return {
      ok: false,
      response: { success: false, code: 'UNAUTHORIZED', message: '인증 정보가 없습니다. 다시 로그인해주세요.' }
    };
  }

  const user = verifyUserCredentials(userId, token);
  if (!user) {
    return {
      ok: false,
      response: { success: false, code: 'UNAUTHORIZED', message: '세션이 만료되었거나 인증 정보가 일치하지 않습니다.' }
    };
  }

  return { ok: true, user: user };
}

/**
 * Users 시트에서 아이디/해시 대조
 */
function verifyUserCredentials(userId, passwordHash) {
  const usersSheet = getSheet(SHEET_NAMES.USERS);
  const rows = getSheetDataRows(usersSheet);

  for (let i = 0; i < rows.length; i++) {
    const rowUserId = String(rows[i][0] || '').trim();
    const rowHash = String(rows[i][1] || '').trim().toLowerCase();
    if (rowUserId.toLowerCase() === userId.toLowerCase() && rowHash === passwordHash.toLowerCase()) {
      return {
        user_id: rowUserId,
        password_hash: rowHash,
        created_at: String(rows[i][2] || '')
      };
    }
  }
  return null;
}

/**
 * 프런트엔드가 password_hash(또는 token)를 보냈거나 평문 password를 보낸 경우 모두 SHA-256 해시로 정규화
 */
function resolvePasswordHash(payload) {
  const hashCandidate = String(payload.password_hash || payload.token || '').trim();
  if (/^[a-fA-F0-9]{64}$/.test(hashCandidate)) {
    return hashCandidate.toLowerCase();
  }
  const rawPassword = String(payload.password || hashCandidate || '');
  if (!rawPassword) return '';
  return sha256Hex(rawPassword);
}

/**
 * GAS 내장 Utilities.computeDigest를 이용한 SHA-256 해시 함수
 */
function sha256Hex(input) {
  const rawBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    input,
    Utilities.Charset.UTF_8
  );
  let hex = '';
  for (let i = 0; i < rawBytes.length; i++) {
    const byteVal = (rawBytes[i] < 0 ? rawBytes[i] + 256 : rawBytes[i]);
    hex += ('0' + byteVal.toString(16)).slice(-2);
  }
  return hex.toLowerCase();
}

/**
 * 6자리 종목코드 정규화 ('69500' -> '069500')
 */
function normalizeTicker(val) {
  if (val === undefined || val === null) return '';
  let str = String(val).trim().toUpperCase();
  if (!str) return '';
  // 숫자만 있는 경우 6자리로 0 채움 (예: 69500 -> 069500)
  if (/^\d+$/.test(str) && str.length <= 6) {
    str = ('000000' + str).slice(-6);
  }
  return str;
}

/**
 * 날짜 셀 값(Date 객체 또는 문자열)을 'YYYY-MM-DD' 문자열로 정규화
 */
function normalizeDateCell(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, TIMEZONE, 'yyyy-MM-dd');
  }
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10);
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, TIMEZONE, 'yyyy-MM-dd');
  }
  return str;
}

function parseSafeNumber(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  const cleaned = typeof val === 'string' ? val.replace(/,/g, '').trim() : val;
  const num = Number(cleaned);
  return isNaN(num) ? fallback : num;
}

function getNowIsoString() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'+09:00'");
}

function ensureDatabaseReady() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const missing = Object.keys(SHEET_NAMES).some(function(key) {
    return !ss.getSheetByName(SHEET_NAMES[key]);
  });
  if (missing) {
    setupDatabase();
  }
}

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    setupDatabase();
    sheet = ss.getSheetByName(name);
  }
  return sheet;
}

function getSheetDataRows(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol < 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
}

function createJsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

