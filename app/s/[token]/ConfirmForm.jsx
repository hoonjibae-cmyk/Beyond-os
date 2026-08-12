'use client';

// Beyond OS v41-151
// 학부모가 자녀의 주간 시간표를 확인하고, 필요하면 그 자리에서 고쳐 제출하는 화면입니다.

import { useMemo, useState } from 'react';
import { formatSpecialDate, SPECIAL_TYPE_LABELS } from '../../../lib/specialScheduleParse';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };

// 학부모가 고를 수 있는 특별 일정 종류. '확인 필요(unknown)'는 고를 수 없고,
// 날짜를 채워 넣으면 결석/외출 중 하나로 바꾸도록 안내합니다.
const SPECIAL_CHOICES = [
  { value: 'absent', label: '결석 (하루 종일 안 옴)' },
  { value: 'away', label: '외출 (중간에 나갔다 옴)' },
  { value: 'start_from', label: '이 날부터 등원 시작' },
];

function emptyDay() {
  return { checkIn: '09:00', checkOut: '22:00', breaks: [] };
}

function describeSpecial(item) {
  if (item.type === 'start_from') {
    return item.dates?.[0] ? `${formatSpecialDate(item.dates[0])}부터 등원 시작` : '등원 시작일 미정';
  }
  const when = (item.dates || []).length
    ? item.dates.map(formatSpecialDate).join(', ')
    : '날짜 미정';
  if (item.type === 'away') {
    return `${when} · ${item.start || '?'} ~ ${item.end || '?'} 외출`;
  }
  if (item.type === 'absent') return `${when} · 결석`;
  return when;
}

export default function ConfirmForm({
  token, student, period, snapshotDays, snapshotSpecial, specialRaw, initialStatus, guardianHint,
}) {
  const [days, setDays] = useState(() => {
    const base = {};
    for (const key of DAY_KEYS) {
      const item = snapshotDays?.[key];
      base[key] = item ? { ...item, breaks: Array.isArray(item.breaks) ? item.breaks : [] } : null;
    }
    return base;
  });
  const [special, setSpecial] = useState(() => (Array.isArray(snapshotSpecial) ? snapshotSpecial : []).map((item, index) => ({
    key: `s${index}`,
    type: item?.type || 'unknown',
    dates: Array.isArray(item?.dates) ? item.dates : [],
    start: item?.start || '',
    end: item?.end || '',
    reason: item?.reason || '',
    raw: item?.raw || '',
    needsReview: Boolean(item?.needsReview),
    include: item?.include === false ? false : true,
  })));
  const [newDate, setNewDate] = useState({});
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

  function setSpecialItem(key, patch) {
    setSpecial((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }
  function addSpecialDate(key) {
    const date = newDate[key];
    if (!date) return;
    setSpecial((prev) => prev.map((item) => (item.key === key
      ? { ...item, dates: [...new Set([...(item.dates || []), date])].sort() }
      : item)));
    setNewDate((prev) => ({ ...prev, [key]: '' }));
  }
  function removeSpecialDate(key, date) {
    setSpecial((prev) => prev.map((item) => (item.key === key
      ? { ...item, dates: (item.dates || []).filter((value) => value !== date) }
      : item)));
  }
  function addSpecialItem() {
    setSpecial((prev) => [...prev, {
      key: `n${prev.length}-${prev.reduce((sum, item) => sum + item.dates.length, 0)}`,
      type: 'absent', dates: [], start: '', end: '', reason: '', raw: '', needsReview: false, include: true,
    }]);
  }
  function removeSpecialItem(key) {
    setSpecial((prev) => prev.filter((item) => item.key !== key));
  }

  const activeSpecial = special.filter((item) => item.include !== false);

  async function submit(decision) {
    if (!guardianName.trim()) { setError('보호자 성함을 입력해 주세요.'); return; }
    setError('');
    setSending(true);
    try {
      const response = await fetch('/api/schedule-confirm-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          decision,
          guardianName,
          note,
          days,
          special: special.map(({ key, ...rest }) => rest),
        }),
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

      {special.length || editing ? (
        <div className="special-card">
          <div className="table-head">
            <strong>특별 일정 {activeSpecial.length ? `${activeSpecial.length}건` : ''}</strong>
            <span>
              가족여행·병원 등 특정 날짜의 예외입니다.
              {editing ? ' 날짜와 시간을 고치거나, 해당 없는 항목은 체크를 해제해 주세요.' : ' 맞는지 확인해 주세요.'}
            </span>
          </div>

          {!special.length ? (
            <div className="special-empty">등록된 특별 일정이 없습니다.</div>
          ) : null}

          <div className="special-list">
            {special.map((item) => {
              const off = item.include === false;
              const review = item.needsReview || (item.type !== 'unknown' && !item.dates.length);
              return (
                <div key={item.key} className={`special-item${off ? ' is-off' : ''}${review ? ' is-review' : ''}`}>
                  <div className="special-line">
                    <span className={`special-tag ${item.type}`}>{SPECIAL_TYPE_LABELS[item.type] || item.type}</span>
                    <span className="special-when">{describeSpecial(item)}</span>
                  </div>
                  {item.reason && !editing ? <span className="special-why">{item.reason}</span> : null}
                  {review ? (
                    <span className="special-review">
                      ⚠ {item.type === 'unknown'
                        ? '날짜를 읽지 못했습니다. 정해지셨다면 아래에서 알려주세요.'
                        : '날짜 또는 시각이 분명하지 않습니다. 확인해 주세요.'}
                    </span>
                  ) : null}
                  {item.raw && (review || editing) ? <span className="special-raw">적어주신 내용: {item.raw}</span> : null}

                  {editing ? (
                    <>
                      <div className="special-edit-row">
                        <label>
                          <input
                            type="checkbox"
                            checked={!off}
                            onChange={(e) => setSpecialItem(item.key, { include: e.target.checked })}
                          />{' '}적용
                        </label>
                        <select
                          value={SPECIAL_CHOICES.some((choice) => choice.value === item.type) ? item.type : 'absent'}
                          onChange={(e) => setSpecialItem(item.key, { type: e.target.value })}
                        >
                          {SPECIAL_CHOICES.map((choice) => (
                            <option key={choice.value} value={choice.value}>{choice.label}</option>
                          ))}
                        </select>
                        <button type="button" className="special-remove" onClick={() => removeSpecialItem(item.key)}>항목 삭제</button>
                      </div>

                      <div className="special-dates">
                        {item.dates.map((date) => (
                          <span key={date} className="special-chip">
                            {formatSpecialDate(date)}
                            <button type="button" onClick={() => removeSpecialDate(item.key, date)} aria-label="날짜 빼기">×</button>
                          </span>
                        ))}
                      </div>
                      <div className="special-edit-row">
                        <input
                          type="date"
                          min={period?.start || undefined}
                          max={period?.end || undefined}
                          value={newDate[item.key] || ''}
                          onChange={(e) => setNewDate((prev) => ({ ...prev, [item.key]: e.target.value }))}
                        />
                        <button type="button" className="special-remove" onClick={() => addSpecialDate(item.key)}>날짜 추가</button>
                      </div>

                      {item.type === 'away' ? (
                        <div className="special-edit-row">
                          <span>나가는 시각</span>
                          <input type="time" value={item.start || ''} onChange={(e) => setSpecialItem(item.key, { start: e.target.value })} />
                          <span>돌아오는 시각</span>
                          <input type="time" value={item.end || ''} onChange={(e) => setSpecialItem(item.key, { end: e.target.value })} />
                        </div>
                      ) : null}

                      <div className="special-edit-row">
                        <span>사유</span>
                        <input
                          type="text"
                          placeholder="예: 가족여행, 병원 진료"
                          value={item.reason || ''}
                          onChange={(e) => setSpecialItem(item.key, { reason: e.target.value })}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>

          {editing ? (
            <button type="button" className="special-add" onClick={addSpecialItem} style={{ marginTop: 10 }}>+ 특별 일정 추가</button>
          ) : null}

          {specialRaw && !editing ? <p className="special-raw" style={{ marginTop: 10 }}>설문에 적어주신 원문: {specialRaw}</p> : null}
        </div>
      ) : null}

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
            ? '고치실 요일의 시간을 바꾸고 제출해 주세요. 등원하지 않는 요일은 “등원” 체크를 해제하시면 됩니다. 특별 일정도 함께 고칠 수 있습니다.'
            : '주간 시간표와 특별 일정이 모두 맞으면 “이대로 확인합니다”를, 다른 부분이 있으면 “수정이 필요합니다”를 눌러주세요.'}
        </p>
      </div>
    </>
  );
}
