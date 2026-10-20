/*****************************************************************
 * CALL MANAGEMENT — 6 structured calls per enquiry by default, with the option to
 * keep logging more beyond that (the UI asks for explicit confirmation past call 6).
 * Kept in its own file (Apps Script merges all top-level .js/.gs files into one
 * global scope, so this can freely use SHEETS/sh_/colMapFromRow_/etc. from Code.js
 * as long as those are only referenced inside functions here, not at file top level).
 *
 * Each logged call also runs through the existing writeNote_() follow-up engine so
 * ENQ.LastContact / ENQ.NextFollowUp / Stage stay in sync exactly the way a normal
 * "Log a communication" entry does, and the call still shows up in the Activity
 * Timeline — CallLog only adds the structured Call 1.. / CallStatus layer on top.
 *****************************************************************/

const CALL_HEADERS = ['CallLogID','CreatedAt','EnqID','Customer','CallNumber','CallDate','Employee','Remarks','NextFollowUp','CallStatus','Interest'];
const CALL_STATUSES = ['Connected','Not Connected','Busy','Switched Off','No Answer'];
// Separate from CallStatus (did the call connect?) — this is the sales read on the customer
// once you actually spoke to them. Left blank when the call didn't connect.
const CALL_INTEREST_LEVELS = ['Interested','Maybe / Thinking','Not Interested'];
// Soft default shown in the UI as "Call N of 6" — no longer a hard cap. Once an enquiry
// reaches this many calls, the UI asks the user to confirm before logging further ones.
const MAX_CALLS_PER_ENQUIRY = 6;

function getCallHistoryRows_(enqId){
  const id = String(enqId).trim();
  const out = getAllCallLogRows_().filter(function(r){ return r.EnqID === id; })
    .map(function(r){ return { CallLogID:r.CallLogID, CallNumber:r.CallNumber, CallDate:fmtNice_(r.CallDate),
      Employee:r.Employee, Remarks:r.Remarks, NextFollowUp: r.NextFollowUp ? fmtNice_(r.NextFollowUp) : '',
      CallStatus:r.CallStatus, Interest:r.Interest }; });
  out.sort(function(a,b){ return a.CallNumber - b.CallNumber; });
  return out;
}

function getCallHistory(enqId, token){
  requireAuth_(token);
  return getCallHistoryRows_(enqId);
}

function logCall(p, token){
  requireAuth_(token);
  if (!p.id) return {ok:false, msg:'Enquiry required'};
  try{
    const sh = sh_('CALL'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
    let used = 0;
    for (let i=1;i<data.length;i++){ if (String(data[i][map['EnqID']]||'').trim() === String(p.id).trim()) used++; }
    // No hard cap — past MAX_CALLS_PER_ENQUIRY the client asks the user to confirm before
    // sending the extra call, so reaching the "default" 6 no longer blocks logging more.

    const status = CALL_STATUSES.indexOf(p.callStatus) >= 0 ? p.callStatus : CALL_STATUSES[0];
    // Only meaningful once you've actually spoken to the customer — a call that didn't connect
    // has nothing to record here, regardless of what the client sent.
    const interest = (status === 'Connected' && CALL_INTEREST_LEVELS.indexOf(p.interest) >= 0) ? p.interest : '';
    const callDate = p.callDate || todayStr_();

    // writeNote_ takes its own script lock internally, so this must run before we take ours below —
    // nesting two script-lock acquisitions in the same call risks a self-deadlock.
    const noteResult = writeNote_({
      id: p.id, customer: p.customer, mode: 'Call',
      outcome: status + (interest ? (' — '+interest) : '') + (p.remarks ? (' — '+p.remarks) : ''),
      note: p.remarks || '', by: p.employee, nextFollowUp: p.nextFollowUp, actualDate: callDate
    }, true);
    if (!noteResult.ok) return noteResult;

    const lock = LockService.getScriptLock(); lock.waitLock(15000);
    try{
      const id = newIdFromRows_('CALL-', data, map['CallLogID']); // data already in hand — avoids newId_'s own second full-sheet read
      const row = new Array(CALL_HEADERS.length).fill('');
      row[map['CallLogID']] = id;
      row[map['CreatedAt']] = new Date();
      row[map['EnqID']] = p.id;
      row[map['Customer']] = p.customer || '';
      row[map['CallNumber']] = used + 1;
      row[map['CallDate']] = callDate;
      row[map['Employee']] = p.employee || '';
      row[map['Remarks']] = p.remarks || '';
      row[map['NextFollowUp']] = p.nextFollowUp || '';
      row[map['CallStatus']] = status;
      if (map['Interest'] !== undefined) row[map['Interest']] = interest;
      sh.appendRow(row);
      invalidateCallCache_();
    } finally { lock.releaseLock(); }

    return {ok:true, msg:'Call '+(used+1)+' logged', callNumber: used+1};
  } catch(err){ return {ok:false, msg:String(err)}; }
}

// Today-scoped call-centre style KPIs: how many calls happened today, how they went, and how many
// open enquiries still need their next call actioned today (or are overdue).
function getCallDashboard(token){
  const me = requireAuth_(token);
  const isAdmin = me.role === 'admin';
  const today = todayStr_();
  const calledTodayEnq = {};
  let todaysCalls = 0, completedCalls = 0, missedCalls = 0;

  // Reps only ever see their own activity here — not the whole team's — same rule
  // getPipeline()/the Dashboard KPIs already enforce; this was missed when those were fixed,
  // so a rep's "Call Activity" card showed company-wide numbers (e.g. Pending Calls in the
  // thousands) mislabeled as their own.
  getAllCallLogRows_().forEach(function(r){
    if (!r.EnqID) return;
    if (!isAdmin && String(r.Employee||'').trim() !== me.name) return;
    if (r.CallDate === today){
      todaysCalls++;
      calledTodayEnq[r.EnqID] = true;
      if (r.CallStatus === 'Connected') completedCalls++;
      else missedCalls++;
    }
  });

  let pendingCalls = 0;
  getAllEnquiries_().forEach(function(e){
    if (!isAdmin && String(e.LeadBy||'').trim() !== me.name) return;
    if (OPEN_STAGES.indexOf(e.Stage) < 0) return;
    if (!e.NextFollowUp || e.NextFollowUp > today) return;
    // No cap here anymore — calls beyond the default 6 are still "pending" if a follow-up is due.
    if (calledTodayEnq[e.EnqID]) return;
    pendingCalls++;
  });

  return { todaysCalls: todaysCalls, completedCalls: completedCalls, missedCalls: missedCalls, pendingCalls: pendingCalls };
}
