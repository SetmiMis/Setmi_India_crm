/* DATA ANALYSIS — one compact, PII-free row per enquiry (no name/phone); the tab filters and
   aggregates client-side, so changing a filter costs no server call. Admins get every enquiry; a rep
   only gets their own (same rule as getPipeline).
   Row: [month, date, product, qty, state, stage, source, leadBy, pincode, district, called, connected,
         interested, estValue, respDays, idleDays, repeatCount]
   respDays = days from enquiry date to first logged call ('' = never called); idleDays = days since the
   last touch (LastContact / last call, else enquiry date); repeatCount = enquiries sharing this phone.
   Dates are day-resolution in the sheet, so "speed" is in days, not hours. */
function getAnalysis(token){
  return analysisBuild_(requireAuth_(token));
}

/* PUBLIC share link (no login): ?page=analysis&key=<ANALYSIS_SHARE_KEY_>. Marketing view only — the lead-owner
   name and the follow-up speed / idle / repeat columns are blanked, and there are no names or phones in the rows.
   To revoke or rotate the link, change the key below and redeploy. */
const ANALYSIS_SHARE_KEY_ = '__REDACTED_ANALYSIS_SHARE_KEY__'; // REDACTED in git — see src/REDACTIONS.md
function analysisKeyOk_(k){ return !!k && String(k) === ANALYSIS_SHARE_KEY_; }
function getAnalysisShared(key){
  if (!analysisKeyOk_(key)) throw new Error('Invalid link.');
  return analysisBuild_({role:'admin'}).map(function(r){ r[7] = '—'; r[14] = ''; r[15] = ''; r[16] = 1; return r; });
}

function analysisBuild_(me){
  const days = function(a, b){ return Math.round((new Date(a) - new Date(b)) / 864e5); };
  const today = todayStr_();
  const calls = {};
  getAllCallLogRows_().forEach(function(c){
    const a = calls[c.EnqID] || (calls[c.EnqID] = {n:0, conn:0, inte:0, first:'', last:''});
    a.n++;
    if (c.CallStatus === 'Connected') a.conn = 1;
    if (c.Interest === 'Interested') a.inte = 1;
    if (c.CallDate && (!a.first || c.CallDate < a.first)) a.first = c.CallDate;
    if (c.CallDate && c.CallDate > a.last) a.last = c.CallDate;
  });
  let list = getAllEnquiries_();
  const phones = {};
  list.forEach(function(e){ const p = phoneKey_(e.Phone); if (p.length === 10) phones[p] = (phones[p] || 0) + 1; });
  if (me.role !== 'admin') list = list.filter(function(e){ return String(e.LeadBy || '').trim() === me.name; });
  return list.map(function(e){
    const q = String(e.Requirement || '').split(' — ');
    const c = calls[String(e.EnqID).trim()] || {n:0, conn:0, inte:0, first:'', last:''};
    const d = e.EnqDate || e.CreatedAt || '';
    const touch = [e.LastContact, c.last, d].filter(Boolean).sort().pop() || '';
    const p = phoneKey_(e.Phone);
    return [d.slice(0,7), d, analysisProduct_(q[0]), (q[1] || '').replace('Qty: ',''),
      (normalizeState_(e.State) || {}).name || '', e.Stage || '', e.Source || 'Other', e.LeadBy || '—',
      String(e.Pincode || '').replace(/\D/g,'').slice(0,6), e.District || '', c.n ? 1 : 0, c.conn, c.inte, Number(e.EstValue) || 0,
      c.first && d ? Math.max(0, days(c.first, d)) : '', touch ? Math.max(0, days(today, touch)) : '', phones[p] || 1];
  });
}

/* CUSTOMERS LIST — Won / Dispatched / Closed enquiries with name + phone, one row per phone number.
   Login required (admin sees all, a rep only their own); deliberately NOT part of the public share link. */
function getCustomersList(token){
  const me = requireAuth_(token);
  const seen = {}, out = [];
  getAllEnquiries_().forEach(function(e){
    if (['Won','Dispatched','Closed'].indexOf(e.Stage) < 0) return;
    if (me.role !== 'admin' && String(e.LeadBy || '').trim() !== me.name) return;
    const p = phoneKey_(e.Phone);
    if (p.length !== 10 || seen[p]) return;
    seen[p] = 1;
    out.push([e.Customer || '', e.Company || '', p, '+91' + p, analysisProduct_(String(e.Requirement || '').split(' — ')[0]),
      (normalizeState_(e.State) || {}).name || '', e.City || e.District || '', e.EnqDate || '', e.Stage]);
  });
  return out;
}

/* Standard product list: raw Requirement text (Meta snake_case names or free text typed by reps) -> one label.
   Order matters: more specific patterns first. Unmatched text falls to "Other". */
function analysisProduct_(raw){
  const s = String(raw || '').toLowerCase().replace(/[_-]+/g, ' ');
  if (/multiple/.test(s)) return 'Multiple Products';
  if (/catalog/.test(s)) return 'Catalogue Share';
  if (/waterproof|ip6[5-8]|\bsp ?\d|sp series/.test(s)) return 'Waterproof Circular Connectors';
  if (/hdmi/.test(s)) return 'HDMI Connectors';
  if (/\bsma\b/.test(s)) return 'SMA Series';
  if (/uhf|vhf|pl ?259|so ?239/.test(s)) return 'UHF/VHF Connectors';
  if (/panel/.test(s)) return 'Panel Mount Connectors';
  if (/audio|video|converter|\bav\b/.test(s)) return 'Audio/Video Converters';
  if (/push|switch/.test(s)) return 'Metal Push Button Switches';
  if (/circular|aviation|gx ?\d|\bm ?\d{1,2}\b|connector/.test(s)) return 'Circular Connectors';
  return s.trim() ? 'Other' : 'Unknown';
}
