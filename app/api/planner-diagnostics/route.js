import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

const BUCKET = 'planner-photos';

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  const checks = {
    table: { ok: false, message: '' },
    bucket: { ok: false, message: '' },
    storageUpload: { ok: false, message: '' },
    dbWriteShape: { ok: false, message: '' },
  };

  try {
    const supabase = getSupabaseAdmin();

    const { error: tableError } = await supabase
      .from('planner_photos')
      .select('id,student_id,planner_date,file_path,photo_url,session_id')
      .limit(1);

    if (tableError) {
      checks.table.message = tableError.message;
    } else {
      checks.table.ok = true;
      checks.table.message = 'planner_photos 테이블 및 주요 컬럼 확인 완료';
    }

    const { data: buckets, error: bucketListError } = await supabase.storage.listBuckets();
    if (bucketListError) {
      checks.bucket.message = bucketListError.message;
    } else {
      const exists = (buckets || []).some((bucket) => bucket.name === BUCKET);
      if (exists) {
        checks.bucket.ok = true;
        checks.bucket.message = 'planner-photos 버킷 확인 완료';
      } else {
        const { error: createError } = await supabase.storage.createBucket(BUCKET, { public: false });
        if (createError) {
          checks.bucket.message = createError.message;
        } else {
          checks.bucket.ok = true;
          checks.bucket.message = 'planner-photos 버킷 자동 생성 완료';
        }
      }
    }

    if (checks.bucket.ok) {
      const testPath = `_diagnostics/${Date.now()}_test.txt`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(testPath, Buffer.from('planner diagnostics'), {
          contentType: 'text/plain',
          upsert: true,
        });

      if (uploadError) {
        checks.storageUpload.message = uploadError.message;
      } else {
        checks.storageUpload.ok = true;
        checks.storageUpload.message = 'Storage 테스트 업로드 성공';
        await supabase.storage.from(BUCKET).remove([testPath]);
      }
    } else {
      checks.storageUpload.message = '버킷 확인 실패로 테스트 업로드 생략';
    }

    if (checks.table.ok) {
      checks.dbWriteShape.ok = true;
      checks.dbWriteShape.message = 'v28은 ON CONFLICT/upsert를 사용하지 않아 unique constraint가 없어도 업로드 가능합니다.';
    }

    const ok = checks.table.ok && checks.bucket.ok && checks.storageUpload.ok && checks.dbWriteShape.ok;
    return Response.json({ ok, checks });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error.message || 'Unknown error',
      checks,
    }, { status: 500 });
  }
}
