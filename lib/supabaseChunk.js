// Beyond OS v41-211 — id 목록으로 조회할 때 주소 길이 때문에 끊기지 않도록 나눠서 실행합니다.
//
// 왜 필요한가
//   Supabase(PostgREST)는 .in('col', [a, b, c]) 를 조회 "주소"로 보냅니다.
//     GET /rest/v1/표?col=in.(uuid,uuid,uuid,...)
//   uuid 하나가 36자(+쉼표)라 목록이 길어지면 주소가 통째로 길어지고,
//   앞단 게이트웨이가 4~8KB 근처에서 400(Bad Request)으로 끊어 버립니다.
//   v41-210 의 랭킹보드 장애가 이것이었습니다. (30일 × 26명 = 780건 → 주소 28KB)
//
// 한 번에 몇 개까지가 안전한가
//   120개 × 37자 ≈ 4.4KB. 흔한 한계(4~8KB)의 절반 수준이라 여유가 있습니다.
//   더 키우면 요청 수는 줄지만 한계에 가까워집니다. 늘리지 마세요.
//
// 쓰는 법
//   const rows = await selectInChunks(sessionIds, (part) => supabase
//     .from('attendance_events').select('*').in('session_id', part));
//
//   await runInChunks(scheduleIds, (part) => supabase
//     .from('student_schedule_breaks').delete().in('schedule_id', part));

export const SAFE_IN_CHUNK = 120;

export function toChunks(values = [], size = SAFE_IN_CHUNK) {
  const list = Array.isArray(values) ? values.filter((value) => value !== null && value !== undefined) : [];
  const step = Number(size) > 0 ? Number(size) : SAFE_IN_CHUNK;
  const out = [];
  for (let index = 0; index < list.length; index += step) out.push(list.slice(index, index + step));
  return out;
}

/**
 * 조회를 나눠서 실행하고 결과를 이어 붙입니다. 한 조각이라도 실패하면 던집니다.
 *
 * @param {Array} values in(...) 에 넣을 값 목록
 * @param {(part: Array) => PromiseLike<{data: any[], error: any}>} run 조각 하나를 조회하는 함수
 */
export async function selectInChunks(values, run, { chunkSize = SAFE_IN_CHUNK } = {}) {
  const rows = [];
  for (const part of toChunks(values, chunkSize)) {
    const { data, error } = await run(part);
    if (error) throw error;
    if (data?.length) rows.push(...data);
  }
  return rows;
}

/**
 * selectInChunks 와 같지만 실패해도 던지지 않습니다.
 * 일부만 성공했으면 그때까지 읽은 행과 함께 error 를 돌려줍니다.
 * (없어도 화면이 떠야 하는 보조 정보에만 쓰세요)
 */
export async function selectInChunksSafe(values, run, { chunkSize = SAFE_IN_CHUNK } = {}) {
  const rows = [];
  for (const part of toChunks(values, chunkSize)) {
    try {
      const { data, error } = await run(part);
      if (error) return { rows, error };
      if (data?.length) rows.push(...data);
    } catch (error) {
      return { rows, error };
    }
  }
  return { rows, error: null };
}

/**
 * 삭제·수정처럼 결과 행이 필요 없는 작업을 나눠서 실행합니다. 실패하면 던집니다.
 */
export async function runInChunks(values, run, { chunkSize = SAFE_IN_CHUNK } = {}) {
  for (const part of toChunks(values, chunkSize)) {
    const { error } = await run(part);
    if (error) throw error;
  }
}
