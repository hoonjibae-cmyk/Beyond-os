-- Beyond OS v40-119: 선택 SQL
-- 목적: attendance_import_events.idempotency_key에 일반 UNIQUE 제약을 추가해
-- 향후 ON CONFLICT(idempotency_key) 사용도 가능하게 보강합니다.
-- v40-119 앱은 upsert를 사용하지 않으므로 필수 SQL은 아닙니다.

-- 1) 중복 idempotency_key가 있는지 먼저 확인
select idempotency_key, count(*)
from attendance_import_events
where idempotency_key is not null
  and idempotency_key <> ''
group by idempotency_key
having count(*) > 1;

-- 위 조회 결과가 0건이면 아래를 실행해도 됩니다.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'attendance_import_events_idempotency_key_unique'
  ) then
    alter table attendance_import_events
      add constraint attendance_import_events_idempotency_key_unique
      unique (idempotency_key);
  end if;
end $$;
