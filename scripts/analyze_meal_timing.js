#!/usr/bin/env node
/**
 * Meal timing analysis (read-only):
 * - Identify meals (carbs >=10g) and find nearest bolus around meal time
 * - Compute pre-bolus lead time (minutes): positive = minutes before meal; negative = after
 * - Group by:
 *   - lead time bins
 *   - context windows: breakfast (5–11), lunch (11–15), dinner (17–21)
 *   - school windows (weekdays): breakfast 7:00–8:00, lunch 11:20–12:10
 * - For each group compute:
 *   - n, % peak >180 within 4h, median peak, median time to <=180 (min)
 *   - Start BG (median, IQR) at meal time (nearest CGM within ±5 min, fallback ±10)
 *   - ΔPeak (median) = peak − start BG
 */
const fs = require('fs');
const path = require('path');

function loadJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function median(a){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function quantile(a,q){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); const pos=(s.length-1)*q; const lo=Math.floor(pos), hi=Math.ceil(pos); if(lo===hi) return s[lo]; const w=pos-lo; return s[lo]*(1-w)+s[hi]*w; }
function pct(n,d){ return d? +(100*n/d).toFixed(1): 0; }

const TZ = 'America/Chicago';
function localParts(ms){ const d=new Date(ms); const f=new Intl.DateTimeFormat('en-US',{timeZone:TZ,weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}); const parts=Object.fromEntries(f.formatToParts(d).map(p=>[p.type,p.value])); const h=+parts.hour, mi=+parts.minute; return {dow:parts.weekday, h, mi}; }

const dataDir = path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
const entriesPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_entries_')).map(f=>path.join(dataDir,f)).sort().pop();
const treatsPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_treatments_')).map(f=>path.join(dataDir,f)).sort().pop();

const entries = loadJson(entriesPath) || [];
const treats = loadJson(treatsPath) || [];
const sgv = entries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date|| (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.mg==='number' && typeof x.ms==='number').sort((a,b)=>a.ms-b.ms);

function isCarb(t){ return typeof t.carbs==='number' && t.carbs>0; }
function isBolus(t){ return typeof t.insulin==='number' && t.insulin>0; }

const meals = treats.filter(t=> isCarb(t) && t.carbs>=10).map(t=>({
  ms: t.mills || (t.created_at? Date.parse(t.created_at): (t.createdAt? Date.parse(t.createdAt): undefined)),
  carbs: t.carbs
})).filter(m=>m.ms).sort((a,b)=>a.ms-b.ms);

const boluses = treats.filter(isBolus).map(t=>({
  ms: t.mills || (t.created_at? Date.parse(t.created_at): (t.createdAt? Date.parse(t.createdAt): undefined)),
  units: t.insulin
})).filter(b=>b.ms).sort((a,b)=>a.ms-b.ms);

function nearestBolusLeadMin(mealMs){
  // Look for bolus within [-60, +30] min window; prefer the last bolus before meal; else first after
  const winStart = mealMs - 60*60000, winEnd = mealMs + 30*60000;
  let candBefore=null, candAfter=null;
  // Binary search could be faster; linear is fine at current sizes
  for(const b of boluses){ if(b.ms<winStart) continue; if(b.ms>winEnd) break; if(b.ms<=mealMs) candBefore=b; else { if(!candAfter) candAfter=b; } }
  if(candBefore){ return (mealMs - candBefore.ms)/60000; }
  if(candAfter){ return - (candAfter.ms - mealMs)/60000; }
  return null; // none in window
}

function slotFor(ms){ const {h}=localParts(ms); if(h>=5 && h<11) return 'breakfast'; if(h>=11 && h<15) return 'lunch'; if(h>=17 && h<21) return 'dinner'; return 'other'; }
function isWeekdaySchoolBreakfast(ms){ const {dow,h,mi}=localParts(ms); const wk = (dow!=='Sat' && dow!=='Sun'); const t=h*60+mi; return wk && t>=420 && t<480; /* 7:00–8:00 */ }
function isWeekdaySchoolLunch(ms){ const {dow,h,mi}=localParts(ms); const wk = (dow!=='Sat' && dow!=='Sun'); const t=h*60+mi; return wk && t>=680 && t<=730; /* 11:20–12:10 approx */ }

function nearestSgvAt(ms){
  // prefer nearest within ±5 min; then ±10; else null
  let best=null, bestDt=Infinity;
  for(const p of sgv){ const dt=Math.abs(p.ms - ms); if(dt<=5*60000 && dt<bestDt){ best=p; bestDt=dt; } if(p.ms>ms+10*60000) break; }
  if(!best){
    bestDt=Infinity;
    for(const p of sgv){ const dt=Math.abs(p.ms - ms); if(dt<=10*60000 && dt<bestDt){ best=p; bestDt=dt; } if(p.ms>ms+20*60000) break; }
  }
  return best? best.mg : null;
}

function startTrendTag(ms){
  // look at -15..0 min window; classify by delta threshold
  const wStart = ms - 15*60000, wEnd = ms;
  const pts = sgv.filter(p=> p.ms>=wStart && p.ms<=wEnd);
  if(pts.length<2) return null;
  const delta = pts[pts.length-1].mg - pts[0].mg;
  if(delta >= 10) return 'rising';
  if(delta <= -10) return 'falling';
  return 'flat';
}

function mealWindowMetrics(meal){
  const start = nearestSgvAt(meal.ms);
  const trend = startTrendTag(meal.ms);
  const win = sgv.filter(p=> p.ms>=meal.ms && p.ms<=meal.ms + 4*3600*1000);
  if(!win.length) return {hitHigh:false, peak:null, t180:null, start, trend};
  const peak = Math.max(...win.map(p=>p.mg));
  const tIdx = win.findIndex(p=>p.mg<=180);
  const delta = (start!=null && peak!=null)? (peak - start) : null;
  return {hitHigh: peak>180, peak, t180: tIdx>=0? (win[tIdx].ms - meal.ms)/60000 : null, start, delta, trend};
}

function binLead(min){
  if(min==null) return 'none(-60..+30)';
  if(min>=20) return 'pre>=20';
  if(min>=10) return 'pre10-19';
  if(min>=5) return 'pre5-9';
  if(min>=0) return 'pre0-4';
  if(min>-10) return 'post0-9';
  if(min>-20) return 'post10-19';
  return 'post>=20';
}

const groups = {
  overall:{}, breakfast:{}, lunch:{}, dinner:{}, schoolBreakfast:{}, schoolLunch:{}
};

for(const m of meals){
  const lead = nearestBolusLeadMin(m.ms);
  const b = binLead(lead);
  const metrics = mealWindowMetrics(m);
  const add = (bucket)=>{
    const g = bucket[b] || (bucket[b]={n:0, highs:0, peaks:[], t180s:[], starts:[], deltas:[], trends:{rising:0,flat:0,falling:0}});
    g.n++; if(metrics.hitHigh) g.highs++; if(metrics.peak!=null) g.peaks.push(metrics.peak); if(metrics.t180!=null) g.t180s.push(metrics.t180); if(metrics.start!=null) g.starts.push(metrics.start); if(metrics.delta!=null) g.deltas.push(metrics.delta); if(metrics.trend){ g.trends[metrics.trend] = (g.trends[metrics.trend]||0)+1; }
  };
  add(groups.overall);
  const slot = slotFor(m.ms);
  if(slot==='breakfast') add(groups.breakfast);
  if(slot==='lunch') add(groups.lunch);
  if(slot==='dinner') add(groups.dinner);
  if(isWeekdaySchoolBreakfast(m.ms)) add(groups.schoolBreakfast);
  if(isWeekdaySchoolLunch(m.ms)) add(groups.schoolLunch);
}

function summarize(bucket){
  const out={};
  for(const [k,v] of Object.entries(bucket)){
    const medStart = median(v.starts||[]);
    const q25 = quantile(v.starts||[], 0.25);
    const q75 = quantile(v.starts||[], 0.75);
    const iqr = (q25!=null && q75!=null)? +(q75 - q25).toFixed(0) : null;
    const medDelta = median(v.deltas||[]);
    const t180 = median(v.t180s);
    // start trend mode
    let trendLabel = null, trendPct = null;
    if(v.trends){ const {rising=0,flat=0,falling=0}=v.trends; const total=rising+flat+falling; if(total>0){ const arr=[['rising',rising],['flat',flat],['falling',falling]]; arr.sort((a,b)=>b[1]-a[1]); trendLabel=arr[0][0]; trendPct = +(100*arr[0][1]/total).toFixed(0); } }
    out[k] = { n: v.n, pctHigh: pct(v.highs, v.n), medianPeak: median(v.peaks), medianTimeTo180Min: t180, startBgMed: medStart, startBgIQR: iqr, deltaPeakMed: medDelta, startTrend: trendLabel, startTrendPct: trendPct };
  }
  return out;
}

const out = {
  leadBins: ['pre>=20','pre10-19','pre5-9','pre0-4','post0-9','post10-19','post>=20','none(-60..+30)'],
  overall: summarize(groups.overall),
  breakfast: summarize(groups.breakfast),
  lunch: summarize(groups.lunch),
  dinner: summarize(groups.dinner),
  schoolBreakfast: summarize(groups.schoolBreakfast),
  schoolLunch: summarize(groups.schoolLunch)
};

const outPath = path.join(dataDir,'meal_timing_analysis.json');
fs.writeFileSync(outPath, JSON.stringify(out,null,2));
console.log(outPath);
