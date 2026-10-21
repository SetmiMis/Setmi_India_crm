/*****************************************************************
 * OMS BRIDGE — "Record Order Details" in the CRM opens an order in the OMS
 * (https://setmi-oms.vercel.app). From there Accounts raises the PI, and this file lets the
 * rep download it, send it to the customer and record the payment without logging into OMS.
 *
 * Setup (Apps Script -> Project Settings -> Script properties):
 *   OMS_URL           https://setmi-oms.vercel.app
 *   OMS_INGEST_TOKEN  same value as INGEST_TOKEN on the OMS Vercel project
 *****************************************************************/
const OMS_ENQ_COL_ = 'OMSOrderID';

function omsFetch_(method, path, body){
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty('OMS_URL') || '').replace(/\/+$/,'');
  const tok = props.getProperty('OMS_INGEST_TOKEN');
  if (!base || !tok) throw new Error('OMS not configured — set OMS_URL and OMS_INGEST_TOKEN in Script properties.');
  const opt = { method: method, muteHttpExceptions: true, contentType: 'application/json', headers: { Authorization: 'Bearer ' + tok } };
  if (body) opt.payload = JSON.stringify(body);
  const res = UrlFetchApp.fetch(base + path, opt);
  let json; try { json = JSON.parse(res.getContentText()); } catch(e){ json = { ok:false, msg:'OMS returned an unexpected response (' + res.getResponseCode() + ').' }; }
  return json;
}

// OMS product catalogue for the order form (cached — the list rarely changes).
function getOmsProducts(token){
  requireAuth_(token);
  const cache = CacheService.getScriptCache();
  const hit = cache.get('oms_products');
  if (hit) return JSON.parse(hit);
  try{
    const r = omsFetch_('get', '/api/ingest/products');
    if (r.ok) cache.put('oms_products', JSON.stringify(r), 600);
    return r;
  }catch(err){ return { ok:false, msg:String(err) }; }
}

function omsEnq_(id){
  const sh = sh_('ENQ'); const data = sh.getDataRange().getValues(); const map = colMapFromRow_(data[0]);
  for (let i=1;i<data.length;i++){
    if (String(data[i][map['EnqID']]).trim() === String(id).trim()) return { sh:sh, data:data, map:map, i:i, row:data[i] };
  }
  return null;
}
const omsCell_ = function(f, col){ return f.map[col]===undefined ? '' : String(f.row[f.map[col]]||'').trim(); };

// p = { id, items:[{productId, qty, remarks}], note }
function recordOrderToOms(p, token){
  const me = requireAuth_(token);
  try{
    const f = omsEnq_(p.id);
    if (!f) return { ok:false, msg:'Enquiry not found' };
    requireOwnLeadOrAdmin_(me, omsCell_(f,'LeadBy'));
    if (omsCell_(f, OMS_ENQ_COL_)) return { ok:false, msg:'Order already recorded: ' + omsCell_(f, OMS_ENQ_COL_) };
    const items = (p.items||[]).filter(function(it){ return it.productId && Number(it.qty) > 0; });
    if (!items.length) return { ok:false, msg:'Kam se kam ek product aur quantity daalo.' };

    const phone = omsCell_(f,'Phone'), email = omsCell_(f,'Email');
    const r = omsFetch_('post', '/api/ingest/order', {
      enqId: p.id,
      customer: { company: omsCell_(f,'Company') || omsCell_(f,'Customer'), contact: omsCell_(f,'Customer'), phone: phone, whatsapp: phone, email: email, gst: omsCell_(f,'GST') },
      items: items, note: p.note || '', quoteNo: omsCell_(f,'QuoteNo')
    });
    if (!r.ok) return { ok:false, msg: r.msg || 'OMS ne order accept nahi kiya.' };

    // Save the OMS order id on the enquiry (column is added on first use, like ClaimedAt).
    const lock = LockService.getScriptLock(); lock.waitLock(15000);
    try{
      const g = omsEnq_(p.id);
      let col = g.map[OMS_ENQ_COL_];
      if (col === undefined){ col = g.data[0].length; g.sh.getRange(1, col+1).setValue(OMS_ENQ_COL_); }
      g.sh.getRange(g.i+1, col+1).setValue(r.orderId);
      invalidateEnqCache_();
    } finally { lock.releaseLock(); }

    // Order recorded == deal won.
    const st = (omsCell_(f,'Stage') === 'Won') ? {ok:true} : moveStage({ id:p.id, stage:'Won', skipInvoice:true, note:'Order OMS mein record hua: ' + r.orderId }, token);
    return { ok:true, msg:'Order recorded: ' + r.orderId + (st.ok ? '' : ' (stage update failed: ' + st.msg + ')'), orderId:r.orderId };
  }catch(err){ return { ok:false, msg:String(err) }; }
}

// Live status + PI link for the enquiry's OMS order.
function getOmsOrder(enqId, token){
  requireAuth_(token);
  try{
    const f = omsEnq_(enqId);
    const oid = f && omsCell_(f, OMS_ENQ_COL_);
    if (!oid) return { ok:true, linked:false };
    const r = omsFetch_('get', '/api/ingest/order/' + encodeURIComponent(oid));
    return r.ok ? Object.assign({ linked:true }, r) : { ok:false, linked:true, orderId:oid, msg:r.msg };
  }catch(err){ return { ok:false, msg:String(err) }; }
}

function omsOrderAction_(enqId, token, body){
  const me = requireAuth_(token);
  try{
    const f = omsEnq_(enqId);
    if (!f) return { ok:false, msg:'Enquiry not found' };
    requireOwnLeadOrAdmin_(me, omsCell_(f,'LeadBy'));
    const oid = omsCell_(f, OMS_ENQ_COL_);
    if (!oid) return { ok:false, msg:'Is enquiry ka order OMS mein record nahi hua.' };
    body.by = me.name;
    return omsFetch_('post', '/api/ingest/order/' + encodeURIComponent(oid), body);
  }catch(err){ return { ok:false, msg:String(err) }; }
}
function omsMarkPiSent(enqId, token){ return omsOrderAction_(enqId, token, { action:'piSent' }); }
// p = { amount, ref, note, proofUrl }
function omsRecordPayment(enqId, p, token){ return omsOrderAction_(enqId, token, { action:'payment', amount:p.amount, ref:p.ref, note:p.note, proofUrl:p.proofUrl }); }
