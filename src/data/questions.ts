/**
 * 줄 설 때 묻는 문항. 지역과 카테고리는 어느 가게 앞인지로 이미 정해진다.
 * 보기의 key는 DB 제약과 맞아야 한다 (supabase/migrations/20261117000000_street.sql의 street_queue).
 * 문구(label)는 자유롭게 바꿔도 되지만 key를 바꾸거나 추가하면 SQL의 check 목록도 같이 고친다.
 */
export type QId = 'time' | 'fee' | 'age' | 'size' | 'host';

export interface Choice { key: string; label: string }
export interface Question { id: QId; title: string; required: boolean; choices: Choice[] }

export const QUESTIONS: Question[] = [
  {
    id: 'time', title: '언제가 좋아요?', required: true,
    choices: [{ key: 'weekday', label: '평일 저녁' }, { key: 'frisat', label: '금 · 토 밤' }, { key: 'weekend', label: '주말 낮' }],
  },
  {
    id: 'fee', title: '참가비는 얼마까지?', required: true,
    choices: [{ key: 'f1', label: '1만 원 이하' }, { key: 'f2', label: '1~3만 원' }, { key: 'f3', label: '3~5만 원' }, { key: 'f4', label: '5만 원 이상' }],
  },
  {
    id: 'age', title: '연령대를 알려주세요', required: false,
    choices: [
      { key: 'a20e', label: '20대 초반' }, { key: 'a20l', label: '20대 후반' }, { key: 'a30e', label: '30대 초반' },
      { key: 'a30l', label: '30대 후반' }, { key: 'a40', label: '40대 이상' },
    ],
  },
  {
    id: 'size', title: '몇 명 모임이 편해요?', required: false,
    choices: [{ key: 'small', label: '4~6명' }, { key: 'medium', label: '8~12명' }, { key: 'large', label: '20명 이상' }],
  },
  {
    id: 'host', title: '직접 열어볼 생각 있어요?', required: false,
    choices: [{ key: 'yes', label: '있어요' }, { key: 'no', label: '아직은' }],
  },
];

/** 문항 id → 고른 보기의 key. 건너뛴 선택 문항은 없다 */
export type Answers = Partial<Record<QId, string>>;
