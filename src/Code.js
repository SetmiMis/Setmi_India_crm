/*****************************************************************
 * SETMI INDIA — SALES / ENQUIRY-TO-ORDER FMS  (v2)
 * Google Apps Script + Google Sheets backend
 * Pipeline: New -> Quoted -> Follow-up -> Won -> Lost -> Dispatched -> Closed
 *
 * FIRST TIME / AFTER UPDATE:  Run setupSheets()
 * DAILY EMAIL:                Run setupDailyTrigger()
 *****************************************************************/

const CONFIG = {
  COMPANY_NAME : 'SETMI INDIA',
  TAGLINE      : 'Engineered for the Extraordinary',
  // Admin PIN lives in Script Properties now, not here — see adminPin_() below.
  // Change it any time via the "Sales FMS" menu -> "Change Admin PIN".
  ADMIN_EMAIL  : Session.getActiveUser().getEmail() || '',
  GST_PERCENT  : 18,
  QUOTE_PREFIX : 'SETMI-Q-',
  ENQ_PREFIX   : 'SETMI-ENQ-',
  CUST_PREFIX  : 'CUST-',
  DIGEST_HOUR  : 9,
  SOURCES   : ['IndiaMART','Phone','TradeIndia','Exhibition','WhatsApp','Referral','Walk-in','Website','Other'],
  TEAM      : ['Vishu','Sales 1','Sales 2'],   // seed Lead By list (editable from app later)
  PRIORITIES: ['Hot','Warm','Cold']
};

const SHEETS = { ENQ:'Enquiries', FU:'FollowUps', CUST:'Customers', TEAM:'Team', PEND:'PendingEnquiries', CALL:'CallLog', USERS:'Users', ARCHIVE:'Archive' };
const STAGES = ['New','Quoted','Follow-up','Won','Lost','Dispatched','Closed'];
const OPEN_STAGES = ['New','Quoted','Follow-up'];
const TZ = Session.getScriptTimeZone() || 'Asia/Kolkata';

const ENQ_HEADERS = ['EnqID','CreatedAt','EnqDate','Customer','Company','Phone','Email','GST','Pincode',
  'District','State','City','Source','Requirement','EstValue','Stage','Priority','LeadBy','QuoteNo',
  'QuoteAmount','QuoteDate','NextFollowUp','LastContact','OrderValue','LostReason','DispatchDate',
  'DispatchInfo','ShipmentWeight','FeedbackRating','FeedbackNote','Notes','Active','PhotoUrl',
  'Qty','Timeline','Grade','Escalation','InvoiceNo'];
const FU_HEADERS   = ['FollowUpID','CreatedAt','EnqID','Customer','Mode','Outcome','NextFollowUp','By','Note'];
const CUST_HEADERS = ['CustID','CreatedAt','Name','Company','Phone','Email','GST','Pincode','District','State','City','Source','Notes','Active'];
const TEAM_HEADERS = ['Name','Active'];
// Every new lead — New Enquiry form, the public field-capture link, Bulk Import — lands here instead
// of straight into Enquiries, and only becomes a real enquiry once someone reviews it from the
// Pending Approvals tab and approves it.
const PEND_HEADERS = ['PendingID','CreatedAt','SubmittedBy','Customer','Company','Phone','Email','GST',
  'Pincode','District','State','City','Source','Priority','LeadBy','EstValue','Requirement','Notes',
  'PhotoUrl','Status','ApprovedEnqID','ReviewedBy','ReviewedAt','RejectReason','Qty','Timeline'];
// Per-user logins — the PIN gate stays as a break-glass fallback (checkPin()) once this sheet has
// at least one active row; see login()/requireAuth_() below.
const USER_HEADERS = ['Username','Name','PassHash','Role','Active','CreatedAt'];
const USER_ROLES = ['admin','rep'];


// ISO 3166-2:IN codes for every state/UT, keyed by normalized (upper, punctuation-stripped) name + common aliases/misspellings.
// GeoChart matches these codes against a static map instead of live geocoding free-text names, which is unreliable inside
// Apps Script's sandboxed iframe and breaks entirely on non-state values (e.g. a city typed into the State field).
const INDIA_STATE_ISO_ = {
  'ANDHRA PRADESH':['IN-AP','Andhra Pradesh'], 'AP':['IN-AP','Andhra Pradesh'],
  'ARUNACHAL PRADESH':['IN-AR','Arunachal Pradesh'],
  'ASSAM':['IN-AS','Assam'],
  'BIHAR':['IN-BR','Bihar'],
  'CHHATTISGARH':['IN-CT','Chhattisgarh'], 'CHATTISGARH':['IN-CT','Chhattisgarh'], 'CHHATISGARH':['IN-CT','Chhattisgarh'],
  'GOA':['IN-GA','Goa'],
  'GUJARAT':['IN-GJ','Gujarat'], 'GUJRAT':['IN-GJ','Gujarat'],
  'HARYANA':['IN-HR','Haryana'],
  'HIMACHAL PRADESH':['IN-HP','Himachal Pradesh'], 'HP':['IN-HP','Himachal Pradesh'],
  'JHARKHAND':['IN-JH','Jharkhand'],
  'KARNATAKA':['IN-KA','Karnataka'], 'KARNATKA':['IN-KA','Karnataka'],
  'KERALA':['IN-KL','Kerala'],
  'MADHYA PRADESH':['IN-MP','Madhya Pradesh'], 'MP':['IN-MP','Madhya Pradesh'],
  'MAHARASHTRA':['IN-MH','Maharashtra'], 'MAHARASTRA':['IN-MH','Maharashtra'],
  'MANIPUR':['IN-MN','Manipur'],
  'MEGHALAYA':['IN-ML','Meghalaya'],
  'MIZORAM':['IN-MZ','Mizoram'],
  'NAGALAND':['IN-NL','Nagaland'],
  'ODISHA':['IN-OR','Odisha'], 'ORISSA':['IN-OR','Odisha'],
  'PUNJAB':['IN-PB','Punjab'],
  'RAJASTHAN':['IN-RJ','Rajasthan'],
  'SIKKIM':['IN-SK','Sikkim'],
  'TAMIL NADU':['IN-TN','Tamil Nadu'], 'TAMILNADU':['IN-TN','Tamil Nadu'], 'TN':['IN-TN','Tamil Nadu'],
  'TELANGANA':['IN-TG','Telangana'], 'TELENGANA':['IN-TG','Telangana'],
  'TRIPURA':['IN-TR','Tripura'],
  'UTTAR PRADESH':['IN-UP','Uttar Pradesh'], 'UP':['IN-UP','Uttar Pradesh'],
  'UTTARAKHAND':['IN-UT','Uttarakhand'], 'UTTRAKHAND':['IN-UT','Uttarakhand'], 'UTTARANCHAL':['IN-UT','Uttarakhand'],
  'WEST BENGAL':['IN-WB','West Bengal'],
  'ANDAMAN AND NICOBAR ISLANDS':['IN-AN','Andaman & Nicobar'], 'ANDAMAN & NICOBAR':['IN-AN','Andaman & Nicobar'],
  'CHANDIGARH':['IN-CH','Chandigarh'],
  'DADRA AND NAGAR HAVELI AND DAMAN AND DIU':['IN-DH','Dadra & Nagar Haveli and Daman & Diu'],
  'DELHI':['IN-DL','Delhi'], 'NEW DELHI':['IN-DL','Delhi'], 'NCT OF DELHI':['IN-DL','Delhi'],
  'JAMMU AND KASHMIR':['IN-JK','Jammu & Kashmir'], 'JAMMU & KASHMIR':['IN-JK','Jammu & Kashmir'], 'J&K':['IN-JK','Jammu & Kashmir'],
  'LADAKH':['IN-LA','Ladakh'],
  'LAKSHADWEEP':['IN-LD','Lakshadweep'],
  'PUDUCHERRY':['IN-PY','Puducherry'], 'PONDICHERRY':['IN-PY','Puducherry']
};
// Strips punctuation/parenthetical noise (e.g. "WEST BENGAL(INDIA)") and looks up the ISO code + clean display name.
function normalizeState_(raw){
  const clean = String(raw||'').toUpperCase().replace(/\(.*?\)/g,'').replace(/[^A-Z& ]/g,'').replace(/\s+/g,' ').trim();
  const hit = INDIA_STATE_ISO_[clean];
  return hit ? {iso:hit[0], name:hit[1]} : null;
}

// Plain edit distance — used only by fuzzyNormalizeState_ below, to catch typos in a state name that
// aren't already in the INDIA_STATE_ISO_ alias list (that list stays the strict/fast path everywhere
// else; fuzzy matching is deliberately opt-in, only for the City/District mixup cleanup, so it never
// changes how the Dashboard/Map/Reports read an already-working exact match).
function levenshtein_(a, b){
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = []; for (let j=0;j<=n;j++) prev[j]=j;
  for (let i=1;i<=m;i++){
    const cur = [i];
    for (let j=1;j<=n;j++){
      cur[j] = a[i-1]===b[j-1] ? prev[j-1] : 1+Math.min(prev[j-1], prev[j], cur[j-1]);
    }
    prev = cur;
  }
  return prev[n];
}
// Canonical clean (upper, letters+space only) state names, built once from INDIA_STATE_ISO_'s
// display names rather than its alias keys (so e.g. "AP" isn't treated as a 2-letter name to fuzzy-match against).
let CANON_STATE_NAMES_ = null;
function canonStateNames_(){
  if (CANON_STATE_NAMES_) return CANON_STATE_NAMES_;
  const seen = {}; const out = [];
  Object.keys(INDIA_STATE_ISO_).forEach(function(k){
    const name = INDIA_STATE_ISO_[k][1];
    const clean = name.toUpperCase().replace(/[^A-Z& ]/g,'');
    if (!seen[clean]){ seen[clean]=true; out.push({clean:clean, name:name, iso:INDIA_STATE_ISO_[k][0]}); }
  });
  CANON_STATE_NAMES_ = out;
  return out;
}
// Tries the strict exact/alias match first; only if that fails, allows a small edit distance (typos
// like "Maharshtra", "Karnatka" not already in the alias list) — scaled to name length so short names
// (Goa, Delhi) still require a near-exact match and don't fuzzy-match unrelated city names.
function fuzzyNormalizeState_(raw){
  const exact = normalizeState_(raw);
  if (exact) return exact;
  const clean = String(raw||'').toUpperCase().replace(/\(.*?\)/g,'').replace(/[^A-Z& ]/g,'').replace(/\s+/g,' ').trim();
  if (clean.length < 4) return null; // too short to safely fuzzy-match without false positives
  let best = null, bestDist = Infinity;
  canonStateNames_().forEach(function(s){
    const dist = levenshtein_(clean, s.clean);
    if (dist < bestDist){ bestDist = dist; best = s; }
  });
  if (!best) return null;
  const maxAllowed = Math.max(1, Math.floor(best.clean.length * 0.2)); // ~1 typo per 5 letters
  return bestDist <= maxAllowed ? {iso:best.iso, name:best.name} : null;
}

/* ----------------------------------------------------------- ROUTING */
function doGet(e){
  const page = (e && e.parameter && e.parameter.page || 'admin').toLowerCase();
  if (page === 'metrics') return publicMetricsJson_(e.parameter.key);
  if (page === 'enquiry'){
    return HtmlService.createTemplateFromFile('Enquiry').evaluate()
      .setTitle(CONFIG.COMPANY_NAME + ' — New Enquiry')
      .addMetaTag('viewport','width=device-width, initial-scale=1, maximum-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (page === 'analysis'){
    if (!analysisKeyOk_(e.parameter.key)) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:30px">This link is not valid.</p>');
    const t = HtmlService.createTemplateFromFile('Share'); t.key = String(e.parameter.key);
    return t.evaluate().setTitle(CONFIG.COMPANY_NAME + ' — Data Analysis')
      .addMetaTag('viewport','width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(CONFIG.COMPANY_NAME + ' — Sales FMS')
    .addMetaTag('viewport','width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(name){ return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/* ----------------------------------------------------------- SETUP / MIGRATE */
function setupSheets(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let enq = ss.getSheetByName(SHEETS.ENQ) || ss.insertSheet(SHEETS.ENQ);
  if (enq.getLastRow() === 0){
    enq.getRange(1,1,1,ENQ_HEADERS.length).setValues([ENQ_HEADERS]).setFontWeight('bold');
    const today = todayStr_();
    const rowFor = function(o){ return ENQ_HEADERS.map(function(h){ return o[h]!==undefined ? o[h] : ''; }); };
    enq.getRange(2,1,2,ENQ_HEADERS.length).setValues([
      rowFor({EnqID:CONFIG.ENQ_PREFIX+'0001', CreatedAt:new Date(), EnqDate:today, Customer:'Rajesh Kumar',
        Company:'Apex Electricals', Phone:'9811000001', Email:'rajesh@apex.in', City:'Delhi',
        Source:'IndiaMART', Requirement:'SP-series IP68 connectors, 200 pcs', EstValue:45000,
        Stage:'Quoted', Priority:'Hot', LeadBy:'Vishu', QuoteNo:CONFIG.QUOTE_PREFIX+'0001',
        QuoteAmount:47200, QuoteDate:today, NextFollowUp:addDaysStr_(today,2), LastContact:today,
        Notes:'Asked for IP68 datasheet', Active:'YES'}),
      rowFor({EnqID:CONFIG.ENQ_PREFIX+'0002', CreatedAt:new Date(), EnqDate:today, Customer:'Meena Nair',
        Company:'Coastal AV', Phone:'9820000002', City:'Mumbai',
        Source:'Exhibition', Requirement:'GX16-8P aviation connectors', EstValue:28000,
        Stage:'New', Priority:'Warm', LeadBy:'Sales 1', NextFollowUp:addDaysStr_(today,1),
        Notes:'Met at exhibition stall', Active:'YES'})
    ]);
    enq.setFrozenRows(1);
  } else {
    const hdr = enq.getRange(1,1,1,enq.getLastColumn()).getValues()[0];
    const oi = hdr.indexOf('Owner');
    if (oi >= 0) enq.getRange(1, oi+1).setValue('LeadBy');   // migrate Owner -> LeadBy
    addMissingHeaders_(enq, ENQ_HEADERS);
  }

  let fu = ss.getSheetByName(SHEETS.FU) || ss.insertSheet(SHEETS.FU);
  if (fu.getLastRow() === 0){ fu.getRange(1,1,1,FU_HEADERS.length).setValues([FU_HEADERS]).setFontWeight('bold'); fu.setFrozenRows(1); }

  let cust = ss.getSheetByName(SHEETS.CUST) || ss.insertSheet(SHEETS.CUST);
  if (cust.getLastRow() === 0){
    cust.getRange(1,1,1,CUST_HEADERS.length).setValues([CUST_HEADERS]).setFontWeight('bold'); cust.setFrozenRows(1);
  } else {
    addMissingHeaders_(cust, CUST_HEADERS);
  }

  let team = ss.getSheetByName(SHEETS.TEAM) || ss.insertSheet(SHEETS.TEAM);
  if (team.getLastRow() === 0){
    team.getRange(1,1,1,TEAM_HEADERS.length).setValues([TEAM_HEADERS]).setFontWeight('bold'); team.setFrozenRows(1);
    CONFIG.TEAM.forEach(function(n){ team.appendRow([n,'YES']); });
  }

  let pend = ss.getSheetByName(SHEETS.PEND) || ss.insertSheet(SHEETS.PEND);
  if (pend.getLastRow() === 0){
    pend.getRange(1,1,1,PEND_HEADERS.length).setValues([PEND_HEADERS]).setFontWeight('bold'); pend.setFrozenRows(1);
  } else {
    addMissingHeaders_(pend, PEND_HEADERS);
  }

  let calls = ss.getSheetByName(SHEETS.CALL) || ss.insertSheet(SHEETS.CALL);
  if (calls.getLastRow() === 0){
    calls.getRange(1,1,1,CALL_HEADERS.length).setValues([CALL_HEADERS]).setFontWeight('bold'); calls.setFrozenRows(1);
  } else {
    addMissingHeaders_(calls, CALL_HEADERS);
  }

  let users = ss.getSheetByName(SHEETS.USERS) || ss.insertSheet(SHEETS.USERS);
  if (users.getLastRow() === 0){
    users.getRange(1,1,1,USER_HEADERS.length).setValues([USER_HEADERS]).setFontWeight('bold'); users.setFrozenRows(1);
  } else {
    addMissingHeaders_(users, USER_HEADERS);
  }

  backfillCustomers_();
  forcePhoneColumnsText_();
  forceTextColumns_();
  migrateAdminPinToProperties_();
  ensureArchiveSheet_();

  const s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  SpreadsheetApp.getActive().toast('Setup done! Ab Deploy → New version karein.','Sales FMS',6);
}

// Locks the Phone/Pincode columns to plain-text so Sheets never silently auto-parses a numeric-looking
// value into a Number (fixes #ERROR! cells, and crashes like "X.trim is not a function" downstream —
// e.g. approvePendingEnquiry() reading a PendingApprovals row straight into addEnquiry(), which assumes
// a string). PEND is included alongside ENQ/CUST since it also collects a Phone/Pincode from an
// unauthenticated/external source (the field Enquiry page, Bulk Import).
function forcePhoneColumnsText_(){
  ['ENQ','CUST','PEND'].forEach(function(key){
    const sh = sh_(key); if(!sh) return;
    const map = colMap_(sh);
    ['Phone','Pincode'].forEach(function(col){
      const idx = map[col]; if (idx===undefined) return;
      sh.getRange(1, idx+1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  });
}

// Free-text columns that get filled from a public, unauthenticated form (the field Enquiry page) or
// from an externally-sourced file (Bulk Import's CSV/Excel rows) — a value like "=HYPERLINK(...)"
// sitting in a source file would otherwise get parsed and executed the next time someone opens the
// sheet. Locking the column format to Plain Text is the same fix already applied to Phone above; it
// only takes effect going forward, so it isn't a substitute for reviewing anything already in the sheet.
const TEXT_LOCK_COLUMNS_ = {
  ENQ:  ['Customer','Company','Email','Notes','Requirement'],
  CUST: ['Name','Company','Email','Notes'],
  PEND: ['Customer','Company','Email','Notes','Requirement'],
  FU:   ['Note'],
  CALL: ['Employee','Remarks']
};
function forceTextColumns_(){
  Object.keys(TEXT_LOCK_COLUMNS_).forEach(function(key){
    const sh = sh_(key); if(!sh) return;
    const map = colMap_(sh);
    TEXT_LOCK_COLUMNS_[key].forEach(function(col){
      const idx = map[col]; if (idx===undefined) return;
      sh.getRange(1, idx+1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  });
}

// One-time repair for existing Phone/Pincode cells that were mis-parsed as formulas/numbers. Run
// manually (Sales FMS menu -> Fix Phone Formatting) if you see #ERROR! in a Phone column, or an
// "X.trim is not a function" error approving a Pending entry.
function fixPhoneFormatting(){
  let totalFixed = 0;
  ['ENQ','CUST','PEND'].forEach(function(key){
    const sh = sh_(key); if(!sh || sh.getLastRow()<2) return;
    const map = colMap_(sh);
    ['Phone','Pincode'].forEach(function(colName){
      const col = map[colName]; if (col===undefined) return;
      sh.getRange(1, col+1, sh.getMaxRows(), 1).setNumberFormat('@');
      const dataRange = sh.getRange(2, col+1, sh.getLastRow()-1, 1);
      const formulas = dataRange.getFormulas();
      const values = dataRange.getValues();
      for (let i=0;i<formulas.length;i++){
        if (formulas[i][0]){
          dataRange.getCell(i+1,1).setValue(formulas[i][0].replace(/^=/, ''));
          totalFixed++;
        } else if (typeof values[i][0] === 'number') {
          dataRange.getCell(i+1,1).setValue(String(values[i][0]));
          totalFixed++;
        }
      }
    });
  });
  SpreadsheetApp.getActive().toast(totalFixed+' phone/pincode cell(s) repaired','Sales FMS',5);
  return {ok:true, fixed:totalFixed};
}

// One-time cleanup for leads that reached Won/Lost/Closed *before* moveStage() started clearing
// Priority on those stages — blanks Priority on every existing row already sitting in one of those
// stages. New stage changes are already handled going forward by moveStage() itself.
// Was Won/Lost/Closed-only, Priority-only. Now also Dispatched (moveStage() didn't clear its
// Priority/NextFollowUp either, until this fix) and also clears NextFollowUp — a closed-out lead
// shouldn't still carry a "next follow-up" date, and editEnquiry() used to quietly repopulate one
// if Priority happened to get edited afterwards (fixed at the source too).
function clearPriorityOnClosedStages(){
  const sh = sh_('ENQ'); if(!sh || sh.getLastRow()<2) return;
  const map = colMap_(sh);
  if (map['Stage']===undefined) return;
  const closedStages = ['Won','Lost','Dispatched','Closed'];
  const range = sh.getRange(2, 1, sh.getLastRow()-1, sh.getLastColumn());
  const data = range.getValues();
  let fixed = 0;
  for (let i=0;i<data.length;i++){
    if (closedStages.indexOf(data[i][map['Stage']]) < 0) continue;
    let touched = false;
    if (map['Priority']!==undefined && data[i][map['Priority']] !== ''){ data[i][map['Priority']] = ''; touched = true; }
    if (map['NextFollowUp']!==undefined && data[i][map['NextFollowUp']] !== ''){ data[i][map['NextFollowUp']] = ''; touched = true; }
    if (touched) fixed++;
  }
  if (fixed) range.setValues(data);
  SpreadsheetApp.getActive().toast(fixed+' existing Won/Lost/Dispatched/Closed lead(s) had stale Priority/NextFollowUp cleared','Sales FMS',6);
  return {ok:true, fixed:fixed};
}

// Was: one upsertCustomer_() call per enquiry — each doing its own full-sheet read + script lock +
// linear scan. At a couple thousand enquiries that's a couple thousand full Customers-sheet reads,
// which is what made "Setup / Repair Sheets" take minutes (or time out). Same end result, done in
// one pass: read Customers once, index existing phones in memory, batch-append only the truly-new
// ones. Doesn't backfill missing fields on customers that already exist (upsertCustomer_() still does
// that for the live "new enquiry -> upsert its customer" path) — only adds ones missing entirely.
function backfillCustomers_(){
  const custSh = sh_('CUST'); if (!custSh) return;
  const custData = custSh.getDataRange().getValues();
  const custMap = colMapFromRow_(custData[0]);

  const seenPhones = {};
  let maxNum = 0;
  for (let i=1;i<custData.length;i++){
    const k = phoneKey_(custData[i][custMap['Phone']]);
    if (k) seenPhones[k] = true;
    const m = String(custData[i][custMap['CustID']]||'').replace(CONFIG.CUST_PREFIX,''); const n = Number(m);
    if (m && !isNaN(n) && n>maxNum) maxNum = n;
  }

  const newRows = [];
  getAllEnquiries_().forEach(function(e){
    const k = phoneKey_(e.Phone);
    if (!k || seenPhones[k]) return;
    seenPhones[k] = true;

    maxNum++;
    const row = new Array(CUST_HEADERS.length).fill('');
    row[custMap['CustID']] = CONFIG.CUST_PREFIX + ('000'+maxNum).slice(-4);
    row[custMap['CreatedAt']] = new Date();
    row[custMap['Name']] = e.Customer||''; row[custMap['Company']] = e.Company||'';
    row[custMap['Phone']] = e.Phone; if (custMap['Email']!==undefined) row[custMap['Email']] = e.Email||'';
    if (custMap['City']!==undefined) row[custMap['City']] = e.City||'';
    if (custMap['Source']!==undefined) row[custMap['Source']] = e.Source||'';
    row[custMap['Active']] = 'YES';
    newRows.push(row);
  });
  if (newRows.length){
    custSh.getRange(custSh.getLastRow()+1, 1, newRows.length, CUST_HEADERS.length).setValues(newRows);
  }
}

/* ----------------------------------------------------------- HELPERS */
function ss_(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function sh_(k){ return ss_().getSheetByName(SHEETS[k]); }
// Apps Script's Date getters (getFullYear/getMonth/getDate) already reflect the project's script
// time zone, so plain getters are equivalent to Utilities.formatDate(...,'yyyy-MM-dd') here but far
// cheaper — this runs per date field per row across every list read, so avoiding that service call
// adds up a lot at a few hundred rows.
function fmtDate_(d){
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  const m = dt.getMonth()+1, day = dt.getDate();
  return dt.getFullYear()+'-'+(m<10?'0':'')+m+'-'+(day<10?'0':'')+day;
}
function fmtNice_(d){ return d ? Utilities.formatDate(new Date(d),TZ,'dd MMM yyyy') : ''; }
function todayStr_(){ return fmtDate_(new Date()); }
function monthKey_(d){ try{ return Utilities.formatDate(new Date(d),TZ,'yyyy-MM'); }catch(e){ return ''; } }
function addDaysStr_(dateStr, n){ const d=new Date(dateStr); d.setDate(d.getDate()+n); return fmtDate_(d); }
function num_(v){ const n=Number(String(v).replace(/[^0-9.\-]/g,'')); return isNaN(n)?0:n; }
// Shipment weight (kg): a number when something was actually typed, '' when the box was left empty.
// num_() alone would turn a blank into 0, which reads as "this shipment weighs nothing" instead of
// "nobody recorded a weight" — a distinction that matters on a transport/freight column.
function weightVal_(v){ const s=String(v==null?'':v).trim(); return s ? num_(s) : ''; }
function phoneKey_(p){ let d=String(p||'').replace(/\D/g,''); return d.length>10?d.slice(-10):d; }

// --- NEW HELPER: Single source of truth for Followup Status ---
function calculateFollowupStatus(nextFollowUp) {
  if (!nextFollowUp) return "No Follow-up";

  const todayStr = todayStr_();
  const targetStr = typeof nextFollowUp === 'string' ? nextFollowUp : fmtDate_(nextFollowUp);

  const todayDate = new Date(todayStr);
  const targetDate = new Date(targetStr);

  const diff = Math.floor((targetDate - todayDate) / 86400000);

  if (diff < 0) return "Overdue";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return "Upcoming";
}

/* ----------------------------------------------------------- FOLLOW-UP SCHEDULING
   Single source of truth for "when should we call next".
   Actual call date  = ENQ.LastContact  (set by logFollowUp/writeNote_)
   Planned call date = ENQ.NextFollowUp (computed here from Priority + Actual date)
   Hot = every working day, Warm = every 2 working days (~3x/week), Cold = every 15 working days.
   Sundays are always skipped; add company holidays to EXTRA_HOLIDAYS_ as 'yyyy-MM-dd' strings. */
const FOLLOWUP_INTERVAL_DAYS = { Hot: 1, Warm: 2, Cold: 6 }; // Cold 6 working days (Sundays skipped) = the PDF's strict 7-day recall

/* Grade A/B/C from the PDF's matrix: Qty (metres) x Timeline. Priority (Hot/Warm/Cold) stays manual —
   only the rep knows it after talking to the customer. Blank until both Qty and Timeline are known. */
const TIMELINES = ['Immediate','Fortnight','Just Exploring'];
const ESCALATIONS = ['Proprietor','Shop Floor'];
function gradeFor_(qty, timeline){
  const q = num_(qty), t = TIMELINES.indexOf(timeline);
  if (!q || t < 0) return '';
  const row = q > 500 ? 2 : (q >= 20 ? 1 : 0);   // 0:<20  1:20-500  2:>500
  const col = 2 - t;                              // 0:Just Exploring 1:Fortnight 2:Immediate
  if (row === 2) return col >= 1 ? 'A' : 'B';
  if (row === 1) return col === 2 ? 'A' : (col === 1 ? 'B' : 'C');
  return col === 2 ? 'B' : 'C';
}
function daysOverdue_(nextFollowUp){
  const d = Math.floor((new Date(todayStr_()) - new Date(fmtDate_(nextFollowUp))) / 86400000);
  return d > 0 ? d : 0;
}
const EXTRA_HOLIDAYS_ = [];

function isWorkingDay_(d){
  if (d.getDay() === 0) return false; // Sunday
  return EXTRA_HOLIDAYS_.indexOf(fmtDate_(d)) < 0;
}
function addWorkingDays_(fromDateStr, n){
  const d = new Date(fromDateStr || todayStr_());
  let left = n;
  while (left > 0){
    d.setDate(d.getDate()+1);
    if (isWorkingDay_(d)) left--;
  }
  return fmtDate_(d);
}
function computeNextFollowUp_(priority, actualDateStr){
  const days = FOLLOWUP_INTERVAL_DAYS[priority] || FOLLOWUP_INTERVAL_DAYS.Warm;
  return addWorkingDays_(actualDateStr, days);
}

// One-time/maintenance batch recompute for every open enquiry (menu: Sales FMS -> Recalculate Follow-up Dates).
// Reads and writes NextFollowUp in a single pass so it stays fast even with thousands of rows.
function recalculateAllNextFollowUps(){
  const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
  const col = map['NextFollowUp'];
  let updated = 0;
  const nextVals = data.slice(1).map(function(row){
    if (!row[map['EnqID']] || String(row[map['Active']]).toUpperCase()==='NO' || OPEN_STAGES.indexOf(row[map['Stage']])<0){
      return [row[col]];
    }
    const base = row[map['LastContact']] || row[map['EnqDate']] || todayStr_();
    const newNext = computeNextFollowUp_(row[map['Priority']] || 'Warm', fmtDate_(base));
    if (fmtDate_(row[col]) !== newNext) updated++;
    return [newNext];
  });
  if (nextVals.length) sh.getRange(2, col+1, nextVals.length, 1).setValues(nextVals);
  invalidateEnqCache_();
  SpreadsheetApp.getActive().toast(updated+' NextFollowUp date(s) recalculated','Sales FMS',6);
  return {ok:true, updated:updated};
}

function onOpen(){
  SpreadsheetApp.getUi().createMenu('Sales FMS')
    .addItem('Setup / Repair Sheets', 'setupSheets')
    .addItem('Recalculate Follow-up Dates (all)', 'recalculateAllNextFollowUps')
    .addItem('Fix Phone Formatting', 'fixPhoneFormatting')
    .addItem('Clear stale Priority/Follow-up on closed leads', 'clearPriorityOnClosedStages')
    .addItem('Setup Daily Email', 'setupDailyTrigger')
    .addSeparator()
    .addItem('Run Audit (Read Only)', 'runAuditFromMenu')
    .addSeparator()
    .addItem('Set Meta Ads Leads Sheet', 'setMetaLeadsSheetId')
    .addItem('Import Meta Ads Leads Now', 'importMetaLeadsFromMenu')
    .addItem('Start Auto-Import (every 30 min)', 'setupMetaLeadsImportTrigger')
    .addItem('Stop Auto-Import', 'stopMetaLeadsImportTrigger')
    .addSeparator()
    .addItem('Change Admin PIN', 'setAdminPin')
    .addItem('Add User', 'addUserFromMenu')
    .addItem('Check State/Pincode Data Quality', 'debugStateSampleFromMenu')
    .addItem('Warm Map District Geocoding', 'warmDistrictGeoFromMenu')
    .addItem('Fix State Name Stuck in City/District', 'fixCityStateMixupFromMenu')
    .addItem('Check State-from-City Geocoding', 'checkStateFromCityFromMenu')
    .addItem('Fix State from City (Geocode)', 'fixStateFromCityFromMenu')
    .addItem('Check Bug-Auto-Assigned Leads', 'checkBugAutoAssignedFromMenu')
    .addItem('Unclaim Bug-Auto-Assigned Leads', 'fixBugAutoAssignedFromMenu')
    .addSeparator()
    .addItem('Check Data Counts (Enquiries vs Archive)', 'checkDataCountsFromMenu')
    .addItem('Debug Row State (temp)', 'debugRowStateFromMenu')
    .addItem('Reconcile Data (temp)', 'reconcileDataFromMenu')
    .addItem('Push Not-Found Rows to Enquiries (temp)', 'pushNotFoundToEnquiriesFromMenu')
    .addItem('Debug Phone Match (temp)', 'debugPhoneMatchFromMenu')
    .addItem('Check Archivable Leads (6+ months closed)', 'checkArchivableFromMenu')
    .addItem('Archive Old Closed Leads', 'archiveOldClosedLeadsFromMenu')
    .addItem('Restore Lead from Archive', 'restoreLeadFromArchiveFromMenu')
    .addItem('Restore ALL from Archive', 'restoreAllFromArchiveFromMenu')
    .addToUi();
}
// Some rows have a real Indian state name typed into City or District instead of State (a data-entry
// mix-up, not a code bug) — e.g. City="Maharashtra" with State left blank. That leaves State blank
// (map/reports show it as Unknown) even though the correct state was typed, just into the wrong
// field. Moves it into State (only when State is currently blank, never overwriting a real State)
// and clears the field it was mistakenly typed into. One read + one write for the whole sheet,
// regardless of how many rows are affected — no per-row Sheets calls.
function fixCityStateMixup_(){
  const sh = sh_('ENQ'); const range = sh.getDataRange(); const data = range.getValues();
  const map = colMapFromRow_(data[0]);
  if (map['State']===undefined) return {ok:false, msg:'No State column found.', moved:0, corrected:0, cleared:0};
  let moved = 0, corrected = 0, cleared = 0;
  for (let i=1;i<data.length;i++){
    if (!data[i][map['EnqID']]) continue;

    const curState = String(data[i][map['State']]||'').trim();
    if (curState && !normalizeState_(curState)){
      // State filled in but possibly a typo — correct it in place. Never touches a State that
      // already resolves exactly, so a legitimately-spelled state is untouched.
      const fuzzy = fuzzyNormalizeState_(curState);
      if (fuzzy && fuzzy.name !== curState){ data[i][map['State']] = fuzzy.name; corrected++; }
    }
    const stateNowSet = !!String(data[i][map['State']]||'').trim();

    // No real city/district is ever exactly the name of a whole state — that's always a data-entry
    // slip (a state name typed into the wrong box), regardless of whether State itself is already
    // filled. So City/District get cleared of a state-name match unconditionally; State only gets
    // backfilled from it when State was blank to begin with (never overwrites a real State).
    ['City','District'].forEach(function(col){
      const c = map[col]; if (c===undefined) return;
      const val = String(data[i][c]||'').trim();
      if (!val) return;
      const resolved = fuzzyNormalizeState_(val);
      if (!resolved) return;
      if (!stateNowSet){ data[i][map['State']] = resolved.name; moved++; }
      else cleared++;
      data[i][c] = '';
    });
  }
  if (moved || corrected || cleared) { range.setValues(data); invalidateEnqCache_(); }
  return {ok:true, moved:moved, corrected:corrected, cleared:cleared};
}
function fixCityStateMixupFromMenu(){
  const r = fixCityStateMixup_();
  SpreadsheetApp.getUi().alert('Fix State Name Stuck in City/District',
    r.moved+' row(s) fixed — a state name (typos included) found in City/District, with State blank, was moved into State.\n'+
    r.corrected+' row(s) had a typo\'d State spelling corrected in place.\n'+
    r.cleared+' row(s) had a leftover state name cleared from City/District (State there was already correctly filled).',
    SpreadsheetApp.getUi().ButtonSet.OK);
}
// FIX STATE FROM CITY — a different case than fixCityStateMixup_ above: here City genuinely holds
// a real city/area name (not a misplaced state name), State is blank, but the city name alone is
// enough to know the state (e.g. City="Surat" -> Gujarat). Geocodes each distinct City value once
// (ever) via Nominatim — same free, no-key API and PropertiesService caching pattern already used
// for the Map's District geocoding — and writes the resolved State in. City itself is left as-is.
const CITY_STATE_CACHE_PROP_ = 'cityStateCache_v1';
const CITY_STATE_MAX_LOOKUPS_PER_RUN_ = 50; // higher than the map's per-load budget — this only
// runs when explicitly triggered from the menu, not on every page load, so it can afford more.

function cityStateCache_(){
  try{ return JSON.parse(PropertiesService.getScriptProperties().getProperty(CITY_STATE_CACHE_PROP_) || '{}'); }
  catch(e){ return {}; }
}
function saveCityStateCache_(cache){
  try{ PropertiesService.getScriptProperties().setProperty(CITY_STATE_CACHE_PROP_, JSON.stringify(cache)); }catch(e){}
}
// neededCities: {cityName: true}. Returns cityName -> state name (only for ones it could resolve).
function resolveCityState_(neededCities, budget){
  const cache = cityStateCache_();
  const out = {};
  let remaining = budget!==undefined ? budget : CITY_STATE_MAX_LOOKUPS_PER_RUN_;
  let dirty = false;
  Object.keys(neededCities).forEach(function(city){
    const key = city.trim().toLowerCase();
    if (cache[key] !== undefined){
      if (cache[key]) out[city] = cache[key];
      return;
    }
    if (remaining <= 0) return;
    remaining--;
    let state = null;
    try{
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&addressdetails=1&q=' +
        encodeURIComponent(city + ', India');
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'SetmiIndiaSalesFMS/1.0' } });
      if (res.getResponseCode() === 200){
        const arr = JSON.parse(res.getContentText());
        if (arr && arr[0] && arr[0].address && arr[0].address.state) state = arr[0].address.state;
      }
    } catch(e){ /* network hiccup — leave uncached, retried on a future run */ }
    if (state){ cache[key] = state; out[city] = state; dirty = true; }
    else { cache[key] = null; dirty = true; } // a genuine no-match — remembered so it's not retried forever
    Utilities.sleep(1000); // Nominatim's usage policy caps free lookups at ~1/second
  });
  if (dirty) saveCityStateCache_(cache);
  return out;
}
function findStateFromCityNeeded_(){
  const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
  const needed = {};
  let rowCount = 0;
  for (let i=1;i<data.length;i++){
    if (!data[i][map['EnqID']]) continue;
    if (String(data[i][map['State']]||'').trim()) continue;
    const city = String(data[i][map['City']]||'').trim();
    if (!city) continue;
    rowCount++;
    needed[city] = (needed[city]||0) + 1;
  }
  return {needed:needed, rowCount:rowCount};
}
// Shows the actual distinct City values (not just a count) — spelling/case variants of the same
// real city (e.g. "surat" / "Surat" / "SURAT ") show up as separate entries here since the sheet
// itself has them as separate strings; that's fine for the geocoder (case/whitespace-insensitive
// lookup, and Nominatim tolerates most real-world spelling variants) but useful to actually see.
function checkStateFromCityFromMenu(){
  const found = findStateFromCityNeeded_();
  const cache = cityStateCache_();
  const cities = Object.keys(found.needed);
  const pending = cities.filter(function(c){ return cache[c.trim().toLowerCase()] === undefined; }).length;
  const top = cities.map(function(c){ return {name:c, count:found.needed[c]}; })
    .sort(function(a,b){ return b.count-a.count; }).slice(0,40)
    .map(function(o){ return o.name+' — '+o.count+' row(s)'; }).join('\n') || '(none)';
  SpreadsheetApp.getUi().alert('State-from-City Geocoding',
    found.rowCount+' row(s) have blank State but a City to try.\n'+
    cities.length+' distinct city name(s), '+pending+' not yet geocoded.\n\n'+
    'Top city values by row count (up to 40):\n'+top+
    (cities.length>40 ? '\n… and '+(cities.length-40)+' more' : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}
function fixStateFromCityFromMenu(){
  const needed = findStateFromCityNeeded_().needed;
  if (!Object.keys(needed).length){ SpreadsheetApp.getUi().alert('Nothing to do — no blank-State rows with a City value.'); return; }
  const resolved = resolveCityState_(needed);

  const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
  let fixed = 0;
  for (let i=1;i<data.length;i++){
    if (String(data[i][map['State']]||'').trim()) continue;
    const city = String(data[i][map['City']]||'').trim();
    if (city && resolved[city]){ data[i][map['State']] = resolved[city]; fixed++; }
  }
  if (fixed){ sh.getRange(1,1,data.length,data[0].length).setValues(data); invalidateEnqCache_(); }

  const stillPending = Object.keys(needed).length - Object.keys(resolved).length;
  SpreadsheetApp.getUi().alert('State from City (Geocode)',
    fixed+' row(s) had State filled in from their City.\n'+
    (stillPending > 0 ? stillPending+' distinct city name(s) still pending — run this again to pick up more.' : 'All caught up.'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// Finds ENQ rows that the approvePendingEnquiry() bug (fixed separately) auto-assigned instead of
// leaving unclaimed on Available Leads — and were never actually touched since, so unclaiming them
// now is safe. "Never touched" = still Stage=New, no LastContact, no CallLog row, no FollowUps row
// for that EnqID. A row that fails any of these was genuinely worked on (by luck or otherwise) and
// is left alone — this only catches the leads still sitting exactly as the bug left them.
function findBugAutoAssignedLeads_(){
  const pendSh = sh_('PEND'); const pendData = pendSh ? pendSh.getDataRange().getValues() : [[]];
  const pendMap = pendSh ? colMapFromRow_(pendData[0]) : {};
  const approvedWithNoRepChosen = {}; // EnqID -> true
  for (let i=1;i<pendData.length;i++){
    if (String(pendData[i][pendMap['Status']]||'') !== 'Approved') continue;
    if (String(pendData[i][pendMap['LeadBy']]||'').trim()) continue; // a rep WAS chosen at submission — not the bug
    const enqId = String(pendData[i][pendMap['ApprovedEnqID']]||'').trim();
    if (enqId) approvedWithNoRepChosen[enqId] = true;
  }
  if (!Object.keys(approvedWithNoRepChosen).length) return [];

  const callSh = sh_('CALL'); const callData = callSh ? callSh.getDataRange().getValues() : [[]];
  const callMap = callSh ? colMapFromRow_(callData[0]) : {};
  const hasCall = {};
  if (callMap['EnqID']!==undefined) for (let i=1;i<callData.length;i++){ hasCall[String(callData[i][callMap['EnqID']]||'').trim()] = true; }

  const fuSh = sh_('FU'); const fuData = fuSh ? fuSh.getDataRange().getValues() : [[]];
  const fuMap = fuSh ? colMapFromRow_(fuData[0]) : {};
  const hasFu = {};
  if (fuMap['EnqID']!==undefined) for (let i=1;i<fuData.length;i++){ hasFu[String(fuData[i][fuMap['EnqID']]||'').trim()] = true; }

  const enqSh = sh_('ENQ'); const enqData = enqSh.getDataRange().getValues(); const enqMap = colMapFromRow_(enqData[0]);
  const hits = [];
  for (let i=1;i<enqData.length;i++){
    const id = String(enqData[i][enqMap['EnqID']]||'').trim();
    if (!approvedWithNoRepChosen[id]) continue;
    if (String(enqData[i][enqMap['Stage']]||'') !== 'New') continue;
    if (String(enqData[i][enqMap['LastContact']]||'').trim()) continue;
    if (hasCall[id] || hasFu[id]) continue;
    if (!String(enqData[i][enqMap['LeadBy']]||'').trim()) continue; // already unclaimed, nothing to do
    hits.push({row:i, id:id, customer:String(enqData[i][enqMap['Customer']]||''), leadBy:String(enqData[i][enqMap['LeadBy']]||'')});
  }
  return hits;
}
function checkBugAutoAssignedFromMenu(){
  const hits = findBugAutoAssignedLeads_();
  const sample = hits.slice(0,20).map(function(h){ return h.id+' — '+h.customer+' (currently: '+h.leadBy+')'; }).join('\n') || '(none)';
  SpreadsheetApp.getUi().alert('Bug-Auto-Assigned Leads',
    hits.length+' lead(s) look like they were auto-assigned by the approval bug and never actually touched since '+
    '(still New, no call, no follow-up, no last-contact date).\n\nSample (up to 20):\n'+sample+
    (hits.length ? '\n\nUse "Unclaim Bug-Auto-Assigned Leads" to send these back to Available Leads.' : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}
function fixBugAutoAssignedFromMenu(){
  const hits = findBugAutoAssignedLeads_();
  if (!hits.length){ SpreadsheetApp.getUi().alert('Nothing to fix — 0 matching leads found.'); return; }
  const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
  hits.forEach(function(h){
    data[h.row][map['LeadBy']] = '';
    if (map['Priority']!==undefined) data[h.row][map['Priority']] = '';
    if (map['NextFollowUp']!==undefined) data[h.row][map['NextFollowUp']] = '';
  });
  sh.getRange(1,1,data.length,data[0].length).setValues(data);
  invalidateEnqCache_();
  SpreadsheetApp.getUi().alert(hits.length+' lead(s) unclaimed — now back on Available Leads.');
}
/* ----------------------------------------------------------- ARCHIVE — old closed leads
   Every read (getAllEnquiries_, and everything built on it — Dashboard, Pipeline, Reports, Map
   Analytics, ...) scans the *entire* Enquiries sheet, closed deals from years ago included, even
   though nothing currently open needs them. Moving old Won/Lost/Dispatched/Closed rows out to their
   own sheet shrinks what every one of those reads has to scan — proportional speedup as the sheet
   keeps growing. Nothing is deleted: "Restore Lead from Archive" moves a row straight back. */
const ARCHIVE_CLOSED_STAGES_ = ['Won','Lost','Dispatched','Closed'];
const ARCHIVE_MONTHS_ = 6;

function ensureArchiveSheet_(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Archive');
  if (!sh){
    sh = ss.insertSheet('Archive');
    sh.getRange(1,1,1,ENQ_HEADERS.length).setValues([ENQ_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
// Best-available "when did this actually close" date for a row: LastContact, else EnqDate, else
// CreatedAt — whichever is present first, since not every row has all three filled.
function archiveRefDate_(row, map){
  const raw = String(row[map['LastContact']]||'').trim() || String(row[map['EnqDate']]||'').trim();
  if (raw){ const d = new Date(raw); if (!isNaN(d.getTime())) return d; }
  const created = row[map['CreatedAt']];
  if (created instanceof Date && !isNaN(created.getTime())) return created;
  return null; // no usable date — never archived, kept safe on the live sheet
}
function findArchivableLeads_(){
  const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - ARCHIVE_MONTHS_);
  const rows = [];
  for (let i=1;i<data.length;i++){
    if (!data[i][map['EnqID']]) continue;
    if (ARCHIVE_CLOSED_STAGES_.indexOf(String(data[i][map['Stage']]||'')) < 0) continue;
    const ref = archiveRefDate_(data[i], map);
    if (!ref || ref >= cutoff) continue;
    rows.push({i:i, row:data[i]});
  }
  return {rows:rows, map:map, sheetHeaderLen:data[0].length};
}
// TEMP DIAGNOSTIC — checks one EnqID's State both straight from the sheet (bypassing cache) and via
// getAllEnquiries_() (cached), to tell a stale-cache bug apart from a genuine blank-State row that
// still matched a State filter search. Delete after use.
// TEMP DIAGNOSTIC — reconciles a "Data Reconciliation" sheet (external) against the live
// Enquiries sheet, matched by phone number (normalized to last 10 digits — handles a leading
// 0/91/+91 difference between the two sheets). Read-only, changes nothing. Delete after use.
function reconcileDataFromMenu(){
  const ui = SpreadsheetApp.getUi();
  const srcRes = ui.prompt('Reconcile Data — Step 1/2', 'Paste the "Data Reconciliation" sheet URL or ID:', ui.ButtonSet.OK_CANCEL);
  if (srcRes.getSelectedButton() !== ui.Button.OK) return;
  const srcUrl = srcRes.getResponseText().trim();

  const tgtRes = ui.prompt('Reconcile Data — Step 2/2', 'Paste the "Enquiries" sheet URL or ID to check against:', ui.ButtonSet.OK_CANCEL);
  if (tgtRes.getSelectedButton() !== ui.Button.OK) return;
  const tgtUrl = tgtRes.getResponseText().trim();

  const r = reconcileDataCore_(srcUrl, tgtUrl);
  if (!r.ok){ ui.alert(r.msg); return; }
  ui.alert('Data Reconciliation done — see sheet "'+r.outName+'"',
    'Total rows: '+r.total+'\n'+
    'Duplicate (already in '+r.tgtName+'): '+r.matched+'\n'+
    'Not found (missing): '+r.unmatched+'\n'+
    (r.blank ? 'No usable phone number: '+r.blank+'\n' : '')+
    '\nPhone column used on "'+r.srcName+'": "'+r.srcHeaderName+'"\n'+r.srcSample+
    '\n\nPhone column used on "'+r.tgtName+'": "'+r.tgtHeaderName+'"\n'+r.tgtSample,
    ui.ButtonSet.OK);
}
// Headless core — no UI calls, callable via `clasp run reconcileDataCore_ -p '["url1","url2"]'`
// for testing without clicking through the menu prompts. Returns a plain JSON-serializable object.
function reconcileDataCore_(srcUrl, tgtUrl){
  const normDigits10_ = function(v){
    let d = String(v||'').replace(/\D/g,'');
    if (d.length===12 && d.indexOf('91')===0) d = d.slice(2);
    else if (d.length===11 && d.indexOf('0')===0) d = d.slice(1);
    return d.length===10 ? d : '';
  };
  const openByUrlOrId_ = function(raw){
    const m = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const id = m ? m[1] : raw;
    const gidM = raw.match(/[?&#]gid=(\d+)/);
    const gid = gidM ? Number(gidM[1]) : null;
    const ss = SpreadsheetApp.openById(id);
    let sheet = ss.getSheets()[0];
    if (gid!==null){
      const match = ss.getSheets().filter(function(s){ return s.getSheetId()===gid; })[0];
      if (match) sheet = match;
    }
    return sheet;
  };
  const findPhoneCol_ = function(map){
    const aliases = ['phone','phone number','phone_number','mobile','mobile number','contact','contact number','customer phone'];
    for (let a=0;a<aliases.length;a++){
      for (const k in map){ if (String(k).trim().toLowerCase()===aliases[a]) return map[k]; }
    }
    return undefined;
  };
  const looksLikePhone_ = function(v){
    const d = String(v||'').replace(/\D/g,'');
    return d.length>=10 && d.length<=13;
  };
  // Some source sheets (confirmed on the "Data Reconciliation" tab) have NO header row at all —
  // data starts right on row 1, so header-text matching finds nothing and the real first data row
  // would otherwise get silently treated as a header and skipped. Falls back to scanning column
  // content: whichever column has the most phone-shaped values in its first ~20 rows wins, and if
  // even row 0 of that column looks like a phone (not a label), the whole row 0 is data too.
  const detectPhoneCol_ = function(data){
    const headerMap = colMapFromRow_(data[0]);
    const byHeader = findPhoneCol_(headerMap);
    if (byHeader !== undefined) return {col: byHeader, hasHeader: true};

    const numCols = data[0].length;
    const sample = data.slice(0, Math.min(21, data.length));
    let best = -1, bestScore = 0;
    for (let c=0;c<numCols;c++){
      let score = 0;
      sample.forEach(function(row){ if (looksLikePhone_(row[c])) score++; });
      if (score > bestScore){ bestScore = score; best = c; }
    }
    if (best < 0) return {col: undefined, hasHeader: true};
    return {col: best, hasHeader: !looksLikePhone_(data[0][best])};
  };

  let srcSheet, srcData, srcPhone;
  try{
    srcSheet = openByUrlOrId_(srcUrl);
    srcData = srcSheet.getDataRange().getValues();
    srcPhone = detectPhoneCol_(srcData);
  } catch(e){ return {ok:false, msg:'Could not open that sheet: '+e.message}; }
  if (srcPhone.col===undefined) return {ok:false, msg:'No phone-like column found on "'+srcSheet.getName()+'" — checked header text and, failing that, scanned every column\'s content for phone-shaped values.'};

  let tgtSheet, tgtData, tgtPhone;
  try{
    tgtSheet = openByUrlOrId_(tgtUrl);
    tgtData = tgtSheet.getDataRange().getValues();
    tgtPhone = detectPhoneCol_(tgtData);
  } catch(e){ return {ok:false, msg:'Could not open the Enquiries sheet: '+e.message}; }
  if (tgtPhone.col===undefined) return {ok:false, msg:'No phone-like column found on "'+tgtSheet.getName()+'".'};

  const srcStart = srcPhone.hasHeader ? 1 : 0;
  const tgtStart = tgtPhone.hasHeader ? 1 : 0;

  const tgtPhones = {};
  for (let i=tgtStart;i<tgtData.length;i++){ const d = normDigits10_(tgtData[i][tgtPhone.col]); if (d) tgtPhones[d] = true; }

  // Full results written to a new sheet in THIS spreadsheet — every source row, its original
  // columns intact, plus Status/MatchedPhone appended. Not just a summary count.
  const outName = 'Reconciliation Results '+Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  const out = SpreadsheetApp.getActiveSpreadsheet().insertSheet(outName);
  const outHeader = (srcPhone.hasHeader ? srcData[0] : srcData[0].map(function(_,i){ return 'Col'+(i+1); })).concat(['Status','MatchedPhone']);
  out.getRange(1,1,1,outHeader.length).setValues([outHeader]).setFontWeight('bold');
  out.setFrozenRows(1);

  let matched = 0, unmatched = 0, blank = 0;
  const outRows = [];
  for (let i=srcStart;i<srcData.length;i++){
    const d = normDigits10_(srcData[i][srcPhone.col]);
    let status;
    if (!d){ status = 'No usable phone'; blank++; }
    else if (tgtPhones[d]){ status = 'Duplicate — found in '+tgtSheet.getName(); matched++; }
    else { status = 'Not found — missing from '+tgtSheet.getName(); unmatched++; }
    outRows.push(srcData[i].concat([status, d]));
  }
  if (outRows.length) out.getRange(2,1,outRows.length,outHeader.length).setValues(outRows);
  out.autoResizeColumns(1, outHeader.length);

  // Named header + a few raw/normalized sample values from BOTH sides — so a wrong-column pick or
  // a normalization mismatch is visible immediately, instead of just a suspicious total.
  const sampleOf_ = function(data, col, start){
    const out = [];
    for (let i=start;i<data.length && out.length<5;i++){
      const raw = data[i][col];
      if (raw===''||raw===undefined||raw===null) continue;
      out.push(raw+' → '+(normDigits10_(raw)||'(unusable)'));
    }
    return out.join('\n') || '(no values found)';
  };

  return {
    ok:true, outName:outName, total:srcData.length-srcStart, matched:matched, unmatched:unmatched, blank:blank,
    srcName:srcSheet.getName(), tgtName:tgtSheet.getName(),
    srcHeaderName: srcPhone.hasHeader ? srcData[0][srcPhone.col] : '(no header row — column '+(srcPhone.col+1)+' detected by content)',
    tgtHeaderName: tgtPhone.hasHeader ? tgtData[0][tgtPhone.col] : '(no header row — column '+(tgtPhone.col+1)+' detected by content)',
    srcSample:sampleOf_(srcData, srcPhone.col, srcStart), tgtSample:sampleOf_(tgtData, tgtPhone.col, tgtStart)
  };
}
// TEMP — takes a "Reconciliation Results ..." sheet (built by Reconcile Data), finds the rows
// marked "Not found — missing from Enquiries", and adds them straight into the Enquiries tab.
// Name/Company column numbers are asked interactively because the source sheet often has no
// header row, so there's no reliable name to auto-detect them by (Phone comes from the
// reconciliation's own MatchedPhone column, which is always populated).
function pushNotFoundToEnquiriesFromMenu(){
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const candidates = ss.getSheets().filter(function(s){ return /^Reconciliation Results/.test(s.getName()); });
  if (!candidates.length){ ui.alert('No "Reconciliation Results ..." sheet found. Run "Reconcile Data (temp)" first.'); return; }
  const sheetName = candidates.length===1 ? candidates[0].getName() : (function(){
    const list = candidates.map(function(s){ return s.getName(); }).join('\n');
    const r = ui.prompt('Multiple reconciliation sheets found — paste the exact name to use:', list, ui.ButtonSet.OK_CANCEL);
    return r.getSelectedButton()===ui.Button.OK ? r.getResponseText().trim() : null;
  })();
  if (!sheetName) return;
  const src = ss.getSheetByName(sheetName);
  if (!src){ ui.alert('No sheet named "'+sheetName+'"'); return; }

  const data = src.getDataRange().getValues();
  const map = colMapFromRow_(data[0]);
  const statusCol = map['Status'], phoneCol = map['MatchedPhone'];
  if (statusCol===undefined || phoneCol===undefined){ ui.alert('That sheet is missing Status/MatchedPhone columns — is it really a Reconcile Data output?'); return; }

  const nameRes = ui.prompt('Which column number (1, 2, 3...) has the Customer Name on "'+sheetName+'"? Leave blank to skip Name.', ui.ButtonSet.OK_CANCEL);
  if (nameRes.getSelectedButton() !== ui.Button.OK) return;
  const nameCol = nameRes.getResponseText().trim() ? Number(nameRes.getResponseText().trim())-1 : undefined;

  const companyRes = ui.prompt('Which column number has the Company Name? Leave blank to skip.', ui.ButtonSet.OK_CANCEL);
  if (companyRes.getSelectedButton() !== ui.Button.OK) return;
  const companyCol = companyRes.getResponseText().trim() ? Number(companyRes.getResponseText().trim())-1 : undefined;

  const notFound = [];
  for (let i=1;i<data.length;i++){
    if (String(data[i][statusCol]||'').indexOf('Not found')===0) notFound.push(data[i]);
  }
  if (!notFound.length){ ui.alert('No "Not found" rows on "'+sheetName+'".'); return; }

  const enq = sh_('ENQ');
  const enqData = enq.getDataRange().getValues();
  const enqMap = colMapFromRow_(enqData[0]);
  const existingPhones = {};
  for (let i=1;i<enqData.length;i++){ const p = String(enqData[i][enqMap['Phone']]||'').replace(/\D/g,''); if (p) existingPhones[p.slice(-10)] = true; }

  const today = todayStr_();
  let added = 0, skippedDup = 0, skippedNoPhone = 0;
  notFound.forEach(function(r){
    const phone = String(r[phoneCol]||'').trim();
    if (!phone){ skippedNoPhone++; return; }
    if (existingPhones[phone]){ skippedDup++; return; }
    existingPhones[phone] = true;

    const row = []; for (const k in enqMap) row[enqMap[k]] = '';
    const id = newIdFromRows_(CONFIG.ENQ_PREFIX, enqData, enqMap['EnqID']);
    if (enqMap['EnqID']!==undefined) row[enqMap['EnqID']] = id;
    if (enqMap['CreatedAt']!==undefined) row[enqMap['CreatedAt']] = new Date();
    if (enqMap['EnqDate']!==undefined) row[enqMap['EnqDate']] = today;
    if (enqMap['Customer']!==undefined) row[enqMap['Customer']] = nameCol!==undefined ? String(r[nameCol]||'').trim() : '';
    if (enqMap['Company']!==undefined) row[enqMap['Company']] = companyCol!==undefined ? String(r[companyCol]||'').trim() : '';
    if (enqMap['Phone']!==undefined) row[enqMap['Phone']] = phone;
    if (enqMap['Source']!==undefined) row[enqMap['Source']] = 'Other';
    if (enqMap['Stage']!==undefined) row[enqMap['Stage']] = 'New';
    if (enqMap['Active']!==undefined) row[enqMap['Active']] = 'YES';
    enq.appendRow(row);
    enqData.push(row);
    added++;
  });
  invalidateEnqCache_();
  ui.alert('Pushed "'+sheetName+'" Not-found rows into Enquiries',
    'Added: '+added+'\nSkipped (phone already in Enquiries): '+skippedDup+'\nSkipped (no usable phone): '+skippedNoPhone,
    ui.ButtonSet.OK);
}
// TEMP DEBUG — checks how a single phone number is stored/matched against Enquiries.
function debugPhoneMatchFromMenu(){
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Enter the 10-digit phone to check:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const target = res.getResponseText().trim();

  const enq = sh_('ENQ');
  const enqData = enq.getDataRange().getValues();
  const enqMap = colMapFromRow_(enqData[0]);
  const phoneColIdx = enqMap['Phone'];
  let hit = null;
  const samples = [];
  for (let i=1;i<enqData.length;i++){
    const raw = enqData[i][phoneColIdx];
    const p = String(raw||'').replace(/\D/g,'');
    const last10 = p.slice(-10);
    if (i<4) samples.push('row'+(i+1)+': raw='+JSON.stringify(raw)+' typeof='+(typeof raw)+' normalized='+last10);
    if (last10 === target && !hit) hit = 'row '+(i+1)+' EnqID='+enqData[i][enqMap['EnqID']]+' raw phone='+JSON.stringify(raw);
  }
  ui.alert('Phone match debug for "'+target+'"',
    'enqMap Phone index: '+phoneColIdx+'\n'+
    'Total Enquiries data rows: '+(enqData.length-1)+'\n'+
    'Match found: '+(hit || 'NO MATCH')+'\n\n'+
    'Sample rows:\n'+samples.join('\n'),
    ui.ButtonSet.OK);
}
function debugRowStateFromMenu(){
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Debug Row State', 'Enter the EnqID (e.g. SETMI-ENQ-1232):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const id = res.getResponseText().trim();
  if (!id) return;

  const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
  let liveState = null, liveCity = null, rowNum = -1;
  for (let i=1;i<data.length;i++){
    if (String(data[i][map['EnqID']]||'').trim() === id){
      liveState = data[i][map['State']]; liveCity = data[i][map['City']]; rowNum = i+1; break;
    }
  }
  if (rowNum < 0){ ui.alert('EnqID "'+id+'" not found in the Enquiries sheet.'); return; }

  const cached = getAllEnquiries_().filter(function(e){ return e.EnqID === id; })[0];

  ui.alert('Debug Row State — '+id,
    'Sheet row: '+rowNum+'\n'+
    'LIVE (direct sheet read) — State: "'+liveState+'" | City: "'+liveCity+'"\n'+
    'CACHED (getAllEnquiries_) — State: "'+(cached?cached.State:'(not found in cache — bug)')+'" | City: "'+(cached?cached.City:'')+'"\n\n'+
    (String(liveState||'').trim()===String(cached?cached.State:'').trim()
      ? 'Cache matches the sheet — this is not a stale-cache issue.'
      : '⚠ MISMATCH — the cache is stale. Run any write action (or wait 90s) and re-check.'),
    ui.ButtonSet.OK);
}
function checkDataCountsFromMenu(){
  const enqSh = sh_('ENQ');
  const enqTotal = Math.max(0, enqSh.getLastRow()-1);
  const active = getAllEnquiries_().length; // Active=YES rows only, same set Pipeline/Dashboard/etc read
  const archiveSh = sh_('ARCHIVE');
  const archiveCount = archiveSh ? Math.max(0, archiveSh.getLastRow()-1) : 0;
  SpreadsheetApp.getUi().alert('Data Counts',
    'Enquiries sheet: '+enqTotal+' row(s) total, '+active+' active (Active=YES — this is what Pipeline/Dashboard/Reports/Map show).\n'+
    'Archive sheet: '+archiveCount+' row(s) (moved out by "Archive Old Closed Leads" — not shown anywhere in the app, but nothing is deleted; restore via "Restore Lead from Archive").',
    SpreadsheetApp.getUi().ButtonSet.OK);
}
function checkArchivableFromMenu(){
  const found = findArchivableLeads_();
  SpreadsheetApp.getUi().alert('Archivable Leads',
    found.rows.length+' closed lead(s) (Won/Lost/Dispatched/Closed) are more than '+ARCHIVE_MONTHS_+' months old and can be archived.\n\n'+
    (found.rows.length ? 'Use "Archive Old Closed Leads" to move them.' : 'Nothing to archive right now.'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}
function archiveOldClosedLeadsFromMenu(){
  const found = findArchivableLeads_();
  if (!found.rows.length){ SpreadsheetApp.getUi().alert('Nothing to archive — 0 matching leads found.'); return; }

  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert('Archive '+found.rows.length+' Lead(s)?',
    'Moves them to the "Archive" sheet — nothing is deleted, and any of them can be restored later via '+
    '"Restore Lead from Archive". Continue?', ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    const enqSh = sh_('ENQ'); const data = enqSh.getDataRange().getValues();
    const archiveSet = {}; found.rows.forEach(function(r){ archiveSet[r.i] = true; });

    const archiveRows = found.rows.map(function(r){ return r.row; });
    const keepRows = [data[0]]; // header
    for (let i=1;i<data.length;i++){ if (!archiveSet[i]) keepRows.push(data[i]); }

    const archiveSh = ensureArchiveSheet_();
    archiveSh.getRange(archiveSh.getLastRow()+1, 1, archiveRows.length, found.sheetHeaderLen).setValues(archiveRows);

    // Rewrite ENQ with only the kept rows, then clear the now-unused tail rows below them.
    enqSh.getRange(1,1,keepRows.length,found.sheetHeaderLen).setValues(keepRows);
    const extraRows = data.length - keepRows.length;
    if (extraRows > 0) enqSh.getRange(keepRows.length+1, 1, extraRows, found.sheetHeaderLen).clearContent();

    invalidateEnqCache_();
    ui.alert(archiveRows.length+' lead(s) archived. The Enquiries sheet now has '+(keepRows.length-1)+' active row(s).');
  } finally { lock.releaseLock(); }
}
function restoreLeadFromArchiveFromMenu(){
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Restore Lead from Archive', 'Enter the EnqID to restore (e.g. SETMI-ENQ-1234):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const id = res.getResponseText().trim();
  if (!id){ return; }

  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    const archiveSh = sh_('ARCHIVE');
    if (!archiveSh){ ui.alert('No Archive sheet found — nothing has been archived yet.'); return; }
    const data = archiveSh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
    let found = -1;
    for (let i=1;i<data.length;i++){ if (String(data[i][map['EnqID']]||'').trim() === id){ found = i; break; } }
    if (found < 0){ ui.alert('EnqID "'+id+'" not found in Archive.'); return; }

    const row = data[found];
    const enqSh = sh_('ENQ');
    enqSh.getRange(enqSh.getLastRow()+1, 1, 1, row.length).setValues([row]);
    archiveSh.deleteRow(found+1); // +1: data[] is 0-indexed from the header row, sheet rows are 1-indexed
    invalidateEnqCache_();
    ui.alert('Lead '+id+' restored to the Enquiries sheet.');
  } finally { lock.releaseLock(); }
}
// Bulk undo for "Archive Old Closed Leads" — moves every row in Archive back into Enquiries in one
// batch (not one at a time), then empties Archive down to just its header.
function restoreAllFromArchiveFromMenu(){
  const ui = SpreadsheetApp.getUi();
  const archiveSh = sh_('ARCHIVE');
  const count = archiveSh ? Math.max(0, archiveSh.getLastRow()-1) : 0;
  if (!count){ ui.alert('Archive is empty — nothing to restore.'); return; }

  const confirm = ui.alert('Restore All '+count+' Archived Lead(s)?',
    'Moves every row in Archive back into the Enquiries sheet. Continue?', ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    const data = archiveSh.getDataRange().getValues();
    const rows = data.slice(1); // drop header
    const enqSh = sh_('ENQ');
    enqSh.getRange(enqSh.getLastRow()+1, 1, rows.length, rows[0].length).setValues(rows);
    archiveSh.getRange(2, 1, archiveSh.getMaxRows()-1, data[0].length).clearContent();
    invalidateEnqCache_();
    ui.alert(rows.length+' lead(s) restored to the Enquiries sheet.');
  } finally { lock.releaseLock(); }
}
/* ----------------------------------------------------------- WORKBOOK AUDIT (read-only)
   One consolidated data-quality report, modelled on another Apps Script project's "IMS Audit" —
   required headers present, duplicate primary keys, invalid enum values (Stage/Priority), missing
   required fields, and a rep name that doesn't match anyone in the Team roster. Every check is
   read-only; this never modifies data, only reports on it. Reuses getAllEnquiries_() (cached) for
   the enquiry-level checks so this costs no extra Sheets reads beyond the header-only scans. */
function auditRequiredHeaders_(issues){
  const checks = [
    {key:'ENQ', headers:ENQ_HEADERS, name:'Enquiries'},
    {key:'PEND', headers:PEND_HEADERS, name:'PendingEnquiries'},
    {key:'CUST', headers:CUST_HEADERS, name:'Customers'},
    {key:'USERS', headers:USER_HEADERS, name:'Users'}
  ];
  let sheetsChecked = 0;
  checks.forEach(function(c){
    const sh = sh_(c.key);
    if (!sh){ issues.push({severity:'HIGH', message:'Sheet "'+c.name+'" is missing entirely.'}); return; }
    sheetsChecked++;
    const have = sh.getLastRow() ? sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(h){ return String(h).trim(); }) : [];
    const missing = c.headers.filter(function(h){ return have.indexOf(h) < 0; });
    if (missing.length) issues.push({severity:'HIGH', message:'"'+c.name+'" is missing column(s): '+missing.join(', ')});
  });
  return sheetsChecked;
}
function auditDuplicateIds_(issues){
  let dupCount = 0;
  [{key:'ENQ', idCol:'EnqID', name:'Enquiries'}, {key:'PEND', idCol:'PendingID', name:'PendingEnquiries'}].forEach(function(c){
    const sh = sh_(c.key); if (!sh) return;
    const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
    if (map[c.idCol]===undefined) return;
    const seen = {};
    for (let i=1;i<data.length;i++){
      const id = String(data[i][map[c.idCol]]||'').trim();
      if (!id) continue;
      if (seen[id]){ dupCount++; issues.push({severity:'HIGH', message:'Duplicate '+c.idCol+' "'+id+'" in '+c.name+' (row '+(i+1)+').'}); }
      else seen[id] = true;
    }
  });
  return dupCount;
}
function auditEnquiryValues_(issues, list, teamNames){
  let invalidStage = 0, invalidPriority = 0, blankCustomer = 0, unknownLeadBy = 0;
  list.forEach(function(e){
    if (STAGES.indexOf(e.Stage) < 0){ invalidStage++; issues.push({severity:'HIGH', message:e.EnqID+': unrecognized Stage "'+e.Stage+'".'}); }
    if (e.Priority && CONFIG.PRIORITIES.indexOf(e.Priority) < 0){ invalidPriority++; issues.push({severity:'MEDIUM', message:e.EnqID+': unrecognized Priority "'+e.Priority+'".'}); }
    if (!String(e.Customer||'').trim()){ blankCustomer++; issues.push({severity:'HIGH', message:e.EnqID+': blank Customer name.'}); }
    if (e.LeadBy && teamNames.indexOf(e.LeadBy) < 0){ unknownLeadBy++; issues.push({severity:'MEDIUM', message:e.EnqID+': Lead By "'+e.LeadBy+'" is not in the Team/Users roster.'}); }
  });
  return {invalidStage:invalidStage, invalidPriority:invalidPriority, blankCustomer:blankCustomer, unknownLeadBy:unknownLeadBy};
}
function buildWorkbookAuditReport_(){
  const issues = [];
  const sheetsChecked = auditRequiredHeaders_(issues);
  const dupCount = auditDuplicateIds_(issues);
  const list = getAllEnquiries_();
  const teamNames = getTeam();
  const valueIssues = auditEnquiryValues_(issues, list, teamNames);
  const stateQuality = debugStateSample_(list);

  const severityRank = {HIGH:0, MEDIUM:1, LOW:2};
  issues.sort(function(a,b){ return (severityRank[a.severity]||9) - (severityRank[b.severity]||9); });

  return {
    generatedAt: new Date().toString(),
    workbookName: SpreadsheetApp.getActiveSpreadsheet().getName(),
    summary: {
      sheetsChecked: sheetsChecked,
      issueCount: issues.length,
      duplicateIds: dupCount,
      invalidStage: valueIssues.invalidStage,
      invalidPriority: valueIssues.invalidPriority,
      blankCustomer: valueIssues.blankCustomer,
      unknownLeadBy: valueIssues.unknownLeadBy,
      blankState: stateQuality.blankState,
      blankPincode: stateQuality.blankPincode
    },
    issues: issues
  };
}
function runAuditFromMenu(){
  const report = buildWorkbookAuditReport_();
  const lines = [
    'Sales FMS Audit Report',
    'Generated: '+report.generatedAt,
    'Workbook: '+report.workbookName,
    '',
    'Sheets checked: '+report.summary.sheetsChecked,
    'Issues found: '+report.summary.issueCount,
    'Duplicate IDs: '+report.summary.duplicateIds,
    'Invalid Stage values: '+report.summary.invalidStage,
    'Invalid Priority values: '+report.summary.invalidPriority,
    'Blank Customer name: '+report.summary.blankCustomer,
    'Lead By not in Team/Users: '+report.summary.unknownLeadBy,
    'Blank State: '+report.summary.blankState,
    'Blank Pincode: '+report.summary.blankPincode,
    '',
    report.issues.length ? 'Top issues:' : 'No issues found by the read-only audit.'
  ];
  report.issues.slice(0,20).forEach(function(issue){ lines.push('- ['+issue.severity+'] '+issue.message); });
  if (report.issues.length > 20) lines.push('... and '+(report.issues.length-20)+' more.');
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}
function debugStateSampleFromMenu(){
  const r = debugStateSample_(getAllEnquiries_());
  const top = r.topUnresolvedStateSpellings.map(function(o){ return o.state+': '+o.count; }).join('\n') || '(none)';
  const fuzzy = r.topFuzzyFixableSpellings.map(function(o){ return o.state+': '+o.count; }).join('\n') || '(none)';
  SpreadsheetApp.getUi().alert('State/Pincode Data Quality',
    'Total active enquiries: '+r.total+'\n'+
    'Blank State: '+r.blankState+' ('+Math.round(r.blankState*100/r.total)+'%)\n'+
    'Blank Pincode: '+r.blankPincode+' ('+Math.round(r.blankPincode*100/r.total)+'%)\n'+
    'Blank State, but a state name (incl. typos) found in City/District: '+r.stateStuckInCityOrDistrict+' (use "Fix State Name Stuck in City/District" to fix)\n\n'+
    'Typo\'d State spellings that can be auto-corrected (top 20):\n'+fuzzy+'\n\n'+
    'Still-unrecognized State spellings, needs a manual look (top 20):\n'+top,
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function addMissingHeaders_(sheet, headers){
  const have = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(function(h){ return String(h).trim(); });
  const missing = headers.filter(function(h){ return have.indexOf(h)<0; });
  if (missing.length) sheet.getRange(1, sheet.getLastColumn()+1, 1, missing.length).setValues([missing]).setFontWeight('bold');
}
function colMap_(sheet){
  return colMapFromRow_(sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0]);
}
// Same as colMap_ but builds from a header row you already have (avoids a second Sheets API round-trip
// when the caller already pulled the whole sheet via getDataRange().getValues() — row[0] is the header).
function colMapFromRow_(headerRow){
  const m={}; headerRow.forEach(function(h,i){ m[String(h).trim()] = i; }); return m;
}
function leadCol_(map){ return (map['LeadBy']!==undefined)?map['LeadBy']:map['Owner']; }
function newId_(prefix, sheet, colIdx){
  return newIdFromRows_(prefix, sheet.getDataRange().getValues(), colIdx);
}
// Same as newId_ but scans rows you already have in memory (avoids a second full-sheet read).
function newIdFromRows_(prefix, data, colIdx){
  let max=0;
  for (let i=1;i<data.length;i++){
    const m = String(data[i][colIdx]||'').replace(prefix,''); const n=Number(m);
    if (m && !isNaN(n) && n>max) max=n;
  }
  return prefix + ('000'+(max+1)).slice(-4);
}
function waNum_(phone){ let p=String(phone||'').replace(/\D/g,''); if(p.length===10) p='91'+p; return p; }
function rowToObj_(row, map){
  const o={};
  Object.keys(map).forEach(function(k){
    let v=row[map[k]];
    if (['CreatedAt','QuoteDate','EnqDate','NextFollowUp','LastContact','DispatchDate'].indexOf(k)>=0)
      v = v ? fmtDate_(v) : '';
    o[k]= (v===null||v===undefined)?'':v;
  });
  if (o.Owner!==undefined && (o.LeadBy===undefined || o.LeadBy==='')) o.LeadBy=o.Owner;
  return o;
}

/* ----------------------------------------------------------- WHATSAPP MESSAGES */
function waWelcome_(e){
  let m = 'Namaste '+(e.Customer||'')+' 🙏\n\n';
  m += 'Thank you for connecting with *'+CONFIG.COMPANY_NAME+'*.';
  if (e.LeadBy)      m += '\nYou were attended by *'+e.LeadBy+'*';
  if (e.Requirement) m += (e.LeadBy?' ':'\n') + 'regarding your requirement: *'+e.Requirement+'*';
  m += '.';
  m += '\n\nWe will share the details/quotation shortly. For anything, simply reply here.\n\n';
  m += '— '+CONFIG.COMPANY_NAME+'\n_'+CONFIG.TAGLINE+'_';
  return m;
}
function waFollow_(e){
  let m = 'Hello '+(e.Customer||'')+',\n\nFollowing up from *'+CONFIG.COMPANY_NAME+'*';
  if (e.LeadBy) m += ' (attended by '+e.LeadBy+')';
  m += '.';
  if (e.QuoteNo)     m += '\nRef quotation *'+e.QuoteNo+'*'+(e.QuoteAmount?(' for ₹'+e.QuoteAmount):'')+'.';
  if (e.Requirement) m += '\nRe: '+e.Requirement+'.';
  m += '\n\nMay we know your decision so we can serve you better?\n\n— '+CONFIG.COMPANY_NAME;
  return m;
}
function waLinkWelcome_(e){ return e.Phone ? 'https://wa.me/'+waNum_(e.Phone)+'?text='+encodeURIComponent(waWelcome_(e)) : ''; }
function waLinkFollow_(e){  return e.Phone ? 'https://wa.me/'+waNum_(e.Phone)+'?text='+encodeURIComponent(waFollow_(e))  : ''; }

/* ----------------------------------------------------------- META / AUTH
   The PIN screen only hides the app's HTML in the browser — every google.script.run function is
   still directly callable by name regardless of what the client shows or hides. requireAuth_() is
   the real gate: every function that reads or writes business data calls it first. checkPin()
   issues a short-lived session token (kept server-side in CacheService) that the client sends back
   on every subsequent call. INTERNAL_BYPASS_ lets trusted server-only callers (daily digest, report
   export) through without a token — it's a random value generated at runtime and never sent to the
   client, so a page visitor can never guess or replay it. */
const AUTH_CACHE_PREFIX_ = 'fms_auth_';
const AUTH_TTL_SECONDS_ = 21600; // 6h sliding session (CacheService's max TTL)
const INTERNAL_BYPASS_ = Utilities.getUuid();

// Reads the live Admin PIN from Script Properties instead of hardcoding it in source (which would
// otherwise sit in plain text in version control). setupSheets() seeds this once from the previous
// hardcoded default on first run after this change, so an existing deployment isn't locked out —
// change it afterwards via the "Sales FMS" menu -> "Change Admin PIN".
function adminPin_(){
  return PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '';
}
function migrateAdminPinToProperties_(){
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ADMIN_PIN') === null) props.setProperty('ADMIN_PIN', '__REDACTED_DEFAULT_PIN__'); // REDACTED in git — see src/REDACTIONS.md
}
function setAdminPin(){
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Set Admin PIN', 'Enter new PIN (leave blank to disable the PIN gate):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const pin = res.getResponseText().trim();
  PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', pin);
  ui.alert(pin ? 'Admin PIN updated.' : 'PIN gate disabled — the app will open to anyone with the link.');
}

function getConfigMeta(){
  return {
    company:CONFIG.COMPANY_NAME, tagline:CONFIG.TAGLINE,
    pinRequired: !!adminPin_(),
    usersConfigured: anyUsersConfigured_(),
    sources:CONFIG.SOURCES, team:getTeam(), priorities:CONFIG.PRIORITIES,
    stages:STAGES, timelines:TIMELINES, escalations:ESCALATIONS, gst:CONFIG.GST_PERCENT, quotePrefix:CONFIG.QUOTE_PREFIX,
    callStatuses:CALL_STATUSES, interestLevels:CALL_INTEREST_LEVELS
  };
}

/* ---------- PASSWORD HASHING (Apps Script has no node:crypto/scrypt — salted SHA-256 via the
   built-in Utilities service instead. Stored as "<saltUuid>:<hashHex>". ---------- */
function sha256Hex_(str){
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8)
    .map(function(b){ return ((b<0?b+256:b).toString(16)).padStart(2,'0'); }).join('');
}
function hashPassword_(password){
  const salt = Utilities.getUuid();
  return salt + ':' + sha256Hex_(salt + ':' + password);
}
function verifyPassword_(password, stored){
  const parts = String(stored||'').split(':');
  if (parts.length !== 2) return false;
  return sha256Hex_(parts[0] + ':' + password) === parts[1];
}

/* ---------- USERS (per-rep login) ---------- */
function listUsers_(){
  const sh = sh_('USERS'); if (!sh) return [];
  const map = colMap_(sh);
  const d = sh.getDataRange().getValues();
  const out = [];
  for (let i=1;i<d.length;i++){
    const username = String(d[i][map.Username]||'').trim();
    if (!username) continue;
    out.push({
      username: username,
      name: String(d[i][map.Name]||'').trim(),
      role: String(d[i][map.Role]||'rep').trim()==='admin' ? 'admin' : 'rep',
      active: String(d[i][map.Active]||'YES').toUpperCase()!=='NO'
    });
  }
  return out;
}
function anyUsersConfigured_(){
  return listUsers_().some(function(u){ return u.active; });
}
/** Admin-facing list, minus PassHash — matches the "Users" tab shown to the app's Users tab (a later step). */
function listUsersForAdmin(token){
  const me = requireAuth_(token);
  if (me.role !== 'admin') throw new Error('Admins only.');
  return listUsers_();
}
function verifyUser_(username, password){
  const u = String(username||'').trim().toLowerCase();
  if (!u || !password) return null;
  const sh = sh_('USERS'); if (!sh) return null;
  const map = colMap_(sh);
  const d = sh.getDataRange().getValues();
  for (let i=1;i<d.length;i++){
    if (String(d[i][map.Username]||'').trim().toLowerCase() !== u) continue;
    if (String(d[i][map.Active]||'YES').toUpperCase()==='NO') return null;
    if (!verifyPassword_(password, String(d[i][map.PassHash]||''))){
      Utilities.sleep(600); // slow down brute-forcing
      return null;
    }
    return {
      username: String(d[i][map.Username]).trim(),
      name: String(d[i][map.Name]||'').trim(),
      role: String(d[i][map.Role]||'rep').trim()==='admin' ? 'admin' : 'rep'
    };
  }
  return null;
}
function addUser(username, name, password, role, token){
  const me = requireAuth_(token);
  // Only the very first user(s) — before any account exists — can be added by any signed-in
  // session (chicken-and-egg: no admin exists yet to authorize one). Once at least one active
  // user exists, this must be admin-only server-side, not just hidden in the UI — otherwise any
  // logged-in rep could call addUser(...,'admin',...) directly via google.script.run and grant
  // themselves admin.
  if (anyUsersConfigured_() && me.role !== 'admin') throw new Error('Admins only.');
  username = String(username||'').trim().toLowerCase();
  name = String(name||'').trim();
  password = String(password||'');
  role = (role==='admin') ? 'admin' : 'rep';
  if (!username || !name || !password) return {ok:false, msg:'Username, name aur password sab zaroori hain.'};
  if (password.length < 6) return {ok:false, msg:'Password kam se kam 6 characters ka ho.'};
  if (!/^[a-z0-9._-]+$/.test(username)) return {ok:false, msg:'Username: sirf lowercase letters, digits, . _ -'};
  if (listUsers_().some(function(u){ return u.username.toLowerCase()===username; })){
    return {ok:false, msg:'Yeh username pehle se hai.'};
  }
  const sh = sh_('USERS');
  const row = USER_HEADERS.map(function(h){
    if (h==='Username') return username;
    if (h==='Name') return name;
    if (h==='PassHash') return hashPassword_(password);
    if (h==='Role') return role;
    if (h==='Active') return 'YES';
    if (h==='CreatedAt') return new Date();
    return '';
  });
  sh.appendRow(row);
  addTeamMember(name, INTERNAL_BYPASS_); // shows up in Lead By dropdowns too
  return {ok:true, msg:'User '+username+' added.'};
}
function addUserFromMenu(){
  const ui = SpreadsheetApp.getUi();
  const u = ui.prompt('Add User — step 1/4', 'Username (lowercase, no spaces):', ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton()!==ui.Button.OK || !u.getResponseText().trim()) return;
  const n = ui.prompt('Add User — step 2/4', 'Full name:', ui.ButtonSet.OK_CANCEL);
  if (n.getSelectedButton()!==ui.Button.OK || !n.getResponseText().trim()) return;
  const p = ui.prompt('Add User — step 3/4', 'Password (min 6 chars):', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton()!==ui.Button.OK) return;
  const r = ui.prompt('Add User — step 4/4', 'Role — type "admin" or leave blank for rep:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton()!==ui.Button.OK) return;
  const res = addUser(u.getResponseText(), n.getResponseText(), p.getResponseText(), r.getResponseText().trim().toLowerCase()==='admin'?'admin':'rep', INTERNAL_BYPASS_);
  ui.alert(res.msg);
}
function changePassword(currentPassword, newPassword, token){
  const me = requireAuth_(token);
  const next = String(newPassword||'');
  if (next.length < 6) return {ok:false, msg:'Naya password kam se kam 6 characters ka ho.'};
  const sh = sh_('USERS'); if (!sh) return {ok:false, msg:'Users sheet nahi mili.'};
  const map = colMap_(sh);
  const d = sh.getDataRange().getValues();
  for (let i=1;i<d.length;i++){
    if (String(d[i][map.Username]||'').trim().toLowerCase() !== String(me.u||'').toLowerCase()) continue;
    if (!verifyPassword_(String(currentPassword||''), String(d[i][map.PassHash]||''))){
      return {ok:false, msg:'Current password galat hai.'};
    }
    sh.getRange(i+1, map.PassHash+1).setValue(hashPassword_(next));
    return {ok:true, msg:'Password change ho gaya.'};
  }
  return {ok:false, msg:'User nahi mila.'};
}
function setUserActive(username, active, token){
  const me = requireAuth_(token);
  if (me.role !== 'admin') throw new Error('Admins only.');
  const sh = sh_('USERS'); if (!sh) return {ok:false, msg:'Users sheet nahi mili.'};
  const map = colMap_(sh);
  const d = sh.getDataRange().getValues();
  const u = String(username||'').trim().toLowerCase();
  for (let i=1;i<d.length;i++){
    if (String(d[i][map.Username]||'').trim().toLowerCase() !== u) continue;
    sh.getRange(i+1, map.Active+1).setValue(active ? 'YES' : 'NO');
    return {ok:true, msg: active?'User re-activate ho gaya.':'User deactivate ho gaya.'};
  }
  return {ok:false, msg:'User nahi mila.'};
}
function adminResetPassword(username, newPassword, token){
  const me = requireAuth_(token);
  if (me.role !== 'admin') throw new Error('Admins only.');
  const next = String(newPassword||'');
  if (next.length < 6) return {ok:false, msg:'Naya password kam se kam 6 characters ka ho.'};
  const sh = sh_('USERS'); if (!sh) return {ok:false, msg:'Users sheet nahi mili.'};
  const map = colMap_(sh);
  const d = sh.getDataRange().getValues();
  const u = String(username||'').trim().toLowerCase();
  for (let i=1;i<d.length;i++){
    if (String(d[i][map.Username]||'').trim().toLowerCase() !== u) continue;
    sh.getRange(i+1, map.PassHash+1).setValue(hashPassword_(next));
    return {ok:true, msg:'Password reset ho gaya.'};
  }
  return {ok:false, msg:'User nahi mila.'};
}
function setUserRole(username, role, token){
  const me = requireAuth_(token);
  if (me.role !== 'admin') throw new Error('Admins only.');
  role = (role==='admin') ? 'admin' : 'rep';
  const sh = sh_('USERS'); if (!sh) return {ok:false, msg:'Users sheet nahi mili.'};
  const map = colMap_(sh);
  const d = sh.getDataRange().getValues();
  const u = String(username||'').trim().toLowerCase();
  if (u === String(me.u||'').trim().toLowerCase() && role !== 'admin'){
    return {ok:false, msg:'Aap khud ko admin se hata nahi sakte.'};
  }
  for (let i=1;i<d.length;i++){
    if (String(d[i][map.Username]||'').trim().toLowerCase() !== u) continue;
    sh.getRange(i+1, map.Role+1).setValue(role);
    return {ok:true, msg:'Role updated.'};
  }
  return {ok:false, msg:'User nahi mila.'};
}

/* ---------- AUTH GATE
   Two ways in: login(username,password) — per-user, the normal path once Users has any active
   row — or checkPin(pin) — the shared-PIN break-glass fallback (also what an install with zero
   users configured still runs on entirely, unauthenticated-if-PIN-blank, same as before this
   change). Either way a session token maps, server-side in CacheService, to a JSON user object
   {u,name,role}; requireAuth_() decodes and returns it (never just a boolean) so callers that
   need to know who's asking — claim, transfer, per-rep visibility — can. Every existing call site
   just does `requireAuth_(token);` and discards the value, which still works: an object is truthy. */
function login(username, password){
  const user = verifyUser_(username, password);
  if (!user){ Utilities.sleep(400); return {ok:false, msg:'Galat username ya password.'}; }
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(AUTH_CACHE_PREFIX_+token, JSON.stringify({u:user.username, name:user.name, role:user.role}), AUTH_TTL_SECONDS_);
  return {ok:true, token:token, name:user.name, role:user.role, username:user.username};
}
/** Login page's "Forgot password?" — no per-user email on file, so this just pings the admin
 *  (webapp runs as USER_DEPLOYING, so CONFIG.ADMIN_EMAIL is the deploying admin) to reset the
 *  user's password by hand from the Users tab. Always returns ok:true regardless of whether the
 *  username exists, so the login page can't be used to enumerate valid usernames. */
function requestPasswordReset(username){
  const u = String(username||'').trim();
  if (u && CONFIG.ADMIN_EMAIL){
    try {
      MailApp.sendEmail({
        to: CONFIG.ADMIN_EMAIL,
        subject: '['+CONFIG.COMPANY_NAME+'] Password reset requested: '+u,
        body: 'User "'+u+'" clicked "Forgot password?" on the login page at '+new Date()+'.\n\n'+
          'Reset their password from the Users tab in the app (admin-only) or the Users sheet.'
      });
    } catch(e){} // best-effort — never block the user-facing message on mail failure
  }
  return {ok:true, msg:'Admin ko notify kar diya gaya hai. Woh aapka password reset kar denge.'};
}
function checkPin(pin){
  const adminPin = adminPin_();
  if (adminPin && String(pin)!==String(adminPin)){
    Utilities.sleep(800); // slow down brute-forcing a short numeric PIN
    return {ok:false};
  }
  const token = Utilities.getUuid();
  const user = {u:'admin', name:'Admin', role:'admin'};
  CacheService.getScriptCache().put(AUTH_CACHE_PREFIX_+token, JSON.stringify(user), AUTH_TTL_SECONDS_);
  return {ok:true, token:token, name:user.name, role:user.role};
}
/** Public wrapper so the client can check "is this saved token still good?" on page load
 *  (localStorage-restored session) without re-implementing requireAuth_'s logic. Throws the same
 *  "Session expired" error as any other call when the token's no longer valid. */
function whoAmI(token){
  return requireAuth_(token);
}
function requireAuth_(token){
  if (token === INTERNAL_BYPASS_) return {u:'system', name:'System', role:'admin'};
  if (!adminPin_() && !anyUsersConfigured_()) return {u:'admin', name:'Admin', role:'admin'}; // nothing configured — fully open, same as before
  const key = token && (AUTH_CACHE_PREFIX_+token);
  const cache = CacheService.getScriptCache();
  if (key){
    // CacheService is only eventually consistent across concurrent executions: refreshAll() fires
    // several google.script.run calls in parallel right after login()/checkPin() writes the token,
    // and each runs as its own separate execution. One of those siblings can read the cache a few ms
    // before the write has propagated and see nothing yet — a false "session expired" seconds after a
    // correct login. Retry briefly before giving up so that race window doesn't get mistaken for a
    // real expiry.
    for (let attempt=0; attempt<3; attempt++){
      const raw = cache.get(key);
      if (raw){
        cache.put(key, raw, AUTH_TTL_SECONDS_); // refresh sliding TTL
        if (raw === '1') return {u:'admin', name:'Admin', role:'admin'}; // pre-login-system session, still mid-flight
        try { return JSON.parse(raw); } catch(e){ return {u:'admin', name:'Admin', role:'admin'}; }
      }
      Utilities.sleep(150);
    }
  }
  throw new Error('Session expired — please reload and enter the PIN again.');
}
function getEnquiryLink(){ return ScriptApp.getService().getUrl() + '?page=enquiry'; }

/* ----------------------------------------------------------- TEAM (LEAD BY) */
function getTeam(){
  const sh = sh_('TEAM'); if (!sh) return CONFIG.TEAM.slice();
  const d = sh.getDataRange().getValues(); const out=[];
  for (let i=1;i<d.length;i++){ if (d[i][0] && String(d[i][1]).toUpperCase()!=='NO') out.push(String(d[i][0]).trim()); }
  return out.length?out:CONFIG.TEAM.slice();
}
function addTeamMember(name, token){
  const me = requireAuth_(token);
  if (me.role !== 'admin') throw new Error('Admins only.');
  name=String(name||'').trim(); if(!name) return {ok:false,msg:'Naam zaroori hai'};
  const sh=sh_('TEAM'); const d=sh.getDataRange().getValues();
  for(let i=1;i<d.length;i++){ if(String(d[i][0]).trim().toLowerCase()===name.toLowerCase()){ sh.getRange(i+1,2).setValue('YES'); return {ok:true,msg:name+' already in list'}; } }
  sh.appendRow([name,'YES']); return {ok:true,msg:name+' added'};
}
function removeTeamMember(name, token){
  const me = requireAuth_(token);
  if (me.role !== 'admin') throw new Error('Admins only.');
  const sh=sh_('TEAM'); const d=sh.getDataRange().getValues();
  for(let i=1;i<d.length;i++){ if(String(d[i][0]).trim()===String(name).trim()){ sh.getRange(i+1,2).setValue('NO'); return {ok:true}; } }
  return {ok:false};
}

/* ----------------------------------------------------------- CUSTOMERS DB */
function upsertCustomer_(p){
  const sh = sh_('CUST'); if(!sh) return '';
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    const d = sh.getDataRange().getValues(); const map = colMapFromRow_(d[0]);
    const key = phoneKey_(p.phone);
    if (key){
      for (let i=1;i<d.length;i++){
        if (phoneKey_(d[i][map['Phone']])===key){
          const r=i+1;
          const row = d[i].slice(); let changed = false;
          const fill=function(col,v){ if(map[col]!==undefined && !row[map[col]] && v){ row[map[col]]=v; changed=true; } };
          fill('Name',p.name); fill('Company',p.company); fill('Email',p.email); fill('City',p.city);
          fill('GST',p.gst); fill('Pincode',p.pincode); fill('District',p.district); fill('State',p.state);
          if (changed) sh.getRange(r, 1, 1, row.length).setValues([row]);
          return d[i][map['CustID']];
        }
      }
    }
    const id = newIdFromRows_(CONFIG.CUST_PREFIX, d, map['CustID']);
    const row = new Array(CUST_HEADERS.length).fill('');
    row[map['CustID']]=id; row[map['CreatedAt']]=new Date();
    row[map['Name']]=p.name||''; row[map['Company']]=p.company||'';
    row[map['Phone']]=p.phone||''; row[map['Email']]=p.email||'';
    if(map['GST']!==undefined) row[map['GST']]=p.gst||'';
    if(map['Pincode']!==undefined) row[map['Pincode']]=p.pincode||'';
    if(map['District']!==undefined) row[map['District']]=p.district||'';
    if(map['State']!==undefined) row[map['State']]=p.state||'';
    row[map['City']]=p.city||''; row[map['Source']]=p.source||''; row[map['Notes']]=p.notes||'';
    row[map['Active']]='YES';
    sh.appendRow(row);
    return id;
  } finally { lock.releaseLock(); }
}
function getCustomers(filter, token){
  requireAuth_(token);
  filter=filter||{};
  const sh=sh_('CUST'); const d=sh.getDataRange().getValues(); const map=colMapFromRow_(d[0]);
  const enq=getAllEnquiries_(); const cnt={};
  enq.forEach(function(e){ const k=phoneKey_(e.Phone); if(k) cnt[k]=(cnt[k]||0)+1; });
  const out=[];
  for(let i=1;i<d.length;i++){
    if(!d[i][map['CustID']]) continue;
    if(String(d[i][map['Active']]).toUpperCase()==='NO') continue;
    out.push({ CustID:d[i][map['CustID']], Name:d[i][map['Name']], Company:d[i][map['Company']],
      Phone:String(d[i][map['Phone']]||''), Email:d[i][map['Email']], City:d[i][map['City']],
      GST: map['GST']!==undefined ? d[i][map['GST']] : '',
      Pincode: map['Pincode']!==undefined ? d[i][map['Pincode']] : '',
      District: map['District']!==undefined ? d[i][map['District']] : '',
      State: map['State']!==undefined ? d[i][map['State']] : '',
      Source:d[i][map['Source']], Notes:d[i][map['Notes']], enquiries:cnt[phoneKey_(d[i][map['Phone']])]||0 });
  }
  if(filter.q){ const q=String(filter.q).toLowerCase();
    return out.filter(function(c){ return (c.Name+' '+c.Company+' '+c.Phone+' '+c.City).toLowerCase().indexOf(q)>=0; }); }
  out.sort(function(a,b){ return String(a.Name).localeCompare(String(b.Name)); });
  return out;
}
function addCustomer(p, token){
  requireAuth_(token);
  if(!String(p.name||'').trim()||!String(p.phone||'').trim()) return {ok:false,msg:'Name aur Phone zaroori'};
  const id=upsertCustomer_(p); return {ok:true,msg:'Customer saved',id:id};
}
function editCustomer(p, token){
  requireAuth_(token);
  const sh=sh_('CUST'); const d=sh.getDataRange().getValues(); const map=colMapFromRow_(d[0]);
  for(let i=1;i<d.length;i++){
    if(String(d[i][map['CustID']]).trim()===String(p.id).trim()){
      const r=i+1; const oldPhone=String(d[i][map['Phone']]||'');
      const row = d[i].slice();
      const set=function(c,v){ if(v!==undefined && map[c]!==undefined) row[map[c]] = v; };
      set('Name',p.name); set('Company',p.company); set('Phone',p.phone);
      set('Email',p.email); set('City',p.city); set('Notes',p.notes);
      set('GST',p.gst); set('Pincode',p.pincode); set('District',p.district); set('State',p.state);
      sh.getRange(r, 1, 1, row.length).setValues([row]);
      syncEnquiriesForCustomer_(oldPhone, p);
      invalidateEnqCache_();
      return {ok:true,msg:'Customer updated'};
    }
  }
  return {ok:false,msg:'Customer not found'};
}
function syncEnquiriesForCustomer_(oldPhone, p){
  const sh=sh_('ENQ'); const d=sh.getDataRange().getValues(); const map=colMapFromRow_(d[0]);
  const key=phoneKey_(oldPhone);
  for(let i=1;i<d.length;i++){
    if(phoneKey_(d[i][map['Phone']])===key){
      const r=i+1;
      const row = d[i].slice();
      if(p.name!==undefined)    row[map['Customer']] = p.name;
      if(p.company!==undefined) row[map['Company']] = p.company;
      if(p.email!==undefined)   row[map['Email']] = p.email;
      if(p.city!==undefined)    row[map['City']] = p.city;
      if(p.phone!==undefined)   row[map['Phone']] = p.phone;
      if(p.gst!==undefined && map['GST']!==undefined)           row[map['GST']] = p.gst;
      if(p.pincode!==undefined && map['Pincode']!==undefined)   row[map['Pincode']] = p.pincode;
      if(p.district!==undefined && map['District']!==undefined) row[map['District']] = p.district;
      if(p.state!==undefined && map['State']!==undefined)       row[map['State']] = p.state;
      sh.getRange(r, 1, 1, row.length).setValues([row]);
    }
  }
}

// Overwrites the Customer record matched by phone (same field-by-field overwrite editCustomer() already
// does) and cascades the correction to every other enquiry sharing that phone — used by editEnquiry() so
// a correction made from inside one enquiry doesn't silently stop at that one row, unlike upsertCustomer_
// below which deliberately only fills blanks (right for a fresh enquiry submission, wrong for an edit).
function upsertCustomerOverwrite_(oldPhone, p){
  const sh = sh_('CUST'); if(!sh) return;
  const d = sh.getDataRange().getValues(); const map = colMapFromRow_(d[0]);
  const oldKey = phoneKey_(oldPhone);
  if (oldKey){
    for (let i=1;i<d.length;i++){
      if (phoneKey_(d[i][map['Phone']]) === oldKey){
        const r = i+1;
        const row = d[i].slice();
        const set = function(c,v){ if(v!==undefined && map[c]!==undefined) row[map[c]] = v; };
        set('Name',p.name); set('Company',p.company); set('Phone',p.phone); set('Email',p.email); set('City',p.city);
        set('GST',p.gst); set('Pincode',p.pincode); set('District',p.district); set('State',p.state);
        sh.getRange(r, 1, 1, row.length).setValues([row]);
        syncEnquiriesForCustomer_(oldPhone, p);
        return;
      }
    }
  }
  // No existing Customer record for the enquiry's old phone — nothing to overwrite, fall back to the
  // normal create-or-fill-blanks path.
  upsertCustomer_(p);
}

/* ----------------------------------------------------------- CREATE / EDIT ENQUIRY */
// Deliberately unauthenticated — the public field Enquiry page (no PIN gate) calls this to warn
// about a repeat submission. Only returns an aggregate count/date/stage, never customer or enquiry
// detail, so an unauthenticated caller can't use it to pull anything sensitive.
function checkPhoneDuplicate(phone){
  const key = phoneKey_(phone);
  if (!key) return {found:false};
  const list = getAllEnquiries_().filter(function(e){ return phoneKey_(e.Phone) === key; });
  if (!list.length) return {found:false};
  list.sort(function(a,b){ return String(b.CreatedAt).localeCompare(String(a.CreatedAt)); });
  return { found:true, count:list.length, lastDate: list[0].EnqDate || fmtDate_(list[0].CreatedAt), lastStage: list[0].Stage || '' };
}

// Authenticated — used only by the admin New Enquiry tab to auto-fill known-customer details.
// Not exposed on the public field Enquiry page, which only gets the lighter checkPhoneDuplicate() above.
function getCustomerByPhone(phone, token){
  requireAuth_(token);
  const key = phoneKey_(phone);
  if (!key) return {found:false};
  const sh = sh_('CUST'); const d = sh.getDataRange().getValues(); const map = colMapFromRow_(d[0]);
  for (let i=1;i<d.length;i++){
    if (phoneKey_(d[i][map['Phone']]) === key && String(d[i][map['Active']]).toUpperCase()!=='NO'){
      return {
        found:true, name:d[i][map['Name']], company:d[i][map['Company']], email:d[i][map['Email']],
        city:d[i][map['City']],
        gst: map['GST']!==undefined ? d[i][map['GST']] : '',
        pincode: map['Pincode']!==undefined ? d[i][map['Pincode']] : '',
        district: map['District']!==undefined ? d[i][map['District']] : '',
        state: map['State']!==undefined ? d[i][map['State']] : ''
      };
    }
  }
  return {found:false};
}

// approvePendingEnquiry() passes INTERNAL_BYPASS_ explicitly (it's already authenticated the caller
// via its own requireAuth_() before it gets here) — any other caller, including a direct
// google.script.run.addEnquiry(...) from the browser console with no token, is rejected below.
function addEnquiry(p, token){
  requireAuth_(token);
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  let locked = true;
  try{
    const sh = sh_('ENQ'); const existing = sh.getDataRange().getValues(); const map = colMapFromRow_(existing[0]);
    const id = newIdFromRows_(CONFIG.ENQ_PREFIX, existing, map['EnqID']);
    const today = todayStr_();

    // Built dynamically off the header map (not ENQ_HEADERS) so a future column added only to
    // the sheet still gets a slot here without a row.length mismatch.
    const row = [];
    for (var k in map) row[map[k]] = '';

    if(map['EnqID'] !== undefined) row[map['EnqID']] = id;
    if(map['CreatedAt'] !== undefined) row[map['CreatedAt']] = new Date();
    if(map['EnqDate'] !== undefined) row[map['EnqDate']] = p.enqDate || today;
    if(map['Customer'] !== undefined) row[map['Customer']] = String(p.customer||'').trim();
    if(map['Company'] !== undefined) row[map['Company']] = String(p.company||'').trim();
    if(map['Phone'] !== undefined) row[map['Phone']] = String(p.phone||'').trim();
    if(map['Email'] !== undefined) row[map['Email']] = String(p.email||'').trim();

    if(map['GST'] !== undefined) row[map['GST']] = String(p.gst||'').trim();
    if(map['Pincode'] !== undefined) row[map['Pincode']] = String(p.pincode||'').trim();
    if(map['District'] !== undefined) row[map['District']] = String(p.district||'').trim();
    if(map['State'] !== undefined) row[map['State']] = String(p.state||'').trim();
    if(map['City'] !== undefined) row[map['City']] = String(p.city||'').trim();

    if(map['Source'] !== undefined) row[map['Source']] = p.source || 'Other';
    if(map['Requirement'] !== undefined) row[map['Requirement']] = String(p.requirement||'').trim();
    if(map['Qty'] !== undefined) row[map['Qty']] = String(p.qty||'').trim() ? num_(p.qty) : '';
    if(map['Timeline'] !== undefined) row[map['Timeline']] = TIMELINES.indexOf(p.timeline)>=0 ? p.timeline : '';
    if(map['Grade'] !== undefined && map['Qty'] !== undefined) row[map['Grade']] = gradeFor_(row[map['Qty']], row[map['Timeline']]);
    if(p.estValue !== undefined && map['EstValue'] !== undefined) row[map['EstValue']] = num_(p.estValue);
    if(map['Stage'] !== undefined) row[map['Stage']] = 'New';
    // leaveUnclaimed: blank Priority/LeadBy on purpose — the lead shows up on Available Leads for
    // any rep to call and claim, instead of being auto-assigned to whoever's first in the Team list.
    if(map['Priority'] !== undefined) row[map['Priority']] = p.leaveUnclaimed ? '' : (CONFIG.PRIORITIES.indexOf(p.priority)>=0 ? p.priority : 'Warm');

    const lCol = leadCol_(map);
    if(lCol !== undefined) row[lCol] = p.leaveUnclaimed ? '' : (p.leadBy || (getTeam()[0]||''));

    if(map['NextFollowUp'] !== undefined) row[map['NextFollowUp']] = p.leaveUnclaimed ? '' : (p.nextFollowUp || computeNextFollowUp_(row[map['Priority']] || 'Warm', row[map['EnqDate']] || today));
    if(map['Notes'] !== undefined) row[map['Notes']] = String(p.notes||'').trim();
    if(map['PhotoUrl'] !== undefined) row[map['PhotoUrl']] = String(p.photoUrl||'').trim();
    if(map['Active'] !== undefined) row[map['Active']] = 'YES';
    
    sh.appendRow(row);
    lock.releaseLock(); locked = false;
    invalidateEnqCache_();

    upsertCustomer_({
      name: p.customer, 
      company: p.company, 
      phone: p.phone, 
      email: p.email, 
      gst: p.gst, 
      pincode: p.pincode, 
      district: p.district, 
      state: p.state, 
      city: p.city, 
      source: p.source, 
      notes: p.notes
    });
    
    const e = {Customer: p.customer, Phone: p.phone, LeadBy: row[lCol], Requirement: p.requirement};
    return {ok:true, id:id, msg:'Enquiry '+id+' saved', waWelcome:waLinkWelcome_(e)};
  } catch(err) {
    return {ok:false, msg:String(err)};
  } finally {
    if (locked) lock.releaseLock();
  }
}

/* ---------- AVAILABLE LEADS (claim system) — step 2 of the Vercel feature backport.
   Open enquiries with no LeadBy show up here for any rep to call and claim, instead of being
   assigned to someone automatically. Matches the Next.js port's getUnclaimedEnquiries/claimEnquiry. */
const AVAILABLE_LEADS_FIELDS_ = ['EnqID','Customer','Company','Phone','City','Requirement','Source','EnqDate','CreatedAt'];
function getUnclaimedEnquiries(token){
  requireAuth_(token);
  return getAllEnquiries_()
    .filter(function(e){ return !String(e.LeadBy||'').trim() && OPEN_STAGES.indexOf(e.Stage)>=0; })
    .sort(function(a,b){ return String(b.CreatedAt).localeCompare(String(a.CreatedAt)); })
    .map(function(e){ return pickFields_(e, AVAILABLE_LEADS_FIELDS_); });
}
/** A rep claims a lead — sets LeadBy to them (and Priority, decided after the call). Fails if someone already owns it. */
function claimEnquiry(enqId, priority, token){
  const me = requireAuth_(token);
  const rep = String(me.name||'').trim();
  if (!rep) return {ok:false, msg:'No rep name on session.'};
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
    let i = -1;
    for (let r=1;r<data.length;r++){ if (String(data[r][map['EnqID']]||'').trim()===String(enqId).trim()){ i=r; break; } }
    if (i<0) return {ok:false, msg:'Enquiry not found.'};

    const lCol = leadCol_(map);
    const owner = String(data[i][lCol]||'').trim();
    if (owner) return {ok:false, msg:'Already claimed by '+owner+'.'};

    const row = data[i].slice();
    row[lCol] = rep;
    if (map['Priority']!==undefined && CONFIG.PRIORITIES.indexOf(priority)>=0){
      row[map['Priority']] = priority;
      if (map['NextFollowUp']!==undefined && !row[map['NextFollowUp']]){
        row[map['NextFollowUp']] = computeNextFollowUp_(priority, todayStr_());
      }
    }
    let claimedCol = map['ClaimedAt'];
    if (claimedCol===undefined){
      claimedCol = data[0].length;
      sh.getRange(1, claimedCol+1).setValue('ClaimedAt');
    }
    while (row.length<=claimedCol) row.push('');
    row[claimedCol] = new Date();

    sh.getRange(i+1, 1, 1, row.length).setValues([row]);
    invalidateEnqCache_();
    return {ok:true, msg:'Claimed — '+enqId+' is now yours.'};
  } catch(err) {
    return {ok:false, msg:String(err)};
  } finally {
    lock.releaseLock();
  }
}

/* ---------- LEAD TRANSFER (rep-to-rep, needs acceptance) — last step of the Vercel backport.
   Owner proposes a transfer, but LeadBy only actually changes once the receiving rep accepts —
   no direct hand-off. Mirrors claimEnquiry()'s "extend the header on first use" pattern for the
   TransferTo column. */
function proposeTransfer(enqId, toRep, token){
  const me = requireAuth_(token);
  const fromRep = String(me.name||'').trim();
  const to = String(toRep||'').trim();
  if (!to) return {ok:false, msg:'Pick who to transfer to.'};
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
    let i = -1;
    for (let r=1;r<data.length;r++){ if (String(data[r][map['EnqID']]||'').trim()===String(enqId).trim()){ i=r; break; } }
    if (i<0) return {ok:false, msg:'Enquiry not found.'};

    const lCol = leadCol_(map);
    const owner = String(data[i][lCol]||'').trim();
    if (owner !== fromRep) return {ok:false, msg:"Aap iske owner nahi ho."};
    if (to === owner) return {ok:false, msg:'Already unhi ke naam hai.'};

    const row = data[i].slice();
    let col = map['TransferTo'];
    if (col===undefined){
      col = data[0].length;
      sh.getRange(1, col+1).setValue('TransferTo');
    }
    while (row.length<=col) row.push('');
    row[col] = to;

    sh.getRange(i+1, 1, 1, row.length).setValues([row]);
    invalidateEnqCache_();
    return {ok:true, msg:'Transfer to '+to+' propose ho gaya — unke accept karne ka wait hai.'};
  } catch(err) {
    return {ok:false, msg:String(err)};
  } finally {
    lock.releaseLock();
  }
}

/** Receiving rep accepts a pending transfer — ownership changes now, same as a fresh claim. */
function acceptTransfer(enqId, token){
  const me = requireAuth_(token);
  const rep = String(me.name||'').trim();
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
    let i = -1;
    for (let r=1;r<data.length;r++){ if (String(data[r][map['EnqID']]||'').trim()===String(enqId).trim()){ i=r; break; } }
    if (i<0) return {ok:false, msg:'Enquiry not found.'};
    if (map['TransferTo']===undefined || String(data[i][map['TransferTo']]||'').trim()!==rep){
      return {ok:false, msg:'Aapke liye koi transfer pending nahi hai is lead par.'};
    }

    const row = data[i].slice();
    const lCol = leadCol_(map);
    row[lCol] = rep;
    row[map['TransferTo']] = '';
    let claimedCol = map['ClaimedAt'];
    if (claimedCol===undefined){ claimedCol = row.length; sh.getRange(1, claimedCol+1).setValue('ClaimedAt'); }
    while (row.length<=claimedCol) row.push('');
    row[claimedCol] = new Date();

    sh.getRange(i+1, 1, 1, row.length).setValues([row]);
    invalidateEnqCache_();
    return {ok:true, msg:enqId+' ab aapki hai.'};
  } catch(err) {
    return {ok:false, msg:String(err)};
  } finally {
    lock.releaseLock();
  }
}

/** Receiving rep declines — lead stays with whoever already had it. */
function declineTransfer(enqId, token){
  const me = requireAuth_(token);
  const rep = String(me.name||'').trim();
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
    let i = -1;
    for (let r=1;r<data.length;r++){ if (String(data[r][map['EnqID']]||'').trim()===String(enqId).trim()){ i=r; break; } }
    if (i<0) return {ok:false, msg:'Enquiry not found.'};
    if (map['TransferTo']===undefined || String(data[i][map['TransferTo']]||'').trim()!==rep){
      return {ok:false, msg:'Aapke liye koi transfer pending nahi hai is lead par.'};
    }

    const row = data[i].slice();
    row[map['TransferTo']] = '';
    sh.getRange(i+1, 1, 1, row.length).setValues([row]);
    invalidateEnqCache_();
    return {ok:true, msg:'Transfer decline ho gaya.'};
  } catch(err) {
    return {ok:false, msg:String(err)};
  } finally {
    lock.releaseLock();
  }
}

/** Open enquiries with a pending transfer addressed to the signed-in rep — for them to accept/decline. */
function getIncomingTransfers(token){
  const me = requireAuth_(token);
  const rep = String(me.name||'').trim();
  return getAllEnquiries_().filter(function(e){ return String(e.TransferTo||'').trim()===rep; });
}

function editEnquiry(p, token){
  const me = requireAuth_(token);
  try{
    const sh=sh_('ENQ'); const d=sh.getDataRange().getValues(); const map=colMapFromRow_(d[0]);
    for(let i=1; i<d.length; i++){
      if(String(d[i][map['EnqID']]).trim() === String(p.id).trim()){
        requireOwnLeadOrAdmin_(me, d[i][map['LeadBy']]);
        const r=i+1;
        const oldPhone = String(d[i][map['Phone']]||'');
        const row = d[i].slice();
        const set = function(c,v){ if(v !== undefined && map[c] !== undefined) row[map[c]] = v; };
        const validPriority = (p.priority !== undefined && CONFIG.PRIORITIES.indexOf(p.priority) >= 0) ? p.priority : undefined;

        set('Customer', p.customer);
        set('Company', p.company);
        set('Phone', p.phone);
        set('Email', p.email);

        set('GST', p.gst);
        set('Pincode', p.pincode);
        set('District', p.district);
        set('State', p.state);
        set('City', p.city);

        set('Requirement', p.requirement);
        set('Priority', validPriority);
        set('Source', p.source);

        if(p.estValue !== undefined && map['EstValue'] !== undefined) row[map['EstValue']] = num_(p.estValue);
        if(p.shipmentWeight !== undefined && map['ShipmentWeight'] !== undefined) row[map['ShipmentWeight']] = weightVal_(p.shipmentWeight);
        if(p.qty !== undefined && map['Qty'] !== undefined) row[map['Qty']] = String(p.qty).trim() ? num_(p.qty) : '';
        if(p.timeline !== undefined && map['Timeline'] !== undefined) row[map['Timeline']] = TIMELINES.indexOf(p.timeline)>=0 ? p.timeline : '';
        if(p.escalation !== undefined && map['Escalation'] !== undefined) row[map['Escalation']] = ESCALATIONS.indexOf(p.escalation)>=0 ? p.escalation : '';
        if(map['Grade'] !== undefined && map['Qty'] !== undefined && map['Timeline'] !== undefined) row[map['Grade']] = gradeFor_(row[map['Qty']], row[map['Timeline']]);

        const lCol = leadCol_(map);
        if(p.leadBy !== undefined && lCol !== undefined) row[lCol] = p.leadBy;

        // Auto-recalculate the Planned date when Priority changes and the user didn't also hand-pick a new date —
        // but never for a closed-out enquiry (Won/Lost/Dispatched/Closed): those had NextFollowUp/Priority
        // cleared by moveStage() on purpose, and a later edit shouldn't quietly bring a stale follow-up date
        // back to life (matches the same fix already applied on the Vercel port).
        const isOpenStage = OPEN_STAGES.indexOf(String(d[i][map['Stage']]||'')) >= 0;
        if (map['NextFollowUp'] !== undefined && isOpenStage){
          const oldNext = fmtDate_(d[i][map['NextFollowUp']]);
          const oldPriority = d[i][map['Priority']];
          const priorityChanged = validPriority !== undefined && validPriority !== oldPriority;
          const dateUntouched = p.nextFollowUp === undefined || p.nextFollowUp === oldNext;
          let newNext = p.nextFollowUp;
          if (priorityChanged && dateUntouched){
            const base = d[i][map['LastContact']] || d[i][map['EnqDate']] || todayStr_();
            newNext = computeNextFollowUp_(validPriority, fmtDate_(base));
          }
          if (newNext !== undefined) row[map['NextFollowUp']] = newNext;
        }

        sh.getRange(r, 1, 1, row.length).setValues([row]);

        // Overwrite (not just fill-blanks) so a correction made here — e.g. fixing a misspelled name —
        // actually sticks on the shared Customer record and cascades to this customer's other enquiries,
        // the same way editing them directly from the Customers tab already does.
        upsertCustomerOverwrite_(oldPhone, {
          name: p.customer,
          company: p.company,
          phone: p.phone,
          email: p.email,
          gst: p.gst,
          pincode: p.pincode,
          district: p.district,
          state: p.state,
          city: p.city
        });
        invalidateEnqCache_();

        return {ok:true, msg:'Enquiry updated'};
      }
    }
    return {ok:false, msg:'Not found'};
  } catch(err) {
    return {ok:false, msg:String(err)};
  }
}

// Reps only ever see their own leads (getPipeline/getFollowUpsDue scope by leadBy) — any endpoint
// that mutates an existing enquiry must enforce that ownership here too, not just rely on the UI
// never showing another rep's lead (a direct google.script.run call bypasses the UI entirely).
function requireOwnLeadOrAdmin_(me, leadByValue){
  if (me.role === 'admin') return;
  if (String(leadByValue||'').trim() !== String(me.name||'').trim()){
    throw new Error('Aap sirf apni khud ki leads par ye action kar sakte hain.');
  }
}

// Soft delete — sets Active='NO' rather than removing the sheet row, so a wrongly-deleted enquiry
// stays recoverable (flip Active back to YES in the sheet) and every existing read already filters
// Active='NO' out (getAllEnquiries_, getPipeline, dashboard, reports), so nothing else needs to change.
function deleteEnquiry(id, token){
  const me = requireAuth_(token);
  const sh = sh_('ENQ'); const d = sh.getDataRange().getValues(); const map = colMapFromRow_(d[0]);
  for (let i=1; i<d.length; i++){
    if (String(d[i][map['EnqID']]).trim() === String(id).trim()){
      requireOwnLeadOrAdmin_(me, d[i][map['LeadBy']]);
      sh.getRange(i+1, map['Active']+1).setValue('NO');
      invalidateEnqCache_();
      return {ok:true, msg:'Enquiry '+id+' deleted'};
    }
  }
  return {ok:false, msg:'Not found'};
}
/* ----------------------------------------------------------- PENDING APPROVALS
   Every New Enquiry submission — from the admin form, the public field-capture link, or Bulk Import,
   PDF/photo attached or not — lands here instead of the Enquiries sheet, and only becomes a real
   enquiry once someone reviews it from the Pending Approvals tab and approves it. */
// Drive folder for PDFs attached to a single enquiry via submitPendingEnquiry. Bulk Import (CSV/Excel)
// doesn't store a source file here — it's parsed entirely client-side, nothing to keep in Drive.
function getDocFolder_(){
  const file = DriveApp.getFileById(ss_().getId());
  const parents = file.getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const name = CONFIG.COMPANY_NAME + ' - Enquiry Documents';
  const existing = parent.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parent.createFolder(name);
}
const MAX_DOC_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB cap on the attached PDF

// Shared row builder for a Pending Approvals draft. Every lead-intake path — the authenticated New
// Enquiry form (submitPendingEnquiry, doc optional), the public field-capture link (submitFieldEnquiry,
// no login), and Bulk Import (submitBulkPendingFromRows) — funnels through here (or its own equivalent)
// so nothing reaches the Enquiries sheet/pipeline without a human reviewing and approving it first.
function savePendingRow_(p, photoUrl){
  const sh = sh_('PEND'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
  const id = newIdFromRows_('PEND-', data, map['PendingID']);
  const row = new Array(PEND_HEADERS.length).fill('');
  row[map['PendingID']] = id;
  row[map['CreatedAt']] = new Date();
  row[map['SubmittedBy']] = Session.getActiveUser().getEmail() || (p.leadBy||'');
  row[map['Customer']] = String(p.customer||'').trim();
  row[map['Company']] = String(p.company||'').trim();
  row[map['Phone']] = String(p.phone||'').trim();
  row[map['Email']] = String(p.email||'').trim();
  row[map['GST']] = String(p.gst||'').trim();
  row[map['Pincode']] = String(p.pincode||'').trim();
  row[map['District']] = String(p.district||'').trim();
  row[map['State']] = String(p.state||'').trim();
  row[map['City']] = String(p.city||'').trim();
  row[map['Source']] = p.source || 'Other';
  row[map['Priority']] = (CONFIG.PRIORITIES.indexOf(p.priority)>=0 ? p.priority : 'Warm');
  row[map['LeadBy']] = p.leadBy || '';
  if (p.estValue !== undefined) row[map['EstValue']] = num_(p.estValue);
  row[map['Requirement']] = String(p.requirement||'').trim();
  if (map['Qty'] !== undefined) row[map['Qty']] = String(p.qty||'').trim() ? num_(p.qty) : '';
  if (map['Timeline'] !== undefined) row[map['Timeline']] = TIMELINES.indexOf(p.timeline)>=0 ? p.timeline : '';
  row[map['Notes']] = String(p.notes||'').trim();
  row[map['PhotoUrl']] = photoUrl || '';
  row[map['Status']] = 'Pending';
  sh.appendRow(row);
  return id;
}

function submitPendingEnquiry(p, token){
  requireAuth_(token);
  if (!String(p.customer||'').trim() || !String(p.phone||'').trim()) return {ok:false, msg:'Name aur Phone zaroori'};
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    let photoUrl = '';
    if (p.docBase64){
      if (p.docMime !== 'application/pdf') return {ok:false, msg:'Only PDF files are accepted'};
      const bytes = Utilities.base64Decode(p.docBase64);
      if (bytes.length > MAX_DOC_SIZE_BYTES) return {ok:false, msg:'PDF is too large — max 10 MB'};
      const folder = getDocFolder_();
      const blob = Utilities.newBlob(bytes, 'application/pdf', p.docName || 'enquiry-document.pdf');
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photoUrl = file.getUrl();
    }
    savePendingRow_(p, photoUrl);
    return {ok:true, msg:'Saved to Pending Approvals'};
  } catch(err){
    return {ok:false, msg:String(err)};
  } finally {
    lock.releaseLock();
  }
}

// Public, unauthenticated entry point for the field-capture link (Enquiry.html, ?page=enquiry — no
// login, no PIN). It used to call addEnquiry() directly, writing straight into the live pipeline with
// nobody reviewing it first — that was the bug. Every field submission now lands in Pending Approvals
// like every other lead-intake path; a team member reviews and approves it from the admin app before
// it becomes a real enquiry.
function submitFieldEnquiry(p){
  if (!String(p.customer||'').trim() || !String(p.phone||'').trim()) return {ok:false, msg:'Name aur Phone zaroori'};
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    savePendingRow_(p, '');
    return {ok:true, msg:'Thank you! Your enquiry has been submitted for review.'};
  } catch(err){
    return {ok:false, msg:String(err)};
  } finally {
    lock.releaseLock();
  }
}

function getPendingEnquiries(token){
  requireAuth_(token);
  const sh = sh_('PEND'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
  const out = [];
  for (let i=1;i<data.length;i++){
    if (!data[i][map['PendingID']]) continue;
    if (String(data[i][map['Status']]||'Pending') !== 'Pending') continue;
    out.push({
      PendingID: data[i][map['PendingID']], CreatedAt: fmtNice_(data[i][map['CreatedAt']]),
      SubmittedBy: data[i][map['SubmittedBy']], Customer: data[i][map['Customer']], Company: data[i][map['Company']],
      Phone: String(data[i][map['Phone']]||''), Email: data[i][map['Email']], GST: data[i][map['GST']],
      Pincode: data[i][map['Pincode']], District: data[i][map['District']], State: data[i][map['State']],
      City: data[i][map['City']], Source: data[i][map['Source']], Priority: data[i][map['Priority']],
      LeadBy: data[i][map['LeadBy']], EstValue: data[i][map['EstValue']], Requirement: data[i][map['Requirement']],
      Notes: data[i][map['Notes']], PhotoUrl: data[i][map['PhotoUrl']]
    });
  }
  out.reverse();
  return out;
}

function approvePendingEnquiry(pendingId, token){
  requireAuth_(token);
  const sh = sh_('PEND'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
  for (let i=1;i<data.length;i++){
    if (String(data[i][map['PendingID']]).trim() === String(pendingId).trim()){
      if (String(data[i][map['Status']]||'') !== 'Pending') return {ok:false, msg:'Already reviewed'};
      const r = i+1;
      const pendLeadBy = String(data[i][map['LeadBy']]||'').trim();
      const result = addEnquiry({
        customer: data[i][map['Customer']], company: data[i][map['Company']], phone: data[i][map['Phone']],
        email: data[i][map['Email']], gst: data[i][map['GST']], pincode: data[i][map['Pincode']],
        district: data[i][map['District']], state: data[i][map['State']], city: data[i][map['City']],
        source: data[i][map['Source']], priority: data[i][map['Priority']], leadBy: pendLeadBy,
        // No rep was chosen at submission time — leave it unclaimed for Available Leads instead of
        // addEnquiry()'s own default (auto-assign to the first name in the Team list). This was the
        // actual bug behind "Pending Approvals has 109 but Available Leads only has 6" — every
        // approval with no LeadBy was silently auto-assigned instead of landing on Available Leads.
        leaveUnclaimed: !pendLeadBy,
        estValue: data[i][map['EstValue']], requirement: data[i][map['Requirement']], notes: data[i][map['Notes']],
        photoUrl: data[i][map['PhotoUrl']],
        qty: map['Qty'] !== undefined ? data[i][map['Qty']] : '', timeline: map['Timeline'] !== undefined ? data[i][map['Timeline']] : ''
      }, INTERNAL_BYPASS_);
      if (!result.ok) return result;
      const row = data[i].slice();
      row[map['Status']] = 'Approved';
      row[map['ApprovedEnqID']] = result.id;
      row[map['ReviewedBy']] = Session.getActiveUser().getEmail()||'';
      row[map['ReviewedAt']] = new Date();
      sh.getRange(r, 1, 1, row.length).setValues([row]);
      return {ok:true, msg:'Approved as '+result.id, id:result.id};
    }
  }
  return {ok:false, msg:'Not found'};
}

function rejectPendingEnquiry(pendingId, reason, token){
  requireAuth_(token);
  const sh = sh_('PEND'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
  for (let i=1;i<data.length;i++){
    if (String(data[i][map['PendingID']]).trim() === String(pendingId).trim()){
      if (String(data[i][map['Status']]||'') !== 'Pending') return {ok:false, msg:'Already reviewed'};
      const r = i+1;
      const row = data[i].slice();
      row[map['Status']] = 'Rejected';
      row[map['RejectReason']] = reason||'';
      row[map['ReviewedBy']] = Session.getActiveUser().getEmail()||'';
      row[map['ReviewedAt']] = new Date();
      sh.getRange(r, 1, 1, row.length).setValues([row]);
      return {ok:true, msg:'Rejected'};
    }
  }
  return {ok:false, msg:'Not found'};
}

// Lets a reviewer fix a field on a still-Pending row before approving it — mainly for Bulk Import,
// where a mis-mapped column or messy source cell needs a per-row correction instead of redoing the
// whole batch. Only touches rows still awaiting review; Approved/Rejected rows are locked history.
function updatePendingEnquiry(p, token){
  requireAuth_(token);
  if (!String(p.customer||'').trim() && !String(p.phone||'').trim()) return {ok:false, msg:'Name aur Phone zaroori'};
  const sh = sh_('PEND'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
  for (let i=1;i<data.length;i++){
    if (String(data[i][map['PendingID']]).trim() === String(p.id).trim()){
      if (String(data[i][map['Status']]||'Pending') !== 'Pending') return {ok:false, msg:'Already reviewed — can\'t edit anymore'};
      const r = i+1;
      const row = data[i].slice();
      row[map['Customer']] = String(p.customer||'').trim();
      row[map['Company']] = String(p.company||'').trim();
      row[map['Phone']] = String(p.phone||'').trim();
      row[map['Email']] = String(p.email||'').trim();
      row[map['GST']] = String(p.gst||'').trim();
      row[map['Pincode']] = String(p.pincode||'').trim();
      row[map['District']] = String(p.district||'').trim();
      row[map['State']] = String(p.state||'').trim();
      row[map['City']] = String(p.city||'').trim();
      row[map['Source']] = p.source||'';
      row[map['Priority']] = p.priority||'';
      row[map['LeadBy']] = p.leadBy||'';
      row[map['EstValue']] = p.estValue||'';
      row[map['Requirement']] = String(p.requirement||'').trim();
      row[map['Notes']] = String(p.notes||'').trim();
      sh.getRange(r, 1, 1, row.length).setValues([row]);
      return {ok:true, msg:'Pending lead updated'};
    }
  }
  return {ok:false, msg:'Not found'};
}

/* ----------------------------------------------------------- BULK LEAD IMPORT (CSV / Excel)
   The client parses the CSV/Excel file entirely in the browser (SheetJS) and lets the user map its
   columns to name/company/phone/requirement/quantity — no AI involved, since a spreadsheet export
   already has structured rows and columns. Each mapped row becomes its own Pending Approvals draft,
   same as every other lead-intake path — still needs a human to review and approve it.
   (This replaced an earlier Gemini-based photo/PDF version — that made sense for messy handwritten
   sources, but was unnecessary complexity/cost for what's normally a clean spreadsheet export.) */
function submitBulkPendingFromRows(leads, token){
  requireAuth_(token);
  if (!Array.isArray(leads) || !leads.length) return {ok:false, msg:'No rows to import'};
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    const sh = sh_('PEND'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
    const startNum = Number(newIdFromRows_('PEND-', data, map['PendingID']).replace('PEND-',''));
    const submittedBy = Session.getActiveUser().getEmail() || '';
    const valid = leads.filter(function(lead){ return String(lead.name||'').trim() || String(lead.phone||'').trim(); });
    if (!valid.length) return {ok:false, msg:'No valid rows found — each row needs at least a name or phone'};

    const rows = valid.map(function(lead, i){
      const row = new Array(PEND_HEADERS.length).fill('');
      row[map['PendingID']] = 'PEND-'+('000'+(startNum+i)).slice(-4);
      row[map['CreatedAt']] = new Date();
      row[map['SubmittedBy']] = submittedBy;
      row[map['Customer']] = String(lead.name||'').trim();
      row[map['Company']] = String(lead.company||'').trim();
      row[map['Phone']] = String(lead.phone||'').trim();
      row[map['Source']] = (CONFIG.SOURCES.indexOf(lead.source)>=0) ? lead.source : 'Other';
      row[map['Priority']] = (CONFIG.PRIORITIES.indexOf(lead.priority)>=0) ? lead.priority : 'Warm';
      row[map['LeadBy']] = String(lead.leadBy||'').trim();
      row[map['Requirement']] = [lead.requirement, lead.quantity].filter(Boolean).join(' — ');
      row[map['Notes']] = 'Bulk imported from CSV/Excel — verify before approving' +
        (String(lead.remark||'').trim() ? (' | Remark: '+String(lead.remark).trim()) : '');
      row[map['Status']] = 'Pending';
      return row;
    });
    sh.getRange(sh.getLastRow()+1, 1, rows.length, PEND_HEADERS.length).setValues(rows);
    return {ok:true, msg:'Imported '+rows.length+' lead(s) — review them in Pending Approvals', count: rows.length};
  } catch(err){
    return {ok:false, msg:String(err)};
  } finally {
    lock.releaseLock();
  }
}


/* ----------------------------------------------------------- MOVE STAGE */
function moveStage(p, token){
  const me = requireAuth_(token);
  try{
    const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
    let r = -1, i0 = -1;
    for (let i=1;i<data.length;i++){ if (String(data[i][map['EnqID']]).trim()===String(p.id).trim()){ r=i+1; i0=i; break; } }
    if (r<0) return {ok:false, msg:'Enquiry not found'};
    requireOwnLeadOrAdmin_(me, data[i0][map['LeadBy']]);
    const row = data[i0].slice();
    const stage = p.stage;
    const set = function(col,val){ if(map[col]!==undefined) row[map[col]] = val; };
    set('Stage', stage); set('LastContact', todayStr_());
    if (stage==='Quoted'){
      if (p.quoteNo!==undefined)     set('QuoteNo', p.quoteNo);
      set('QuoteDate', todayStr_());
      set('NextFollowUp', p.nextFollowUp || computeNextFollowUp_(data[i0][map['Priority']], todayStr_()));
    } else if (stage==='Follow-up'){
      set('NextFollowUp', p.nextFollowUp || computeNextFollowUp_(data[i0][map['Priority']], todayStr_()));
    } else if (stage==='Won'){
      // skipInvoice: only OmsBridge.js passes it (order is recorded in OMS first, invoice comes later).
      const inv = String(p.invoiceNo||'').trim();
      if (!inv && !p.skipInvoice) return {ok:false, msg:'Won karne ke liye Invoice Number daalna zaroori hai'};
      if (inv) set('InvoiceNo', inv);
      set('NextFollowUp',''); set('Priority','');
    } else if (stage==='Lost'){
      set('LostReason', p.lostReason||''); set('NextFollowUp',''); set('Priority','');
    } else if (stage==='Dispatched'){
      set('DispatchDate', p.dispatchDate || todayStr_()); set('DispatchInfo', p.dispatchInfo||'');
      // Total weight of the shipment, in kg. Stored as a number so the sheet can sum/sort it;
      // a blank box stays blank rather than becoming a misleading 0.
      set('ShipmentWeight', weightVal_(p.shipmentWeight));
      set('NextFollowUp',''); set('Priority',''); // Dispatched is also a terminal state — same as Won/Lost/Closed
    } else if (stage==='Closed'){
      if (p.feedbackRating!==undefined) set('FeedbackRating', p.feedbackRating);
      if (p.feedbackNote!==undefined)   set('FeedbackNote', p.feedbackNote); set('NextFollowUp',''); set('Priority','');
    }
    if (p.note){ const cur=row[map['Notes']]; set('Notes',(cur?cur+' | ':'')+todayStr_()+': '+p.note); }
    sh.getRange(r, 1, 1, row.length).setValues([row]);
    invalidateEnqCache_();
    return {ok:true, msg:'Moved to '+stage};
  }catch(err){ return {ok:false, msg:String(err)}; }
}

/* ----------------------------------------------------------- FOLLOW-UP LOG
   writeNote_ is the shared engine behind Call Management's logCall() — it stays even though the
   standalone "Log a communication" UI that used to call it directly (via logFollowUp/addNote) has
   been removed. */
// Actual date = when the call really happened (defaults to today, or p.actualDate if backdating a call).
// Planned date = auto-computed from Priority unless the caller passed an explicit nextFollowUp (manual override).
function writeNote_(p, advanceStage){
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    const actualDate = p.actualDate || todayStr_();
    let nextFU = p.nextFollowUp || '';

    if (p.id){
      const esh=sh_('ENQ'); const edata=esh.getDataRange().getValues(); const emap=colMapFromRow_(edata[0]);
      for(let i=1;i<edata.length;i++){
        if(String(edata[i][emap['EnqID']]).trim()===String(p.id).trim()){
          const r=i+1;
          const row = edata[i].slice();
          row[emap['LastContact']] = actualDate;
          if (!nextFU && advanceStage) nextFU = computeNextFollowUp_(edata[i][emap['Priority']] || 'Warm', actualDate);
          if (nextFU) row[emap['NextFollowUp']] = nextFU;
          if (advanceStage){ const cur=String(edata[i][emap['Stage']]); if(cur==='New'||cur==='Quoted') row[emap['Stage']] = 'Follow-up'; }
          esh.getRange(r, 1, 1, row.length).setValues([row]);
          invalidateEnqCache_();
          break;
        }
      }
    }

    const fu = sh_('FU'); const existingFu = fu.getDataRange().getValues(); const fmap = colMapFromRow_(existingFu[0]);
    const fid = newIdFromRows_('FU-', existingFu, fmap['FollowUpID']);
    const frow = new Array(FU_HEADERS.length).fill('');
    frow[fmap['FollowUpID']]=fid; frow[fmap['CreatedAt']]=new Date();
    frow[fmap['EnqID']]=p.id||''; frow[fmap['Customer']]=p.customer||'';
    frow[fmap['Mode']]=p.mode||'Note'; frow[fmap['Outcome']]=p.outcome||'';
    frow[fmap['NextFollowUp']]=nextFU; frow[fmap['By']]=p.by||''; frow[fmap['Note']]=p.note||'';
    fu.appendRow(frow);
    invalidateFuCache_();

    return {ok:true, msg:'Saved'};
  }catch(err){ return {ok:false, msg:String(err)}; }
  finally { lock.releaseLock(); }
}
/* ----------------------------------------------------------- READS
   Generic cached-and-chunked full-sheet reader. Originally hand-rolled just for the Enquiries
   sheet (getAllEnquiries_, behind getPipeline/getDashboardData/getCustomers/getReports/
   getFollowUpsDue — a full sheet scan that used to run fresh on every one of those calls, even
   several back-to-back for the same refreshAll()). Extracted so CallLog and FollowUps — scanned
   fresh on every single "Open enquiry" click via getCallHistoryRows_()/the FU history loop, and
   again on every dashboard load via getCallDashboard() — can share the same proven caching
   instead of each hand-rolling their own copy. Cached in CacheService, chunked to stay under the
   100KB-per-key limit, invalidated by bumping a version key from every function that writes to
   that sheet — a stale read just means falling back to a live scan, never wrong data.
     cachePrefix — short unique key ('enq','call','fu', ...)
     sheetKey    — key into SHEETS
     keep(row,map)   — true if this raw row should be included
     mapRow(row,map) — turns one included raw row into the cached object shape */
function cachedSheetRows_(cachePrefix, sheetKey, ttlSeconds, chunkSize, keep, mapRow){
  const cache = CacheService.getScriptCache();
  const verKey = cachePrefix+'_cache_ver';

  function version(){
    let v = cache.get(verKey);
    if (!v){ v = String(Date.now()); cache.put(verKey, v, 21600); }
    return v;
  }
  function readCache(ver){
    const manifestRaw = cache.get(cachePrefix+'_manifest_'+ver);
    if (!manifestRaw) return null;
    const n = JSON.parse(manifestRaw).n;
    const keys = []; for (let i=0;i<n;i++) keys.push(cachePrefix+'_chunk_'+ver+'_'+i);
    const got = cache.getAll(keys);
    if (!keys.every(function(k){ return got[k] !== undefined; })) return null;
    let out = [];
    for (let i=0;i<n;i++) out = out.concat(JSON.parse(got[cachePrefix+'_chunk_'+ver+'_'+i]));
    return out;
  }
  function liveRead(){
    const sh = sh_(sheetKey); if (!sh) return [];
    const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
    const out = [];
    for (let i=1;i<data.length;i++){ if (keep(data[i], map)) out.push(mapRow(data[i], map)); }
    return out;
  }

  let ver;
  try{ ver = version(); const hit = readCache(ver); if (hit) return hit; } catch(e){ /* fall through to a live read */ }

  // A page refresh fires several independent calls at once — right after the cache expires, all
  // of them used to hit a miss simultaneously and each do its own full sheet read at the same
  // time. The lock means only the first one actually reads the sheet; every other concurrent
  // caller waits a moment, then reads the cache the first one just filled.
  const lock = LockService.getScriptLock();
  if (lock.tryLock(20000)){
    try{
      try{ const hit2 = readCache(ver); if (hit2) return hit2; } catch(e){}
      const out = liveRead();
      try{
        const puts = {}; let n = 0;
        for (let i=0;i<out.length;i+=chunkSize){ puts[cachePrefix+'_chunk_'+ver+'_'+n] = JSON.stringify(out.slice(i, i+chunkSize)); n++; }
        puts[cachePrefix+'_manifest_'+ver] = JSON.stringify({n:n});
        cache.putAll(puts, ttlSeconds);
      } catch(e){ /* caching is best-effort — a row too large for one chunk just skips caching this pass */ }
      return out;
    } finally { lock.releaseLock(); }
  }

  // Someone else is already filling the cache and we couldn't get the lock in time — fall back to
  // a live read rather than blocking indefinitely. Slower than a cache hit, but always correct.
  return liveRead();
}
function invalidateSheetCache_(cachePrefix){
  try{ CacheService.getScriptCache().put(cachePrefix+'_cache_ver', String(Date.now()), 21600); }catch(e){}
}

const ENQ_CACHE_TTL_ = 90; // seconds — a write invalidates this immediately anyway,
// so this only bounds how stale a read can be after a change made outside the app (rare); longer
// means fewer full-sheet reads as the sheet grows.
const ENQ_CACHE_CHUNK_SIZE_ = 80; // objects per chunk, kept small to stay well under the 100KB/key cap
function invalidateEnqCache_(){ invalidateSheetCache_('enq'); } // called by every function that mutates the Enquiries sheet
function getAllEnquiries_(){
  return cachedSheetRows_('enq', 'ENQ', ENQ_CACHE_TTL_, ENQ_CACHE_CHUNK_SIZE_,
    function(row, map){ return !!row[map['EnqID']] && String(row[map['Active']]).toUpperCase()!=='NO'; },
    rowToObj_);
}

const CALL_CACHE_TTL_ = 90;
const CALL_CACHE_CHUNK_SIZE_ = 150; // call rows are smaller than enquiry rows — more fit per 100KB chunk
function invalidateCallCache_(){ invalidateSheetCache_('call'); } // called by logCall()
function getAllCallLogRows_(){
  return cachedSheetRows_('call', 'CALL', CALL_CACHE_TTL_, CALL_CACHE_CHUNK_SIZE_,
    function(row, map){ return !!row[map['CallLogID']]; },
    function(row, map){
      return {
        CallLogID: row[map['CallLogID']], EnqID: String(row[map['EnqID']]||'').trim(),
        CallNumber: Number(row[map['CallNumber']]) || 0, CallDate: fmtDate_(row[map['CallDate']]),
        Employee: row[map['Employee']], Remarks: row[map['Remarks']],
        NextFollowUp: row[map['NextFollowUp']] ? fmtDate_(row[map['NextFollowUp']]) : '',
        CallStatus: row[map['CallStatus']], Interest: map['Interest']!==undefined ? row[map['Interest']] : ''
      };
    });
}

const FU_CACHE_TTL_ = 90;
const FU_CACHE_CHUNK_SIZE_ = 150;
function invalidateFuCache_(){ invalidateSheetCache_('fu'); } // called by writeNote_()
// CreatedAt/NextFollowUp cached in ISO (fmtDate_) form, same as getAllCallLogRows_ — canonical
// and directly comparable/sliceable (getTeamPerformance needs 'yyyy-MM' month keys); callers that
// want the display format (getEnquiry's history list) apply fmtNice_ themselves.
function getAllFollowUpRows_(){
  return cachedSheetRows_('fu', 'FU', FU_CACHE_TTL_, FU_CACHE_CHUNK_SIZE_,
    function(row, map){ return !!row[map['FollowUpID']]; },
    function(row, map){
      return {
        EnqID: String(row[map['EnqID']]||'').trim(),
        CreatedAt: row[map['CreatedAt']] ? fmtDate_(row[map['CreatedAt']]) : '',
        Mode: row[map['Mode']], Outcome: row[map['Outcome']],
        NextFollowUp: row[map['NextFollowUp']] ? fmtDate_(row[map['NextFollowUp']]) : '',
        By: row[map['By']], Note: row[map['Note']]
      };
    });
}
function getPipeline(filter, token) {
  const me = requireAuth_(token);
  filter = filter || {};
  // Reps only ever see their own claimed leads — not each other's — regardless of what the
  // client asks for; admins see everyone's, same as before.
  if (me.role !== 'admin') filter.leadBy = me.name;

  let list = getAllEnquiries_();

  // ---------------- Search ----------------
  if (filter.q) {
    const q = String(filter.q).toLowerCase();

    list = list.filter(function (e) {
      return (
        (e.Customer || "") +
        " " +
        (e.Company || "") +
        " " +
        (e.Phone || "") +
        " " +
        (e.Requirement || "") +
        " " +
        (e.City || "") +
        " " +
        (e.Source || "") +
        " " +
        (e.LeadBy || "") +
        " " +
        (e.EnqID || "")
      )
        .toLowerCase()
        .includes(q);
    });
  }

  // ---------------- Stage (accepts a single stage, or an array to match any of several —
  // e.g. the Dashboard's "Active Pipeline" card spans New/Quoted/Follow-up at once, which the
  // Pipeline tab's single-select Stage dropdown can't represent on its own) ----------------
  if (filter.stage){
    if (Array.isArray(filter.stage)) list = list.filter(e => filter.stage.indexOf(e.Stage) >= 0);
    else list = list.filter(e => e.Stage == filter.stage);
  }

  // ---------------- Source ----------------
  if (filter.source)
    list = list.filter(e => e.Source == filter.source);

  // ---------------- Lead ----------------
  if (filter.leadBy)
    list = list.filter(e => e.LeadBy == filter.leadBy);

  // ---------------- Priority ----------------
  if (filter.priority)
    list = list.filter(e => e.Priority == filter.priority);

  // ---------------- Follow-up Status ----------------
  if (filter.followupStatus) {
    list = list.filter(function(e){
      return calculateFollowupStatus(e.NextFollowUp) === filter.followupStatus;
    });
  }

  // ---------------- City ----------------
  if (filter.city) {
    const city = filter.city.toLowerCase();
    list = list.filter(function (e) {
      return String(e.City || "")
        .toLowerCase()
        .includes(city);
    });
  }

  // ---------------- State ---------------- (separate from City — a City-text search alone misses
  // rows whose City is now just a clean city name with the state correctly in its own column)
  if (filter.state) {
    const state = filter.state.toLowerCase();
    list = list.filter(function (e) {
      return String(e.State || "").toLowerCase().includes(state);
    });
  }

  // ---------------- Company ----------------
  if (filter.company) {
    const comp = filter.company.toLowerCase();
    list = list.filter(function (e) {
      return String(e.Company || "")
        .toLowerCase()
        .includes(comp);
    });
  }

  // ---------------- Date Range ----------------
  if (filter.dateFrom) {
    list = list.filter(function (e) {
      return e.EnqDate >= filter.dateFrom;
    });
  }

  if (filter.dateTo) {
    list = list.filter(function (e) {
      return e.EnqDate <= filter.dateTo;
    });
  }

  // ---------------- Sort ----------------
  list.sort(function (a, b) {
    return String(b.CreatedAt)
      .localeCompare(String(a.CreatedAt));
  });

  return list;
}
// Scans the raw sheet directly and builds only the one matched row, instead of getAllEnquiries_()
// which would build a full object (with several date-format calls each) for every row in the sheet
// just to find and keep one — that was the main cause of the View button feeling slow.
function getEnquiry(id, token){
  requireAuth_(token);
  const eid = String(id).trim();
  const e = getAllEnquiries_().filter(function(x){ return String(x.EnqID).trim() === eid; })[0];
  if (!e) return {ok:false};
  const hist = getAllFollowUpRows_().filter(function(r){ return r.EnqID === eid; })
    .map(function(r){ return { date: r.CreatedAt?fmtNice_(r.CreatedAt):'', mode:r.Mode, outcome:r.Outcome,
      next: r.NextFollowUp?fmtNice_(r.NextFollowUp):'', by:r.By, note:r.Note }; });
  hist.reverse(); e.history=hist;
  e.calls = getCallHistoryRows_(id);
  e.callsRemaining = Math.max(0, MAX_CALLS_PER_ENQUIRY - e.calls.length); // 0 once the default is reached; more can still be logged
  e.waWelcome=waLinkWelcome_(e); e.waFollow=waLinkFollow_(e);
  return {ok:true, enquiry:e};
}

/* ----------------------------------------------------------- FOLLOW-UPS DUE */
// Trims a full enquiry object down to only the fields a given list view actually renders — the
// full row (Notes, PhotoUrl, GST, QuoteAmount, ...) never needs to leave the server for a list;
// opening a specific lead (openDetail -> getEnquiry) fetches the full row on demand, same as
// before. Cuts the response payload for the views that show the most rows at once.
function pickFields_(e, fields){
  const o = {};
  fields.forEach(function(f){ if (e[f]!==undefined) o[f] = e[f]; });
  return o;
}
const FOLLOWUP_FIELDS_ = ['EnqID','Customer','Company','Stage','Priority','NextFollowUp','LastContact','LeadBy','Requirement','waFollow','waWelcome','Grade','Escalation','DaysOverdue'];

// Lightweight sibling of getFollowUpsDue() — just the two counts the sidebar's Follow-ups badge
// needs, kept fresh on every refreshAll() regardless of which tab is open. Previously the only way
// to get this number was loadDash()'s full getDashboardData() (KPIs + all four charts + map data),
// which used to run on every single refreshAll() call no matter what tab was actually open — the
// real "why is stuff loading that I'm not even looking at" the user was pointing at.
function getFollowUpBadgeCounts(token){
  const me = requireAuth_(token);
  let overdue=0, dueToday=0;
  getAllEnquiries_().forEach(function(e){
    if (me.role !== 'admin' && e.LeadBy !== me.name) return;
    if (OPEN_STAGES.indexOf(e.Stage) < 0 || !e.NextFollowUp) return;
    const status = calculateFollowupStatus(e.NextFollowUp);
    if (status === 'Overdue') overdue++;
    else if (status === 'Today') dueToday++;
  });
  return {overdue:overdue, dueToday:dueToday};
}
function getFollowUpsDue(token){
  const me = requireAuth_(token);
  const list = getAllEnquiries_().filter(function(e){
    if (me.role !== 'admin' && e.LeadBy !== me.name) return false; // reps see only their own claimed leads
    return OPEN_STAGES.indexOf(e.Stage) >= 0 && e.NextFollowUp;
  });

  const overdue = [], todo = [], upcoming = [];

  list.forEach(function(src){
    const e = pickFields_(src, FOLLOWUP_FIELDS_);
    e.waFollow = waLinkFollow_(src);
    e.waWelcome = waLinkWelcome_(src);
    e.DaysOverdue = daysOverdue_(e.NextFollowUp);

    const status = calculateFollowupStatus(e.NextFollowUp);

    if (status === "Overdue") overdue.push(e);
    else if (status === "Today") todo.push(e);
    else upcoming.push(e); // Catches "Tomorrow" and "Upcoming"
  });
  
  const byDate = function(a,b){ return String(a.NextFollowUp).localeCompare(String(b.NextFollowUp)); };
  overdue.sort(byDate); todo.sort(byDate); upcoming.sort(byDate);
  
  return {overdue: overdue, today: todo, upcoming: upcoming.slice(0, 15)};
}

/* ----------------------------------------------------------- DASHBOARD */
/* ----------------------------------------------------------- DASHBOARD & CHARTS */
function filterDashData_(list, f) {
  if (!f) return list;
  if (f.dateFrom) list = list.filter(e => e.EnqDate >= f.dateFrom);
  if (f.dateTo) list = list.filter(e => e.EnqDate <= f.dateTo);
  if (f.leadBy) list = list.filter(e => e.LeadBy == f.leadBy);
  if (f.source) list = list.filter(e => e.Source == f.source);
  if (f.priority) list = list.filter(e => e.Priority == f.priority);
  if (f.stage) list = list.filter(e => e.Stage == f.stage);
  return list;
}

// Combined entry point for the client: computes KPIs + charts from a single sheet read/filter pass
// instead of two separate google.script.run round-trips that each independently re-scan the sheet.
// Reps only ever see their own claimed leads — not each other's — regardless of what the
// client asks for; admins see everyone's. Same rule getPipeline() already enforces; the
// Dashboard (KPIs + charts) was missing it, so every rep saw company-wide numbers mislabeled
// as their own (e.g. "Overdue: 1557" when their actual Follow-ups list held 24).
function scopeDashFilter_(filter, me){
  filter = filter || {};
  if (me.role !== 'admin') filter = Object.assign({}, filter, {leadBy: me.name});
  return filter;
}
function getDashboardData(filter, token){
  const me = requireAuth_(token);
  const list = filterDashData_(getAllEnquiries_(), scopeDashFilter_(filter, me));
  return { kpis: computeDashboardKpis_(list), charts: computeDashboardCharts_(list) };
}

function getDashboard(filter, token){
  const me = requireAuth_(token);
  return computeDashboardKpis_(filterDashData_(getAllEnquiries_(), scopeDashFilter_(filter, me)));
}
function computeDashboardKpis_(list){
  const mKey = monthKey_(new Date());
  const funnel = {}; STAGES.forEach(s => funnel[s]=0);
  
  let openCount=0, quotedValue=0, wonMonthCount=0, wonMonthValue=0;
  let overdue=0, dueToday=0, wonTotal=0, lostTotal=0;
  let hotLeads=0, warmLeads=0, coldLeads=0;
  // PDF Command Center: Contacted = anyone touched (stage moved past New / a contact logged);
  // Approved = contacted leads that reached Quoted or beyond (not still New, not Lost);
  // Converted = approved leads that are Won/Dispatched/Closed.
  let contacted=0, approved=0, converted=0, escProp=0, escShop=0;

  list.forEach(function(e){
    funnel[e.Stage] = (funnel[e.Stage]||0) + 1;
    const isContacted = e.Stage !== 'New' || !!e.LastContact;
    if (isContacted){
      contacted++;
      if (['Quoted','Follow-up','Won','Dispatched','Closed'].indexOf(e.Stage)>=0){
        approved++;
        if (['Won','Dispatched','Closed'].indexOf(e.Stage)>=0) converted++;
      }
    }
    if (OPEN_STAGES.indexOf(e.Stage)>=0){
      if (e.Escalation==='Proprietor') escProp++; else if (e.Escalation==='Shop Floor') escShop++;
    }

    if(OPEN_STAGES.indexOf(e.Stage)>=0){
      openCount++; 
      quotedValue += num_(e.QuoteAmount) || num_(e.EstValue);
      
      if(e.Priority === 'Hot') hotLeads++;
      else if(e.Priority === 'Warm') warmLeads++;
      else coldLeads++;

      if(e.NextFollowUp){ 
        const status = calculateFollowupStatus(e.NextFollowUp);
        if(status === "Overdue") overdue++;
        else if(status === "Today") dueToday++;
      }
    }
    if(e.Stage==='Won'){ wonTotal++; if(monthKey_(e.LastContact||e.CreatedAt)===mKey){ wonMonthCount++; wonMonthValue+=num_(e.OrderValue); } }
    if(e.Stage==='Dispatched'){ wonTotal++; if(monthKey_(e.LastContact||e.CreatedAt)===mKey) wonMonthValue+=num_(e.OrderValue); }
    if(e.Stage==='Closed') wonTotal++;
    if(e.Stage==='Lost') lostTotal++;
  });
  
  const decided = wonTotal + lostTotal; 
  const winRate = decided ? Math.round(wonTotal*100/decided) : 0;
  
  return {
    totalEnquiries: list.length,
    activePipeline: openCount,
    pipelineValue: quotedValue,
    wonRevenue: wonMonthValue,
    wonMonthCount: wonMonthCount,
    hotLeads: hotLeads,
    warmLeads: warmLeads,
    coldLeads: coldLeads,
    overdue: overdue, 
    dueToday: dueToday, 
    winRate: winRate,
    contactedPct: list.length ? Math.round(contacted*10000/list.length)/100 : 0, contacted: contacted,
    approvedPct: contacted ? Math.round(approved*10000/contacted)/100 : 0, approved: approved,
    convertedPct: approved ? Math.round(converted*10000/approved)/100 : 0, converted: converted,
    escProprietor: escProp, escShopFloor: escShop,
    funnel: funnel,
    asOf: fmtNice_(new Date()) 
  };
}

/* ----------------------------------------------------------- DASHBOARD CHARTS (APEX & GEO) */
function getDashboardCharts(filter, token) {
  const me = requireAuth_(token);
  return computeDashboardCharts_(filterDashData_(getAllEnquiries_(), scopeDashFilter_(filter, me)));
}
function computeDashboardCharts_(list) {
  const data = {
    months: { categories: [], data: [] },
    sources: { labels: [], data: [] },
    priorities: { labels: ['Hot', 'Warm', 'Cold'], data: [0, 0, 0] },
    leadBy: { labels: [], data: [] },
    states: [] 
  };

  const monthMap = {}; 
  const sourceMap = {}; 
  const leadMap = {}; 
  const stateMap = {};

  list.forEach(function(e) {
    const p = e.Priority || 'Warm';
    if(p === 'Hot') data.priorities.data[0]++;
    else if(p === 'Warm') data.priorities.data[1]++;
    else if(p === 'Cold') data.priorities.data[2]++;

    const s = e.Source || 'Other';
    sourceMap[s] = (sourceMap[s] || 0) + 1;

    const l = e.LeadBy || 'Unassigned';
    leadMap[l] = (leadMap[l] || 0) + 1;

    const dStr = e.EnqDate || e.CreatedAt;
    if(dStr) {
       const d = new Date(dStr);
       const mKey = Utilities.formatDate(d, TZ, "MMM yyyy");
       const sortKey = Utilities.formatDate(d, TZ, "yyyy-MM");
       if(!monthMap[sortKey]) monthMap[sortKey] = { label: mKey, count: 0 };
       monthMap[sortKey].count++;
    }

    // State mapping: resolve to a canonical ISO 3166-2:IN code where possible so the map can match by
    // code instead of live-geocoding free text (unreliable inside Apps Script's sandboxed iframe, and
    // breaks on non-state values). Unresolved values still group by their raw text for the table.
    const st = String(e.State || e.state || e.STATE || '').trim();
    if (st) {
        const resolved = normalizeState_(st);
        const key = resolved ? resolved.iso : ('RAW:'+st.toUpperCase());
        if(!stateMap[key]){
          const c = resolved ? (STATE_CENTROID_[resolved.name]||null) : null;
          stateMap[key] = { state: resolved ? resolved.name : st, iso: resolved ? resolved.iso : '', count: 0, value: 0,
            lat: c ? c[0] : null, lng: c ? c[1] : null };
        }
        stateMap[key].count++;
        stateMap[key].value += (num_(e.QuoteAmount) || num_(e.EstValue));
    }
  });

  data.sources.labels = Object.keys(sourceMap);
  data.sources.data = Object.values(sourceMap);
  
  data.leadBy.labels = Object.keys(leadMap);
  data.leadBy.data = Object.values(leadMap);

  const sortedMonths = Object.keys(monthMap).sort().slice(-6);
  sortedMonths.forEach(function(k) {
    data.months.categories.push(monthMap[k].label);
    data.months.data.push(monthMap[k].count);
  });

  data.states = Object.values(stateMap).sort(function(a,b) { return b.count - a.count; });
  return data;
}

/* ----------------------------------------------------------- REPORTS */
function getReports(token){
  const me = requireAuth_(token);
  if (me.role !== 'admin') throw new Error('Admins only.');
  const list=getAllEnquiries_();
  const bySource={}, byLead={};
  list.forEach(function(e){
    const s=e.Source||'Other';
    if(!bySource[s]) bySource[s]={source:s,enquiries:0,won:0,lost:0};
    bySource[s].enquiries++;
    const won=(e.Stage==='Won'||e.Stage==='Dispatched'||e.Stage==='Closed');
    if(won) bySource[s].won++;
    if(e.Stage==='Lost') bySource[s].lost++;
    const l=e.LeadBy||'—';
    if(!byLead[l]) byLead[l]={leadBy:l,enquiries:0,won:0};
    byLead[l].enquiries++; if(won) byLead[l].won++;
  });
  const sources=Object.keys(bySource).map(function(k){ const o=bySource[k]; const dec=o.won+o.lost; o.winRate=dec?Math.round(o.won*100/dec):0; return o; }).sort(function(a,b){ return b.enquiries-a.enquiries; });
  const leads=Object.keys(byLead).map(function(k){ return byLead[k]; }).sort(function(a,b){ return b.enquiries-a.enquiries; });
  return {sources:sources, leads:leads};
}

/* ----------------------------------------------------------- TEAM PERFORMANCE
   Per-rep leaderboard — leads owned, calls, follow-ups, conversions. Read-only, derived from data
   the app already writes (Enquiries.LeadBy, CallLog.Employee, FollowUps.By). Admin-only, matches
   the Vercel port's teamPerformance.ts. */
function getTeamPerformance(token){
  const me = requireAuth_(token);
  if (me.role !== 'admin') throw new Error('Admins only.');

  const enq = getAllEnquiries_();
  const callRows = getAllCallLogRows_();
  const fuRows = getAllFollowUpRows_();

  const today = todayStr_();
  const mKey = today.slice(0,7); // 'YYYY-MM'
  const CONVERTED = ['Won','Dispatched','Closed'];

  // Every name that appears as an owner / caller / note-taker, plus the active Team roster.
  const names = {};
  getTeam().forEach(function(n){ if(n) names[n]=true; });
  enq.forEach(function(e){ if (e.LeadBy) names[String(e.LeadBy).trim()]=true; });
  callRows.forEach(function(r){ if (r.Employee) names[String(r.Employee).trim()]=true; });
  fuRows.forEach(function(r){ if (r.By) names[String(r.By).trim()]=true; });

  // One pass over calls/follow-ups building per-name totals, instead of re-scanning the whole
  // list once per rep (was O(reps x rows) on top of the raw sheet reads this now also skips).
  const callsByName = {};
  callRows.forEach(function(r){
    const name = String(r.Employee||'').trim(); if (!name) return;
    const b = callsByName[name] || (callsByName[name] = {today:0, month:0});
    if (r.CallDate === today) b.today++;
    if (r.CallDate.slice(0,7) === mKey) b.month++;
  });
  const fuByName = {};
  fuRows.forEach(function(r){
    const name = String(r.By||'').trim(); if (!name || r.CreatedAt.slice(0,7) !== mKey) return;
    fuByName[name] = (fuByName[name]||0) + 1;
  });

  const reps = Object.keys(names).filter(Boolean).map(function(name){
    const mine = enq.filter(function(e){ return String(e.LeadBy||'').trim()===name; });
    let open=0, overdue=0, won=0, lost=0;
    mine.forEach(function(e){
      if (OPEN_STAGES.indexOf(e.Stage)>=0){
        open++;
        if (e.NextFollowUp && String(e.NextFollowUp) < today) overdue++;
      }
      if (CONVERTED.indexOf(e.Stage)>=0) won++;
      else if (e.Stage==='Lost') lost++;
    });
    const decided = won+lost;
    const c = callsByName[name] || {today:0, month:0};

    return {
      name:name, leads:mine.length, open:open, overdue:overdue,
      callsMonth:c.month, callsToday:c.today, followupsMonth: fuByName[name]||0,
      won:won, lost:lost, winRate: decided ? Math.round(won*100/decided) : 0
    };
  });

  reps.sort(function(a,b){ return (b.won-a.won) || (b.leads-a.leads) || (b.callsMonth-a.callsMonth); });

  const totals = reps.reduce(function(t,r){
    return { leads:t.leads+r.leads, won:t.won+r.won, lost:t.lost+r.lost, callsMonth:t.callsMonth+r.callsMonth };
  }, {leads:0,won:0,lost:0,callsMonth:0});

  return { reps: reps, totals: totals, asOf: fmtNice_(new Date()) };
}

function generateReportSheet(token){
  requireAuth_(token);
  const ss=ss_(); const name='Report '+Utilities.formatDate(new Date(),TZ,'MMM yyyy');
  let sh=ss.getSheetByName(name); if(sh) ss.deleteSheet(sh); sh=ss.insertSheet(name);
  const rep=getReports(INTERNAL_BYPASS_); const dash=getDashboard(undefined, INTERNAL_BYPASS_); let r=1;
  sh.getRange(r,1).setValue(CONFIG.COMPANY_NAME+' — Sales FMS Snapshot ('+dash.asOf+')').setFontWeight('bold').setFontSize(13); r+=2;
  sh.getRange(r,1,1,3).setValues([['Open','Won (Month)','Win Rate %']]).setFontWeight('bold'); r++;
  sh.getRange(r,1,1,3).setValues([[dash.activePipeline,dash.wonMonthCount,dash.winRate]]); r+=2;
  sh.getRange(r,1).setValue('By Source').setFontWeight('bold'); r++;
  sh.getRange(r,1,1,5).setValues([['Source','Enquiries','Won','Lost','Win %']]).setFontWeight('bold'); r++;
  rep.sources.forEach(function(o){ sh.getRange(r,1,1,5).setValues([[o.source,o.enquiries,o.won,o.lost,o.winRate]]); r++; }); r++;
  sh.getRange(r,1).setValue('By Lead By').setFontWeight('bold'); r++;
  sh.getRange(r,1,1,3).setValues([['Lead By','Enquiries','Won']]).setFontWeight('bold'); r++;
  rep.leads.forEach(function(o){ sh.getRange(r,1,1,3).setValues([[o.leadBy,o.enquiries,o.won]]); r++; });
  sh.autoResizeColumns(1,5);
  SpreadsheetApp.getActive().toast('Report sheet "'+name+'" ready','Sales FMS',5);
  return {ok:true,name:name};
}

// TEMP DIAGNOSTIC — checks real State/Pincode data quality. Takes the already-fetched (cached)
// enquiry list rather than re-reading the sheet, so it adds no extra Sheets API call. Delete after use.
function debugStateSample_(list){
  let blankState=0, blankPincode=0, stateStuckInCityOrDistrict=0;
  const unresolved = {};    // State non-blank, fails BOTH exact and fuzzy match -> count
  const fuzzyFixable = {};  // State non-blank, fails exact but a fuzzy typo match exists -> "typed -> corrected": count
  list.forEach(function(e){
    const st = String(e.State||'').trim();
    const pin = String(e.Pincode||'').trim();
    if (!st) blankState++;
    else if (!normalizeState_(st)){
      const fuzzy = fuzzyNormalizeState_(st);
      if (fuzzy){ const k = st+' → '+fuzzy.name; fuzzyFixable[k] = (fuzzyFixable[k]||0)+1; }
      else unresolved[st] = (unresolved[st]||0)+1;
    }
    if (!pin) blankPincode++;
    if (!st && (fuzzyNormalizeState_(e.City) || fuzzyNormalizeState_(e.District))) stateStuckInCityOrDistrict++;
  });
  const topUnresolved = Object.keys(unresolved).map(function(k){ return {state:k, count:unresolved[k]}; })
    .sort(function(a,b){ return b.count-a.count; }).slice(0,20);
  const topFuzzyFixable = Object.keys(fuzzyFixable).map(function(k){ return {state:k, count:fuzzyFixable[k]}; })
    .sort(function(a,b){ return b.count-a.count; }).slice(0,20);
  return { total:list.length, blankState:blankState, blankPincode:blankPincode,
    stateStuckInCityOrDistrict: stateStuckInCityOrDistrict,
    topUnresolvedStateSpellings: topUnresolved, topFuzzyFixableSpellings: topFuzzyFixable };
}

/* ----------------------------------------------------------- DAILY DIGEST */
function setupDailyTrigger(){
  ScriptApp.getProjectTriggers().forEach(function(t){ if(t.getHandlerFunction()==='sendDailyDigest') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendDailyDigest').timeBased().everyDays(1).atHour(CONFIG.DIGEST_HOUR).create();
  SpreadsheetApp.getActive().toast('Daily follow-up email set for ~'+CONFIG.DIGEST_HOUR+':00','Sales FMS',6);
}
function escHtml_(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function sendDailyDigest(){
  const to=CONFIG.ADMIN_EMAIL||Session.getActiveUser().getEmail(); if(!to) return;
  const due=getFollowUpsDue(INTERNAL_BYPASS_); const dash=getDashboard(undefined, INTERNAL_BYPASS_); const url=ScriptApp.getService().getUrl();
  const row=function(e,tag){ return '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><b>'+escHtml_(e.Customer)+'</b>'+(e.Company?(' — '+escHtml_(e.Company)):'')+
    '<br><span style="color:#777">'+escHtml_(e.EnqID)+' · '+escHtml_(e.Stage)+' · '+escHtml_(e.LeadBy||'')+'</span></td>'+
    '<td style="padding:6px 10px;border-bottom:1px solid #eee">'+escHtml_(e.Requirement||'')+'</td>'+
    '<td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">'+tag+' '+fmtNice_(e.NextFollowUp)+'</td>'+
    '<td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">'+escHtml_(e.Phone||'')+(e.waFollow?(' · <a href="'+e.waFollow+'">WhatsApp</a>'):'')+'</td></tr>'; };
  let html='<div style="font-family:Arial,sans-serif;max-width:720px"><h2 style="color:#0b86ac;margin:0">'+CONFIG.COMPANY_NAME+' — Aaj ke Follow-ups</h2>'+
    '<p style="color:#555;margin:4px 0 14px">'+dash.asOf+' · Open: <b>'+dash.activePipeline+'</b> · Overdue: <b style="color:#d9594a">'+dash.overdue+'</b> · Due today: <b>'+dash.dueToday+'</b> · Win rate: <b>'+dash.winRate+'%</b></p>';
  if(due.overdue.length){ html+='<h3 style="color:#d9594a;margin:14px 0 4px">⚠ Overdue ('+due.overdue.length+')</h3><table style="width:100%;border-collapse:collapse;font-size:13px">'; due.overdue.forEach(function(e){ html+=row(e,'Due'); }); html+='</table>'; }
  if(due.today.length){ html+='<h3 style="color:#54a737;margin:16px 0 4px">● Due Today ('+due.today.length+')</h3><table style="width:100%;border-collapse:collapse;font-size:13px">'; due.today.forEach(function(e){ html+=row(e,'Today'); }); html+='</table>'; }
  if(!due.overdue.length && !due.today.length) html+='<p style="color:#54a737">✓ Koi follow-up due nahi hai aaj. Pipeline clean hai.</p>';
  html+='<p style="margin-top:18px"><a href="'+url+'" style="background:#0b86ac;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open Sales FMS</a></p><p style="color:#999;font-size:12px">'+CONFIG.TAGLINE+'</p></div>';
  MailApp.sendEmail({ to:to, subject:'['+CONFIG.COMPANY_NAME+'] '+due.overdue.length+' overdue · '+due.today.length+' due today', htmlBody:html });
}

