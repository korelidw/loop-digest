#!/usr/bin/env node
/**
 * Correction effectiveness by context (read-only) + Experiment peek aggregates:
 * - Identify insulin-only corrections (bolus >0, no carbs within ±15 min)
 * - Compute 2h/3h drop from pre value
 * - Attach approximate IOB at correction (from devicestatus nearest ±5 min)
 * - Group by IOB bins and time-of-day windows
 * - Compute ISF Bias: Observed mg/dL per U vs Expected (profile ISF)
 * - Experiment peek: For Corrections — Midday (11–13), IOB<0.5, compute RECENT vs BASELINE deltas:
 *   Δ%ineff2h (down good), Δmedian 2–3h drop (up good), ΔTAR 90–180 (down good), n (recent), safety chips (Pred≤suspend 0–180, TBR 0–180)
 */
const fs = require('fs');
const path = require('path');

function loadJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function median(a){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function quantile(a,q){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); const pos=(s.length-1)*q; const base=Math.floor(pos); const rest=pos-base; if(s[base+1]!==undefined){ return s[base]+rest*(s[base+1]-s[base]); } else { return s[base]; } }
function pct(n,d){ return d? +(100*n/d).toFixed(1): 0; }
function winsorize(arr, pLow=0.02, pHigh=0.98){ if(!arr.length) return []; const lo=quantile(arr,pLow); const hi=quantile(arr,pHigh); return arr.map(v=> Math.max(lo, Math.min(hi, v))); }
function bootstrapMedians(arr, iters=1000){ const n=arr.length; if(n===0) return []; const meds=new Array(iters); for(let i=0;i<iters;i++){ const sample=new Array(n); for(let j=0;j<n;j++){ sample[j]=arr[Math.floor(Math.random()*n)]; } meds[i]=median(sample); } return meds; }

const TZ = 'America/Chicago';
function hourLocal(ms){ const d=new Date(ms); const f=new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',hour12:false}); return +Object.fromEntries(f.formatToParts(d).map(p=>[p.type,p.value])).hour; }
function secondsLocal(ms){ const d=new Date(ms); const f=new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}); const parts=Object.fromEntries(f.formatToParts(d).map(p=>[p.type,p.value])); return (+parts.hour)*3600 + (+parts.minute)*60 + (+parts.second); }

const dataDir = path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
const entriesPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_entries_')).map(f=>path.join(dataDir,f)).sort().pop();
const treatsPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_treatments_')).map(f=>path.join(dataDir,f)).sort().pop();
const devPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_devicestatus_')).map(f=>path.join(dataDir,f)).sort().pop();
const profilePath = path.join(dataDir,'ns_profile_latest.json');
const constraintsPath = path.join(dataDir,'constraints_summary.json');
const experimentsPath = path.join(dataDir,'experiments.json');

const entries = loadJson(entriesPath) || [];
const treats = loadJson(treatsPath) || [];
const dev = loadJson(devPath) || [];
const profiles = loadJson(profilePath) || [];
const constraints = loadJson(constraintsPath) || {};
const experiments = loadJson(experimentsPath) || {active:[]};

const sgv = entries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date|| (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.mg==='number' && typeof x.ms==='number').sort((a,b)=>a.ms-b.ms);

function isInsulinOnly(t){ const insOk = typeof t.insulin==='number' && t.insulin>0; const carbs = typeof t.carbs==='number' && t.carbs>0; return insOk && !carbs; }
function isCarb(t){ return typeof t.carbs==='number' && t.carbs>0; }

const boluses = treats.filter(isInsulinOnly).map(t=>({
  ms: t.mills || (t.created_at? Date.parse(t.created_at): (t.createdAt? Date.parse(t.createdAt): undefined)),
  units: t.insulin
})).filter(b=>b.ms).sort((a,b)=>a.ms-b.ms);

const carbTimes = treats.filter(isCarb).map(t=> t.mills || (t.created_at? Date.parse(t.created_at): (t.createdAt? Date.parse(t.createdAt): undefined)) ).filter(Boolean).sort((a,b)=>a-b);

function nearbyCarb(ms, windowMin){ const w=windowMin*60000; for(const c of carbTimes){ if(c<ms-w) continue; if(c>ms+w) break; return true; } return false; }

// Build quick index for devicestatus iob/predictions
const devIOB = dev.filter(r=>r && r.loop && r.loop.iob && typeof r.loop.iob.iob==='number').map(r=>({ms: Date.parse(r.created_at || r.loop.timestamp), iob: r.loop.iob.iob})).filter(x=>!isNaN(x.ms)).sort((a,b)=>a.ms-b.ms);
const devPred = dev.filter(r=> r && r.loop && r.loop.predicted && Array.isArray(r.loop.predicted.values)).map(r=>({ms: Date.parse(r.created_at || r.loop.timestamp), values: r.loop.predicted.values})).filter(x=>!isNaN(x.ms)).sort((a,b)=>a.ms-b.ms);

function nearestIOB(ms){ // linear scan acceptable at current size
  const w=5*60000; let best=null, bestd=Infinity; for(const x of devIOB){ const d=Math.abs(x.ms-ms); if(d<bestd){ best=x; bestd=d; } if(x.ms>ms+w) break; }
  return (best && bestd<=w)? best.iob : null;
}
function anyPredLeSuspendBetween(msStart, msEnd, suspend){
  if(suspend==null) return null;
  for(const p of devPred){ if(p.ms<msStart) continue; if(p.ms>msEnd) break; const minPred = Math.min(...p.values.filter(v=>typeof v==='number')); if(typeof minPred==='number' && minPred<=suspend) return true; }
  return false;
}

function preGlucose(ms){ // find sgv value within [-10,+5] min
  const start = ms-10*60000, end = ms+5*60000; const cand = sgv.filter(p=>p.ms>=start && p.ms<=end); if(!cand.length) return null; // nearest by time
  cand.sort((a,b)=> Math.abs(a.ms-ms)-Math.abs(b.ms-ms)); return cand[0].mg;
}

function dropAfter(ms, hours){ const end = ms+hours*3600*1000; const pre = preGlucose(ms); if(pre==null) return null; const win = sgv.filter(p=>p.ms>ms && p.ms<=end); if(!win.length) return null; const last = win[win.length-1].mg; return pre - last; }
function fracAbove(msStart, msEnd, thresh){ const win = sgv.filter(p=>p.ms>=msStart && p.ms<=msEnd); if(!win.length) return null; const n=win.length; const k=win.filter(p=>p.mg>thresh).length; return +(100*k/n).toFixed(1); }
function fracBelow(msStart, msEnd, thresh){ const win = sgv.filter(p=>p.ms>=msStart && p.ms<=msEnd); if(!win.length) return null; const n=win.length; const k=win.filter(p=>p.mg<thresh).length; return +(100*k/n).toFixed(1); }

function todBin(h){ if(h>=0 && h<4) return 'overnight(0-4)'; if(h>=6 && h<9) return 'morning(6-9)'; if(h>=11 && h<13) return 'midday(11-13)'; if(h>=17 && h<21) return 'evening(17-21)'; return 'other'; }
function iobBin(x){ if(x==null) return 'iob:unknown'; if(x<0.5) return 'iob<0.5'; if(x<1.5) return 'iob 0.5-1.5'; return 'iob>1.5'; }

// Build ISF lookup from latest active profile
function latestProfile(){ if(Array.isArray(profiles) && profiles.length) return profiles[0]; return null; }
function sensSchedule(){ const p=latestProfile(); const store=p&&p.store&&p.store[p.defaultProfile||'Default']; const sens=store&&store.sens; if(!Array.isArray(sens)) return []; return sens.slice().sort((a,b)=> (a.timeAsSeconds||0)-(b.timeAsSeconds||0)); }
function isfAtSeconds(sec){ const sched=sensSchedule(); if(!sched.length) return null; let last=sched[0]; for(const s of sched){ if((s.timeAsSeconds||0)<=sec) last=s; else break; } return typeof last.value==='number'? last.value: null; }

const predBelow = constraints && constraints.predictions && constraints.predictions.pctPredBelowSuspend;
const abCadence = constraints && constraints.automaticBolus && constraints.automaticBolus.pctCyclesWithAB;
const constraintConfounded = (predBelow!=null && predBelow>=25) || (abCadence!=null && abCadence>30);

const suspendThreshold = (()=>{ const p=latestProfile(); const ls=p&&p.loopSettings||p; return ls&&ls.minimumBGGuard!=null? ls.minimumBGGuard: null; })();

const groups = {};
const perEvent = []; // capture events for experiment peek
for(const b of boluses){
  if(nearbyCarb(b.ms,15)) continue; // exclude meals within ±15m
  const d2 = dropAfter(b.ms,2); const d3 = dropAfter(b.ms,3);
  if(d2==null && d3==null) continue;
  const hb = todBin(hourLocal(b.ms));
  const ibVal = nearestIOB(b.ms);
  const ib = iobBin(ibVal);
  const key = hb+' | '+ib;
  const g = groups[key] || (groups[key]={n:0, lt30_2h:0, drops2:[], drops3:[], units:[], obsPerU:[], expPerU:[], biasPerU:[]});
  g.n++; if(d2!=null && d2<30) g.lt30_2h++; if(d2!=null) g.drops2.push(d2); if(d3!=null) g.drops3.push(d3);
  g.units.push(b.units||0);
  if(d2!=null && b.units && b.units>=0.30){ // apply <0.30U filter before per-event bias
    const obsPU = d2 / b.units; // Observed mg/dL per U (drop is positive when falling)
    g.obsPerU.push(obsPU);
    const sec = secondsLocal(b.ms)%86400; const exp = isfAtSeconds(sec); // Expected mg/dL per U from profile
    if(typeof exp==='number'){
      g.expPerU.push(exp);
      g.biasPerU.push(obsPU - exp); // Bias = Observed − Expected (mg/dL/U)
    }
  }
  // capture event for experiment peek
  const pre = preGlucose(b.ms);
  const ms90=b.ms+90*60000, ms180=b.ms+180*60000;
  const tar90180 = fracAbove(ms90, ms180, 180);
  const tbr90180 = fracBelow(b.ms, ms180, 70);
  const predLow = anyPredLeSuspendBetween(b.ms, ms180, suspendThreshold);
  perEvent.push({ms:b.ms, hb, ibVal, ib, d2, d3, tar90180, tbr90180, predLeSuspend: predLow});
}

const outGroups = Object.entries(groups).map(([k,g])=>{
  // Winsorize per-event bias at p2/p98, then bootstrap 1k medians for CI
  const biasArr = Array.isArray(g.biasPerU)? g.biasPerU.filter(v=> typeof v==='number' && !Number.isNaN(v)) : [];
  const winBias = biasArr.length>=3? winsorize(biasArr,0.02,0.98) : biasArr.slice();
  const medObsPerU = median(g.obsPerU);
  const medExpPerU = median(g.expPerU);
  const medBias = median(winBias);
  let ci=null;
  if(winBias.length>=5){
    const boots = bootstrapMedians(winBias, 1000);
    const lo = quantile(boots, 0.025);
    const hi = quantile(boots, 0.975);
    if(lo!=null && hi!=null) ci=[lo,hi];
  }
  return {
    group:k, n:g.n,
    pctIneffective2h:pct(g.lt30_2h,g.n),
    medDrop2h: median(g.drops2),
    medDrop3h: median(g.drops3),
    expectedPerU: medExpPerU!=null? +(+medExpPerU).toFixed(0): null,
    observedPerU: medObsPerU!=null? +(+medObsPerU).toFixed(0): null,
    biasPerU: (medBias!=null? +(+medBias).toFixed(0): null),
    biasCI: (ci && ci.length===2)? [+(+ci[0]).toFixed(0), +(+ci[1]).toFixed(0)] : null,
    constraintConfounded: !!constraintConfounded
  };
}).sort((a,b)=> a.group.localeCompare(b.group));

// Experiment peek aggregates
function isMiddayLowIOB(ev){ return ev.hb.startsWith('midday') && ev.ibVal!=null && ev.ibVal<0.5; }
const nowMs = Date.now();
const RECENT_WINDOW_MS = 2*24*3600*1000; // last 48h
const BASELINE_WINDOW_DAYS = 7; // 7-day baseline
const recentStart = nowMs - RECENT_WINDOW_MS;
const baseStart = nowMs - BASELINE_WINDOW_DAYS*24*3600*1000;
const recent = perEvent.filter(ev=> isMiddayLowIOB(ev) && ev.ms>=recentStart);
const base = perEvent.filter(ev=> isMiddayLowIOB(ev) && ev.ms>=baseStart && ev.ms<recentStart);
function agg(list){
  const n=list.length;
  if(!n) return {n:0};
  const ine = pct(list.filter(x=> x.d2!=null && x.d2<20).length, n);
  const med2 = median(list.map(x=> x.d2).filter(v=> v!=null));
  const med3 = median(list.map(x=> x.d3).filter(v=> v!=null));
  const tar = (()=>{ const vals=list.map(x=> x.tar90180).filter(v=> v!=null); return vals.length? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1): null; })();
  const tbr = (()=>{ const vals=list.map(x=> x.tbr90180).filter(v=> v!=null); return vals.length? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1): null; })();
  const pred = (()=>{ const vals=list.map(x=> x.predLeSuspend).filter(v=> v!=null); return vals.length? pct(vals.filter(Boolean).length, vals.length): null; })();
  return {n, pctIneff2h:ine, medDrop2h:med2, medDrop3h:med3, pctTAR90_180:tar, pctTBR0_180:tbr, pctPredLeSuspend0_180:pred};
}
function delta(a,b){ // a minus b
  if(a==null || b==null) return null; return +(a-b).toFixed(1);
}
const aggRecent = agg(recent);
const aggBase = agg(base);
const expPeek = {
  context: 'Corrections — Midday (11–13), IOB<0.5',
  recent: aggRecent,
  baseline7d: aggBase,
  deltas: {
    dPctIneff2h: delta(aggRecent.pctIneff2h, aggBase.pctIneff2h), // down good
    dMedDrop2h: delta(aggRecent.medDrop2h, aggBase.medDrop2h), // up good
    dMedDrop3h: delta(aggRecent.medDrop3h, aggBase.medDrop3h), // up good
    dPctTAR90_180: delta(aggRecent.pctTAR90_180, aggBase.pctTAR90_180) // down good
  },
  safety: {
    pctPredLeSuspend0_180: aggRecent.pctPredLeSuspend0_180,
    pctTBR0_180: aggRecent.pctTBR0_180
  }
};

// ISF +10% run window (14:00–16:30), clean corrections (no carbs ±4h), IOB<1.5
function isISFRunDef(){ const x=(experiments.active||[]).find(x=> /ISF \+10%|ISF\s*\+10%|ISF \+10/.test(x.title||'')); if(!x) return null; return {startMs: x.startDate? Date.parse(x.startDate+'T00:00:00-06:00'): null, title: x.title, window: x.window||'14:00–16:30'}; }
function isWithinISFRunWindow(ms){ const d=new Date(ms); const fmt = new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false}); const parts=Object.fromEntries(fmt.formatToParts(d).map(p=>[p.type,p.value])); const hm= (+parts.hour)*60 + (+parts.minute); return hm>=14*60 && hm<=16*60+30; }
function cleanCorrection(ev){ // no carbs ±4h and IOB <1.5
  const hasCarb = nearbyCarb(ev.ms, 240);
  const iobOk = ev.ibVal!=null ? ev.ibVal<1.5 : true;
  return !hasCarb && iobOk;
}
const isfDef = isISFRunDef();
let experimentsOut = { midDayLowIob: expPeek };
if(isfDef && isfDef.startMs){
  const events = perEvent.filter(ev=> isWithinISFRunWindow(ev.ms) && cleanCorrection(ev));
  const recent2 = events.filter(ev=> ev.ms>=isfDef.startMs);
  const baseStart2 = isfDef.startMs - 7*24*3600*1000;
  const baseline2 = events.filter(ev=> ev.ms>=baseStart2 && ev.ms<isfDef.startMs);
  const A = agg(recent2); const B = agg(baseline2);
  function d(a,b){ if(a==null||b==null) return null; return +(a-b).toFixed(1); }
  experimentsOut.isfRun = {
    title: isfDef.title,
    window: isfDef.window||'14:00–16:30',
    recent: A,
    baseline7d: B,
    deltas: {
      dPctIneff2h: d(A.pctIneff2h, B.pctIneff2h),
      dMedDrop2h: d(A.medDrop2h, B.medDrop2h),
      dMedDrop3h: d(A.medDrop3h, B.medDrop3h),
      dPctTAR90_180: d(A.pctTAR90_180, B.pctTAR90_180)
    },
    adherence: { cleanCorrections: recent2.length }
  };
}

const outPath = path.join(dataDir,'correction_context.json');
fs.writeFileSync(outPath, JSON.stringify({groups:outGroups, experimentPeek: expPeek, experiments: experimentsOut},null,2));
console.log(outPath);
