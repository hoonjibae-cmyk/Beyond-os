import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateManualAttendanceStudyMinutes, projectManualAttendanceEvents } from '../lib/manualAttendanceStudy.js';
const at=(time)=>`2026-11-24T${time}:00+09:00`;
const windows=[{label:'오전',start:'09:30',end:'12:00'},{label:'오후',start:'13:00',end:'17:00'}];
const event=(event_type,time)=>({event_type,event_at:at(time)});
const events=[event('check_in','09:30'),event('away','11:30'),event('return','13:30'),event('check_out','17:00')];
const session={seat_status:'out',check_in_at:at('09:30'),check_out_at:at('17:00'),away_total_minutes:120};
const calculate=(row=session,history=events,extra={})=>calculateManualAttendanceStudyMinutes(row,{events:history,studyWindows:windows,nowIso:at('17:00'),...extra});
test('lunch overlapping an absence is excluded only once',()=>assert.equal(calculate(),330));
test('an absence entirely during lunch removes no study minutes',()=>assert.equal(calculate({...session,away_total_minutes:60},[event('check_in','09:30'),event('away','12:00'),event('return','13:00'),event('check_out','17:00')]),390));
test('all completed absence intervals are included',()=>assert.equal(calculate({...session,away_total_minutes:50},[event('check_in','09:30'),event('away','11:00'),event('return','11:30'),event('away','15:00'),event('return','15:20'),event('check_out','17:00')]),340));
test('pending return and checkout produce the same saved total',()=>{
  const before=events.slice(0,2);const returned=projectManualAttendanceEvents(before,{eventType:'return',eventAt:at('13:30')});
  assert.equal(calculate({...session,check_out_at:null,seat_status:'occupied'},returned,{nowIso:at('13:30')}),120);
  assert.equal(calculate(session,projectManualAttendanceEvents(returned,{eventType:'check_out',eventAt:at('17:00')})),330);
  assert.equal(before.length,2);
});
test('ongoing absence includes only elapsed study-window time',()=>assert.equal(calculate({...session,seat_status:'away',check_out_at:null,away_started_at:at('11:30'),away_total_minutes:0},events.slice(0,2),{nowIso:at('13:15')}),120));
test('changed arrival and departure bound the absence intervals',()=>{
  assert.equal(calculate({...session,check_in_at:at('12:30')}),210);
  assert.equal(calculate({...session,check_out_at:at('11:45')}),120);
});
test('reentry converts the latest checkout without mutating history',()=>{
  const history=[event('check_in','09:30'),event('check_out','14:00')];
  const reentered=projectManualAttendanceEvents(history,{convertLastCheckout:true,eventType:'return',eventAt:at('15:00')});
  assert.equal(calculate({...session,away_total_minutes:60},reentered),330);
  assert.equal(history[1].event_type,'check_out');
});
test('absence reset clears history and returns zero',()=>{
  const projected=projectManualAttendanceEvents(events,{resetEvents:true,eventType:'absent',eventAt:at('09:30')});
  assert.equal(projected.length,1);assert.equal(calculate({...session,seat_status:'absent'},projected),0);
});
test('untimed legacy totals and explicit manual totals retain their behavior',()=>{
  assert.equal(calculate({...session,away_total_minutes:30},[]),360);
  assert.equal(calculate({...session,away_total_minutes:45},events,{useEvents:false}),345);
});
