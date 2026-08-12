'use client';

// Beyond OS v41-151
// 학부모가 자녀의 주간 시간표를 확인하고, 필요하면 그 자리에서 고쳐 제출하는 화면입니다.

import { useMemo, useState } from 'react';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };

function emptyDay() {
  return { checkIn: '09:00', checkOut: '22:00', breaks: [] };
}

export default function ConfirmForm({ token, student, period, snapshotDays, initialStatus, guardianHint }) {
  const [days, setDays] = useState(() => {
    const base = {};
    for (const key of DAY_KEYS) {
      const item = snapshotDays?.[key];
      base[key] = item ? { ...item, breaks: Array.isArray(item.breaks) ? item.breaks : [] } : null;
    }
    return base;
  });
  const [editing, setEditing] = useState(false);
  const [guardianName, setGuardianName] = useState(guardianHint || '');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const attendDays = useMemo(
    () => DAY_KEYS.filter((key) => days[key] && !days[key].absent).length,
    [days],
  );

  function setDay(dayKey, patch) {
    setDays((prev) => ({ ...prev, [dayKey]: prev[dayKey] ? { ...prev[dayKey], ...patch } : { ...emptyDay(), ...patch } }));
  }
  function toggleAttend(dayKey, attend) {
    setDays((prev) => ({ ...prev, [dayKey]: attend ? (prev[dayKey] || emptyDay()) : null }));
  }
  function setBreak(dayKey, index, patch) {
    setDays((prev) => {
      const day = prev[dayKey] || emptyDay();
      const breaks = [...(day.breaks || [])];
      breaks[index] = { ...breaks[index], ...patch };
      return { ...prev, [dayKey]: { ...day, breaks } };
    });
  }
  function addBreak(dayKey) {
    setDays((prev) => {
      const day = prev[dayKey] || emptyDay();
      return { ...prev, [dayKey]: { ...day, breaks: [...(day.breaks || []), { start: '', end: '', reason: '' }] } };
    });
  }
  function removeBreak(dayKey, index) {
    setDays((prev) => {
      const day = prev[dayKey] || emptyDay();
      return { ...prev, [dayKey]: { ...day, breaks: (day.breaks || []).filter((_, i) => i !== index) } };
    });
  }

  async function submit(decision) {
    if (!guardianName.trim()) { setError('보호자 성함을 입력해 주세요.'); return; }
    setError('');
    setSending(true);
    try {
      const response = await fetch('/api/schedule-confirm-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, decision, guardianName, note, days }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '제출에 실패했습니다.');
      setResult(data);
    } catch (err) {
      setError(err?.message || '제출 중 오류가 발생했습니다.');
    } finally {
      setSending(false);
    }
  }

  if (result?.ok) {
    return (
      <div className="done-card">
        <strong>{result.status === 'confirmed' ? '확인이 완료되었습니다' : '수정 요청이 접수되었습니다'}</strong>
        <p>{result.message}</p>
        <span>문의사항은 비욘드 관리센터로 연락 주세요.</span>
      </div>
    );
  }

  return (
    <>
      {initialStatus && initialStatus !== 'pending' ? (
        <div className="notice-box">
          이미 한 번 제출하신 내역이 있습니다. 다시 제출하시면 마지막 내용으로 갱신됩니다.
        </div>
      ) : null}

      <div className="table-card">
        <div className="table-head">
          <strong>{student?.name} 학생 주간 시간표</strong>
          <span>{period?.start} ~ {period?.end} · 등원 {attendDays}일</span>
        </div>

        <table>
          <thead>
            <tr><th>요일</th><th>등원</th><th>하원</th><th>외출(학원 등)</th></tr>
          </thead>
          <tbody>
            {DAY_KEYS.map((dayKey) => {
              const day = days[dayKey];
              const attend = Boolean(day);
              return (
                <tr key={dayKey} className={attend ? '' : 'is-off'}>
                  <th scope="row">
                    {DAY_LABELS[dayKey]}
                    {editing ? (
                      <label className="attend-toggle">
                        <input type="checkbox" checked={attend} onChange={(e) => toggleAttend(dayKey, e.target.checked)} />
                        등원
                      </label>
                    ) : null}
                  </th>
                  {!attend ? (
                    <td colSpan={3} className="off-cell">등원하지 않음</td>
                  ) : (
                    <>
                      <td>
                        {editing
                          ? <input type="time" value={day.checkIn || ''} onChange={(e) => setDay(dayKey, { checkIn: e.target.value })} />
                          : (day.checkIn || '-')}
                      </td>
                      <td>
                        {editing
                          ? <input type="time" value={day.checkOut || ''} onChange={(e) => setDay(dayKey, { checkOut: e.target.value })} />
                          : (day.checkOut || '-')}
                      </td>
                      <td>
                        {(day.breaks || []).length === 0 && !editing ? <em className="muted-cell">없음</em> : null}
                        {(day.breaks || []).map((gap, index) => (
                          <div key={index} className="break-row">
                            {editing ? (
                              <>
                                <input type="time" value={gap.start || ''} onChange={(e) => setBreak(dayKey, index, { start: e.target.value })} />
                                <span>~</span>
                                <input type="time" value={gap.end || ''} onChange={(e) => setBreak(dayKey, index, { end: e.target.value })} />
                                <input type="text" placeholder="사유(학원명 등)" value={gap.reason || ''} onChange={(e) => setBreak(dayKey, index, { reason: e.target.value })} />
                                <button type="button" onClick={() => removeBreak(dayKey, index)}>삭제</button>
                              </>
                            ) : (
                              <span>{gap.start}~{gap.end || '?'}{gap.reason ? ` · ${gap.reason}` : ''}</span>
                            )}
                          </div>
                        ))}
                        {editing ? <button type="button" className="add-break" onClick={() => addBreak(dayKey)}>+ 외출 추가</button> : null}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="form-card">
        <label className="field">
          <span>보호자 성함</span>
          <input type="text" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder="예: 홍길동" />
        </label>
        <label className="field">
          <span>남기실 말씀 (선택)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="추가로 알려주실 내용이 있으면 적어주세요." />
        </label>

        {error ? <div className="error-box">{error}</div> : null}

        {!editing ? (
          <div className="action-row">
            <button type="button" className="primary" disabled={sending} onClick={() => submit('confirm')}>
              {sending ? '제출 중...' : '이대로 확인합니다'}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(true)}>수정이 필요합니다</button>
          </div>
        ) : (
          <div className="action-row">
            <button type="button" className="primary" disabled={sending} onClick={() => submit('change')}>
              {sending ? '제출 중...' : '수정한 내용으로 제출'}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>수정 취소</button>
          </div>
        )}
        <p className="guide">
          {editing
            ? '고치실 요일의 시간을 바꾸고 제출해 주세요. 등원하지 않는 요일은 “등원” 체크를 해제하시면 됩니다.'
            : '표의 내용이 맞으면 “이대로 확인합니다”를, 다른 부분이 있으면 “수정이 필요합니다”를 눌러주세요.'}
        </p>
      </div>
    </>
  );
}
