#!/usr/bin/env node
/**
 * Analyze Loop constraints/gating from Nightscout devicestatus + profile.
 * - Counts predicted-below-suspend episodes and whether basal was zeroed
 * - Counts temp basals at/near maxBasal cap
 * - Summarizes automatic bolus (AB) cadence and volumes
 * - Tallies pump communication failures
 */
const fs = require('fs');
const path = require('path');

function loadJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function pct(n,d){ return d? +(100*n/d).toFixed(1) : 0; }
function median(a){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function quantile(a,q){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); const pos=(s.length-1)*q; const base=Math.floor(pos); const rest=pos-base; return s[base]+(s[base+1]-s[base])*(isNaN(rest)?0:rest); }

const dataDir = path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
const devFile = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_devicestatus_')).map(f=>path.join(dataDir,f)).sort().pop();
const profFile = path.join(dataDir,'ns_profile_latest.json');
const dev = loadJson(devFile) || [];
const prof = loadJson(profFile) || [];

// Profile-derived limits (from most recent profile entry)
let maxBasal=null, maxBolus=null, suspend=null, dosingStrategy=null;
if(Array.isArray(prof) && prof.length){
  const latest = prof[0];
  const ls = latest.loopSettings || (latest.store && latest.store.Default && latest.store.Default.loopSettings) || null;
  const root = latest.loopSettings || latest; // Loop uploads sometimes attach loopSettings at root
  maxBasal = (latest.loopSettings && latest.loopSettings.maximumBasalRatePerHour) || (root.maximumBasalRatePerHour) || null;
  maxBolus = (latest.loopSettings && latest.loopSettings.maximumBolus) || (root.maximumBolus) || null;
  suspend = (latest.loopSettings && latest.loopSettings.minimumBGGuard) || (root.minimumBGGuard) || null;
  dosingStrategy = (latest.loopSettings && latest.loopSettings.dosingStrategy) || (root.dosingStrategy) || null;
}

let total=0;
let withPred=0, predBelowSuspend=0;
let zeroBasal=0, zeroBasal_whenLowPred=0, zeroBasal_whenNotLowPred=0;
let atMaxBasal=0;
let abCycles=0, abEnacted=0; const abVolumes=[]; const recBolusVolumes=[]; const autoRecVolumes=[];
let failures=0;

for(const r of dev){
  const L = r.loop || {};
  if(!L || Object.keys(L).length===0) continue;
  total++;
  if(L.failureReason) failures++;

  // Predicted below suspend?
  let minPred = null;
  if(L.predicted && Array.isArray(L.predicted.values)){
    withPred++;
    minPred = Math.min(...L.predicted.values.filter(v=>typeof v==='number'));
    if(typeof suspend==='number' && typeof minPred==='number' && minPred<=suspend){ predBelowSuspend++; }
  }

  // Enacted temp basal / bolus
  const enacted = L.enacted || {};
  const rate = typeof enacted.rate==='number' ? enacted.rate : null;
  const bolusVol = typeof enacted.bolusVolume==='number' ? enacted.bolusVolume : null;

  if(rate===0){ zeroBasal++; if(typeof minPred==='number'){ if(typeof suspend==='number' && minPred<=suspend) zeroBasal_whenLowPred++; else zeroBasal_whenNotLowPred++; } }
  if(typeof maxBasal==='number' && typeof rate==='number' && rate>=maxBasal-1e-6) atMaxBasal++;

  // Automatic bolus presence
  if(L.automaticDoseRecommendation && typeof L.automaticDoseRecommendation.bolusVolume==='number'){
    abCycles++;
    autoRecVolumes.push(L.automaticDoseRecommendation.bolusVolume);
  }
  if(typeof bolusVol==='number' && bolusVol>0){ abEnacted++; abVolumes.push(bolusVol); }
  if(typeof L.recommendedBolus==='number') recBolusVolumes.push(L.recommendedBolus);
}

const out = {
  meta: { totalCycles: total, dosingStrategy, maxBasal, maxBolus, suspendThreshold: suspend },
  predictions: { withPred, predBelowSuspend, pctPredBelowSuspend: pct(predBelowSuspend, withPred) },
  basal: { zeroBasal, zeroBasal_whenLowPred, zeroBasal_whenNotLowPred, atMaxBasal, pctAtMaxBasal: pct(atMaxBasal,total) },
  automaticBolus: {
    abCycles, abEnacted, pctCyclesWithAB: pct(abEnacted,total),
    enactedVol: { n: abVolumes.length, median: median(abVolumes), p10: quantile(abVolumes,0.1), p90: quantile(abVolumes,0.9) },
    autoRecVol: { n: autoRecVolumes.length, median: median(autoRecVolumes), p90: quantile(autoRecVolumes,0.9) },
    recBolusVol: { n: recBolusVolumes.length, median: median(recBolusVolumes), p90: quantile(recBolusVolumes,0.9) }
  },
  reliability: { failures }
};

const outPath = path.join(dataDir,'constraints_summary.json');
fs.writeFileSync(outPath, JSON.stringify(out,null,2));
console.log(outPath);
