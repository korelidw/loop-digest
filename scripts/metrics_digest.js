#!/usr/bin/env node
/**
 * Metrics digest for Nightscout entries (read-only):
 * - TIR/TBR/TAR counts (70–180, <70, <54, >180, >250)
 * - Coefficient of Variation (CV)
 * - Glycemic Risk Index proxy: LBGI, HBGI, GRI=LBGI+HBGI
 * - Coverage/uptime estimate
 * - Simple flags: possible missed carbs (fast rises without carb entry)
 */
const fs = require('fs');
const path = require('path');

function loadJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function mean(a){ return a.length? a.reduce((s,x)=>s+x,0)/a.length : 0; }
function sd(a){ if(a.length<2) return 0; const m=mean(a); const v=mean(a.map(x=> (x-m)*(x-m) )); return Math.sqrt(v); }

const dataDir = path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
const entriesPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_entries_')).map(f=>path.join(dataDir,f)).sort().pop();
const treatsPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_treatments_')).map(f=>path.join(dataDir,f)).sort().pop();

const entries = loadJson(entriesPath) || [];
const treats = loadJson(treatsPath) || [];

const sgv = entries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date|| (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.mg==='number' && typeof x.ms==='number').sort((a,b)=>a.ms-b.ms);
const values = sgv.map(x=>x.mg);
const n = values.length;

// TIR/TBR/TAR counts
let veryLow=0, low=0, inRange=0, high=0, veryHigh=0;
for(const mg of values){ if(mg<54) veryLow++; if(mg<70) low++; else if(mg<=180) inRange++; else high++; if(mg>250) veryHigh++; }

// Coverage estimate (expected every 5 min)
let coverage=null, durationDays=null; if(sgv.length){ const dur = sgv[sgv.length-1].ms - sgv[0].ms; durationDays = +(dur/(24*3600*1000)).toFixed(2); const expected = dur/(5*60*1000); coverage = expected>0? Math.min(1, sgv.length/expected): null; }

// CV
const m = mean(values);
const s = sd(values);
const cv = m? +(100*s/m).toFixed(1) : null;

// Glycemic Risk Index proxy (LBGI, HBGI, GRI=L+H)
// Risk transform r = 1.509*( (ln(glucose))^1.084 - 5.381 )
// Low risk component: r<0 ; High: r>0 ; Index = 10*mean(r^2) within each side
function riskTransform(g){ return 1.509 * ( Math.pow(Math.log(g), 1.084) - 5.381 ); }
const r = values.filter(g=>g>0).map(g=> riskTransform(g));
const lowRisks = r.filter(x=>x<0).map(x=>x*x);
const highRisks = r.filter(x=>x>0).map(x=>x*x);
const LBGI = lowRisks.length? +(10*mean(lowRisks)).toFixed(2): 0;
const HBGI = highRisks.length? +(10*mean(highRisks)).toFixed(2): 0;
const GRI = +(LBGI + HBGI).toFixed(2);

// Simple missed carb flags: count rises >50 mg/dL within 60 min with no carb entry within ±15 min before rise start
const carbEvents = treats.filter(t=> typeof t.carbs==='number' && t.carbs>0).map(t=> t.mills || (t.created_at? Date.parse(t.created_at) : (t.createdAt? Date.parse(t.createdAt): null)) ).filter(Boolean).sort((a,b)=>a-b);
let possibleMissedCarbs=0;
for(let i=0;i<sgv.length;i++){
  const start = sgv[i];
  const window = sgv.filter(p=> p.ms>start.ms && p.ms<= start.ms + 60*60000);
  if(!window.length) break;
  const maxRise = Math.max(...window.map(p=> p.mg - start.mg));
  if(maxRise>=50){
    const recentCarb = carbEvents.find(ms=> ms>= start.ms - 15*60000 && ms<= start.ms + 10*60000);
    if(!recentCarb) { possibleMissedCarbs++; i += Math.max(1, Math.floor(window.length/2)); }
  }
}

const out = {
  meta:{ durationDays, coverage, count:n },
  tir:{ veryLow, low, inRange, high, veryHigh },
  cv,
  risk:{ LBGI, HBGI, GRI },
  dataFlags:{ possibleMissedCarbs }
};

const outPath = path.join(dataDir,'metrics_digest.json');
fs.writeFileSync(outPath, JSON.stringify(out,null,2));
console.log(outPath);
