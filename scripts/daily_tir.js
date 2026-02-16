#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const TZ='America/Chicago';
function localDay(ms){ const d=new Date(ms); const f=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}); const p=Object.fromEntries(f.formatToParts(d).map(x=>[x.type,x.value])); return `${p.year}-${p.month}-${p.day}`; }
const dataDir=path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
const entriesPath=fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_entries_')).map(f=>path.join(dataDir,f)).sort().pop();
const entries=JSON.parse(fs.readFileSync(entriesPath,'utf8'));
const now=new Date();
const todayKey=localDay(now.getTime());
const pts=entries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date || (e.dateString? Date.parse(e.dateString): undefined)}))
  .filter(x=>typeof x.mg==='number' && typeof x.ms==='number')
  .filter(x=> localDay(x.ms)===todayKey);
let low=0, veryLow=0, inRange=0, high=0, veryHigh=0;
for(const p of pts){ if(p.mg<54) veryLow++; if(p.mg<70) low++; else if(p.mg<=180) inRange++; else high++; if(p.mg>250) veryHigh++; }
const total=pts.length;
function pct(v){ return total? +(100*v/total).toFixed(1):0; }
const out={ day: todayKey, total, counts:{ lt54: veryLow, lt70: low, inRange, gt180: high, gt250: veryHigh }, pct:{ tbr_lt70: pct(low), tbr_lt54: pct(veryLow), tir_70_180: pct(inRange), tar_gt180: pct(high) } };
console.log(JSON.stringify(out,null,2));
