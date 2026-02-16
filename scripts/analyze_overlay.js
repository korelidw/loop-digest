#!/usr/bin/env node
/**
 * Daily overlay summary from Nightscout devicestatus:
 * For each local day (America/Chicago), tally:
 * - total cycles
 * - predicted <= suspend threshold cycles
 * - zero-basal enacted cycles
 * - automatic bolus enacted cycles
 * - pump communication failures
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

const dataDir = path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
const devFile = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_devicestatus_')).map(f=>path.join(dataDir,f)).sort().pop();
const profFile = path.join(dataDir,'ns_profile_latest.json');
const dev = loadJson(devFile) || [];
const prof = loadJson(profFile) || [];
let suspend = null; if(Array.isArray(prof) && prof.length){ const latest=prof[0]; const ls = latest.loopSettings || latest; suspend = ls.minimumBGGuard ?? null; }

const byDay = {};
for(const r of dev){
  const L = r.loop || {};
  if(!L || Object.keys(L).length===0) continue;
  const key = dayKey(r.created_at || L.timestamp);
  if(!key) continue;
  const d = byDay[key] || (byDay[key]={cycles:0,predLeSuspend:0,zeroBasal:0,abEnacted:0,failures:0});
  d.cycles++;
  if(L.failureReason) d.failures++;
  // pred <= suspend?
  if(suspend!=null && L.predicted && Array.isArray(L.predicted.values)){
    const minPred = Math.min(...L.predicted.values.filter(v=>typeof v==='number'));
    if(typeof minPred==='number' && minPred<=suspend) d.predLeSuspend++;
  }
  // enacted
  const enacted = L.enacted || {};
  if(typeof enacted.rate==='number' && enacted.rate===0) d.zeroBasal++;
  if(typeof enacted.bolusVolume==='number' && enacted.bolusVolume>0) d.abEnacted++;
}

const days = Object.keys(byDay).sort();
const out = { tz:TZ, suspendThreshold:suspend, days: days.map(k=>({
  day:k, 
  cycles:byDay[k].cycles,
  pctPredLeSuspend:pct(byDay[k].predLeSuspend, byDay[k].cycles),
  pctZeroBasal:pct(byDay[k].zeroBasal, byDay[k].cycles),
  pctABcycles:pct(byDay[k].abEnacted, byDay[k].cycles),
  pctFailures:pct(byDay[k].failures, byDay[k].cycles)
}))};

const outPath = path.join(dataDir,'overlay_daily.json');
fs.writeFileSync(outPath, JSON.stringify(out,null,2));
console.log(outPath);
