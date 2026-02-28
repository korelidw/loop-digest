#!/usr/bin/env node
/**
 * Compute prior-window metrics_digest_prev.json from the previous ns_entries_* file.
 * Falls back to the oldest if only one exists.
 */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
function loadJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function mean(a){ return a.length? a.reduce((s,x)=>s+x,0)/a.length : 0; }
function sd(a){ if(a.length<2) return 0; const m=mean(a); const v=mean(a.map(x=> (x-m)*(x-m) )); return Math.sqrt(v); }

const entriesFiles = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_entries_')).sort();
if(!entriesFiles.length){ console.error('No ns_entries_* files found'); process.exit(1); }
const priorFile = entriesFiles.length>=2 ? entriesFiles[entriesFiles.length-2] : entriesFiles[0];
const treatsFiles = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_treatments_')).sort();
const treatsFile = treatsFiles.length>=2 ? treatsFiles[treatsFiles.length-2] : treatsFiles[0];

const entries = loadJson(path.join(dataDir,priorFile)) || [];
const treats = loadJson(path.join(dataDir,treatsFile)) || [];

const sgv = entries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date|| (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.mg==='number' && typeof x.ms==='number').sort((a,b)=>a.ms-b.ms);
const values = sgv.map(x=>x.mg);
const n = values.length;

let veryLow=0, low=0, inRange=0, high=0, veryHigh=0;
for(const mg of values){ if(mg<54) veryLow++; if(mg<70) low++; else if(mg<=180) inRange++; else high++; if(mg>250) veryHigh++; }

let coverage=null, durationDays=null; if(sgv.length){ const dur = sgv[sgv.length-1].ms - sgv[0].ms; durationDays = +(dur/(24*3600*1000)).toFixed(2); const expected = dur/(5*60*1000); coverage = expected>0? Math.min(1, sgv.length/expected): null; }

const m = mean(values); const s = sd(values); const cv = m? +(100*s/m).toFixed(1) : null;

function riskTransform(g){ return 1.509 * ( Math.pow(Math.log(g), 1.084) - 5.381 ); }
const r = values.filter(g=>g>0).map(g=> riskTransform(g));
const lowRisks = r.filter(x=>x<0).map(x=>x*x);
const highRisks = r.filter(x=>x>0).map(x=>x*x);
const LBGI = lowRisks.length? +(10*mean(lowRisks)).toFixed(2): 0;
const HBGI = highRisks.length? +(10*mean(highRisks)).toFixed(2): 0;
const GRI = +(LBGI + HBGI).toFixed(2);

const out = {
  meta:{ durationDays, coverage, count:n },
  tir:{ veryLow, low, inRange, high, veryHigh },
  cv,
  risk:{ LBGI, HBGI, GRI }
};
const outPath = path.join(dataDir,'metrics_digest_prev.json');
fs.writeFileSync(outPath, JSON.stringify(out,null,2));
console.log(outPath);
