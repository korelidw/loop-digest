#!/usr/bin/env node
/**
 * Deterministic Nightscout review (lightweight):
 * - Uses entries (CGM), treatments (carbs/insulin), profile (presence), devicestatus (counts only)
 * - Computes coverage, TIR, lows/highs, overnight drift, post-meal response by slot, correction effectiveness
 * - Emits a summary + hypothesis candidates (directional only)
 */
const fs = require('fs');
const path = require('path');

function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function median(arr){ if(!arr.length) return null; const s=[...arr].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function pct(v,tot){ return tot?+(100*v/tot).toFixed(1):0; }
function within(v,min,max){ return v>=min && v<=max; }

const TZ = 'America/Chicago';
function localParts(ms){ const d = new Date(ms); const fmt = new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}); const parts = Object.fromEntries(fmt.formatToParts(d).map(p=>[p.type,p.value])); const y=+parts.year, m=+parts.month, da=+parts.day, h=+parts.hour, mi=+parts.minute; return {y,m,da,h,mi, key:`${y}-${String(m).padStart(2,'0')}-${String(da).padStart(2,'0')}`, hod:h}; }

const dataDir = path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
const entriesPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_entries_')).map(f=>path.join(dataDir,f)).sort().pop();
const treatsPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_treatments_')).map(f=>path.join(dataDir,f)).sort().pop();
const profilePath = path.join(dataDir,'ns_profile_latest.json');

const entries = loadJson(entriesPath) || [];
const treats = loadJson(treatsPath) || [];
const profile = loadJson(profilePath);

// Basic counts
const total = entries.length;
const sgv = entries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date||e.dateString&&Date.parse(e.dateString)})).filter(x=>typeof x.mg==='number' && typeof x.ms==='number');
sgv.sort((a,b)=>a.ms-b.ms);

// TIR metrics
let low=0, inRange=0, high=0, veryLow=0, veryHigh=0;
for(const p of sgv){ if(p.mg<54) veryLow++; if(p.mg<70) low++; else if(p.mg<=180) inRange++; else high++; if(p.mg>250) veryHigh++; }

// Coverage estimate using 5-min cadence
let coverage=null, durationDays=null; if(sgv.length){ const dur = sgv[sgv.length-1].ms - sgv[0].ms; durationDays = +(dur/(24*3600*1000)).toFixed(2); const expected = dur/(5*60*1000); coverage = expected>0?Math.min(1, sgv.length/expected):null; }

// Overnight drift per day (00:00-04:00 local)
const nightSlopes=[]; const nightsLow=[]; const nightsHigh=[];
const byDay = new Map();
for(const p of sgv){ const lp = localParts(p.ms); if(!byDay.has(lp.key)) byDay.set(lp.key,[]); byDay.get(lp.key).push(p); }
for(const [day,list] of byDay){ const overnight = list.filter(p=>{const h=localParts(p.ms).hod; return h>=0 && h<4;}); if(overnight.length>5){ const start=overnight[0], end=overnight[overnight.length-1]; const slope = (end.mg - start.mg) / ((end.ms - start.ms)/3600000); // mg/dL per hour
 nightSlopes.push(slope); if(overnight.some(p=>p.mg<70)) nightsLow.push(day); if(overnight.some(p=>p.mg>180)) nightsHigh.push(day); }
}
const medianNightSlope = median(nightSlopes);

// Treatments parse
function isCarb(t){ return typeof t.carbs==='number' && t.carbs>0; }
function isInsulinOnly(t){ const carbsOk = !(typeof t.carbs==='number' && t.carbs>0); const insOk = typeof t.insulin==='number' && t.insulin>0; return insOk && carbsOk; }

// Post-meal analysis (carbs >= 10g), slots
const meals = treats.filter(t=>isCarb(t) && t.carbs>=10).map(t=>{ const ms = t.mills || (t.created_at? Date.parse(t.created_at): (t.createdAt? Date.parse(t.createdAt): undefined)); return {ms, carbs:t.carbs||0, enteredIns:t.insulin||0}; }).filter(m=>m.ms);
function slotFor(ms){ const h=localParts(ms).hod; if(h>=5 && h<11) return 'breakfast'; if(h>=11 && h<15) return 'lunch'; if(h>=17 && h<21) return 'dinner'; return 'other'; }
const mealStats = {breakfast:[], lunch:[], dinner:[], other:[]};
for(const m of meals){ const slot=slotFor(m.ms); // 4h window
  const win = sgv.filter(p=>p.ms>=m.ms && p.ms<=m.ms+4*3600*1000);
  const preIdx = sgv.findIndex(p=>p.ms<=m.ms);
  const pre = preIdx>0? sgv[preIdx].mg : null;
  const peak = win.length? Math.max(...win.map(p=>p.mg)) : null;
  const ret180Idx = win.findIndex(p=>p.mg<=180);
  const timeTo180Min = ret180Idx>=0? (win[ret180Idx].ms - m.ms)/60000 : null;
  const hitHigh = peak!==null && peak>180;
  mealStats[slot].push({pre,peak,timeTo180Min,carbs:m.carbs});
}
function summarizeMeals(list){ const n=list.length; if(!n) return {n:0, pctHigh:0, medianPeak:null, medianTimeTo180Min:null};
  const highs = list.filter(x=>x.peak>180).length; const mp = median(list.filter(x=>x.peak!=null).map(x=>x.peak));
  const t180 = median(list.filter(x=>x.timeTo180Min!=null).map(x=>x.timeTo180Min));
  return {n, pctHigh:pct(highs,n), medianPeak:mp, medianTimeTo180Min:t180};
}
const mealSummary = Object.fromEntries(Object.entries(mealStats).map(([k,v])=>[k, summarizeMeals(v)]));

// Correction analysis (insulin with no carbs), 2h delta and lows within 4h
const corrections = treats.filter(isInsulinOnly).map(t=>{ const ms = t.mills || (t.created_at? Date.parse(t.created_at): (t.createdAt? Date.parse(t.createdAt): undefined)); return {ms, units:t.insulin||0}; }).filter(x=>x.ms);
let corrIneff=0, corrOver=0, corrN=0; const corrDrops=[];
for(const c of corrections){ // pre within 15 min before
  const preIdx = sgv.findIndex(p=>p.ms>=c.ms-15*60000 && p.ms<=c.ms+5*60000);
  const pre = preIdx>=0? sgv[preIdx].mg : null;
  const win2h = sgv.filter(p=>p.ms>c.ms && p.ms<=c.ms+2*3600*1000);
  const win4h = sgv.filter(p=>p.ms>c.ms && p.ms<=c.ms+4*3600*1000);
  if(pre!=null && win2h.length){ const end=win2h[win2h.length-1]; const drop = pre - end.mg; corrDrops.push(drop); corrN++; if(drop<30) corrIneff++; }
  if(win4h.some(p=>p.mg<70)) corrOver++;
}

// Build hypotheses (directional, with uncertainty)
const cards=[];
// Overnight drift
if(medianNightSlope!=null){
  if(medianNightSlope<-5){ cards.push({
    title:'Overnight downward drift suggests basal too strong',
    window:'00:00–04:00 local, fasting',
    levers:['basal'], direction:'too strong',
    evidence:[`Median overnight slope ${medianNightSlope.toFixed(1)} mg/dL/hr (negative)`, `${nightsLow.length} nights with <70`, `${nightsHigh.length} nights >180 (context)`],
    confidence: nightsLow.length + nightSlopes.length>6 ? 'Medium' : 'Low',
    confounders:['late corrections','exercise carryover','sensor compression lows'],
    safety:'If basal reduced incorrectly, overnight highs may increase.',
    next:['Confirm with a 4–6h fasting window near midnight on a quiet night; watch trend without Loop corrections.']
  }); }
  if(medianNightSlope>5){ cards.push({
    title:'Overnight upward drift suggests basal too weak',
    window:'00:00–04:00 local, fasting',
    levers:['basal'], direction:'too weak',
    evidence:[`Median overnight slope +${medianNightSlope.toFixed(1)} mg/dL/hr`, `${nightsHigh.length} nights >180`, `${nightsLow.length} nights <70 (context)`],
    confidence: nightSlopes.length>6 ? 'Medium' : 'Low',
    confounders:['bedtime snacks','site wearout','late meal impact'],
    safety:'If basal increased too much, risk of overnight lows.',
    next:['Re-check on a low-activity night; verify rise without carbs or bolus.']
  }); }
}
// Post-meal
for(const slot of ['breakfast','lunch','dinner']){
  const s = mealSummary[slot];
  if(s && s.n>=5 && s.pctHigh>=50){
    cards.push({
      title:`Post-${slot} highs suggest ICR too weak`,
      window:`${slot} meals`,
      levers:['ICR'], direction:'too weak',
      evidence:[`${s.n} ${slot} meals analyzed`, `${s.pctHigh}% peaked >180`, `Median peak ~${s.medianPeak||'?'} mg/dL`, s.medianTimeTo180Min?`Median return-to-180 ${Math.round(s.medianTimeTo180Min)} min`:'Often prolonged return-to-180'],
      confidence: s.n>=10 ? 'Medium' : 'Low',
      confounders:['unannounced carbs','fat/protein delays','site absorption'],
      safety:'Over-tightening ICR risks post-meal lows.',
      next:[`Log a few ${slot} meals with accurate carbs; watch 4h curve and correction needs.`]
    });
  }
}
// Corrections
if(corrN>=10){
  const medDrop = median(corrDrops);
  if((corrIneff/corrN)>=0.4){
    cards.push({
      title:'Corrections often ineffective → ISF may be too weak',
      window:'Anytime corrections (no carbs)',
      levers:['ISF'], direction:'too weak',
      evidence:[`${corrN} corrections analyzed`, `${pct(corrIneff,corrN)}% had <30 mg/dL drop within 2h`, `Median 2h drop ${medDrop!=null?medDrop.toFixed(0):'?'} mg/dL`],
      confidence: corrN>=20 ? 'Medium' : 'Low',
      confounders:['insulin on board','rising meals misclassified','site issues'],
      safety:'Strengthening ISF increases hypoglycemia risk if misapplied.',
      next:['Tag a few clean corrections (no food/exercise) and re-check 2–3h impact.']
    });
  }
  if((corrOver/corrN)>=0.15){
    cards.push({
      title:'Corrections sometimes overshoot → ISF may be too strong',
      window:'Anytime corrections (no carbs)',
      levers:['ISF'], direction:'too strong',
      evidence:[`${pct(corrOver,corrN)}% had glucose <70 within 4h post-correction`],
      confidence:'Low',
      confounders:['compression lows','stacked insulin','exercise'],
      safety:'Weakening ISF can leave highs untreated; consider context carefully.',
      next:['Review a few overshoot cases; check for stacked insulin or activity.']
    });
  }
}

// Overall lows priority
const lowPct = pct(low,total);
if(lowPct>=2){
  cards.unshift({
    title:'Hypoglycemia burden present — prioritize low prevention',
    window:'All-day summary',
    levers:['basal','ICR','ISF','timing/model'], direction:'risk',
    evidence:[`${low} low readings (<70) out of ${total} (${lowPct}%)`, `${nightsLow.length} nights with lows in 00:00–04:00`],
    confidence:'Medium',
    confounders:['compression','sensor noise'],
    safety:'Treat lows promptly; avoid multiple simultaneous tightening changes.',
    next:['Focus first on consistent low windows (overnight vs post-meal); test one lever at a time.']
  });
}

const out = {
  meta:{ tz:TZ, totalReadings:total, coverage, durationDays, tir:{low, inRange, high, veryLow, veryHigh} },
  meals: mealSummary,
  corrections: { n:corrN, pctIneffective: pct(corrIneff,corrN), pctOvershoot: pct(corrOver,corrN), medianDrop: median(corrDrops) },
  nights: { n: nightSlopes.length, medianSlope: medianNightSlope, nightsLowCount: nightsLow.length, nightsHighCount: nightsHigh.length },
  cards
};

const outPath = path.join(dataDir,'review_summary.json');
fs.writeFileSync(outPath, JSON.stringify(out,null,2));
console.log(outPath);
