/*****************************************************************
 * META ADS LEADS AUTO-IMPORT — ports web/lib/services/metaLeads.ts (the Vercel app's version)
 * to Apps Script. Pulls new rows from an external "Leads" Google Sheet (Meta/Facebook Lead Ads
 * exports land there, typically via a Zapier/native sync feeding it or an IMPORTRANGE() formula
 * from another spreadsheet) and drops them straight into Enquiries, unclaimed — they show up on
 * Available Leads for a rep to call and claim, same as any other unclaimed lead.
 *
 * Strictly READ-ONLY against that external sheet. Dedup happens entirely on our own side, via a
 * "MetaLeadID:<id>" tag embedded in Notes — Notes only ever gets appended to, never overwritten,
 * so the tag survives for the enquiry's lifetime and a re-run never double-imports.
 *****************************************************************/
const META_LEADS_SHEET_ID_PROP_ = 'META_LEADS_SHEET_ID';

function metaLeadsSheetId_(){
  return PropertiesService.getScriptProperties().getProperty(META_LEADS_SHEET_ID_PROP_) || '';
}
function setMetaLeadsSheetId(){
  requireOwnerOrSheetUi_();
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Set Meta Ads Leads Sheet',
    'Paste the Google Sheet ID (or full URL) of the external Leads sheet that Meta Ads exports land in:',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  let raw = res.getResponseText().trim();
  const m = raw.match(/\/d\/([a-zA-Z0-9_-]+)/); // accepts a pasted full URL too, not just the bare ID
  const id = m ? m[1] : raw;
  PropertiesService.getScriptProperties().setProperty(META_LEADS_SHEET_ID_PROP_, id);
  ui.alert(id ? 'Meta Ads leads sheet set.' : 'Cleared — auto-import is now off until this is set again.');
}

// Common header spellings across Meta Lead Ads exports / manual sheets — matched case-insensitively.
const META_HEADER_ALIASES_ = {
  id: ['id','lead_id','leadgen_id'],
  createdTime: ['created_time','created_at','date'],
  name: ['full_name','name','customer','customer name'],
  phone: ['phone_number','phone','mobile','mobile number','contact'],
  company: ['company','company_name','business'],
  city: ['city'],
  pincode: ['post_code','pincode','zip','zip_code'],
  product: ['product_interested_in','product','product_name','interest'],
  quantity: ['expected_order_quantity','quantity','order_quantity']
};
function findMetaCol_(map, aliases){
  for (let a=0; a<aliases.length; a++){
    for (const k in map){ if (String(k).trim().toLowerCase() === aliases[a]) return map[k]; }
  }
  return undefined;
}
// Meta's own export prefixes some values with a short type tag, e.g. "p:+917303810757" for phone
// or "z:201012" for pincode — strip it so downstream fields get the clean value.
function stripMetaTag_(v){ return String(v||'').replace(/^[a-z]{1,3}:\s*/i, '').trim(); }

const META_LEAD_ID_TAG_ = 'MetaLeadID:';
function extractMetaLeadId_(notes){
  const m = String(notes||'').match(/MetaLeadID:(\S+)/);
  return m ? m[1] : undefined;
}
// Every Meta lead id already imported (Pending or straight into Enquiries) — checked before doing
// any per-lead work like a pincode lookup.
function alreadyImportedMetaLeadIds_(){
  const ids = {};
  ['PEND','ENQ'].forEach(function(key){
    const sh = sh_(key); if (!sh) return;
    const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
    if (map['Notes']===undefined) return;
    for (let i=1;i<data.length;i++){ const id = extractMetaLeadId_(data[i][map['Notes']]); if (id) ids[id]=true; }
  });
  return ids;
}
// Pincode -> {district,state}, via the same api.postalpincode.in lookup the New Enquiry form's
// client-side pincode autofill uses. Called once per unique pincode in a batch, not once per lead.
function lookupDistrictState_(pin){
  if (!/^\d{6}$/.test(pin)) return null;
  try{
    const res = UrlFetchApp.fetch('https://api.postalpincode.in/pincode/'+pin, {muteHttpExceptions:true});
    if (res.getResponseCode() !== 200) return null;
    const data = JSON.parse(res.getContentText());
    const po = (data && data[0] && data[0].Status==='Success') ? (data[0].PostOffice||[])[0] : null;
    return po ? {district: po.District||'', state: po.State||''} : null;
  } catch(e){ return null; }
}

/** Reads the external Leads sheet (read-only) and imports rows not already seen. Returns {imported, skipped}. */
function importNewMetaLeads_(){
  const sheetId = metaLeadsSheetId_();
  if (!sheetId) return {ok:false, msg:'Meta Ads leads sheet not configured — set it from the Sales FMS menu first.', imported:0, skipped:0};

  // Reads every tab in the source spreadsheet (Sheet1, Sheet2, ...), not just the first — a source
  // spreadsheet that gets a second tab added later (another campaign/platform export) is picked up
  // automatically, no config change needed.
  let sheets;
  try{ sheets = SpreadsheetApp.openById(sheetId).getSheets(); }
  catch(e){ return {ok:false, msg:'Could not open the leads sheet: '+e.message, imported:0, skipped:0}; }

  const get = function(row, col){ return col===undefined ? '' : String(row[col]==null?'':row[col]).trim(); };
  let candidates = [];
  sheets.forEach(function(src){
    const values = src.getDataRange().getValues();
    if (values.length < 2) return; // header only or empty — nothing to read
    const map = colMapFromRow_(values[0]);
    const idCol = findMetaCol_(map, META_HEADER_ALIASES_.id);
    const nameCol = findMetaCol_(map, META_HEADER_ALIASES_.name);
    const phoneCol = findMetaCol_(map, META_HEADER_ALIASES_.phone);
    const companyCol = findMetaCol_(map, META_HEADER_ALIASES_.company);
    const cityCol = findMetaCol_(map, META_HEADER_ALIASES_.city);
    const pincodeCol = findMetaCol_(map, META_HEADER_ALIASES_.pincode);
    const productCol = findMetaCol_(map, META_HEADER_ALIASES_.product);
    const qtyCol = findMetaCol_(map, META_HEADER_ALIASES_.quantity);

    for (let i=1;i<values.length;i++){
      const row = values[i];
      const name = get(row, nameCol);
      const phone = stripMetaTag_(get(row, phoneCol));
      if (!name && !phone) continue;
      // Sheet name prefixed into the row-index fallback so "row-5" on Sheet1 and "row-5" on Sheet2
      // never collide and get treated as the same lead for dedup purposes.
      const metaLeadId = idCol!==undefined ? get(row, idCol) : (src.getName()+'-row-'+i);
      if (!metaLeadId) continue;
      const requirement = [get(row, productCol), qtyCol!==undefined && get(row,qtyCol) ? ('Qty: '+get(row,qtyCol)) : '']
        .filter(function(s){ return s; }).join(' — ');
      candidates.push({
        metaLeadId: metaLeadId, name: name, phone: phone, company: get(row, companyCol),
        city: get(row, cityCol), pincode: stripMetaTag_(get(row, pincodeCol)), requirement: requirement
      });
    }
  });
  if (!candidates.length) return {ok:true, msg:'No leads found in the sheet.', imported:0, skipped:0};

  const already = alreadyImportedMetaLeadIds_();
  const fresh = candidates.filter(function(c){ return !already[c.metaLeadId]; });
  if (!fresh.length) return {ok:true, msg:'Nothing new — all '+candidates.length+' lead(s) already imported.', imported:0, skipped:candidates.length};

  // District/State resolved once per unique pincode, only for leads actually about to be imported.
  const uniquePins = {};
  fresh.forEach(function(c){ if (c.pincode) uniquePins[c.pincode] = true; });
  const pinGeo = {};
  Object.keys(uniquePins).forEach(function(pin){ const g = lookupDistrictState_(pin); if (g) pinGeo[pin] = g; });

  // Batch-inserted as one read + one write for the whole set, instead of calling addEnquiry() once
  // per lead — addEnquiry() re-reads the entire Enquiries sheet on every call (to compute the next
  // EnqID), which is fine for a single New Enquiry submission but turns an N-lead import into N
  // full-sheet reads + N locks + N writes. That compounding cost was the actual "why is this
  // taking so long" — this mirrors submitBulkPendingFromRows()'s existing batch pattern instead.
  const imported = bulkInsertEnquiries_(fresh.map(function(c){
    const geo = c.pincode ? pinGeo[c.pincode] : null;
    return {
      customer: c.name, company: c.company, phone: c.phone, city: c.city, pincode: c.pincode,
      district: geo ? geo.district : '', state: geo ? geo.state : '',
      source: 'Other', requirement: c.requirement,
      notes: 'Auto-imported from Meta Ads leads sheet · '+META_LEAD_ID_TAG_+c.metaLeadId
    };
  }));

  return {ok:true, msg:'Imported '+imported+' new lead(s).', imported:imported, skipped:candidates.length-imported};
}

// Batch version of addEnquiry()'s "leaveUnclaimed" path — one sheet read, IDs computed in memory,
// one setValues() write for all rows, one lock. Every row lands as Stage=New with blank Priority/
// LeadBy/NextFollowUp, exactly like addEnquiry({leaveUnclaimed:true}) does for a single row.
function bulkInsertEnquiries_(leads){
  if (!leads.length) return 0;
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
    const startNum = Number(newIdFromRows_(CONFIG.ENQ_PREFIX, data, map['EnqID']).replace(CONFIG.ENQ_PREFIX,''));
    const today = todayStr_();
    const rows = leads.map(function(p, i){
      const row = [];
      for (const k in map) row[map[k]] = '';
      row[map['EnqID']] = CONFIG.ENQ_PREFIX+('000'+(startNum+i)).slice(-4);
      row[map['CreatedAt']] = new Date();
      row[map['EnqDate']] = today;
      row[map['Customer']] = String(p.customer||'').trim();
      row[map['Company']] = String(p.company||'').trim();
      row[map['Phone']] = String(p.phone||'').trim();
      row[map['Pincode']] = String(p.pincode||'').trim();
      row[map['District']] = String(p.district||'').trim();
      row[map['State']] = String(p.state||'').trim();
      row[map['City']] = String(p.city||'').trim();
      row[map['Source']] = p.source || 'Other';
      row[map['Requirement']] = String(p.requirement||'').trim();
      row[map['Stage']] = 'New';
      row[map['Notes']] = String(p.notes||'').trim();
      row[map['Active']] = 'YES';
      return row;
    });
    sh.getRange(sh.getLastRow()+1, 1, rows.length, rows[0].length).setValues(rows);
    invalidateEnqCache_();
    return rows.length;
  } finally { lock.releaseLock(); }
}

/** Client-callable — the "Import Meta Leads Now" button in Pending Approvals. */
function importMetaLeadsNow(token){
  requireAuth_(token);
  return importNewMetaLeads_();
}
function importMetaLeadsFromMenu(){
  requireOwnerOrSheetUi_();
  const r = importNewMetaLeads_();
  SpreadsheetApp.getUi().alert('Import Meta Ads Leads', r.msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Runs importNewMetaLeads_() every 30 min — the "just happens automatically" behavior, matching
    the Vercel app's Cron job, without needing an external scheduler. */
function setupMetaLeadsImportTrigger(){
  requireOwnerOrSheetUi_();
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction()==='importNewMetaLeads_') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('importNewMetaLeads_').timeBased().everyMinutes(30).create();
  SpreadsheetApp.getActive().toast('Meta Ads leads will now auto-import every 30 minutes.','Sales FMS',6);
}
function stopMetaLeadsImportTrigger(){
  requireOwnerOrSheetUi_();
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction()==='importNewMetaLeads_'){ ScriptApp.deleteTrigger(t); removed++; } });
  SpreadsheetApp.getActive().toast(removed ? 'Auto-import stopped.' : 'Auto-import was not running.','Sales FMS',5);
}
