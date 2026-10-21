/* ----------------------------------------------------------- PUBLIC METRICS
 * Read-only, customer-safe, counts-only feed for the public website dashboard.
 * GET <web app url>?page=metrics&key=<PUBLIC_METRICS_KEY>
 * Key lives in Script properties (PUBLIC_METRICS_KEY); set it once with setPublicMetricsKey('<key>').
 * Never returns names, phones, emails, values, rep names, win/loss, overdue or backlog — only totals.
 */
function publicMetricsKeyOk_(key){
  const secret = PropertiesService.getScriptProperties().getProperty('PUBLIC_METRICS_KEY');
  return !!secret && String(key || '') === secret;
}

// Run once (Apps Script editor, or `clasp run setPublicMetricsKey -p '["<key>"]'`).
function setPublicMetricsKey(key){
  requireOwnerOrSheetUi_();
  if (!key || String(key).length < 16) throw new Error('Use a key of at least 16 characters.');
  PropertiesService.getScriptProperties().setProperty('PUBLIC_METRICS_KEY', String(key));
  return 'ok';
}

const DEMAND_BUCKETS_ = [
  ['Metal push switches',   /switch/i],
  ['Circular & GX connectors', /circular|\bgx\b|aviation|m12|waterproof/i],
  ['BNC / SMA / UHF (RF)',  /\bbnc\b|\bsma\b|\buhf\b|\brf\b|coax/i],
  ['HDMI & AV cables',      /hdmi|cable|vga|dvi|\bav\b|audio.?video|converter/i],
  ['Audio & PA',            /speaker|horn|tweeter|xlr|speakon|amplifier|audio/i],
  ['Solar (MC4)',           /solar|mc4/i],
  ['Power connectors',      /power|sb50|\bdc\b|plug|socket/i]
];

function publicMetricsJson_(key){
  const json = function(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  if (!publicMetricsKeyOk_(key)) return json({ error: 'invalid key' });

  const mKey = monthKey_(new Date());
  const enq = getAllEnquiries_();
  const charts = computeDashboardCharts_(enq);

  const demand = {};
  enq.forEach(function(e){
    const text = String(e.Requirement || '');
    for (let i = 0; i < DEMAND_BUCKETS_.length; i++){
      if (DEMAND_BUCKETS_[i][1].test(text)){ demand[DEMAND_BUCKETS_[i][0]] = (demand[DEMAND_BUCKETS_[i][0]] || 0) + 1; break; }
    }
  });

  const custSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CUST);
  const customers = custSheet ? Math.max(0, custSheet.getLastRow() - 1) : 0;

  return json({
    asOf: fmtNice_(new Date()),
    customers: customers,
    enquiriesTotal: enq.length,
    enquiriesThisMonth: enq.filter(function(e){ return monthKey_(e.EnqDate || e.CreatedAt) === mKey; }).length,
    callsThisMonth: getAllCallLogRows_().filter(function(c){ return monthKey_(c.CallDate) === mKey; }).length,
    followUpsThisMonth: getAllFollowUpRows_().filter(function(f){ return monthKey_(f.CreatedAt) === mKey; }).length,
    months: charts.months,                               // last 6 months {categories, data}
    demand: Object.keys(demand).map(function(k){ return { name: k, count: demand[k] }; })
              .sort(function(a, b){ return b.count - a.count; }).slice(0, 6),
    states: charts.states.map(function(s){ return { state: s.state, iso: s.iso, count: s.count, lat: s.lat, lng: s.lng }; })
  });
}
