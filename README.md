# 연금 자산 매니저 (Pension Asset Manager)

개인 및 다중 사용자의 연금 자산(**국내 상장 ETF** 및 **현금 예수금**)을 통합 관리하고, **매일 오후 5시(17:00 KST) 기준 자산 스냅샷**을 자동으로 기록해 일별 자산 추이 및 포트폴리오 비중을 시각화하는 서버리스 웹 애플리케이션입니다.

- **Frontend:** HTML5, Tailwind CSS (CDN), Chart.js (CDN), Vanilla JavaScript (`index.html`, `app.js`)
- **Hosting:** GitHub Pages (정적 웹 호스팅)
- **Backend & DB:** Google Sheets + Google Apps Script (`Code.gs`)
- **CORS 우회 통신:** 모든 API 요청을 `POST` 메서드 + `Content-Type: text/plain;charset=utf-8` 헤더로 전송하여 브라우저의 CORS Preflight(`OPTIONS`) 제약을 우회합니다.

---

## 파일 구성

```text
├── Code.gs       # Google Apps Script 백엔드 전체 코드 (DB 자동 초기화, API 라우터, 17시 스케줄러)
├── index.html    # 반응형 대시보드 UI (로그인/회원가입, 요약 카드, 차트 2종, 계좌/종목/현금 모달)
├── app.js        # 프런트엔드 상태 관리, SHA-256 해싱, GAS API 통신, Chart.js 렌더링, 로컬 데모 모드
└── README.md     # 구글 시트 연동 및 GitHub Pages 배포 단계별 가이드
```

---

## 데이터베이스 구조 (Google Sheets 5개 시트)

`setupDatabase()` 함수를 실행하면 하나의 구글 스프레드시트 내에 아래 5개 시트와 헤더, 텍스트 서식(`@`)이 자동으로 생성됩니다.

| 시트명 | 컬럼 구성 | 설명 |
| :--- | :--- | :--- |
| **`Users`** | `user_id`, `password_hash`, `created_at` | 자체 회원 인증 정보 (SHA-256 해시 저장) |
| **`Accounts`** | `account_id`, `user_id`, `account_name`, `cash_balance`, `created_at` | 사용자별 연금저축/IRP 계좌 및 보유 현금(예수금) |
| **`Holdings`** | `holding_id`, `account_id`, `user_id`, `ticker`, `ticker_name`, `quantity`, `avg_price` | 계좌별 보유 ETF 종목 (`069500` 등 앞자리 `0` 보존을 위해 텍스트 포맷 유지) |
| **`PriceCache`** | `ticker`, `current_price`, `ticker_name` | `=IFERROR(GOOGLEFINANCE("KRX:"&A2, "price"), 0)` 수식이 자동 입력되는 실시간/지연 시세 시트 |
| **`Snapshots`** | `snapshot_id`, `date`, `user_id`, `account_id`, `eval_amount`, `cash_amount`, `total_asset` | 매일 17시 자동(또는 수동) 기록되는 계좌별 및 전체(`"ALL"`) 일별 자산 스냅샷 |

---

## 단계별 배포 및 연동 가이드

### 1단계: Google Sheets 생성 및 Apps Script 코드 붙여넣기

1. [Google Sheets](https://sheets.new)에 접속하여 새 스프레드시트를 생성하고 문서 제목을 원하는 이름(예: `연금자산관리_DB`)으로 지정합니다.
2. 상단 메뉴에서 **[확장 프로그램] → [Apps Script]**를 클릭합니다.
3. 기본으로 열려 있는 `코드.gs`(또는 `Code.gs`)의 기존 내용을 모두 지우고, 이 저장소의 **[`Code.gs`](./Code.gs)** 파일 전체 코드를 복사하여 붙여넣은 뒤 저장(`Ctrl + S` 또는 `Cmd + S`)합니다.
4. 좌측 **[프로젝트 설정(톱니바퀴 아이콘)]**에서 시간대가 `GMT+09:00 한국 표준시 - 서울 (Asia/Seoul)`로 되어 있는지 확인합니다.

---

### 2단계: 데이터베이스 초기화(`setupDatabase`) 및 매일 17시 트리거(`createDailyTrigger`) 실행

1. Apps Script 편집기 상단 툴바의 **함수 선택 드롭다운**에서 **`setupDatabase`**를 선택하고 **[실행]** 버튼을 클릭합니다.
2. 최초 실행 시 **[권한 검토]** 창이 나타나면 아래 순서대로 승인합니다:
   - 본인 Google 계정 선택 → **[고급]** 클릭 → **[프로젝트 이름(안전하지 않음)으로 이동]** 클릭 → **[허용]** 클릭
3. 실행 로그에 `데이터베이스(5개 시트) 초기화가 완료되었습니다.` 메시지가 출력되고, 스프레드시트에 `Users`, `Accounts`, `Holdings`, `PriceCache`, `Snapshots` 5개 탭이 생성된 것을 확인합니다.
4. 다시 상단 **함수 선택 드롭다운**에서 **`createDailyTrigger`**를 선택하고 **[실행]** 버튼을 클릭합니다.
   - 좌측 메뉴의 **[트리거(시계 아이콘)]** 탭으로 이동하면 `takeDailySnapshot` 함수가 **매일 오후 5시~6시(17:00~18:00 KST)**에 자동 실행되도록 등록된 것을 확인할 수 있습니다.

---

### 3단계: Google Apps Script 웹 앱(Web App) 배포

1. Apps Script 우측 상단의 **[배포] → [새 배포]**를 클릭합니다.
2. 좌측 **유형 선택(톱니바퀴 아이콘)**에서 **[웹 앱]**을 선택합니다.
3. 아래와 같이 설정을 입력합니다 (중요):
   - **설명:** `연금 자산 관리 API v1`
   - **다음 사용자 인증 정보로 실행 (Execute as):** **`나 (Me)`**
   - **액세스 권한이 있는 사용자 (Who has access):** **`모든 사용자 (Anyone)`**
4. **[배포]** 버튼을 클릭한 뒤 생성된 **웹 앱 URL (`https://script.google.com/macros/s/AKfycb.../exec`)**을 복사합니다.

> **참고:** 이후 `Code.gs` 코드를 수정했을 때는 **[배포] → [배포 관리] → 연필 아이콘(수정) → 버전: [새 버전]**을 선택하여 배포하면 기존 웹 앱 URL을 그대로 유지할 수 있습니다.

---

### 4단계: 프런트엔드에 웹 앱 URL 연결하기

웹 앱 URL을 연결하는 방법은 **2가지** 중 편한 방법을 선택할 수 있습니다.

#### 방법 A: 코드 수정 없이 웹 화면에서 설정 (권장)
1. 웹 페이지 우측 상단의 **[API 설정]** 버튼을 클릭합니다.
2. 복사한 Google Apps Script 웹 앱 URL(`https://script.google.com/macros/s/.../exec`)을 입력하고 **[연결 테스트 (Ping)]**로 정상 응답을 확인한 뒤 **[설정 저장]**을 누릅니다.

#### 방법 B: `app.js` 상단 상수에 기본 URL 고정
여러 기기에서 매번 URL을 입력하지 않으려면 [`app.js`](./app.js) 파일 상단 14번째 줄의 `DEFAULT_GAS_WEB_APP_URL`에 배포 URL을 입력해 커밋합니다:

```javascript
const DEFAULT_GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

---

### 5단계: GitHub Pages에 정적 호스팅 배포하기

1. GitHub에서 새 저장소(Repository)를 생성합니다.
2. 이 프로젝트의 파일(`index.html`, `app.js`, `Code.gs`, `README.md`)을 저장소에 푸시(Push)합니다.
   ```bash
   git init
   git add index.html app.js Code.gs README.md
   git commit -m "feat: 연금 자산 관리 웹 앱 초기 배포"
   git branch -M main
   git remote add origin https://github.com/<사용자명>/<저장소명>.git
   git push -u origin main
   ```
3. GitHub 저장소 상단 **[Settings] → 좌측 [Pages]** 메뉴로 이동합니다.
4. **Build and deployment** 항목에서:
   - **Source:** `Deploy from a branch` 선택
   - **Branch:** `main` / `/(root)` 선택 후 **[Save]** 클릭
5. 약 1~2분 뒤 발급된 `https://<사용자명>.github.io/<저장소명>/` 주소로 접속하여 회원가입 및 연금 자산 관리를 시작합니다.

---

## 주요 기능 요약

- **자체 회원 인증:** 별도 Google OAuth 없이 ID/Password만으로 회원가입·로그인 가능 (비밀번호는 SHA-256 해시로 변환되어 저장 및 검증).
- **통합 뷰 & 개별 계좌 뷰 즉시 전환:** 상단 탭 및 드롭다운으로 전체 계좌 합산 뷰와 개별 계좌(연금저축1, 연금저축2, IRP 등) 뷰를 즉시 전환.
- **시각화 대시보드:**
  - **일별 자산 변화 추이 (Line Chart):** 전체/개별 계좌의 총자산·주식평가금·현금 추이 및 **다중 계좌 비교 모드**, 기간 필터(30일/90일/전체) 지원.
  - **현재 자산 비중 (Doughnut Chart):** 종목별 비중 + 현금 비중 또는 계좌별 비중 시각화.
- **현금(예수금) 입출금 및 잔액 관리:** 잔액 직접 설정뿐만 아니라 `+입금`, `-출금` 모드와 빠른 금액 버튼(`+10만`, `+50만`, `+100만`) 지원.
- **보유 종목(KRX ETF) 실시간 연동:** 6자리 종목코드(`360750`, `133690`, `069500` 등) 등록 시 `PriceCache` 시트에 `GOOGLEFINANCE` 수식을 자동 생성하여 최신 평가금액 및 수익률 산출.
- **자동 & 수동 스냅샷:** 매일 오후 5시 자동 트리거 기록 외에 상단 **[지금 스냅샷 찍기]** 버튼으로 언제든 오늘 자 스냅샷 즉시 갱신 가능.

