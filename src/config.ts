/**
 * 바꿀 수 있는 값은 여기 한 곳에 둔다.
 * MAX_QUEUES와 MIN_DISPLAY는 서버(supabase/migrations/20261117000000_street.sql의
 * street_max_queues, street_min_display)가 실제로 강제한다. 바꿀 때는 양쪽을 같이 고친다.
 */

export const SERVICE_NAME = '파팅 거리';

/** "N명 모이면 열려요"의 N */
export const GOAL = 10;

/** 영수증의 예상 참석 계산에 쓰는 가정: 대기자 중 실제로 오는 비율. 화면에 그대로 적힌다 */
export const ATTEND_RATE = 0.3;

/** 영수증의 예상 매출 계산에 쓰는 참가비(원). 보기 구간의 대표값이다 */
export const FEE_VALUE: Record<string, number> = { f1: 10000, f2: 20000, f3: 40000, f4: 50000 };

/** 주최자용 영수증 주소. 가게를 주지 않으면 순위 페이지 */
export function receiptUrl(sigungu?: string, category?: string): string {
  const u = new URL('/host.html', location.origin);
  if (sigungu && category) { u.searchParams.set('s', sigungu); u.searchParams.set('c', category); }
  return u.toString();
}

/** 한 사람이 동시에 설 수 있는 줄 수 */
export const MAX_QUEUES = 5;

/** 분포를 보여주는 최소 대기 인원 */
export const MIN_DISPLAY = 5;

/** 연락처 동의 문구의 버전. 문구를 바꾸면 날짜를 올린다 */
export const CONSENT_VERSION = '2026-11-17';

export const PARTING_URL = 'https://parting.io/';

/**
 * "이 가게 열기"가 넘어가는 주소. 지역과 카테고리를 붙여 보낸다.
 * parting.io의 주최 등록 주소와 받는 파라미터가 정해지면 여기만 고친다.
 */
export function hostUrl(sigungu: string, category: string): string {
  const u = new URL(PARTING_URL);
  u.searchParams.set('region', sigungu);
  u.searchParams.set('category', category);
  u.searchParams.set('utm_source', 'street');
  return u.toString();
}

/** 가게 하나로 바로 가는 주소. share가 true면 공유 링크로 들어온 방문으로 집계된다 */
export function shopUrl(sigungu: string, category: string, share = false): string {
  const u = new URL('/', location.origin);
  u.searchParams.set('s', sigungu);
  u.searchParams.set('c', category);
  if (share) u.searchParams.set('ref', 'share');
  return u.toString();
}
