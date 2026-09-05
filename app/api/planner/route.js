import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { normalizePlannerRotation } from '../../../lib/plannerRotation';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getKstDateString } from '../../../lib/date';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'planner-photos';

function sanitizeFileName(name) {
  return String(name || 'planner.jpg')
    .replace(/[^\w.\-가-힣]/g, '_')
    .slice(0, 80);
}

async function ensureBucket(supabase) {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(`Storage bucket 조회 실패: ${listError.message}`);

  const exists = (buckets || []).some((bucket) => bucket.name === BUCKET);
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (createError) throw new Error(`Storage bucket 생성 실패: ${createError.message}`);
  }
}

async function getPlannerSessionId(supabase, studentId, plannerDate) {
  const { data, error } = await supabase
    .from('daily_sessions')
    .select('id')
    .eq('student_id', studentId)
    .eq('session_date', plannerDate)
    .maybeSingle();

  if (error) return null;
  return data?.id || null;
}

async function withSignedUrls(supabase, rows) {
  const output = [];

  for (const row of rows || []) {
    const path = row.file_path || row.photo_url;
    let signedUrl = null;

    if (path) {
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 60 * 6);
      signedUrl = data?.signedUrl || null;
    }

    output.push({ ...row, file_path: row.file_path || row.photo_url, signedUrl });
  }

  return output;
}

async function findExistingPlanner(supabase, studentId, plannerDate) {
  const { data, error } = await supabase
    .from('planner_photos')
    .select('*')
    .eq('student_id', studentId)
    .eq('planner_date', plannerDate)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`planner_photos 기존 데이터 조회 실패: ${error.message}`);
  return data || null;
}

// v41-240: 중복 방지 인덱스가 없는 환경에서만 쓰는 예전 방식입니다.
// 경쟁 상태를 막지 못하므로 upsert 가 안 될 때만 씁니다.
async function saveWithoutUpsert(supabase, payload, existing) {
  const result = existing?.id
    ? await supabase
      .from('planner_photos')
      .update(payload)
      .eq('id', existing.id)
      .select('*, students(*)')
      .single()
    : await supabase
      .from('planner_photos')
      .insert(payload)
      .select('*, students(*)')
      .single();
  return { saved: result.data, saveError: result.error };
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || getKstDateString();

    const { data, error } = await supabase
      .from('planner_photos')
      .select('*, students(*)')
      .eq('planner_date', date)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`planner_photos 조회 실패: ${error.message}`);

    const planners = await withSignedUrls(supabase, data || []);
    return Response.json({ date, planners });
  } catch (error) {
    return Response.json({
      error: error.message || 'Unknown error',
      hint: 'beyond_os_supabase_planner_v28_rebuild.sql을 실행했는지 확인하세요.',
    }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  let uploadedPath = null;

  try {
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || '관리자';
    await ensureBucket(supabase);

    const form = await request.formData();
    const studentId = String(form.get('studentId') || '');
    const plannerDate = String(form.get('plannerDate') || getKstDateString());
    const memo = String(form.get('memo') || '');
    // v41-235: 업로드 화면에서 이미 사진을 돌려 저장하므로 보통 0 입니다.
    // 사후 보정용으로 값을 받아 둘 수 있게 열어 둡니다.
    const rotation = normalizePlannerRotation(form.get('rotation'));
    const uploadedBy = actorName;
    const file = form.get('file');

    if (!studentId) {
      return Response.json({ error: '학생을 선택하세요.' }, { status: 400 });
    }

    if (!file || typeof file.arrayBuffer !== 'function') {
      return Response.json({ error: '업로드할 플래너 사진을 선택하세요.' }, { status: 400 });
    }

    // 학생 존재 여부 확인
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('id,name')
      .eq('id', studentId)
      .maybeSingle();

    if (studentError) throw new Error(`학생 조회 실패: ${studentError.message}`);
    if (!student) return Response.json({ error: '존재하지 않는 학생입니다.' }, { status: 400 });

    const existing = await findExistingPlanner(supabase, studentId, plannerDate);
    const sessionId = await getPlannerSessionId(supabase, studentId, plannerDate);

    const safeName = sanitizeFileName(file.name);
    const filePath = `${studentId}/${plannerDate}/${Date.now()}_${safeName}`;
    uploadedPath = filePath;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: true,
      });

    if (uploadError) throw new Error(`Storage 업로드 실패: ${uploadError.message}`);

    const payload = {
      student_id: studentId,
      session_id: sessionId || existing?.session_id || null,
      planner_date: plannerDate,
      file_path: filePath,
      file_name: safeName,
      photo_url: filePath,
      memo,
      rotation,
      uploaded_by: uploadedBy,
      updated_at: new Date().toISOString(),
    };

    let saved;
    let saveError;

    // v41-240: 같은 학생·같은 날짜는 한 줄만 있어야 합니다. (unique index)
    //
    // 지금까지는 '먼저 찾아보고 있으면 UPDATE, 없으면 INSERT' 였습니다.
    // 찾는 순간과 넣는 순간 사이에 다른 요청이 끼어들면 둘 다 '없음'으로 보고
    // 각자 INSERT 해서, 뒤에 도착한 쪽이 아래 오류로 죽었습니다.
    //   duplicate key value violates unique constraint
    //   "idx_planner_photos_student_date"
    // 업로드 버튼을 두 번 누르거나(모바일에서 응답이 느려 흔합니다) 두 사람이
    // 같은 학생을 동시에 올릴 때 재현됩니다. 실제로는 앞선 요청이 이미 저장을
    // 마친 뒤라, 사진은 들어갔는데 화면에는 실패로 뜨는 상황이었습니다.
    //
    // upsert 는 찾기와 넣기를 DB 한 번의 처리로 묶어 이 틈을 없앱니다.
    // 인덱스가 없는 환경(옛 SQL 미실행)에서는 42P10 이 나므로, 그때만
    // 예전 방식으로 물러섭니다.
    const upsertResult = await supabase
      .from('planner_photos')
      .upsert({ ...payload, ...(existing?.id ? { id: existing.id } : {}) }, { onConflict: 'student_id,planner_date' })
      .select('*, students(*)')
      .single();

    if (!upsertResult.error) {
      saved = upsertResult.data;
    } else if (String(upsertResult.error.code || '') === '42P10') {
      // 중복 방지 인덱스가 없는 환경. 예전 방식 그대로 진행합니다.
      ({ saved, saveError } = await saveWithoutUpsert(supabase, payload, existing));
    } else {
      saveError = upsertResult.error;
    }


    if (saveError) {
      await supabase.storage.from(BUCKET).remove([filePath]);
      throw new Error(`planner_photos 저장 실패: ${saveError.message}`);
    }

    const oldPath = existing?.file_path || existing?.photo_url;
    if (oldPath && oldPath !== filePath) {
      await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => null);
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'planner.upload',
      targetType: 'planner_photo',
      targetId: saved.id,
      targetName: student.name,
      payload: {
        studentId,
        plannerDate,
        fileName: safeName,
        replacedExisting: Boolean(existing?.id),
      },
    });

    const [withUrl] = await withSignedUrls(supabase, [saved]);
    return Response.json({ planner: withUrl });
  } catch (error) {
    if (uploadedPath) {
      try {
        const supabase = getSupabaseAdmin();
        await supabase.storage.from(BUCKET).remove([uploadedPath]);
      } catch {}
    }

    return Response.json({
      error: error.message || 'Unknown error',
      hint: 'ON CONFLICT를 쓰지 않는 v28 업로드 방식입니다. beyond_os_supabase_planner_v28_rebuild.sql 실행 여부와 planner_photos 컬럼 제약을 확인하세요.',
    }, { status: 500 });
  }
}

// v41-235: 이미 올라간 사진의 방향만 고칩니다.
//
// 사진 파일은 그대로 두고 각도만 바꿉니다. 리포트는 열어 볼 때마다 이 값을
// 보고 그리므로, 이미 발송한 리포트도 다음에 열면 바로 선 사진이 됩니다.
export async function PATCH(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const body = await request.json();
    const plannerId = String(body.plannerId || body.id || '').trim();
    if (!plannerId) {
      return Response.json({ error: '방향을 고칠 플래너 사진을 선택하세요.' }, { status: 400 });
    }
    const rotation = normalizePlannerRotation(body.rotation);

    const { data: saved, error } = await supabase
      .from('planner_photos')
      .update({ rotation, updated_at: new Date().toISOString() })
      .eq('id', plannerId)
      .select('*, students(*)')
      .single();
    if (error) {
      // rotation 컬럼이 없으면 무엇을 해야 하는지 바로 알 수 있게 알려 줍니다.
      const message = String(error.message || '');
      if (/rotation/i.test(message)) {
        return Response.json({
          error: '플래너 사진 방향을 저장할 칸이 아직 없습니다. Supabase에서 beyond-os-supabase-planner-rotation-v41-235.sql 을 실행한 뒤 다시 시도하세요.',
        }, { status: 409 });
      }
      throw error;
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'planner.rotate',
      targetType: 'planner_photo',
      targetId: plannerId,
      targetName: saved?.students?.name || '',
      payload: { rotation, plannerDate: saved?.planner_date || '' },
    }).catch(() => {});

    const [withUrl] = await withSignedUrls(supabase, [saved]);
    return Response.json({ planner: withUrl });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
