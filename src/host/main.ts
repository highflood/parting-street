/**
 * 주최자용 페이지 (PRD S4 영수증, S6 주최자 보기). 3D 없이 먼저 만든 판이다.
 *   /host.html                 주인을 기다리는 가게 순위
 *   /host.html?s=26230&c=wine  가게 하나의 영수증
 * 숫자는 서버가 준 합계 그대로이고, 예상 참석과 매출은 가정을 화면에 적는다.
 */
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '../base.css';
import './host.css';
import { createStreetApi, type MapStats, type RankRow, type ShopDetail } from '../state/api';
import { CATEGORIES, categoryOf, type CategoryKey } from '../data/categories';
import { QUESTIONS, type QId } from '../data/questions';
import { SIDO, regionLabel, sigunguOf } from '../data/regions';
import { ATTEND_RATE, FEE_VALUE, GOAL, PARTING_URL, SERVICE_NAME, hostUrl, receiptUrl, shopUrl } from '../config';
import { button, el, fmt, link } from '../ui/dom';

const api = createStreetApi();
const root = document.getElementById('app')!;

const st = {
  shop: null as { sigungu: string; category: CategoryKey } | null,
  map: null as MapStats | null,
  rank: null as RankRow[] | null,
  rankFailed: false,
  detail: null as ShopDetail | null,
  detailFailed: false,
  filterSido: '',
  filterCategory: '',
};

// ───────── 계산 ─────────

const label = (id: QId, key: string) => QUESTIONS.find(q => q.id === id)?.choices.find(c => c.key === key)?.label ?? key;

/** 가장 많이 고른 보기 순으로. share는 그 문항에 답한 사람 중 비율(%) */
function ranked(counts: Record<string, number>): { key: string; n: number; share: number }[] {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => ({ key, n, share: Math.round((n / total) * 100) }));
}

/** 220000 → "22만 원", 1250000 → "125만 원" */
const won = (n: number) => (n >= 10000 ? `${fmt(Math.round(n / 10000))}만 원` : `${fmt(n)}원`);

interface Estimate { attend: number; fee: number; revenue: number }
/** 예상 참석 = 대기자 × 참석률 가정, 예상 매출 = 예상 참석 × 가장 많이 고른 참가비의 대표값 */
function estimate(d: ShopDetail): Estimate | null {
  if (!d.dist) return null;
  const top = ranked(d.dist.fee)[0];
  const fee = top ? FEE_VALUE[top.key] : undefined;
  if (!fee) return null;
  const attend = Math.round(d.waiting * ATTEND_RATE);
  return attend > 0 ? { attend, fee, revenue: attend * fee } : null;
}

// ───────── 동작 ─────────

let toastTimer = 0;
function toast(text: string) {
  document.querySelector('.toast')?.remove();
  const t = el('div', 'toast', text);
  t.setAttribute('role', 'status');
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 3200);
}

async function send(text: string, url: string, copied: string) {
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ text, url }); return; } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast(copied);
  } catch {
    window.prompt('아래 내용을 복사해서 보내 주세요.', `${text} ${url}`);
  }
}

async function openThisShop() {
  if (!st.shop) return;
  // 창을 먼저 열어야 팝업으로 막히지 않는다. 기록은 뒤에서 한다
  window.open(hostUrl(st.shop.sigungu, st.shop.category), '_blank', 'noopener');
  await api.hostClick(st.shop.sigungu, st.shop.category);
}

function readUrl(): typeof st.shop {
  const p = new URLSearchParams(location.search);
  const s = p.get('s'), c = categoryOf(p.get('c'));
  return s && sigunguOf(s) && c ? { sigungu: s, category: c.key } : null;
}

function go(shop: typeof st.shop, push = true) {
  st.shop = shop;
  st.detail = null;
  st.detailFailed = false;
  if (push) history.pushState(null, '', shop ? receiptUrl(shop.sigungu, shop.category) : receiptUrl());
  render();
  window.scrollTo(0, 0);
  if (shop) void loadDetail(shop); else void loadRank();
}

async function loadDetail(shop: NonNullable<typeof st.shop>) {
  const d = await api.detail(shop.sigungu, shop.category);
  if (st.shop !== shop) return;
  st.detail = d;
  st.detailFailed = !d;
  render();
}

async function loadRank() {
  const [rank, map] = await Promise.all([api.rank(100), api.map()]);
  st.rank = rank;
  st.rankFailed = !rank;
  if (map) st.map = map;
  if (!st.shop) render();
}

// ───────── 화면 조각 ─────────

function top(): HTMLElement {
  const h = el('header', 'top');
  const brand = link('brand', SERVICE_NAME, receiptUrl());
  brand.prepend(el('i'));
  brand.addEventListener('click', e => { e.preventDefault(); go(null); });
  h.append(brand, el('span', 'badge', '주최자용'));
  return h;
}

function footer(): HTMLElement {
  const f = el('footer', 'foot');
  if (api.local) f.appendChild(el('p', 'local', '연습 모드예요. 서버에 연결되지 않아 이 기기의 기록만 보여요.'));
  f.appendChild(el('p', undefined, '대기 인원은 로그인 없이 브라우저 단위로 센 익명 수치예요. 같은 휴대폰 번호는 한 명으로 세요. 회원 수가 아니에요.'));
  const links = el('p');
  links.append(link('', '참가자 줄 서기 화면', '/'), ' · ', link('', 'parting.io', PARTING_URL, true));
  f.appendChild(links);
  return f;
}

function row(k: string, v: string, note?: string, strong = false): HTMLElement {
  const r = el('div', strong ? 'r strong' : 'r');
  const key = el('span', 'k', k);
  if (note) key.appendChild(el('small', undefined, note));
  r.append(key, el('span', 'v', v));
  return r;
}

const rule = () => el('i', 'rule');

/** 영수증 종이 */
function receipt(shop: NonNullable<typeof st.shop>, d: ShopDetail): HTMLElement {
  const cat = categoryOf(shop.category)!;
  const paper = el('section', 'receipt');
  paper.setAttribute('aria-label', '수요 영수증');

  const head = el('div', 'r-head');
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\s/g, '').replace(/\.$/, '');
  head.append(el('small', undefined, `${SERVICE_NAME} · ${today} 기준`), el('strong', undefined, `${regionLabel(shop.sigungu)} · ${cat.short}`));
  paper.append(head, rule());

  paper.appendChild(row('대기', `${fmt(d.waiting)}명`, undefined, true));
  paper.appendChild(row('알림 신청', `${fmt(d.notify)}명`, '열리면 문자를 받겠다고 번호를 남긴 사람'));
  if (d.week > 0) paper.appendChild(row('최근 7일', `+${fmt(d.week)}명`));

  if (d.dist) {
    paper.appendChild(rule());
    const time = ranked(d.dist.time)[0], fee = ranked(d.dist.fee)[0], size = ranked(d.dist.size)[0];
    const ages = ranked(d.dist.age).slice(0, 2);
    if (time) paper.appendChild(row('가장 많은 시간', `${label('time', time.key)} (${time.share}%)`));
    if (fee) paper.appendChild(row('가장 많은 참가비', `${label('fee', fee.key)} (${fee.share}%)`));
    if (ages.length) paper.appendChild(row('연령대', ages.map(a => label('age', a.key)).join(' · ')));
    if (size) paper.appendChild(row('편한 인원', label('size', size.key)));

    const e = estimate(d);
    if (e) {
      paper.appendChild(rule());
      paper.appendChild(row('예상 참석', `약 ${fmt(e.attend)}명`, `대기자의 ${Math.round(ATTEND_RATE * 100)}%가 온다고 가정`));
      paper.appendChild(row('예상 매출', `약 ${won(e.revenue)}`, `참가비 ${won(e.fee)} × ${fmt(e.attend)}명`, true));
    }
  } else {
    paper.appendChild(rule());
    const wait = el('p', 'r-wait');
    wait.append(el('b', undefined, '모으는 중'), ` 대기 ${fmt(d.min)}명부터 시간대와 참가비, 예상 매출을 보여드려요. ${fmt(Math.max(1, d.min - d.waiting))}명 남았어요.`);
    paper.appendChild(wait);
  }

  paper.append(rule(), el('i', 'barcode'), el('p', 'r-foot', '예상 참석과 매출은 가정에 따른 추정이에요. 실제 결과를 보장하지 않아요.'));
  return paper;
}

/** 영수증 아래의 "지금 열 이유" */
function reasons(d: ShopDetail): HTMLElement | null {
  const items: [string, string][] = [];
  if (d.dist) {
    const parts = [
      ranked(d.dist.time)[0] && label('time', ranked(d.dist.time)[0].key),
      ranked(d.dist.fee)[0] && label('fee', ranked(d.dist.fee)[0].key),
      ranked(d.dist.size)[0] && label('size', ranked(d.dist.size)[0].key),
    ].filter(Boolean);
    if (parts.length) items.push(['이렇게 열면 가장 많이 와요', parts.join(' · ')]);
  }
  if (d.notify > 0) items.push(['모집 문자는 파팅이 보내요', `가게를 열면 알림을 신청한 ${fmt(d.notify)}명에게 바로 알려드려요.`]);
  if (d.week > 0 && d.waiting > d.week) items.push(['줄이 길어지는 중이에요', `최근 7일 동안 ${fmt(d.week)}명이 새로 줄 섰어요.`]);
  if (d.clicks > 0) items.push(['다른 주최자도 보고 있어요', `최근 30일 동안 ${fmt(d.clicks)}명이 '이 가게 열기'를 눌렀어요. 가게는 먼저 여는 사람의 것이에요.`]);
  if (!items.length) return null;
  const box = el('section', 'reasons');
  for (const [title, body] of items) {
    const item = el('div', 'reason');
    item.append(el('strong', undefined, title), el('p', undefined, body));
    box.appendChild(item);
  }
  return box;
}

// ───────── 화면 ─────────

function viewReceipt(page: HTMLElement, shop: NonNullable<typeof st.shop>) {
  const cat = categoryOf(shop.category)!;
  const region = regionLabel(shop.sigungu);
  page.appendChild(button('back', '‹ 다른 가게 순위 보기', () => go(null)));

  const d = st.detail;
  const pitch = el('div', 'pitch');
  if (!d) {
    pitch.appendChild(el('h1', undefined, st.detailFailed ? '숫자를 불러오지 못했어요' : `${region} · ${cat.short}`));
    pitch.appendChild(el('p', undefined, st.detailFailed ? '잠시 뒤에 새로고침해 주세요.' : '줄을 세는 중이에요.'));
    page.appendChild(pitch);
    return;
  }

  const copyLink = () => void send(
    `${region}에서 ${cat.short} 모임을 기다리는 사람이 ${fmt(d.waiting)}명이에요. 주최자는 아직 없어요.`,
    receiptUrl(shop.sigungu, shop.category), '영수증 링크를 복사했어요.');
  const recruit = () => void send(
    `${region}에 ${cat.short} 모임 열리면 갈 사람? 줄 서면 열려요.`,
    shopUrl(shop.sigungu, shop.category, true), '줄 서기 링크를 복사했어요. 모임을 기다릴 만한 곳에 올려 보세요.');

  if (d.open) {
    pitch.append(el('h1', undefined, '이미 문을 연 가게예요'), el('p', undefined, `${region} · ${cat.name} 가게는 주최자가 파티를 열었어요. 주인을 기다리는 다른 가게를 살펴보세요.`));
    page.append(pitch, button('btn solid', '주인을 기다리는 가게 보기', () => go(null)));
    return;
  }

  const h = el('h1');
  if (d.waiting > 0) {
    h.append(`${region}에서 ${cat.short} 모임을 기다리는 사람이 `, el('em', undefined, `${fmt(d.waiting)}명`), '.');
    pitch.append(h, el('p', 'no-host', '주최자는 아직 없어요.'));
  } else {
    h.append(`${region} · ${cat.short}`);
    pitch.append(h, el('p', undefined, '아직 줄 선 사람이 없어요. 줄 서기 링크를 먼저 돌리면 수요를 확인하고 열 수 있어요.'));
  }
  page.appendChild(pitch);

  page.appendChild(receipt(shop, d));
  page.appendChild(button('btn solid big', '이 가게 열기 ↗', () => void openThisShop()));
  page.appendChild(el('p', 'faint center', '파팅(parting.io)의 주최 등록으로 넘어가요.'));

  const why = reasons(d);
  if (why) page.appendChild(why);

  if (d.waiting < GOAL) {
    const more = el('section', 'more');
    more.append(
      el('strong', undefined, '먼저 더 모으고 열어도 돼요'),
      el('p', undefined, '줄 서기 링크를 단톡방이나 인스타에 올리면 이 숫자가 그대로 올라가요.'),
      button('btn', '줄 서기 링크 복사', recruit),
    );
    page.appendChild(more);
  }
  page.appendChild(button('btn text', '이 영수증 공유하기', copyLink));
}

function viewRank(page: HTMLElement) {
  const hero = el('div', 'pitch');
  const total = st.map?.total ?? 0, shops = st.map?.shops ?? 0;
  const h = el('h1');
  if (total > 0) h.append('주인을 기다리는 가게 앞에 ', el('em', undefined, `${fmt(total)}명`), '이 줄 서 있어요.');
  else h.append('주인을 기다리는 가게');
  hero.appendChild(h);
  hero.appendChild(el('p', undefined, shops > 0
    ? `가게 ${fmt(shops)}곳이 아직 비어 있어요. 눌러서 대기 인원과 예상 매출을 영수증으로 확인하세요.`
    : '가게마다 대기 인원과 예상 매출을 영수증으로 보여드려요.'));
  page.appendChild(hero);

  if (!st.rank) {
    page.appendChild(el('p', 'empty', st.rankFailed ? '순위를 불러오지 못했어요. 잠시 뒤에 새로고침해 주세요.' : '줄을 세는 중이에요.'));
    return;
  }
  if (!st.rank.length) {
    const empty = el('section', 'more');
    empty.append(
      el('strong', undefined, '아직 줄이 생긴 가게가 없어요'),
      el('p', undefined, '참가자에게 줄 서기 링크를 먼저 돌리면 여기에 순위가 쌓여요.'),
      link('btn', '줄 서기 화면 보기', '/'),
    );
    page.appendChild(empty);
    return;
  }

  // 거르기: 줄이 있는 시/도만 보기에 넣는다
  const filters = el('div', 'filters');
  const pick = (aria: string, value: string, options: [string, string][], onChange: (v: string) => void) => {
    const s = el('select');
    s.setAttribute('aria-label', aria);
    for (const [v, text] of options) {
      const o = el('option', undefined, text);
      o.value = v;
      s.appendChild(o);
    }
    s.value = value;
    s.addEventListener('change', () => { onChange(s.value); render(); });
    return s;
  };
  const sidoCodes = new Set(st.rank.map(r => r.sigungu.slice(0, 2)));
  filters.append(
    pick('지역', st.filterSido, [['', '전국'], ...SIDO.filter(s => sidoCodes.has(s.code)).map(s => [s.code, s.short] as [string, string])], v => { st.filterSido = v; }),
    pick('모임 종류', st.filterCategory, [['', '모든 모임'], ...CATEGORIES.map(c => [c.key, c.name] as [string, string])], v => { st.filterCategory = v; }),
  );
  page.appendChild(filters);

  const rows = st.rank.filter(r => (!st.filterSido || r.sigungu.startsWith(st.filterSido)) && (!st.filterCategory || r.category === st.filterCategory));
  if (!rows.length) { page.appendChild(el('p', 'empty', '이 조건에는 아직 줄이 없어요.')); return; }

  const list = el('ol', 'rank');
  rows.slice(0, 30).forEach((r, i) => {
    const li = el('li');
    const b = button('rank-row', '', () => go({ sigungu: r.sigungu, category: r.category as CategoryKey }));
    const name = el('span', 'name');
    name.append(el('b', undefined, `${regionLabel(r.sigungu)} · ${categoryOf(r.category)!.short}`));
    const sub = [r.notify > 0 ? `알림 신청 ${fmt(r.notify)}명` : '', r.week > 0 ? `7일간 +${fmt(r.week)}` : ''].filter(Boolean).join(' · ');
    name.appendChild(el('small', undefined, sub || '주인 구함'));
    const n = el('span', 'n');
    n.append(el('b', undefined, fmt(r.waiting)), '명');
    b.append(el('span', 'no', String(i + 1)), name, n);
    li.appendChild(b);
    list.appendChild(li);
  });
  page.appendChild(list);
}

function render() {
  root.textContent = '';
  const page = el('main', 'page host');
  page.appendChild(top());
  if (st.shop) viewReceipt(page, st.shop); else viewRank(page);
  page.appendChild(footer());
  root.appendChild(page);
  document.title = st.shop
    ? `${regionLabel(st.shop.sigungu)} · ${categoryOf(st.shop.category)!.short} 영수증 · ${SERVICE_NAME}`
    : `주인을 기다리는 가게 · ${SERVICE_NAME}`;
}

go(readUrl(), false);
window.addEventListener('popstate', () => go(readUrl(), false));
// 열어 둔 화면의 숫자를 1분마다 새로 고친다
setInterval(() => {
  if (document.hidden) return;
  if (st.shop) void loadDetail(st.shop); else void loadRank();
}, 60000);
