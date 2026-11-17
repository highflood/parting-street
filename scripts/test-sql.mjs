/**
 * 마이그레이션을 내장 Postgres(PGlite)에 올려 함수 동작과 권한을 확인한다.
 *   npm run test:sql
 * Supabase 자체(PostgREST, 기본 권한)까지 흉내 내지는 않는다. anon, authenticated 역할만 만들어 둔다.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const dir = resolve(import.meta.dirname, '../supabase/migrations');
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const db = new PGlite();

await db.exec('create role anon nologin; create role authenticated nologin;');
// Supabase처럼 새 테이블과 함수를 anon에게 기본으로 열어 둔 상태에서 시작한다
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`);
// 두 번 실행해도 되는지 본다
for (let i = 0; i < 2; i++) for (const f of files) await db.exec(readFileSync(resolve(dir, f), 'utf8'));

let n = 0;
const ok = name => { n++; console.log(`  ok  ${name}`); };
const one = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const uid = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const join = (v, s = '26230', c = 'wine', extra = '') =>
  one(`select street_join(p_visitor => $1, p_sigungu => $2, p_category => $3, p_time => 'frisat', p_fee => 'f2'${extra})`, [v, s, c]);

// ── 줄 서기 ──
let r = await join(uid(1));
assert.deepEqual(r, { result: 'ok', position: 1, waiting: 1 }); ok('첫 줄: 1번째');
r = await join(uid(2), '26230', 'wine', `, p_age => 'a20l', p_size => 'medium', p_wants_host => true`);
assert.deepEqual(r, { result: 'ok', position: 2, waiting: 2 }); ok('둘째: 2번째, 선택 문항 포함');
r = await join(uid(1));
assert.deepEqual(r, { result: 'dup', position: 1, waiting: 2 }); ok('같은 가게 중복 불가');
assert.equal((await join(uid(3), '99999')).result, 'invalid'); ok('없는 시군구 거절');
assert.equal((await join(uid(3), '26230', 'karaoke')).result, 'invalid'); ok('없는 카테고리 거절');
assert.equal((await one(`select street_join($1, '26230', 'wine', 'never', 'f2')`, [uid(3)])).result, 'invalid'); ok('잘못된 답변 거절');
assert.equal((await one(`select street_join($1, '26230', 'wine', null, 'f2')`, [uid(3)])).result, 'invalid'); ok('필수 문항 누락 거절');

// ── 5개 제한 ──
for (const c of ['board', 'rooftop', 'run', 'book']) assert.equal((await join(uid(1), '26230', c)).result, 'ok');
assert.equal((await join(uid(1), '26230', 'club')).result, 'limit'); ok('여섯 번째 줄은 거절');
assert.deepEqual(await one(`select street_leave($1, '26230', 'book')`, [uid(1)]), { result: 'ok', waiting: 0 });
assert.equal((await join(uid(1), '26230', 'club')).result, 'ok'); ok('하나 나가면 다시 설 수 있다');

// ── 연락처 ──
assert.equal(await one(`select street_contact_set($1, '010-1234-5678', '2026-11-17')`, [uid(9)]), 'noqueue'); ok('줄에 없으면 번호를 받지 않는다');
assert.equal(await one(`select street_contact_set($1, '02-123-4567', '2026-11-17')`, [uid(1)]), 'invalid'); ok('번호 형식 확인');
assert.equal(await one(`select street_contact_set($1, '010-1234-5678', '2026-11-17')`, [uid(1)]), 'ok');
assert.equal(await one(`select phone from street_contact where visitor_id = $1`, [uid(1)]), '01012345678'); ok('번호는 숫자만 저장');
assert.equal(await one(`select street_contact_set($1, '+82 10 1234 5678', '2026-11-17')`, [uid(2)]), 'ok');
assert.equal(await one(`select phone from street_contact where visitor_id = $1`, [uid(2)]), '01012345678'); ok('+82 번호 정리');

// 같은 번호의 두 방문자는 한 명으로 센다
r = await one(`select street_town('26230')`);
assert.equal(r.wine.waiting, 1); ok('같은 번호는 대기 한 명');
r = await one(`select street_mine($1)`, [uid(2)]);
assert.equal(r.notify, true);
assert.deepEqual(r.queues, [{ sigungu: '26230', category: 'wine', open: false, url: null, position: 1, waiting: 1 }]); ok('내 줄 조회에 번호는 없다');
assert.equal(JSON.stringify(r).includes('0101234'), false);

await db.query(`select street_contact_remove($1)`, [uid(2)]);
assert.equal(await one(`select count(*)::int from street_contact where visitor_id = $1`, [uid(2)]), 0); ok('알림 그만 받기: 번호 삭제');
assert.equal((await one(`select street_town('26230')`)).wine.waiting, 2);

// 마지막 줄에서 나가면 번호도 지운다
assert.equal(await one(`select street_contact_set($1, '01099998888', '2026-11-17')`, [uid(2)]), 'ok');
await db.query(`select street_leave($1, '26230', 'wine')`, [uid(2)]);
assert.equal(await one(`select count(*)::int from street_contact where visitor_id = $1`, [uid(2)]), 0); ok('마지막 줄에서 나가면 번호 삭제');
assert.equal(await one(`select count(*)::int from street_contact where visitor_id = $1`, [uid(1)]), 1); ok('남은 줄이 있으면 번호 유지');

// ── 분포와 순위 ──
r = await one(`select street_shop_detail('26230', 'wine')`);
assert.equal(r.waiting, 1); assert.equal(r.dist, null); assert.equal(r.min, 5); ok('기준 미만이면 분포를 비운다');
for (let i = 10; i < 16; i++) await join(uid(i), '26230', 'wine', `, p_age => 'a30e'`);
await db.query(`select street_contact_set($1, '01011112222', '2026-11-17')`, [uid(10)]);
r = await one(`select street_shop_detail('26230', 'wine')`);
assert.equal(r.waiting, 7); assert.equal(r.notify, 2);
assert.deepEqual(r.dist.time, { frisat: 7 }); assert.deepEqual(r.dist.age, { a30e: 6 }); ok('기준 이상이면 분포를 준다');
assert.equal(JSON.stringify(r).includes('0101'), false);

await join(uid(20), '11440', 'board');
r = await one(`select street_map()`);
assert.equal(r.sigungu['26230'], 11); assert.equal(r.sido['26'], 11); assert.equal(r.sido['11'], 1); assert.equal(r.total, 12); ok('지도 합계');
r = await one(`select street_rank(3)`);
assert.equal(r.length, 3); assert.deepEqual([r[0].sigungu, r[0].category, r[0].waiting, r[0].week], ['26230', 'wine', 7, 7]); ok('순위');

// ── 개업 ──
await db.exec(`insert into street_shop (sigungu, category, party_url) values ('26230', 'wine', 'https://parting.io/')`);
r = await one(`select street_town('26230')`);
assert.deepEqual(r.wine, { waiting: 7, open: true, url: 'https://parting.io/' });
assert.equal((await join(uid(30))).result, 'open'); ok('개업한 가게에는 줄 서지 않는다');
assert.equal((await one(`select street_map()`)).sigungu['26230'], 4); ok('개업한 가게는 대기 합계에서 빠진다');
assert.equal((await join(uid(1), '26230', 'book')).result, 'ok'); ok('개업한 가게의 줄은 5개 제한에서 빠진다');
await assert.rejects(db.exec(`insert into street_shop (sigungu, category, party_url) values ('26230', 'run', 'javascript:alert(1)')`)); ok('party_url은 https만');

// ── 방문, 클릭 ──
await db.query(`select street_visit($1, 'share')`, [uid(1)]);
await db.query(`select street_visit($1, 'direct')`, [uid(1)]);
await db.query(`select street_visit($1, '<script>')`, [uid(2)]);
assert.deepEqual((await db.query(`select ref from street_visit order by visitor_id`)).rows.map(x => x.ref), ['share', null]); ok('방문은 하루 한 번, ref 정리');
await db.query(`select street_host_click($1, '26230', 'run')`, [uid(1)]);
await db.query(`select street_host_click($1, '00000', 'run')`, [uid(1)]);
assert.equal(await one(`select count(*)::int from street_host_click`), 1); ok('주최 클릭 기록');
await db.query(`select street_host_click($1, '26230', 'run')`, [uid(1)]);
await db.query(`select street_host_click($1, '26230', 'run')`, [uid(2)]);
r = await one(`select street_shop_detail('26230', 'run')`);
assert.equal(r.clicks, 2); assert.equal(r.week, 1); ok('영수증: 클릭한 사람 수(중복 제외)와 7일 증가');

// ── 반복 호출 제한 ──
await db.exec(`select set_config('request.headers', '{"cf-connecting-ip":"203.0.113.7"}', false)`);
let busy = 0;
for (let i = 100; i < 145; i++) if ((await join(uid(i), '11680', 'run')).result === 'busy') busy++;
assert.equal(busy, 5); ok('같은 IP에서 10분에 40번까지');
assert.equal(await one(`select count(*)::int from street_throttle where key like '%203%'`), 0); ok('IP는 해시로만 남는다');
await db.exec(`select set_config('request.headers', '', false)`);

// ── 권한: anon은 테이블과 내부 함수에 닿지 못한다 ──
await db.exec('set role anon');
for (const t of ['street_queue', 'street_contact', 'street_shop', 'street_visit', 'street_host_click', 'street_region', 'street_throttle']) {
  await assert.rejects(db.query(`select * from ${t} limit 1`), /permission denied/);
  await assert.rejects(db.query(`delete from ${t}`), /permission denied/);
}
ok('anon은 테이블을 직접 읽거나 쓸 수 없다');
for (const f of ['street_counts()', `street_spot('${uid(1)}', '26230', 'wine')`, 'street_throttled(1)', 'street_contact_purge()', 'street_min_display()']) {
  await assert.rejects(db.query(`select ${f}`), /permission denied/);
}
ok('anon은 내부 함수를 부를 수 없다');
assert.equal((await join(uid(40), '11440', 'wine')).result, 'ok');
assert.equal(typeof (await one(`select street_map()`)).total, 'number');
assert.equal((await one(`select street_rank(5)`)).length > 0, true);
assert.equal((await one(`select street_shop_detail('26230', 'wine')`)).open, true);
assert.equal(await one(`select street_contact_set($1, '01033334444', '2026-11-17')`, [uid(40)]), 'ok');
assert.equal((await one(`select street_mine($1)`, [uid(40)])).notify, true);
await db.query(`select street_contact_remove($1)`, [uid(40)]);
await db.query(`select street_visit($1, 'share')`, [uid(40)]);
await db.query(`select street_host_click($1, '11440', 'wine')`, [uid(40)]);
assert.equal((await one(`select street_leave($1, '11440', 'wine')`, [uid(40)])).result, 'ok');
ok('anon은 공개 함수만으로 전체 흐름을 쓸 수 있다');
await db.exec('reset role');

// ── 보유 기간 ──
await db.exec(`update street_contact set consent_at = now() - interval '13 months' where visitor_id = '${uid(10)}'`);
assert.equal(await one(`select street_contact_purge()`), 1); ok('1년 지난 번호 삭제');

assert.equal(await one(`select count(*)::int from street_region`), 256);
console.log(`\n${n}개 통과 (마이그레이션 ${files.length}개)`);
await db.close();
