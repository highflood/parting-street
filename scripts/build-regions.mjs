/**
 * 시/도와 시군구 목록을 만든다.
 *
 *   node scripts/build-regions.mjs <HangJeongDong_verYYYYMMDD.geojson>
 *
 * 원본: https://github.com/vuski/admdongkor (통계청 SGIS 행정동 경계를 가공한 것, CC BY 4.0 / 공공누리 1유형)
 * 원본 파일(약 35MB)은 저장소에 넣지 않는다. 행정구역이 바뀌면 새 버전을 받아 다시 실행한다.
 *
 * 만드는 파일
 *   src/data/regions.json                                  화면용 (코드, 이름, 중심 좌표)
 *   supabase/migrations/20261117000100_street_regions.sql  DB의 유효 코드 목록
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

const src = process.argv[2];
if (!src) { console.error('원본 geojson 경로를 넘겨주세요.'); process.exit(1); }
const root = resolve(import.meta.dirname, '..');
const geo = JSON.parse(readFileSync(src, 'utf8'));

const SIDO_SHORT = {
  '서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구', '인천광역시': '인천', '광주광역시': '광주',
  '대전광역시': '대전', '울산광역시': '울산', '세종특별자치시': '세종', '경기도': '경기', '충청북도': '충북',
  '충청남도': '충남', '전라남도': '전남', '경상북도': '경북', '경상남도': '경남', '제주특별자치도': '제주',
  '강원특별자치도': '강원', '전북특별자치도': '전북', '전남광주통합특별시': '전남·광주',
};

/** 면적과 면적 가중 중심 (경위도를 평면으로 본 근사. 지도에 불빛을 찍는 용도로는 충분하다) */
function ringMoment(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j], [x1, y1] = ring[i];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  return { a: a / 2, cx: cx / 6, cy: cy / 6 };
}
function addGeometry(acc, g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    // 바깥 고리만 쓴다. 구멍은 중심에 거의 영향을 주지 않는다
    const m = ringMoment(poly[0]);
    const sign = m.a < 0 ? -1 : 1;
    acc.a += m.a * sign; acc.cx += m.cx * sign; acc.cy += m.cy * sign;
  }
}
const center = acc => [Number((acc.cx / acc.a).toFixed(4)), Number((acc.cy / acc.a).toFixed(4))];
const blank = () => ({ a: 0, cx: 0, cy: 0 });

const sido = new Map();
const sgg = new Map();
for (const f of geo.features) {
  const p = f.properties;
  if (!/^\d{5}$/.test(p.sgg) || !/^\d{2}$/.test(p.sido) || p.sgg.slice(0, 2) !== p.sido) throw new Error(`코드가 이상해요: ${JSON.stringify(p)}`);
  if (!sido.has(p.sido)) sido.set(p.sido, { name: p.sidonm, acc: blank() });
  if (!sgg.has(p.sgg)) sgg.set(p.sgg, { sido: p.sido, raw: p.sggnm, acc: blank() });
  addGeometry(sido.get(p.sido).acc, f.geometry);
  addGeometry(sgg.get(p.sgg).acc, f.geometry);
}

/** "수원시장안구" → "수원시 장안구" */
function displayName(code, raw, sidoName) {
  const m = /^(.+시)(.+구)$/.exec(raw);
  if (m) return `${m[1]} ${m[2]}`;
  // 통합특별시 안의 옛 광주 자치구는 "동구"만으로는 어디인지 알 수 없어 앞에 광주를 붙인다
  if (sidoName === '전남광주통합특별시' && raw.endsWith('구')) return `광주 ${raw}`;
  return raw;
}

const out = {
  source: `통계청 SGIS 행정동 경계(공공누리 1유형)를 가공한 vuski/admdongkor ${basename(src)} (CC BY 4.0)`,
  sido: [...sido].sort(([a], [b]) => a.localeCompare(b)).map(([code, v]) => {
    const short = SIDO_SHORT[v.name];
    if (!short) throw new Error(`짧은 이름이 없는 시/도: ${v.name}`);
    const [lng, lat] = center(v.acc);
    return { code, name: v.name, short, lng, lat };
  }),
  sigungu: [...sgg].sort(([a], [b]) => a.localeCompare(b)).map(([code, v]) => {
    const [lng, lat] = center(v.acc);
    return { code, name: displayName(code, v.raw, sido.get(v.sido).name), lng, lat };
  }),
};

const jsonPath = resolve(root, 'src/data/regions.json');
mkdirSync(dirname(jsonPath), { recursive: true });
const lines = [
  '{',
  `"source": ${JSON.stringify(out.source)},`,
  '"sido": [', out.sido.map(s => JSON.stringify(s)).join(',\n'), '],',
  '"sigungu": [', out.sigungu.map(s => JSON.stringify(s)).join(',\n'), ']',
  '}', '',
];
writeFileSync(jsonPath, lines.join('\n'));

const q = s => `'${s.replace(/'/g, "''")}'`;
const short = Object.fromEntries(out.sido.map(s => [s.code, s.short]));
const sql = `-- 파팅 거리: 유효한 시군구 코드 목록. scripts/build-regions.mjs가 만든 파일이므로 직접 고치지 않는다.
-- 20261117000000_street.sql 다음에 실행한다. 여러 번 실행해도 안전하다.
-- ${out.source}

insert into public.street_region (code, name) values
${out.sigungu.map(s => `  (${q(s.code)}, ${q(`${short[s.code.slice(0, 2)]} ${s.name}`)})`).join(',\n')}
on conflict (code) do update set name = excluded.name;
`;
writeFileSync(resolve(root, 'supabase/migrations/20261117000100_street_regions.sql'), sql);

console.log(`시/도 ${out.sido.length}개, 시군구 ${out.sigungu.length}개`);
