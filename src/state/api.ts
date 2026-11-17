/**
 * 줄 서기 서버 호출. Supabase 설정이 있으면 서버 함수(RPC)를 부르고,
 * 없으면 이 브라우저에만 저장하는 연습 모드로 동작한다(개발용).
 * 함수와 인자 이름은 supabase/migrations/20261117000000_street.sql과 맞아야 한다.
 * 서버가 돌려준 값은 믿지 않고 모양을 맞춘 뒤에 쓴다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { CATEGORIES, categoryOf } from '../data/categories';
import { sigunguOf } from '../data/regions';
import type { Answers } from '../data/questions';
import { CONSENT_VERSION, MAX_QUEUES, MIN_DISPLAY } from '../config';

export interface ShopState { waiting: number; open: boolean; url: string | null }
/** 카테고리 key → 가게 상태. 줄도 없고 개업도 안 한 카테고리는 없다 */
export type Town = Record<string, ShopState>;
export interface MapStats {
  total: number;
  /** 줄이 있고 아직 주인이 없는 가게 수 */
  shops: number;
  sido: Record<string, number>;
  sigungu: Record<string, number>;
}
/** 영수증용. 대기 인원이 min 미만이면 dist는 null */
export interface ShopDetail extends ShopState {
  notify: number;
  /** 최근 7일에 줄 선 인원 */
  week: number;
  /** 최근 30일에 "이 가게 열기"를 누른 사람 수 */
  clicks: number;
  min: number;
  dist: { time: Record<string, number>; fee: Record<string, number>; age: Record<string, number>; size: Record<string, number>; hosts: number } | null;
}
export interface RankRow { sigungu: string; category: string; waiting: number; notify: number; week: number }
export interface Spot extends ShopState { sigungu: string; category: string; position: number }
export interface Mine { queues: Spot[]; notify: boolean }

export type JoinResult =
  | { result: 'ok' | 'dup'; position: number; waiting: number }
  | { result: 'limit' | 'open' | 'invalid' | 'busy' | 'error' };
export type ContactResult = 'ok' | 'invalid' | 'noqueue' | 'busy' | 'error';

export interface StreetApi {
  /** 서버 없이 이 브라우저에만 저장하는 중이면 true */
  readonly local: boolean;
  visit(ref: 'share' | 'direct'): Promise<void>;
  map(): Promise<MapStats | null>;
  town(sigungu: string): Promise<Town | null>;
  mine(): Promise<Mine | null>;
  detail(sigungu: string, category: string): Promise<ShopDetail | null>;
  rank(limit: number): Promise<RankRow[] | null>;
  join(sigungu: string, category: string, a: Answers): Promise<JoinResult>;
  leave(sigungu: string, category: string): Promise<boolean>;
  setContact(phone: string): Promise<ContactResult>;
  removeContact(): Promise<boolean>;
  hostClick(sigungu: string, category: string): Promise<void>;
}

const VISITOR_KEY = 'parting.visitor';
const uuid = () => (typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));

let memoryId: string | undefined;
/**
 * 이 브라우저의 익명 방문자 번호. 파팅 라운지와 같은 키를 쓴다.
 * 저장소를 못 쓰면(사생활 보호 모드 등) 페이지를 닫을 때까지만 유지된다.
 */
function visitorId(): string {
  try {
    const saved = localStorage.getItem(VISITOR_KEY);
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(saved)) return saved;
    const id = uuid();
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch { return (memoryId ??= uuid()); }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const counts = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries(obj(v)).map(([k, n]) => [k, num(n)]));
/** 가게 주소는 https만 받는다. 그 밖의 값은 버린다 */
const safeUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  try { return new URL(v).protocol === 'https:' ? v : null; } catch { return null; }
};
const shopState = (v: unknown): ShopState => {
  const r = obj(v);
  return { waiting: num(r.waiting), open: r.open === true, url: safeUrl(r.url) };
};

/** 숫자만 남긴 휴대폰 번호. 형식이 아니면 null */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/[^0-9]/g, '');
  if (d.startsWith('8210')) d = `0${d.slice(2)}`;
  return /^010[0-9]{8}$/.test(d) ? d : null;
}

class SupabaseStreet implements StreetApi {
  readonly local = false;
  private id = visitorId();
  constructor(private client: SupabaseClient) {}

  private async rpc(fn: string, args?: Record<string, unknown>): Promise<{ ok: boolean; data: unknown }> {
    try {
      const { data, error } = await this.client.rpc(fn, args);
      if (error) { console.warn(`${fn} 실패. SQL 마이그레이션을 실행했는지 확인하세요.`, error.message); return { ok: false, data: null }; }
      return { ok: true, data };
    } catch (err) {
      console.warn(`${fn} 실패`, err);
      return { ok: false, data: null };
    }
  }

  async visit(ref: 'share' | 'direct') { await this.rpc('street_visit', { p_visitor: this.id, p_ref: ref }); }

  async map() {
    const { ok, data } = await this.rpc('street_map');
    if (!ok) return null;
    const r = obj(data);
    return { total: num(r.total), shops: num(r.shops), sido: counts(r.sido), sigungu: counts(r.sigungu) };
  }

  async detail(sigungu: string, category: string) {
    const { ok, data } = await this.rpc('street_shop_detail', { p_sigungu: sigungu, p_category: category });
    if (!ok) return null;
    const r = obj(data);
    const d = r.dist && typeof r.dist === 'object' ? obj(r.dist) : null;
    return {
      ...shopState(r), notify: num(r.notify), week: num(r.week), clicks: num(r.clicks), min: num(r.min),
      dist: d ? { time: counts(d.time), fee: counts(d.fee), age: counts(d.age), size: counts(d.size), hosts: num(d.hosts) } : null,
    };
  }

  async rank(limit: number) {
    const { ok, data } = await this.rpc('street_rank', { p_limit: limit });
    if (!ok || !Array.isArray(data)) return null;
    const out: RankRow[] = [];
    for (const row of data) {
      const r = obj(row);
      if (typeof r.sigungu !== 'string' || !sigunguOf(r.sigungu) || typeof r.category !== 'string' || !categoryOf(r.category)) continue;
      out.push({ sigungu: r.sigungu, category: r.category, waiting: num(r.waiting), notify: num(r.notify), week: num(r.week) });
    }
    return out;
  }

  async town(sigungu: string) {
    const { ok, data } = await this.rpc('street_town', { p_sigungu: sigungu });
    if (!ok) return null;
    const out: Town = {};
    for (const [k, v] of Object.entries(obj(data))) if (categoryOf(k)) out[k] = shopState(v);
    return out;
  }

  async mine() {
    const { ok, data } = await this.rpc('street_mine', { p_visitor: this.id });
    if (!ok) return null;
    const r = obj(data);
    const queues: Spot[] = [];
    for (const q of Array.isArray(r.queues) ? r.queues : []) {
      const s = obj(q);
      if (typeof s.sigungu !== 'string' || !sigunguOf(s.sigungu) || typeof s.category !== 'string' || !categoryOf(s.category)) continue;
      queues.push({ sigungu: s.sigungu, category: s.category, position: num(s.position), ...shopState(s) });
    }
    return { queues, notify: r.notify === true };
  }

  async join(sigungu: string, category: string, a: Answers): Promise<JoinResult> {
    const { ok, data } = await this.rpc('street_join', {
      p_visitor: this.id, p_sigungu: sigungu, p_category: category,
      p_time: a.time ?? null, p_fee: a.fee ?? null, p_age: a.age ?? null, p_size: a.size ?? null,
      p_wants_host: a.host === undefined ? null : a.host === 'yes',
    });
    if (!ok) return { result: 'error' };
    const r = obj(data);
    switch (r.result) {
      case 'ok': case 'dup': return { result: r.result, position: num(r.position), waiting: num(r.waiting) };
      case 'limit': case 'open': case 'invalid': case 'busy': return { result: r.result };
      default: return { result: 'error' };
    }
  }

  async leave(sigungu: string, category: string) {
    return (await this.rpc('street_leave', { p_visitor: this.id, p_sigungu: sigungu, p_category: category })).ok;
  }

  async setContact(phone: string): Promise<ContactResult> {
    const { ok, data } = await this.rpc('street_contact_set', { p_visitor: this.id, p_phone: phone, p_consent_version: CONSENT_VERSION });
    if (!ok) return 'error';
    return data === 'ok' || data === 'invalid' || data === 'noqueue' || data === 'busy' ? data : 'error';
  }

  async removeContact() { return (await this.rpc('street_contact_remove', { p_visitor: this.id })).ok; }

  async hostClick(sigungu: string, category: string) {
    await this.rpc('street_host_click', { p_visitor: this.id, p_sigungu: sigungu, p_category: category });
  }
}

/** 서버 설정이 없는 개발 환경용. 이 브라우저가 선 줄만 센다. 휴대폰 번호는 저장하지 않는다 */
class LocalStreet implements StreetApi {
  readonly local = true;
  private key = 'parting.street.local';
  private data: { queues: { sigungu: string; category: string }[]; notify: boolean };

  constructor() {
    let d: Partial<LocalStreet['data']> = {};
    try { d = JSON.parse(localStorage.getItem(this.key) ?? '{}') ?? {}; } catch { /* ignore */ }
    const queues = Array.isArray(d.queues) ? d.queues.filter(q => q && sigunguOf(q.sigungu) && categoryOf(q.category)) : [];
    this.data = { queues, notify: d.notify === true };
  }

  private save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch { /* ignore */ } }
  private has(sigungu: string, category: string) { return this.data.queues.some(q => q.sigungu === sigungu && q.category === category); }

  async visit() { /* 집계하지 않는다 */ }

  async map() {
    const sido: Record<string, number> = {}, sigungu: Record<string, number> = {};
    for (const q of this.data.queues) {
      sigungu[q.sigungu] = (sigungu[q.sigungu] ?? 0) + 1;
      sido[q.sigungu.slice(0, 2)] = (sido[q.sigungu.slice(0, 2)] ?? 0) + 1;
    }
    return { total: this.data.queues.length, shops: this.data.queues.length, sido, sigungu };
  }

  async detail(sigungu: string, category: string) {
    const n = this.has(sigungu, category) ? 1 : 0;
    return { waiting: n, open: false, url: null, notify: n && this.data.notify ? 1 : 0, week: n, clicks: 0, min: MIN_DISPLAY, dist: null };
  }

  async rank() {
    return this.data.queues.map(q => ({ ...q, waiting: 1, notify: this.data.notify ? 1 : 0, week: 1 }));
  }

  async town(sigungu: string) {
    const out: Town = {};
    for (const c of CATEGORIES) if (this.has(sigungu, c.key)) out[c.key] = { waiting: 1, open: false, url: null };
    return out;
  }

  async mine() {
    return {
      queues: this.data.queues.map(q => ({ ...q, position: 1, waiting: 1, open: false, url: null })),
      notify: this.data.notify,
    };
  }

  async join(sigungu: string, category: string, a: Answers): Promise<JoinResult> {
    if (!sigunguOf(sigungu) || !categoryOf(category) || !a.time || !a.fee) return { result: 'invalid' };
    if (this.has(sigungu, category)) return { result: 'dup', position: 1, waiting: 1 };
    if (this.data.queues.length >= MAX_QUEUES) return { result: 'limit' };
    this.data.queues.push({ sigungu, category });
    this.save();
    return { result: 'ok', position: 1, waiting: 1 };
  }

  async leave(sigungu: string, category: string) {
    this.data.queues = this.data.queues.filter(q => !(q.sigungu === sigungu && q.category === category));
    if (!this.data.queues.length) this.data.notify = false;
    this.save();
    return true;
  }

  async setContact(phone: string): Promise<ContactResult> {
    if (!normalizePhone(phone)) return 'invalid';
    if (!this.data.queues.length) return 'noqueue';
    this.data.notify = true;
    this.save();
    return 'ok';
  }

  async removeContact() { this.data.notify = false; this.save(); return true; }
  async hostClick() { /* 기록하지 않는다 */ }
}

export function createStreetApi(): StreetApi {
  const client = getSupabase();
  return client ? new SupabaseStreet(client) : new LocalStreet();
}
