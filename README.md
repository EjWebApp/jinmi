# 진미농원 홈페이지

정읍 신태인 천단마을 **진미농원 유기농포도체험장** 홍보 홈페이지입니다.
농장주 페이스북 기록(2012~2026)을 바탕으로 내용을 만들었습니다.

| 주소 | 화면 |
|---|---|
| `/` | 홈: 농원 소개, 5무 농법, 체험 프로그램, 품종 달력, 포도밭 일기, 후기, 농산물, 오시는 길 |
| `/reserve` | 체험 예약: 프로그램 → 날짜·시간(남은 자리 표시) → 인원·연락처 → 동의, 예약 조회 |
| `/admin` | 관리자: 로그인, 예약 상태·메모 관리, CSV 받기, 휴무일, 관리자 계정·비밀번호 |

## 구성

- **서버**: Node.js(내장 `http`) + `mysql2` 하나만 사용합니다.
- **DB**: MySQL 호환 DB(로컬은 MariaDB, 운영은 TiDB Cloud). 처음 실행하면 테이블이 자동으로 만들어집니다 ([db.js](db.js)).
- **관리자 로그인**: 아이디와 비밀번호를 쓰고, 비밀번호는 scrypt로 암호화해 저장합니다. 로그인 상태는 HttpOnly 쿠키로 12시간 유지되고, 5번 틀리면 10분 동안 잠깁니다.
- **예약 정원**: 시간대마다 정원이 있고, 기본값은 40명입니다([config.json](config.json)의 `capacityPerSlot`). 같은 시간대에 예약이 동시에 들어와도 DB 잠금으로 정원을 넘지 않게 막습니다.
- **로고**: 1f 시안(덩굴 원형 배지)을 SVG로 넣었습니다 ([public/js/common.js](public/js/common.js)).

## 로컬에서 실행

```bash
npm install
npm run db:up      # Docker로 MariaDB 10.11 실행 (포트 3307)
npm start          # http://localhost:3000
```

처음 실행하면 `.env`의 `INITIAL_ADMIN_ID` / `INITIAL_ADMIN_PASSWORD` 값으로 관리자 계정이 만들어집니다.
**첫 로그인 때 비밀번호를 바꾸라는 화면이 나옵니다.** 비밀번호를 바꾼 뒤에는 `.env`의 초기 비밀번호가 더 이상 쓰이지 않습니다.

## 내용 수정

- 체험 프로그램, 운영 시기, 소요 시간, 체험비, 시간대, 정원 → [config.json](config.json)을 고친 뒤 서버를 재시작하세요.
  체험비를 표시하려면 `"price": "1인 15,000원"`처럼 적으면 예약 요약에 나옵니다.
- 사진 → [public/images/](public/images/)에 있습니다. 페이스북 원본에서 골라 축소한 사진입니다.
- 문구·연락처 → [public/index.html](public/index.html)

## 무료 배포: Render + TiDB Cloud

사이트는 [Render](https://render.com) 무료 웹 서비스, DB는 [TiDB Cloud](https://tidbcloud.com) 무료(Starter) 클러스터를 씁니다. TiDB는 MySQL과 호환됩니다.

1. **GitHub에 올리기**: GitHub에 비공개(private) 저장소를 만들고 이 프로젝트를 push합니다.
2. **TiDB Cloud DB 만들기**: 가입 → 클러스터 만들기(무료, 리전은 Tokyo 등 가까운 곳) → **Connect** 화면에서
   Host, Port(4000), User(`xxxx.root` 형태), Password를 확인합니다. DB(`jinmi`)는 서버가 처음 켜질 때 자동으로 만듭니다.
3. **Render에 배포**: Render 가입(GitHub 계정으로) → **New → Blueprint** → 저장소 선택.
   [render.yaml](render.yaml)을 읽어 설정이 채워지고, 아래 값만 입력하면 됩니다.
   | 이름 | 값 |
   |---|---|
   | `DB_HOST` | TiDB Host |
   | `DB_USER` | TiDB User |
   | `DB_PASSWORD` | TiDB Password |
   | `INITIAL_ADMIN_PASSWORD` | 처음 쓸 임시 관리자 비밀번호 |
4. 배포가 끝나면 `https://jinmi-xxxx.onrender.com/admin`에 접속해 `admin`으로 로그인하고 비밀번호를 바꿉니다.
5. 이후에는 GitHub에 push할 때마다 자동으로 다시 배포됩니다.

알아둘 점
- 무료 서비스는 **15분 동안 접속이 없으면 잠들고**, 다음 첫 접속 때 깨어나는 데 최대 1분쯤 걸립니다.
- Render 서버의 파일은 재배포 때 사라지므로, 데이터는 모두 DB에 저장합니다(사진은 저장소의 `public/images`).
- 도메인을 연결하려면 Render 서비스의 **Settings → Custom Domains**에서 추가합니다. HTTPS는 자동입니다.
- 무료 조건은 바뀔 수 있으니 가끔 Render·TiDB 요금 안내를 확인해 주세요.

## 확인이 필요한 내용 (페이스북에서 정확히 찾지 못한 것)

- 1인당 **체험비**: 지금은 "체험비 문의"로 표시합니다.
- **품종별 수확 시기**: 글에 나온 수확 순서를 바탕으로 막대를 그렸습니다. 날짜는 대략입니다.
- **상세 주소**: "신태인읍 천단마을"과 지도 좌표(페이스북 체크인 위치)만 넣었습니다.
- 운영 시간대(오전 10시 / 오후 2시)와 시간대별 정원 40명은 페이스북 글의 예약 사례를 보고 정한 기본값입니다.
