/**
 * 시/도와 시군구. 목록은 scripts/build-regions.mjs가 만든 regions.json이다.
 * 저장은 항상 시군구 코드(5자리)로 하고, 이름과 별칭은 표시에만 쓴다.
 */
import data from './regions.json';

export interface Sido { code: string; name: string; short: string; lng: number; lat: number }
export interface Sigungu { code: string; name: string; lng: number; lat: number }

export const SIDO: readonly Sido[] = data.sido;
export const SIGUNGU: readonly Sigungu[] = data.sigungu;
export const REGION_SOURCE: string = data.source;

const sidoByCode = new Map(SIDO.map(s => [s.code, s]));
const sigunguByCode = new Map(SIGUNGU.map(s => [s.code, s]));

export const sidoOf = (code: string | null | undefined) => sidoByCode.get((code ?? '').slice(0, 2));
export const sigunguOf = (code: string | null | undefined) => sigunguByCode.get(code ?? '');
export const sigunguIn = (sido: string) => SIGUNGU.filter(s => s.code.startsWith(sido));

/** 상권 이름. 표시용 별칭일 뿐이고 저장에는 쓰지 않는다. 필요한 만큼 늘린다 */
const ALIASES: Record<string, string> = {
  '11110': '종로', '11170': '이태원', '11200': '성수', '11215': '건대', '11440': '홍대', '11680': '강남',
  '26230': '서면', '26350': '해운대', '26500': '광안리',
};
export const aliasOf = (code: string): string | undefined => ALIASES[code];

/** "부산 부산진구", "경기 수원시 장안구", "세종시" */
export function regionLabel(code: string): string {
  const g = sigunguOf(code), s = sidoOf(code);
  if (!g || !s) return code;
  // "세종 세종시", "전남·광주 광주 동구"처럼 겹치는 경우는 시군구 이름만 쓴다
  const overlap = g.name === `${s.short}시` || s.short.split('·').includes(g.name.split(' ')[0]);
  return overlap ? g.name : `${s.short} ${g.name}`;
}

/** 공유 문구용 짧은 이름: 별칭이 있으면 별칭, 없으면 시군구 이름 */
export const regionShort = (code: string): string => aliasOf(code) ?? sigunguOf(code)?.name ?? code;
