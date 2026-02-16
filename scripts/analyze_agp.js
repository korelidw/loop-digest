#!/usr/bin/env node
/**
 * AGP quantiles by minute-of-day (America/Chicago)
 * Output: agp.json with arrays of length 288 (5-min bins): p05,p25,p50,p75,p95
 */
const fs = require('fs');
const path = require('path');
function loadJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function quantile(a,q){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); const pos=(s.length-1)*q; const base=Math.floor(pos); const rest=pos-base; if(!s.length) return null; if(base+1>=s.length) return s[s.length-1]; return s[base] + (s[base+1]-s[base])*(isNaN(rest)?0:rest); }
const TZ = 'America/Chicago';
function hodBin(ms){ const d=new Date(ms); const parts=new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d).reduce((o,p)=>{o[p.type]=p.value;return o;},{}); const h=+parts.hour, m=+parts.minute; const idx=Math.floor((h*60+m)/5); return Math.max(0, Math.min(287, idx)); }

const dataDir = path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
const entriesPath = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_entries_')).map(f=>path.join(dataDir,f)).sort().pop();
const entries = loadJson(entriesPath) || [];
const sgv = entries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date || (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.mg==='number' && typeof x.ms==='number');
const bins = Array.from({length:288},()=>[]);
for(const p of sgv){ bins[hodBin(p.ms)].push(p.mg); }
const p05=[],p25=[],p50=[],p75=[],p95=[];
for(let i=0;i<288;i++){
  const arr=bins[i];
  p05.push(quantile(arr,0.05));
  p25.push(quantile(arr,0.25));
  p50.push(quantile(arr,0.5));
  p75.push(quantile(arr,0.75));
  p95.push(quantile(arr,0.95));
}
const out={ tz:TZ, stepMin:5, p05,p25,p50,p75,p95 };
fs.writeFileSync(path.join(dataDir,'agp.json'), JSON.stringify(out,null,2));
console.log(path.join(dataDir,'agp.json'));
