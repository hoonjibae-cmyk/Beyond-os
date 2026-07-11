import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
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
      uploaded_by: uploadedBy,
      updated_at: new Date().toISOString(),
    };

    let saved;
    let saveError;

    if (existing?.id) {
      const result = await supabase
        .from('planner_photos')
        .update(payload)
        .eq('id', existing.id)
        .select('*, students(*)')
        .single();
      saved = result.data;
      saveError = result.error;
    } else {
      const result = await supabase
        .from('planner_photos')
        .insert(payload)
        .select('*, students(*)')
        .single();
      saved = result.data;
      saveError = result.error;
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
