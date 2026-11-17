/**
 * 카테고리(임시). 파팅 라운지와 같은 key를 쓴다.
 * key를 바꾸거나 추가하면 SQL의 check 목록(street_queue, street_shop, street_host_click)도 같이 고친다.
 */
export const CATEGORIES = [
  { key: 'wine', name: '와인 · 다이닝', short: '와인' },
  { key: 'board', name: '보드게임', short: '보드게임' },
  { key: 'rooftop', name: '루프탑 파티', short: '루프탑' },
  { key: 'run', name: '러닝 · 액티비티', short: '러닝' },
  { key: 'book', name: '독서 · 토크', short: '독서' },
  { key: 'club', name: '노래 · 클럽', short: '노래' },
] as const;

export type Category = (typeof CATEGORIES)[number];
export type CategoryKey = Category['key'];

export function categoryOf(key: string | null | undefined): Category | undefined {
  return CATEGORIES.find(c => c.key === key);
}
