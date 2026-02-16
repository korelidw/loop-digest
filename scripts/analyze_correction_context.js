#!/usr/bin/env node
/**
 * Corrections effectiveness by context (@120m, dose-normalized)
 * - Identify insulin-only corrections (bolus >0)
 * - Exclude confounders: any carbs or exercise within ±4h of bolus
 * - Compute 120m drop from pre value and normalize per unit
 * - Also compute 2h/3h raw drops and %ineffective (<20 mg/dL at 2h) for overlay
 * - Attach approximate IOB at correction (from devicestatus nearest ±5 min)
 * - Group by IOB bins and time-of-day windows
 */
const fs = require('fs');
const path = require('path');

function loadJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function median(a){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function pct(n,d){ return d? +(100*n/d).toFixed(1): 0; }

const TZ = 'America/Chicago';
function hourLocal(ms){ const d=new Date(ms); const f=new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',hour12:false}); return +Object.fromEntries(f.formatToParts(d).map(p=>[p.type,p.value])).hour; }

const dataDir = path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
const entriesPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_entries_')).map(f=>path.join(dataDir,f)).sort().pop();
const treatsPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_treatments_')).map(f=>path.join(dataDir,f)).sort().pop();
const devPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_devicestatus_')).map(f=>path.join(dataDir,f)).sort().pop();

const entries = loadJson(entriesPath) || [];
const treats = loadJson(treatsPath) || [];
const dev = loadJson(devPath) || [];

const sgv = entries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date|| (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.mg==='number' && typeof x.ms==='number').sort((a,b)=>a.ms-b.ms);

function isInsulinOnly(t){ const insOk = typeof t.insulin==='number' && t.insulin>0; const carbs = typeof t.carbs==='number' && t.carbs>0; return insOk && !carbs; }
function isCarb(t){ return typeof t.carbs==='number' && t.carbs>0; }
function isExercise(t){ const et=(t.eventType||'').toLowerCase(); const notes=(t.notes||t.note||'').toLowerCase(); return et.includes('exercise') || notes.includes('exercise') || et.includes('activity'); }

const boluses = treats.filter(isInsulinOnly).map(t=>({
  ms: t.mills || (t.created_at? Date.parse(t.created_at): (t.createdAt? Date.parse(t.createdAt): undefined)),
  units: t.insulin
})).filter(b=>b.ms && b.units>=0.3).sort((a,b)=>a.ms-b.ms);

const carbTimes = treats.filter(isCarb).map(t=> t.mills || (t.created_at? Date.parse(t.created_at): (t.createdAt? Date.parse(t.createdAt): undefined)) ).filter(Boolean).sort((a,b)=>a-b);
const exTimes = treats.filter(isExercise).map(t=> t.mills || (t.created_at? Date.parse(t.created_at): (t.createdAt? Date.parse(t.createdAt): undefined)) ).filter(Boolean).sort((a,b)=>a-b);

function withinAny(times, ms, windowMin){ const w=windowMin*60000; for(const t of times){ if(t<ms-w) continue; if(t>ms+w) break; return true; } return false; }

// Build quick index for devicestatus iob
const devIOB = dev.filter(r=>r && r.loop && r.loop.iob && typeof r.loop.iob.iob==='number').map(r=>({ms: Date.parse(r.created_at || r.loop.timestamp), iob: r.loop.iob.iob})).filter(x=>!isNaN(x.ms)).sort((a,b)=>a.ms-b.ms);

function nearestIOB(ms){ // linear scan acceptable at current size
  const w=5*60000; let best=null, bestd=Infinity; for(const x of devIOB){ const d=Math.abs(x.ms-ms); if(d<bestd){ best=x; bestd=d; } if(x.ms>ms+w) break; }
  return (best && bestd<=w)? best.iob : null;
}

function preGlucose(ms){ // find sgv value within [-10,+5] min
  const start = ms-10*60000, end = ms+5*60000; const cand = sgv.filter(p=>p.ms>=start && p.ms<=end); if(!cand.length) return null; // nearest by time
  cand.sort((a,b)=> Math.abs(a.ms-ms)-Math.abs(b.ms-ms)); return cand[0].mg;
}

function valueNear(msTarget, tolMin=10){
  const start = msTarget - tolMin*60000, end = msTarget + tolMin*60000;
  const cand = sgv.filter(p=>p.ms>=start && p.ms<=end);
  if(!cand.length) return null;
  cand.sort((a,b)=> Math.abs(a.ms-msTarget)-Math.abs(b.ms-msTarget));
  return cand[0].mg;
}

function dropAtMinutes(ms, minutes){
  const pre = preGlucose(ms); if(pre==null) return null;
  const val = valueNear(ms + minutes*60000, 10); if(val==null) return null;
  return pre - val;
}

function dropAfter(ms, hours){ const end = ms+hours*3600*1000; const pre = preGlucose(ms); if(pre==null) return null; const win = sgv.filter(p=>p.ms>ms && p.ms<=end); if(!win.length) return null; const last = win[win.length-1].mg; return pre - last; }

function todBin(h){ if(h>=0 && h<4) return 'overnight(0-4)'; if(h>=6 && h<9) return 'morning(6-9)'; if(h>=11 && h<13) return 'midday(11-13)'; if(h>=17 && h<21) return 'evening(17-21)'; return 'other'; }
function iobBin(x){ if(x==null) return 'iob:unknown'; if(x<0.5) return 'iob<0.5'; if(x<1.5) return 'iob 0.5-1.5'; return 'iob>1.5'; }

const groups = {};
for(const b of boluses){
  // Exclusions: carbs/exercise within ±4h
  if(withinAny(carbTimes, b.ms, 240)) continue;
  if(withinAny(exTimes, b.ms, 240)) continue;

  const d2raw = dropAfter(b.ms,2);
  const d3raw = dropAfter(b.ms,3);
  const d120 = dropAtMinutes(b.ms,120);
  const perU = (d120!=null && b.units>0)? (d120 / b.units) : null;
  if(d2raw==null && d3raw==null && perU==null) continue;

  const hb = todBin(hourLocal(b.ms));
  const ib = iobBin(nearestIOB(b.ms));
  const key = hb+' | '+ib;
  const g = groups[key] || (groups[key]={n:0, lt20_2h:0, drops2:[], drops3:[], perU120:[]});
  g.n++;
  if(d2raw!=null && d2raw<20) g.lt20_2h++;
  if(d2raw!=null) g.drops2.push(d2raw);
  if(d3raw!=null) g.drops3.push(d3raw);
  if(perU!=null) g.perU120.push(perU);
}

const out = Object.entries(groups).map(([k,g])=>({
  group:k,
  n:g.n,
  pctIneffective2h:pct(g.lt20_2h,g.n),
  medDrop2h: median(g.drops2),
  medDrop3h: median(g.drops3),
  medDropPerU120: median(g.perU120)
}))
  .sort((a,b)=> a.group.localeCompare(b.group));

const outPath = path.join(dataDir,'correction_context.json');
fs.writeFileSync(outPath, JSON.stringify({groups:out, meta:{window:"±4h carb/exercise excluded", metric:"median drop per unit at 120m"}},null,2));
console.log(outPath);
