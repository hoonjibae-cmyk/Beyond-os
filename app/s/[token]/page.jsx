// Beyond OS v41-151
// 학부모 시간표 최종 확인 공개 페이지 (/s/[token])
// 로그인 없이 토큰으로 열리며, 해당 학생 한 명의 시간표만 보여줍니다.

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import ConfirmForm from './ConfirmForm';

export const dynamic = 'force-dynamic';

async function loadConfirmation(token) {
  if (!token) return null;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('schedule_confirmations')
      .select('*, students(id, name, school, grade)')
      .eq('token', token)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

const styles = `
  *{box-sizing:border-box}
  body{margin:0}
  .wrap{min-height:100vh;background:#f5f5f7;padding:20px 14px 48px;
    font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#1d1d1f}
  .inner{max-width:720px;margin:0 auto;display:grid;gap:14px}
  header{background:#fff;border-radius:20px;padding:22px 20px;box-shadow:0 8px 24px rgba(0,0,0,.05)}
  header h1{margin:0;font-size:20px;letter-spacing:-.02em}
  header p{margin:6px 0 0;font-size:13.5px;color:#6e6e73;line-height:1.6}
  header .badge{display:inline-block;background:#0071e3;color:#fff;border-radius:999px;
    padding:4px 12px;font-size:11.5px;font-weight:800;margin-bottom:10px}
  .table-card,.form-card,.done-card,.notice-box,.error-box{background:#fff;border-radius:20px;
    box-shadow:0 8px 24px rgba(0,0,0,.05)}
  .table-card{padding:18px 16px}
  .table-head{margin-bottom:12px}
  .table-head strong{display:block;font-size:15.5px}
  .table-head span{display:block;margin-top:3px;font-size:12.5px;color:#6e6e73;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th,td{border-bottom:1px solid #f0f0f2;padding:10px 6px;text-align:left;vertical-align:top}
  thead th{font-size:12px;color:#6e6e73;font-weight:700;border-bottom:1px solid #e5e5ea}
  tbody th{width:52px;font-weight:800;color:#1d1d1f}
  tr.is-off{background:#fafafc}
  .off-cell{color:#86868b;font-weight:600}
  .muted-cell{color:#86868b;font-style:normal}
  .attend-toggle{display:flex;align-items:center;gap:4px;margin-top:5px;font-size:11px;font-weight:700;color:#6e6e73}
  .break-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:5px}
  .break-row input[type=text]{flex:1 1 110px;min-width:90px}
  input[type=time],input[type=text],textarea{font-family:inherit;font-size:13.5px;border:1px solid #d2d2d7;
    border-radius:9px;padding:7px 9px;background:#fff;color:#1d1d1f}
  textarea{width:100%;min-height:80px;resize:vertical}
  button{font-family:inherit;cursor:pointer;border:0;border-radius:12px;font-weight:800}
  .break-row button{background:#f5f5f7;color:#86868b;font-size:11.5px;padding:6px 9px}
  .add-break{background:#f0f6ff;color:#0071e3;font-size:12px;padding:7px 11px}
  .form-card{padding:18px 16px;display:grid;gap:12px}
  .field{display:grid;gap:5px}
  .field>span{font-size:12.5px;font-weight:800;color:#6e6e73}
  .action-row{display:flex;gap:8px;flex-wrap:wrap}
  .action-row button{flex:1 1 160px;min-height:48px;font-size:15px}
  .action-row .primary{background:#0071e3;color:#fff}
  .action-row .secondary{background:#f5f5f7;color:#1d1d1f}
  .guide{margin:0;font-size:12.5px;color:#86868b;line-height:1.55}
  .notice-box{padding:13px 16px;font-size:13px;color:#8a6a12;background:#fff8e8;font-weight:700}
  .error-box{padding:12px 14px;font-size:13px;color:#b4232b;background:#fdeeee;font-weight:700;box-shadow:none}
  .done-card{padding:28px 20px;text-align:center;display:grid;gap:8px}
  .done-card strong{font-size:19px}
  .done-card p{margin:0;font-size:14px;color:#424245;line-height:1.6}
  .done-card span{font-size:12.5px;color:#86868b}
  footer{text-align:center;font-size:12px;color:#86868b;line-height:1.6;margin-top:4px}
  @media (max-width:520px){ th,td{padding:9px 4px;font-size:12.5px} tbody th{width:42px} }
`;

export default async function ScheduleConfirmPage({ params }) {
  const { token } = await params;
  const row = await loadConfirmation(token);

  if (!row) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
        <div className="wrap"><div className="inner">
          <header>
            <h1>링크를 확인할 수 없습니다</h1>
            <p>주소가 잘못되었거나 만료된 링크입니다. 비욘드 관리센터로 문의해 주세요.</p>
          </header>
        </div></div>
      </>
    );
  }

  const student = row.students || {};
  const snapshotDays = row.snapshot?.days || {};

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="wrap">
        <div className="inner">
          <header>
            <span className="badge">시간표 최종 확인</span>
            <h1>{student.name || '학생'} 학생 시간표를 확인해 주세요</h1>
            <p>
              {[student.school, student.grade].filter(Boolean).join(' ')}
              {student.school || student.grade ? ' · ' : ''}
              {row.start_date} ~ {row.end_date}
              <br />
              설문에 적어주신 내용을 아래와 같이 정리했습니다. 확인 후 아래 버튼을 눌러주세요.
              수정이 필요하면 직접 고쳐서 제출하실 수 있습니다.
            </p>
          </header>

          <ConfirmForm
            token={token}
            student={student}
            period={{ start: row.start_date, end: row.end_date }}
            snapshotDays={snapshotDays}
            initialStatus={row.status}
            guardianHint={row.confirmed_by || ''}
          />

          <footer>
            The Place 26 · 비욘드 관리센터<br />
            이 링크는 해당 학생의 보호자만 사용해 주세요.
          </footer>
        </div>
      </div>
    </>
  );
}
