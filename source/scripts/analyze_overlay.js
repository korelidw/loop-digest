#!/usr/bin/env node
/**
 * Daily overlay summary from Nightscout devicestatus + hourly reliability stripe (last 7d):
 * For each local day (America/Chicago), tally:
 * - total cycles
 * - predicted <= suspend threshold cycles
 * - zero-basal enacted cycles
 * - automatic bolus enacted cycles
 * - pump communication failures
 * Also roll up per-hour-of-day (0–23) across the last 7 local days for:
 * - pctFailures
 * - pctPredLeSuspend
 */
const fs = require('fs');
const path = require('path');

function loadJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function pct(n,d){ return d? +(100*n/d).toFixed(1) : 0; }

const TZ = 'America/Chicago';
function dayKey(iso){
  if(!iso) return null;
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-US',{timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit'});
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function hourOfDay(iso){
  if(!iso) return null;
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-US',{timeZone:TZ, hour:'2-digit', hour12:false});
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p=>[p.type,p.value]));
  return +parts.hour;
}

const dataDir = path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
const devFile = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_devicestatus_')).map(f=>path.join(dataDir,f)).sort().pop();
const profFile = path.join(dataDir,'ns_profile_latest.json');
const dev = loadJson(devFile) || [];
const prof = loadJson(profFile) || [];
let suspend = null; if(Array.isArray(prof) && prof.length){ const latest=prof[0]; const ls = latest.loopSettings || latest; suspend = ls.minimumBGGuard ?? null; }

const byDay = {};
const byHour = new Array(24).fill(null).map(()=>({cycles:0, failures:0, predLeSuspend:0}));
let latestMs = 0;
for(const r of dev){
  const L = r.loop || {};
  if(!L || Object.keys(L).length===0) continue;
  const iso = r.created_at || L.timestamp;
  const key = dayKey(iso);
  const hr = hourOfDay(iso);
  const tms = Date.parse(iso);
  if(!key || hr==null || Number.isNaN(tms)) continue;
  if(tms>latestMs) latestMs = tms;
  const d = byDay[key] || (byDay[key]={cycles:0,predLeSuspend:0,zeroBasal:0,abEnacted:0,failures:0});
  d.cycles++;
  if(L.failureReason) d.failures++;
  // pred <= suspend?
  if(suspend!=null && L.predicted && Array.isArray(L.predicted.values)){
    const nums = L.predicted.values.filter(v=>typeof v==='number');
    const minPred = nums.length? Math.min(...nums): null;
    if(typeof minPred==='number' && minPred<=suspend) d.predLeSuspend++;
  }
  // enacted
  const enacted = L.enacted || {};
  if(typeof enacted.rate==='number' && enacted.rate===0) d.zeroBasal++;
  if(typeof enacted.bolusVolume==='number' && enacted.bolusVolume>0) d.abEnacted++;
  // hour bins (we fill after we know the last-7d range; for efficiency tally now and down-select later)
  const hb = byHour[hr];
  hb.cycles++;
  if(L.failureReason) hb.failures++;
  if(suspend!=null && L.predicted && Array.isArray(L.predicted.values)){
    const nums2 = L.predicted.values.filter(v=>typeof v==='number');
    const minPred2 = nums2.length? Math.min(...nums2): null;
    if(typeof minPred2==='number' && minPred2<=suspend) hb.predLeSuspend++;
  }
}

const days = Object.keys(byDay).sort();
// Determine last 7 local days seen
const last7 = days.slice(-7);
// Recompute byHour limited to last 7 days by re-iterating just those days' records
if(last7.length){
  // Reset byHour
  for(let i=0;i<24;i++){ byHour[i]={cycles:0,failures:0,predLeSuspend:0}; }
  const daySet = new Set(last7);
  for(const r of dev){
    const L = r.loop || {};
    if(!L || Object.keys(L).length===0) continue;
    const iso = r.created_at || L.timestamp;
    const key = dayKey(iso);
    if(!daySet.has(key)) continue;
    const hr = hourOfDay(iso);
    const hb = byHour[hr];
    hb.cycles++;
    if(L.failureReason) hb.failures++;
    if(suspend!=null && L.predicted && Array.isArray(L.predicted.values)){
      const nums = L.predicted.values.filter(v=>typeof v==='number');
      const minPred = nums.length? Math.min(...nums): null;
      if(typeof minPred==='number' && minPred<=suspend) hb.predLeSuspend++;
    }
  }
}

const out = { tz:TZ, suspendThreshold:suspend, days: days.map(k=>({
  day:k, 
  cycles:byDay[k].cycles,
  pctPredLeSuspend:pct(byDay[k].predLeSuspend, byDay[k].cycles),
  pctZeroBasal:pct(byDay[k].zeroBasal, byDay[k].cycles),
  pctABcycles:pct(byDay[k].abEnacted, byDay[k].cycles),
  pctFailures:pct(byDay[k].failures, byDay[k].cycles)
})), hourly: byHour.map((h,idx)=>({hour:idx, pctFailures:pct(h.failures,h.cycles), pctPredLeSuspend:pct(h.predLeSuspend,h.cycles), cycles:h.cycles})) };

const outPath = path.join(dataDir,'overlay_daily.json');
fs.writeFileSync(outPath, JSON.stringify(out,null,2));
console.log(outPath);
