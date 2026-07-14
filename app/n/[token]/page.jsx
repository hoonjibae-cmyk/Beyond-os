import { redirect } from 'next/navigation';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

function formatDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value));
  } catch {
    return String(value).slice(0, 10);
  }
}

async function loadNotice(token) {
  if (!token) return null;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('notices').select('*').eq('token', token).maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

const wrap = {
  minHeight: '100vh',
  margin: 0,
  background: '#f5f5f7',
  color: '#1d1d1f',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",sans-serif',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '40px 18px 64px',
};
const card = {
  width: '100%',
  maxWidth: 640,
  background: '#fff',
  border: '1px solid #e6e4e0',
  borderRadius: 20,
  boxShadow: '0 1px 2px rgba(0,0,0,.04),0 12px 40px rgba(0,0,0,.06)',
  overflow: 'hidden',
};

export default async function PublicNoticePage({ params }) {
  const resolved = await params;
  const notice = await loadNotice(resolved?.token);

  if (notice?.external_url) {
    redirect(notice.external_url);
  }

  if (!notice) {
    return (
      <main style={wrap}>
        <div style={{ ...card, padding: '48px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>👑</div>
          <h1 style={{ fontSize: 20, margin: '14px 0 6px' }}>공지를 열 수 없습니다</h1>
          <p style={{ color: '#6e6e73', margin: 0, fontSize: 14 }}>링크가 만료되었거나 더 이상 사용할 수 없는 공지입니다.</p>
        </div>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <div style={{ width: '100%', maxWidth: 640, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'linear-gradient(160deg,#2b2b30,#121214)', fontSize: 22 }}>👑</div>
        <div style={{ lineHeight: 1.25 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>The Place 26</div>
          <div style={{ color: '#8e8e93', fontSize: 12, fontWeight: 600 }}>비욘드 학습관리센터 공지</div>
        </div>
      </div>

      <article style={card}>
        <header style={{ padding: '26px 28px 18px', borderBottom: '1px solid #ededf0' }}>
          <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, letterSpacing: '.12em', color: '#0071e3', background: '#eef4fe', padding: '5px 12px', borderRadius: 999 }}>공지사항</div>
          <h1 style={{ fontSize: 'clamp(22px,4vw,28px)', letterSpacing: '-.02em', margin: '14px 0 6px', wordBreak: 'keep-all' }}>{notice.title}</h1>
          {notice.created_at ? <div style={{ color: '#8e8e93', fontSize: 13 }}>{formatDate(notice.created_at)}</div> : null}
        </header>
        <div style={{ padding: '22px 28px 30px', fontSize: 15.5, lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'keep-all', color: '#1d1d1f' }}>
          {notice.body || ''}
        </div>
      </article>

      <p style={{ color: '#a1a1a8', fontSize: 12, marginTop: 22 }}>The Place 26 · 비욘드 학습관리센터</p>
    </main>
  );
}
