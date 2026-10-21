/*****************************************************************
 * MAP ANALYTICS — live enquiry analytics by geography (State/District/Zone) and Source.
 * Kept in its own file like Orders.js/CallLog.js — Apps Script merges all top-level .js/.gs files
 * into one global scope, so this freely uses getAllEnquiries_/normalizeState_/OPEN_STAGES/phoneKey_
 * from Code.js as long as they're only referenced inside functions here, not at file top level.
 *
 * "Zone" isn't a field anywhere in this schema (Enquiries, Customers, or Orders) — it's derived from
 * State via the static regional mapping below, reusing the same normalizeState_() lookup the
 * dashboard's India map already relies on, so no new data entry is required anywhere in the app.
 *
 * "Zone In" / "Zone Out" from the original brief were ambiguous — there's no data source that
 * distinguishes leads "entering" vs "leaving" a zone. This interprets them as the closest concrete,
 * useful reading given what the schema actually has: Zone In = converted (Won/Dispatched/Closed)
 * enquiries per zone, Zone Out = lost enquiries per zone.
 *
 * "Features" from the original brief has no data source anywhere in this schema and isn't built —
 * there's no product-feature or enquiry-feature field to analyze.
 *****************************************************************/
const STATE_ZONE_ = {
  'Delhi':'North', 'Haryana':'North', 'Punjab':'North', 'Himachal Pradesh':'North', 'Uttarakhand':'North',
  'Uttar Pradesh':'North', 'Jammu & Kashmir':'North', 'Ladakh':'North', 'Chandigarh':'North',
  'Andhra Pradesh':'South', 'Karnataka':'South', 'Kerala':'South', 'Tamil Nadu':'South', 'Telangana':'South', 'Puducherry':'South',
  'West Bengal':'East', 'Odisha':'East', 'Bihar':'East', 'Jharkhand':'East',
  'Maharashtra':'West', 'Gujarat':'West', 'Goa':'West', 'Rajasthan':'West', 'Dadra & Nagar Haveli and Daman & Diu':'West',
  'Madhya Pradesh':'Central', 'Chhattisgarh':'Central',
  'Assam':'Northeast', 'Arunachal Pradesh':'Northeast', 'Manipur':'Northeast', 'Meghalaya':'Northeast',
  'Mizoram':'Northeast', 'Nagaland':'Northeast', 'Sikkim':'Northeast', 'Tripura':'Northeast',
  'Andaman & Nicobar':'Islands', 'Lakshadweep':'Islands'
};
// State centroids for the Map View's Leaflet markers (mirrors web/lib/geo/pincode.ts's
// STATE_CENTROID table used by the Vercel app, so both apps place the same dot in the same spot).
const STATE_CENTROID_ = {
  'Andhra Pradesh':[15.9871,80.392], 'Arunachal Pradesh':[27.6834,94.6138], 'Assam':[26.3279,92.7513],
  'Bihar':[25.7184,85.5562], 'Chandigarh':[30.7368,76.7568], 'Chhattisgarh':[21.3662,82.127],
  'Dadra & Nagar Haveli and Daman & Diu':[20.3029,72.7942], 'Delhi':[28.6358,77.149], 'Goa':[15.4113,73.9552],
  'Gujarat':[22.4048,72.1894], 'Haryana':[29.2068,76.4529], 'Himachal Pradesh':[31.6482,76.8205],
  'Jammu & Kashmir':[33.4904,74.9831], 'Jharkhand':[23.7268,85.8173], 'Karnataka':[14.4753,76.1523],
  'Kerala':[10.343,76.3349], 'Ladakh':[34.2996,78.2932], 'Lakshadweep':[10.8117,72.8809],
  'Madhya Pradesh':[23.6715,78.3157], 'Maharashtra':[19.1768,75.6021], 'Manipur':[24.7194,93.7649],
  'Meghalaya':[25.5554,91.3859], 'Mizoram':[23.3901,92.8548], 'Nagaland':[26.0471,94.3736],
  'Odisha':[20.6368,84.9846], 'Puducherry':[11.6201,79.6811], 'Punjab':[31.0059,75.522],
  'Rajasthan':[26.3848,74.7567], 'Sikkim':[27.2704,88.4526], 'Tamil Nadu':[11.0529,78.554],
  'Telangana':[17.7594,78.8965], 'Tripura':[23.7879,91.6968], 'Uttar Pradesh':[26.945,80.7892],
  'Uttarakhand':[30.0353,79.153], 'West Bengal':[23.5086,87.9975], 'Andaman & Nicobar':[11.5537,92.7773]
};

// DISTRICT-LEVEL GEOCODING — for enquiries with a State (and District) but no Pincode: many older
// rows have State filled in but were never asked for a Pincode. Rather than dropping those to a
// single state-wide dot, resolve District+State to real coordinates via Nominatim (OpenStreetMap's
// free geocoding API) once per district, ever — cached permanently in PropertiesService (no TTL,
// unlike CacheService) so it's a one-time network cost, not a per-load one, and touches zero Sheets
// API quota (it's an external HTTP call, not a Sheets read/write).
const DISTRICT_GEO_PROP_ = 'districtGeoCache_v1';
const DISTRICT_GEO_MAX_LOOKUPS_PER_RUN_ = 8; // cap live Nominatim calls per Map Analytics load

function districtGeoCache_(){
  try{ return JSON.parse(PropertiesService.getScriptProperties().getProperty(DISTRICT_GEO_PROP_) || '{}'); }
  catch(e){ return {}; }
}
function saveDistrictGeoCache_(cache){
  try{ PropertiesService.getScriptProperties().setProperty(DISTRICT_GEO_PROP_, JSON.stringify(cache)); }catch(e){}
}
// Looks up (and geocodes + caches, budget permitting) District+State pairs. `keys` is a Set-like
// object {key: true} of "district||state" pairs actually needed this run; returns key -> [lat,lng]
// (only for keys it could resolve — caller falls back to the state centroid for the rest).
function resolveDistrictGeo_(neededKeys, budgetOverride){
  const cache = districtGeoCache_();
  const out = {};
  let budget = budgetOverride!==undefined ? budgetOverride : DISTRICT_GEO_MAX_LOOKUPS_PER_RUN_;
  let dirty = false;
  Object.keys(neededKeys).forEach(function(key){
    if (cache[key] !== undefined){
      if (cache[key]) out[key] = cache[key]; // cached [lat,lng]; cached `null` means "tried, no match"
      return;
    }
    if (budget <= 0) return; // uncached, no budget left this run — falls back to state centroid for now
    budget--;
    const parts = key.split('||'); // [district, state]
    let ll = null;
    try{
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=' +
        encodeURIComponent(parts[0] + ', ' + parts[1] + ', India');
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'SetmiIndiaSalesFMS/1.0' } });
      if (res.getResponseCode() === 200){
        const arr = JSON.parse(res.getContentText());
        if (arr && arr[0]) ll = [parseFloat(arr[0].lat), parseFloat(arr[0].lon)];
      }
    } catch(e){ /* network hiccup — leave uncached, retried on a future load */ }
    if (ll){ cache[key] = ll; out[key] = ll; dirty = true; }
    else if (budget >= 0){ cache[key] = null; dirty = true; } // remember a genuine no-match so we don't retry it forever
    Utilities.sleep(1000); // Nominatim's usage policy caps free lookups at ~1/second
  });
  if (dirty) saveDistrictGeoCache_(cache);
  return out;
}

// Run once (or whenever new District/State combos show up) from the Sales FMS menu — geocodes
// every distinct District+State pair in the sheet that doesn't have a Pincode, in one go, instead
// of relying on the small per-load budget in getMapAnalyticsFull to slowly warm the cache over many
// tab opens. Safe to re-run any time — already-cached pairs (hit or genuine miss) cost nothing.
function warmDistrictGeoFromMenu(){
  requireOwnerOrSheetUi_();
  const list = getAllEnquiries_();
  const needed = {};
  list.forEach(function(e){
    const resolved = normalizeState_(e.State);
    const stateName = resolved ? resolved.name : ((e.State||'').trim() || 'Unknown');
    const pin = String(e.Pincode||'').replace(/\D/g,'');
    const districtName = (e.District||'').trim() || 'Unknown';
    if (pin.length !== 6 && stateName !== 'Unknown' && (e.District||'').trim()){
      needed[districtName + '||' + stateName] = true;
    }
  });
  const cache = districtGeoCache_();
  const pending = Object.keys(needed).filter(function(k){ return cache[k] === undefined; }).length;
  const resolved = resolveDistrictGeo_(needed, 200); // 200 is comfortably within the 6-min execution limit at 1/sec
  SpreadsheetApp.getUi().alert('Map District Geocoding',
    pending + ' new District+State pair(s) found, ' + Object.keys(resolved).length + ' resolved this run.\n' +
    (pending > 200 ? 'More than 200 were pending — run this again to pick up the rest.' : 'All caught up.'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function zoneForState_(rawState){
  const resolved = normalizeState_(rawState);
  const name = resolved ? resolved.name : '';
  return (name && STATE_ZONE_[name]) || 'Unclassified';
}

// Merged getMapAnalytics + getMapDrilldown into one call: both used to independently call
// getAllEnquiries_() and re-scan the full enquiry list from the client, doubling both the scan
// work and the network payload on every Map Analytics tab open. With 2000+ rows this was the
// tab's actual slowness — not a data bug. One shared scan + one RPC round-trip fixes it without
// touching the underlying Sheets read (still just one getAllEnquiries_() cache hit).
function getMapAnalyticsFull(token){
  requireAuth_(token);
  const list = getAllEnquiries_();
  const today = todayStr_();
  const CONVERTED_STAGES_ = ['Won','Dispatched','Closed'];

  let todaysEnquiries = 0;
  const activeCust = {}, convertedCust = {}, lostCust = {};
  const stateMap = {}, districtMap = {}, zoneMap = {}, sourceMap = {};
  const stateIsoMap = {};        // canonical state name -> iso
  const districtByState = {};    // state name -> { district name -> {name,total,won,lost} }
  const areaMap = {};            // "state||district" -> { area name -> {name,total,won,lost} }
  const pointMap = {};           // pincode (or "s:"+state when no usable pincode) -> map point

  function bump(map, key, e){
    const k = key || 'Unknown';
    if (!map[k]) map[k] = {name:k, total:0, won:0, lost:0};
    map[k].total++;
    if (CONVERTED_STAGES_.indexOf(e.Stage) >= 0) map[k].won++;
    if (e.Stage === 'Lost') map[k].lost++;
  }

  const stateNameByRow = new Array(list.length); // cached so the geocode pass below doesn't redo it
  const districtGeoNeeded = {}; // "district||state" -> true, for rows with State+District but no Pincode

  list.forEach(function(e, i){
    if (e.EnqDate === today) todaysEnquiries++;
    const custKey = phoneKey_(e.Phone) || e.Customer;
    if (OPEN_STAGES.indexOf(e.Stage) >= 0) activeCust[custKey] = true;
    if (CONVERTED_STAGES_.indexOf(e.Stage) >= 0) convertedCust[custKey] = true;
    if (e.Stage === 'Lost') lostCust[custKey] = true;

    const resolved = normalizeState_(e.State);
    const stateName = resolved ? resolved.name : ((e.State||'').trim() || 'Unknown');
    stateNameByRow[i] = stateName;
    if (resolved) stateIsoMap[stateName] = resolved.iso;

    bump(stateMap, stateName, e);
    bump(districtMap, e.District, e);
    bump(zoneMap, zoneForState_(e.State), e);
    bump(sourceMap, e.Source || 'Other', e);

    if (!districtByState[stateName]) districtByState[stateName] = {};
    bump(districtByState[stateName], e.District, e);

    const districtName = (e.District||'').trim() || 'Unknown';
    const areaKey = stateName + '||' + districtName;
    if (!areaMap[areaKey]) areaMap[areaKey] = {};
    bump(areaMap[areaKey], e.City, e);

    const pin = String(e.Pincode||'').replace(/\D/g,'');
    if (pin.length !== 6 && stateName !== 'Unknown' && (e.District||'').trim()){
      districtGeoNeeded[districtName + '||' + stateName] = true;
    }
  });

  // District+State geocoded once (ever) per pair via Nominatim, cached in PropertiesService — see
  // resolveDistrictGeo_ above. Bridges the many older rows that have State+District but were saved
  // before Pincode was ever asked for, without lumping them all onto one state-wide dot.
  const districtGeo = resolveDistrictGeo_(districtGeoNeeded);

  list.forEach(function(e, i){
    const stateName = stateNameByRow[i];
    // Map points — real pincode centroid when known (finest, matches the Vercel app); else the
    // geocoded District+State centroid when available; else the plain State centroid, marked approx.
    const pin = String(e.Pincode||'').replace(/\D/g,'');
    const pinLL = pin.length === 6 ? PINCODE_LATLNG_[pin] : null;
    const districtName = (e.District||'').trim() || 'Unknown';
    const distLL = pinLL ? null : (districtGeo[districtName+'||'+stateName] || null);
    const stLL = (pinLL || distLL) ? null : (STATE_CENTROID_[stateName] || null);
    const ll = pinLL || distLL || stLL;
    if (ll){
      const approx = !pinLL;
      const pKey = pinLL ? pin : (distLL ? ('d:'+districtName+'||'+stateName) : ('s:'+stateName));
      if (!pointMap[pKey]) pointMap[pKey] = {lat:ll[0], lng:ll[1], pincode:approx?'':pin, state:stateName,
        district: distLL ? districtName : '', approx:approx, total:0, won:0, lost:0};
      const pt = pointMap[pKey];
      pt.total++;
      if (CONVERTED_STAGES_.indexOf(e.Stage) >= 0) pt.won++;
      if (e.Stage === 'Lost') pt.lost++;
    }
  });

  const toList = function(map){ return Object.keys(map).map(function(k){ return map[k]; }); };
  const byState = toList(stateMap).sort(function(a,b){ return b.total-a.total; });
  const byDistrict = toList(districtMap).sort(function(a,b){ return b.total-a.total; }).slice(0,20);
  const byZone = toList(zoneMap).sort(function(a,b){ return b.total-a.total; });
  const bySource = toList(sourceMap).sort(function(a,b){ return b.total-a.total; });

  // Ranked by total won count (not win rate) — avoids a 1-enquiry/1-won zone reading as "100% top
  // performing" ahead of a zone that's actually generating far more real sales.
  const zonesByWon = byZone.slice().sort(function(a,b){ return b.won-a.won; });
  const zonesWithVolume = zonesByWon.filter(function(z){ return z.total > 0; });
  const topZones = zonesWithVolume.slice(0,5);
  const lowestZones = zonesWithVolume.slice(-5).reverse();

  const districtsByState = {};
  Object.keys(districtByState).forEach(function(s){
    districtsByState[s] = Object.keys(districtByState[s]).map(function(d){ return districtByState[s][d]; })
      .sort(function(a,b){ return b.total-a.total; });
  });
  const areasByDistrict = {};
  Object.keys(areaMap).forEach(function(k){
    areasByDistrict[k] = Object.keys(areaMap[k]).map(function(a){ return areaMap[k][a]; })
      .sort(function(a,b){ return b.total-a.total; });
  });

  return {
    summary: {
      totalEnquiries: list.length,
      todaysEnquiries: todaysEnquiries,
      activeCustomers: Object.keys(activeCust).length,
      convertedCustomers: Object.keys(convertedCust).length,
      lostCustomers: Object.keys(lostCust).length
    },
    byState: byState, byDistrict: byDistrict, byZone: byZone, bySource: bySource,
    zoneIn: byZone.map(function(z){ return {name:z.name, count:z.won}; }).sort(function(a,b){ return b.count-a.count; }),
    zoneOut: byZone.map(function(z){ return {name:z.name, count:z.lost}; }).sort(function(a,b){ return b.count-a.count; }),
    topZones: topZones, lowestZones: lowestZones,
    drilldown: {
      states: byState.map(function(s){
        var c = STATE_CENTROID_[s.name] || null;
        return {name:s.name, iso:stateIsoMap[s.name]||'', total:s.total, won:s.won, lost:s.lost,
          lat: c ? c[0] : null, lng: c ? c[1] : null};
      }),
      districtsByState: districtsByState,
      areasByDistrict: areasByDistrict,
      // Capped — the Map View is a visual overview, not the source of truth (the drill-down table
      // has everything). Bounds worst-case marker count/payload if the sheet ever has many distinct
      // pincodes.
      points: Object.keys(pointMap).map(function(k){ return pointMap[k]; })
        .sort(function(a,b){ return b.total-a.total; }).slice(0,300)
    }
  };
}
