/**
 * 3D 없는 줄 서기 페이지 (PRD S5). 공유 링크의 기본 도착지다.
 * three.js를 불러오지 않는다. 주소의 ?s=시군구코드&c=카테고리 로 가게 하나를 가리키고,
 * 없으면 시/도 → 시군구 → 카테고리를 차례로 고른다.
 */
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '../base.css';
import './join.css';
import { createStreetApi, normalizePhone, type MapStats, type Mine, type Spot, type Town } from '../state/api';
import { CATEGORIES, categoryOf, type CategoryKey } from '../data/categories';
import { QUESTIONS, type Answers } from '../data/questions';
import { SIDO, regionLabel, regionShort, sidoOf, sigunguIn, sigunguOf } from '../data/regions';
import { GOAL, MAX_QUEUES, PARTING_URL, SERVICE_NAME, receiptUrl, shopUrl } from '../config';
import { button, el, fmt, link } from '../ui/dom';

type View = 'sido' | 'sigungu' | 'category' | 'shop' | 'ask' | 'contact' | 'done';

/** 줄 그림에 그리는 최대 인원. 나머지는 숫자로 보여준다 */
const QUEUE_DRAW = 12;

const api = createStreetApi();
const root = document.getElementById('app')!;

const st = {
  view: 'sido' as View,
  sido: null as string | null,
  sigungu: null as string | null,
  category: null as CategoryKey | null,
  map: null as MapStats | null,
  town: null as Town | null,
  /** town이 어느 시군구의 것인지. 불러오는 중이거나 실패했으면 null */
  townFor: null as string | null,
  loading: false,
  mine: null as Mine | null,
  answers: {} as Answers,
  step: 0,
  done: null as { position: number; waiting: number } | null,
  notice: null as string | null,
  busy: false,
};

// ───────── 상태 ─────────

const mySpot = (): Spot | undefined =>
  st.mine?.queues.find(q => q.sigungu === st.sigungu && q.category === st.category);
/** 5개 제한에 들어가는 줄 수. 개업한 가게의 줄은 빼고 센다 */
const myActive = () => st.mine?.queues.filter(q => !q.open).length ?? 0;
const shopNow = () => (st.townFor === st.sigungu && st.category ? st.town?.[st.category] : undefined);

function remainText(waiting: number): string {
  if (waiting <= 0) return '아직 아무도 없어요. 첫 줄을 서 보세요.';
  const remain = GOAL - waiting;
  return remain > 0 ? `${fmt(remain)}명만 더 오면 열려요` : '목표 인원을 채웠어요. 주인만 오면 열려요';
}

function readUrl(): { sigungu: string; category: CategoryKey } | null {
  const p = new URLSearchParams(location.search);
  const s = p.get('s'), c = categoryOf(p.get('c'));
  return s && sigunguOf(s) && c ? { sigungu: s, category: c.key } : null;
}

function show(view: View, notice: string | null = null) {
  st.view = view;
  st.notice = notice;
  render();
  window.scrollTo(0, 0);
}

async function loadTown(sigungu: string) {
  st.loading = true;
  st.townFor = null;
  const [town, mine] = await Promise.all([api.town(sigungu), api.mine()]);
  if (st.sigungu !== sigungu) return;
  st.loading = false;
  st.town = town;
  st.townFor = town ? sigungu : null;
  if (mine) st.mine = mine;
  render();
}

async function refreshAll() {
  const sigungu = st.sigungu;
  const [map, mine, town] = await Promise.all([api.map(), api.mine(), sigungu ? api.town(sigungu) : null]);
  if (map) st.map = map;
  if (mine) st.mine = mine;
  if (sigungu && sigungu === st.sigungu && town) { st.town = town; st.townFor = sigungu; }
  // 번호를 입력하는 중에는 화면을 다시 그리지 않는다
  if (st.view !== 'contact') render();
}

function openShop(sigungu: string, category: CategoryKey, push = true) {
  const sameTown = st.townFor === sigungu;
  st.sigungu = sigungu;
  st.sido = sigungu.slice(0, 2);
  st.category = category;
  st.done = null;
  if (push) history.pushState(null, '', shopUrl(sigungu, category));
  show('shop');
  if (!sameTown) void loadTown(sigungu);
}

function openPicker(view: 'sido' | 'sigungu' | 'category') {
  if (location.search) history.pushState(null, '', location.pathname);
  show(view);
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

async function share(position: number, waiting: number) {
  if (!st.sigungu || !st.category) return;
  const cat = categoryOf(st.category)!;
  const text = `${regionShort(st.sigungu)} ${cat.short} 가게 ${fmt(position)}번째로 줄 섰어요. ${remainText(waiting)}`;
  const url = shopUrl(st.sigungu, st.category, true);
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ text, url }); return; } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('링크를 복사했어요. 친구에게 붙여 넣어 보세요.');
  } catch {
    // 인앱 브라우저처럼 복사 권한이 없는 곳에서는 직접 복사하게 한다
    window.prompt('아래 내용을 복사해서 보내 주세요.', `${text} ${url}`);
  }
}

/** 주최자용 영수증으로 간다. "이 가게 열기" 클릭은 영수증에서 기록한다 */
function goHost() {
  if (!st.sigungu || !st.category) return;
  location.href = receiptUrl(st.sigungu, st.category);
}

function startJoin() {
  if (myActive() >= MAX_QUEUES) {
    show('shop', `줄은 ${MAX_QUEUES}개까지 설 수 있어요. 아래에서 하나를 나간 뒤 다시 서 주세요.`);
    return;
  }
  st.answers = {};
  st.step = 0;
  history.pushState(null, '', location.href);
  show('ask');
}

async function leave(q: { sigungu: string; category: string }) {
  if (st.busy) return;
  const last = (st.mine?.queues.length ?? 0) <= 1;
  const extra = last && st.mine?.notify ? '\n알림용 휴대폰 번호도 함께 지워져요.' : '';
  if (!window.confirm(`${regionLabel(q.sigungu)} · ${categoryOf(q.category)?.name ?? ''} 줄에서 나갈까요?${extra}`)) return;
  st.busy = true;
  const ok = await api.leave(q.sigungu, q.category);
  st.busy = false;
  if (!ok) { toast('나가지 못했어요. 잠시 뒤에 다시 시도해 주세요.'); return; }
  st.done = null;
  toast('줄에서 나왔어요.');
  await refreshAll();
}

async function stopNotify() {
  if (st.busy) return;
  if (!window.confirm('알림을 그만 받을까요? 저장된 휴대폰 번호를 지워요. 줄은 그대로 서 있어요.')) return;
  st.busy = true;
  const ok = await api.removeContact();
  st.busy = false;
  if (!ok) { toast('처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.'); return; }
  toast('번호를 지웠어요.');
  await refreshAll();
}

const JOIN_ERRORS: Record<string, string> = {
  limit: `줄은 ${MAX_QUEUES}개까지 설 수 있어요. 다른 줄에서 하나를 나간 뒤 다시 서 주세요.`,
  open: '방금 문을 연 가게예요. 줄을 서지 않고 바로 들어갈 수 있어요.',
  invalid: '답변을 확인하지 못했어요. 처음부터 다시 답해 주세요.',
  busy: '요청이 많아요. 잠시 뒤에 다시 시도해 주세요.',
  error: '연결이 불안정해요. 잠시 뒤에 다시 시도해 주세요.',
};

/** 마지막 문항에 답하면 바로 줄을 선다. 연락처는 줄 선 뒤에 원하는 사람만 남긴다 */
async function joinNow() {
  if (st.busy || !st.sigungu || !st.category) return;
  st.busy = true;
  try {
    const r = await api.join(st.sigungu, st.category, st.answers);
    if (r.result !== 'ok' && r.result !== 'dup') {
      if (r.result === 'limit' || r.result === 'open') { await refreshAll(); show('shop', JOIN_ERRORS[r.result]); } else show('ask', JOIN_ERRORS[r.result]);
      return;
    }
    st.done = { position: r.position, waiting: r.waiting };
    show('done');
    void refreshAll();
  } finally {
    st.busy = false;
  }
}

/** 줄 선 사람의 개업 알림 신청 */
async function saveContact(phone: string, fail: (message: string) => void) {
  if (st.busy) return;
  st.busy = true;
  try {
    const r = await api.setContact(phone);
    if (r !== 'ok') {
      fail(r === 'invalid' ? '휴대폰 번호를 확인해 주세요.'
        : r === 'noqueue' ? '줄에 서 있어야 알림을 받을 수 있어요.'
        : JOIN_ERRORS[r === 'busy' ? 'busy' : 'error']);
      return;
    }
    toast('가게가 열리면 문자로 알려드릴게요.');
    await refreshAll();
    show(st.done ? 'done' : 'shop');
  } finally {
    st.busy = false;
  }
}

function askContact() {
  history.pushState(null, '', location.href);
  show('contact');
}

// ───────── 화면 조각 ─────────

function top(): HTMLElement {
  const h = el('header', 'top');
  const brand = link('brand', SERVICE_NAME, '/');
  brand.prepend(el('i'));
  brand.addEventListener('click', e => { e.preventDefault(); openPicker('sido'); });
  h.appendChild(brand);
  if (st.map && st.map.total > 0) {
    const t = el('span', 'total');
    t.append('전국 ', el('b', undefined, `${fmt(st.map.total)}명`), ' 대기 중');
    h.appendChild(t);
  }
  return h;
}

function back(text: string, onClick: () => void): HTMLElement {
  return button('back', `‹ ${text}`, onClick);
}

function notice(): HTMLElement | null {
  if (!st.notice) return null;
  const n = el('p', 'notice', st.notice);
  n.setAttribute('role', 'alert');
  return n;
}

function footer(): HTMLElement {
  const f = el('footer', 'foot');
  if (api.local) f.appendChild(el('p', 'local', '연습 모드예요. 서버에 연결되지 않아 이 기기에만 저장돼요.'));
  const links = el('p');
  links.append(link('', '개인정보 처리방침', '/privacy.html'), ' · ', link('', 'parting.io', PARTING_URL, true));
  f.appendChild(links);
  return f;
}

/** 대기 인원만큼 사람을 그린다. 내가 서 있으면 맨 끝 사람이 나다 */
function queueFigures(waiting: number, mine: boolean): HTMLElement {
  const q = el('div', 'queue');
  q.setAttribute('role', 'img');
  q.setAttribute('aria-label', waiting > 0 ? `가게 앞에 ${fmt(waiting)}명이 줄 서 있어요` : '아직 줄이 없어요');
  const drawn = Math.min(waiting, QUEUE_DRAW);
  for (let i = 0; i < drawn; i++) {
    const p = el('i', `person tone-${i % 4}`);
    if (mine && i === drawn - 1) p.className = 'person me';
    q.appendChild(p);
  }
  if (waiting > drawn) q.appendChild(el('span', 'more', `+${fmt(waiting - drawn)}`));
  return q;
}

function shopfront(sigungu: string, category: CategoryKey, waiting: number, open: boolean, mine: boolean): HTMLElement {
  const s = el('section', open ? 'shop lit' : 'shop');
  const sign = el('div', 'sign');
  sign.append(el('small', undefined, regionLabel(sigungu)), el('strong', undefined, categoryOf(category)!.name));
  const tag = el('span', 'tag', open ? '영업 중' : '주인 구함');
  const front = el('div', 'front');
  front.append(el('i', 'window'), el('i', 'door'), el('i', 'window'));
  s.append(sign, tag, front, queueFigures(open ? 0 : waiting, mine), el('i', 'ground'));
  return s;
}

function myQueues(): HTMLElement | null {
  const list = st.mine?.queues ?? [];
  if (!list.length) return null;
  const box = el('section', 'mine');
  const head = el('h2', undefined, '내가 선 줄 ');
  head.appendChild(el('span', undefined, `${myActive()}/${MAX_QUEUES}`));
  box.appendChild(head);
  const ul = el('ul');
  for (const q of list) {
    const li = el('li');
    const go = button('row', '', () => openShop(q.sigungu, q.category as CategoryKey));
    go.append(
      el('b', undefined, `${regionLabel(q.sigungu)} · ${categoryOf(q.category)?.short ?? ''}`),
      el('span', undefined, q.open ? '영업 중' : `${fmt(q.position)}번째 · 대기 ${fmt(q.waiting)}명`),
    );
    li.append(go, button('out', '나가기', () => void leave(q)));
    ul.appendChild(li);
  }
  box.appendChild(ul);
  if (st.mine?.notify) {
    const n = el('p', 'notify-line', '가게가 열리면 문자로 알려드려요. ');
    n.appendChild(button('inline', '알림 그만 받기', () => void stopNotify()));
    box.appendChild(n);
  }
  return box;
}

// ───────── 화면 ─────────

function viewSido(page: HTMLElement) {
  const head = el('div', 'head');
  head.append(el('h1', undefined, '우리 동네에 열렸으면 하는 모임, 줄부터 서요'), el('p', undefined, '줄이 길어지면 주최자가 가게를 열어요. 먼저 시/도를 골라 주세요.'));
  page.appendChild(head);
  const grid = el('div', 'grid three');
  for (const s of SIDO) {
    const b = button('pick', '', () => { st.sido = s.code; show('sigungu'); });
    b.appendChild(el('b', undefined, s.short));
    const n = st.map?.sido[s.code] ?? 0;
    if (n > 0) b.appendChild(el('span', 'count', `${fmt(n)}명`));
    grid.appendChild(b);
  }
  page.appendChild(grid);
}

function viewSigungu(page: HTMLElement) {
  const sido = sidoOf(st.sido);
  if (!sido) { viewSido(page); return; }
  page.appendChild(back('시/도 다시 고르기', () => show('sido')));
  const head = el('div', 'head');
  head.append(el('h1', undefined, sido.name), el('p', undefined, '어느 동네에서 열리면 좋을까요?'));
  page.appendChild(head);
  const grid = el('div', 'grid two');
  for (const g of sigunguIn(sido.code)) {
    const b = button('pick', '', () => {
      st.sigungu = g.code;
      show('category');
      if (st.townFor !== g.code) void loadTown(g.code);
    });
    b.appendChild(el('b', undefined, g.name));
    const n = st.map?.sigungu[g.code] ?? 0;
    if (n > 0) b.appendChild(el('span', 'count', `${fmt(n)}명`));
    grid.appendChild(b);
  }
  page.appendChild(grid);
}

function viewCategory(page: HTMLElement) {
  const sigungu = st.sigungu;
  if (!sigungu || !sigunguOf(sigungu)) { viewSido(page); return; }
  page.appendChild(back('동네 다시 고르기', () => { st.sido = sigungu.slice(0, 2); show('sigungu'); }));
  const head = el('div', 'head');
  head.append(el('h1', undefined, regionLabel(sigungu)), el('p', undefined, '어떤 가게 앞에 설까요?'));
  page.appendChild(head);
  const town = st.townFor === sigungu ? st.town : null;
  const list = el('div', 'grid one');
  for (const c of CATEGORIES) {
    const shop = town?.[c.key];
    const b = button('pick shop-pick', '', () => openShop(sigungu, c.key));
    b.appendChild(el('b', undefined, c.name));
    const status = shop?.open ? '영업 중'
      : shop && shop.waiting > 0 ? `대기 ${fmt(shop.waiting)}명 · 주인 구함`
      : st.loading ? '불러오는 중' : '첫 줄을 기다려요';
    b.appendChild(el('span', shop?.open ? 'count open' : 'count', status));
    list.appendChild(b);
  }
  page.appendChild(list);
}

function viewShop(page: HTMLElement) {
  const sigungu = st.sigungu, category = st.category;
  if (!sigungu || !category) { viewSido(page); return; }
  const shop = shopNow();
  const spot = mySpot();
  const waiting = shop?.waiting ?? spot?.waiting ?? 0;
  const open = shop?.open ?? spot?.open ?? false;

  page.appendChild(back('다른 가게 보기', () => openPicker('category')));
  page.appendChild(shopfront(sigungu, category, waiting, open, !!spot && !open));
  const n = notice();
  if (n) page.appendChild(n);

  const info = el('section', 'info');
  if (open) {
    info.append(el('h1', undefined, '문을 열었어요'), el('p', undefined, '주최자가 파티를 열었어요. 지금 바로 들어갈 수 있어요.'));
    page.append(info, link('btn solid', '들어가기 ↗', shop?.url ?? spot?.url ?? PARTING_URL, true));
  } else {
    if (st.loading && !shop) {
      info.append(el('h1', undefined, '줄을 세는 중'), el('p', undefined, '잠시만요.'));
    } else {
      const h = el('h1');
      h.append('대기 ', el('em', undefined, `${fmt(waiting)}명`));
      info.append(h, el('p', undefined, remainText(waiting)));
      const bar = el('div', 'bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(GOAL));
      bar.setAttribute('aria-valuenow', String(Math.min(waiting, GOAL)));
      bar.setAttribute('aria-label', `목표 ${GOAL}명 중 ${waiting}명`);
      const fill = el('i');
      fill.style.width = `${Math.min(100, Math.round((waiting / GOAL) * 100))}%`;
      bar.appendChild(fill);
      info.appendChild(bar);
      if (!st.townFor && !st.loading && !spot) info.appendChild(el('p', 'faint', '지금 인원을 불러오지 못했어요. 줄은 설 수 있어요.'));
    }
    page.appendChild(info);

    if (spot) {
      const card = el('section', 'stand');
      card.append(el('strong', undefined, `${fmt(spot.position)}번째로 줄 서 있어요`));
      card.appendChild(el('p', undefined, st.mine?.notify ? '가게가 열리면 문자로 알려드려요.' : '친구를 데려오면 가게가 더 빨리 열려요.'));
      page.append(card, button('btn solid', '공유하기', () => void share(spot.position, spot.waiting)));
      if (!st.mine?.notify) {
        page.appendChild(button('btn', '열리면 알림 받기', askContact));
      }
    } else {
      page.appendChild(button('btn solid', '줄 서기', startJoin));
    }
    page.appendChild(button('btn text', '내가 열면 몇 명이 올까? 영수증 보기 ›', goHost));
  }

  const mine = myQueues();
  if (mine) page.appendChild(mine);
}

function viewAsk(page: HTMLElement) {
  const q = QUESTIONS[st.step];
  if (!q || !st.sigungu || !st.category) { viewShop(page); return; }
  // 마지막 문항이면 그 자리에서 줄을 선다
  const next = () => {
    if (st.busy) return;
    if (st.step >= QUESTIONS.length - 1) { void joinNow(); return; }
    st.step++;
    show('ask');
  };
  page.appendChild(back(st.step > 0 ? '이전 질문' : '가게 앞으로', () => {
    if (st.busy) return;
    if (st.step > 0) { st.step--; show('ask'); } else show('shop');
  }));
  page.appendChild(progress(st.step));
  const n = notice();
  if (n) page.appendChild(n);

  const card = el('section', 'bubble');
  card.appendChild(el('small', undefined, `${regionLabel(st.sigungu)} · ${categoryOf(st.category)!.name}`));
  const title = el('h1', undefined, q.title);
  if (!q.required) title.appendChild(el('span', 'opt', '선택'));
  card.appendChild(title);
  const choices = el('div', 'choices');
  for (const c of q.choices) {
    const b = button(st.answers[q.id] === c.key ? 'choice on' : 'choice', c.label, () => { st.answers[q.id] = c.key; next(); });
    choices.appendChild(b);
  }
  card.appendChild(choices);
  page.appendChild(card);
  if (!q.required) page.appendChild(button('btn text', '건너뛰기', () => { delete st.answers[q.id]; next(); }));
}

function progress(step: number): HTMLElement {
  const total = QUESTIONS.length;
  const p = el('div', 'steps');
  p.setAttribute('aria-label', `${total}단계 중 ${step + 1}단계`);
  for (let i = 0; i < total; i++) p.appendChild(el('i', i < step ? 'past' : i === step ? 'now' : ''));
  return p;
}

function viewContact(page: HTMLElement) {
  if (!st.sigungu || !st.category) { viewSido(page); return; }
  const leaveView = () => show(st.done ? 'done' : 'shop');
  page.appendChild(back('돌아가기', leaveView));

  const card = el('section', 'bubble');
  card.append(
    el('h1', undefined, '열리면 알려드릴까요?'),
    el('p', 'lead', '줄 선 가게가 열리면 문자로 알려드려요. 신청하지 않아도 줄은 그대로예요.'),
  );

  const label = el('label', 'field');
  label.appendChild(el('span', undefined, '휴대폰 번호'));
  const input = el('input');
  input.type = 'tel';
  input.inputMode = 'numeric';
  input.autocomplete = 'tel-national';
  input.placeholder = '010-1234-5678';
  input.maxLength = 17;
  label.appendChild(input);
  card.appendChild(label);

  const terms = el('dl', 'terms');
  const rows: [string, string][] = [
    ['수집 항목', '휴대폰 번호'],
    ['이용 목적', '줄 선 가게의 개업 알림 문자 발송'],
    ['보유 기간', '알림을 보낸 뒤, 또는 신청 후 1년 중 빠른 때에 지워요'],
  ];
  for (const [k, v] of rows) terms.append(el('dt', undefined, k), el('dd', undefined, v));
  card.appendChild(terms);
  card.appendChild(el('p', 'faint', '번호는 주최자에게 전달하지 않아요. 알림은 파팅이 보내요. 동의하지 않아도 줄은 설 수 있고, 줄에서 나가거나 알림을 끄면 번호를 바로 지워요.'));

  const agree = el('label', 'agree');
  const check = el('input');
  check.type = 'checkbox';
  const agreeText = el('span', undefined, '위 내용을 확인했고, 개업 알림 문자를 받는 데 동의해요. ');
  agreeText.appendChild(link('', '개인정보 처리방침', '/privacy.html', true));
  agree.append(check, agreeText);
  card.appendChild(agree);

  const error = el('p', 'error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  card.appendChild(error);
  page.appendChild(card);

  const withPhone = button('btn solid', '알림 받기', () => void run());
  page.append(withPhone, button('btn text', '안 받을래요', leaveView));

  const sync = () => { withPhone.disabled = st.busy || !(normalizePhone(input.value) && check.checked); };
  const fail = (message: string) => { error.textContent = message; error.hidden = false; };
  async function run() {
    const phone = normalizePhone(input.value);
    if (!phone || !check.checked) return;
    error.hidden = true;
    const pending = saveContact(phone, fail);
    sync();
    await pending;
    sync();
  }
  input.addEventListener('input', sync);
  check.addEventListener('change', sync);
  sync();
}

function viewDone(page: HTMLElement) {
  const d = st.done;
  if (!d || !st.sigungu || !st.category) { viewShop(page); return; }
  const cat = categoryOf(st.category)!;
  page.appendChild(shopfront(st.sigungu, st.category, d.waiting, false, true));

  const info = el('section', 'info done');
  const h = el('h1');
  h.append(el('em', undefined, `${fmt(d.position)}번째`), '로 줄 섰어요');
  info.append(h, el('p', undefined, `${regionLabel(st.sigungu)} · ${cat.name}`), el('p', 'lamp', remainText(d.waiting)));
  if (st.mine?.notify) info.appendChild(el('p', 'faint', '가게가 열리면 문자로 알려드릴게요.'));
  page.appendChild(info);

  page.appendChild(button('btn solid', '친구에게 공유하기', () => void share(d.position, d.waiting)));
  // 번호는 줄 선 뒤에, 원하는 사람만 남긴다
  if (!st.mine?.notify) page.appendChild(button('btn', '열리면 알림 받기', askContact));

  if (st.answers.host === 'yes') {
    const host = el('section', 'stand');
    host.append(el('strong', undefined, '직접 열어볼 생각이 있다고 하셨죠'), el('p', undefined, '이 가게 앞에 선 줄이 그대로 첫 손님이 돼요.'));
    page.append(host, button('btn', '이 가게 영수증 보기 ›', goHost));
  }
  page.appendChild(button('btn text', '가게 앞으로 돌아가기', () => { st.done = null; show('shop'); }));
  page.appendChild(el('p', 'faint center', '3D 거리는 준비 중이에요. 열리면 여기서 바로 구경할 수 있어요.'));
}

function render() {
  root.textContent = '';
  const page = el('main', `page view-${st.view}`);
  page.appendChild(top());
  switch (st.view) {
    case 'sido': viewSido(page); break;
    case 'sigungu': viewSigungu(page); break;
    case 'category': viewCategory(page); break;
    case 'shop': viewShop(page); break;
    case 'ask': viewAsk(page); break;
    case 'contact': viewContact(page); break;
    case 'done': viewDone(page); break;
  }
  if (st.view === 'sido' || st.view === 'sigungu' || st.view === 'category') {
    const mine = myQueues();
    if (mine) page.appendChild(mine);
  }
  page.appendChild(footer());
  root.appendChild(page);
}

// ───────── 시작 ─────────

function start() {
  const params = new URLSearchParams(location.search);
  // 주소에 ?host를 붙이면 주최자용 페이지로 보낸다
  if (params.has('host')) {
    const t = readUrl();
    location.replace(t ? receiptUrl(t.sigungu, t.category) : receiptUrl());
    return;
  }
  const ref =params.get('ref') === 'share' ? 'share' : 'direct';
  // 주소창의 링크를 다시 공유해도 공유 유입으로 겹쳐 세지 않게 ref는 지운다
  if (params.has('ref')) {
    params.delete('ref');
    const q = params.toString();
    history.replaceState(null, '', q ? `${location.pathname}?${q}` : location.pathname);
  }

  const target = readUrl();
  if (target) openShop(target.sigungu, target.category, false); else show('sido');

  // 뒤로 가기: 설문 중이면 가게 앞으로, 가게 앞이면 고르는 화면으로
  window.addEventListener('popstate', () => {
    const t = readUrl();
    if (!t) { show('sido'); return; }
    // 줄 선 직후 알림 화면에서 뒤로 가면 완료 화면으로 돌아간다
    if (st.view === 'contact' && st.done && t.sigungu === st.sigungu && t.category === st.category) { show('done'); return; }
    openShop(t.sigungu, t.category, false);
  });

  void api.visit(ref);
  void refreshAll();
}

start();
