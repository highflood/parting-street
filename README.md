# 파팅 거리

문 닫힌 가게 앞에 사람들이 줄 서 있는 거리를 보여줘서, 주최자가 "여기 열기만 하면 사람이 온다"를 알게 하는 서비스. 기획은 [PRD.md](PRD.md).

지금은 **M1**(DB와 함수, 3D 없는 줄 서기 페이지, 연락처 수집과 동의, 처리방침, 공유 링크)과 **M3의 3D 없는 판**(주최자용 순위와 영수증)이 들어 있다. M2(3D 지도와 거리)는 아직 없다.

PRD와 다른 점: 휴대폰 번호는 줄 서기 전이 아니라 줄 선 뒤에 원하는 사람만 남긴다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5174
npm run build      # 타입 체크 + dist 빌드
npm run test:sql   # 마이그레이션을 내장 Postgres에 올려 함수와 권한 확인
```

`.env`가 없으면 이 브라우저에만 저장하는 연습 모드로 동작한다(화면 아래에 표시된다).
실제 서버에 붙이려면 `.env.example`을 `.env`로 복사해 Supabase 주소와 anon 키를 넣는다. Vercel에도 같은 환경변수 두 개를 넣는다.

## Supabase에서 해야 할 일 (한 번만)

1. Supabase 대시보드 > SQL Editor를 연다.
2. `supabase/migrations/20261117000000_street.sql` 전체를 붙여 넣고 Run.
3. `supabase/migrations/20261117000100_street_regions.sql` 전체를 붙여 넣고 Run. (시군구 코드 목록. 이게 없으면 줄 서기가 전부 거절된다)
4. 사이트에서 줄을 서 보고 Table Editor의 `street_queue`, `street_contact`에 행이 생기고, 나가면 지워지는지 확인한다.

둘 다 여러 번 실행해도 안전하다. 다른 Supabase 프로젝트를 쓰면 `vercel.json`의 CSP `connect-src` 주소도 바꾼다.

## 주소

- `/` 시/도 → 시군구 → 카테고리를 골라 줄 서기
- `/?s=26230&c=wine` 가게 하나로 바로 가기 (`s` 시군구 코드 5자리, `c` 카테고리 key)
- 공유 링크에는 `&ref=share`가 붙고, 공유 유입으로 집계된다
- `/privacy.html` 개인정보 처리방침
- `/host.html` 주최자용: 주인을 기다리는 가게 순위 (`/?host`로 들어와도 여기로 온다)
- `/host.html?s=26230&c=wine` 주최자용: 가게 하나의 영수증. 주최자에게 보내는 링크다

영수증의 예상 참석은 대기자 × `ATTEND_RATE`(30%), 예상 매출은 거기에 가장 많이 고른 참가비 구간의 대표값(`FEE_VALUE`)을 곱한 것이다. 둘 다 `src/config.ts`에서 바꾸고, 가정은 화면에 그대로 적힌다. 대기 5명 미만인 가게는 분포와 매출을 숨기고 "모으는 중"으로 보여준다.

## 구조

```
index.html, src/join/     줄 서기 페이지 (three.js를 불러오지 않는다)
privacy.html              처리방침
src/config.ts             목표 인원, 참석률 가정, 주최 등록 주소 등 바꿀 값
src/data/categories.ts    카테고리 (임시 6개)
src/data/questions.ts     줄 설 때 묻는 문항
src/data/regions.json     시/도, 시군구 (생성 파일)
src/state/api.ts          서버 함수 호출, 연습 모드
supabase/migrations/      테이블, RLS, 함수
scripts/build-regions.mjs 지역 목록 생성
scripts/test-sql.mjs      SQL 테스트
```

## 운영

- **가게 개업 처리**: Table Editor > `street_shop`에 행을 넣는다 (`sigungu`, `category`, `party_url`은 https 주소).
- **알림 보낼 번호 조회** (SQL Editor, 운영자만):
  ```sql
  select distinct c.phone from street_queue q join street_contact c using (visitor_id)
  where q.sigungu = '26230' and q.category = 'wine';
  ```
- **보유 기간 지난 번호 삭제**: `select street_contact_purge();` 를 주기적으로 실행한다(신청 후 1년). 알림을 보낸 뒤의 삭제는 M4에서 붙인다.
- **문항 보기나 카테고리를 바꿀 때**: `src/data/`의 key와 SQL의 check 목록을 같이 고친다. 문구만 바꾸는 것은 코드만 고치면 된다.
- **행정구역이 바뀌면**: [vuski/admdongkor](https://github.com/vuski/admdongkor)의 새 geojson을 받아 `npm run regions -- <파일>`을 실행하고, 생성된 regions SQL을 다시 실행한다.

## 숫자와 개인정보

- 테이블은 RLS로 잠그고 함수(RPC)로만 접근한다. 읽기 함수는 합계만 돌려준다.
- 휴대폰 번호는 `street_contact`에만 있고 브라우저에서 읽는 함수는 없다. 브라우저에도 저장하지 않는다.
- 같은 번호는 visitor_id가 달라도 대기 한 명으로 센다.
- 한 방문자 줄 5개, 같은 가게 중복 불가, 같은 IP에서 10분에 40번까지(IP는 해시로 1시간만 보관).
- 대기 인원은 로그인 없이 브라우저 단위다. 주최자에게는 "대기 N명"과 "알림 신청 N명"을 따로 말한다.

## 지역 데이터 출처

본 데이터는 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서 공공누리 제1유형으로 개방한 행정동 경계를 가공한 것이며(가공: vuski/admdongkor, https://github.com/vuski/admdongkor), CC BY 4.0으로 배포됩니다.
