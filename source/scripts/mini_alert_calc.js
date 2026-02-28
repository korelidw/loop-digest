#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const dataDir=path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
function load(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return []; } }
const entriesPath=fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_entries_')).map(f=>path.join(dataDir,f)).sort().pop();
const devPath=fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_devicestatus_')).map(f=>path.join(dataDir,f)).sort().pop();
const profPath=path.join(dataDir,'ns_profile_latest.json');
const entries=load(entriesPath);
const dev=load(devPath);
let profile=[]; try { profile=JSON.parse(fs.readFileSync(profPath,'utf8')); } catch {}
const now=Date.now(); const start=now-24*3600*1000;
const sgv=entries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date || (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.mg==='number'&&typeof x.ms==='number'&& x.ms>=start && x.ms<=now);
let lt70=0, lt54=0; for(const p of sgv){ if(p.mg<70) lt70++; if(p.mg<54) lt54++; }
function localDay(ms){ const TZ='America/Chicago'; const d=new Date(ms); const f=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}); const parts=Object.fromEntries(f.formatToParts(d).map(x=>[x.type,x.value])); return `${parts.year}-${parts.month}-${parts.day}`; }
const todayKey=localDay(now);
const todayPts=entries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date || (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.mg==='number'&&typeof x.ms==='number' && localDay(x.ms)===todayKey);
let low=0, veryLow=0, inRange=0, high=0; for(const p of todayPts){ if(p.mg<54) veryLow++; if(p.mg<70) low++; else if(p.mg<=180) inRange++; else high++; }
const total=todayPts.length; function pct(v){ return total? +(100*v/total).toFixed(1):0; }
const headline={ day: todayKey, total, tir_70_180: pct(inRange), tbr_lt70: pct(low), tbr_lt54: pct(veryLow) };
let suspend=null; if(Array.isArray(profile) && profile.length){ const latest=profile[0]; const ls=latest.loopSettings||latest; suspend = (ls.minimumBGGuard!=null? +ls.minimumBGGuard : null); }
let cycles=0, predLe=0, failures=0; for(const r of dev){ const ts= Date.parse(r.created_at|| (r.loop&&r.loop.timestamp)||''); if(!ts|| ts<start || ts>now) continue; const L=r.loop||{}; if(!L||Object.keys(L).length===0) continue; cycles++; if(L.failureReason) failures++; if(suspend!=null && L.predicted && Array.isArray(L.predicted.values)){ const vals=L.predicted.values.filter(v=>typeof v==='number'); if(vals.length){ const min=Math.min(...vals); if(min<=suspend) predLe++; } }
}
function pct2(n,d){ return d? +(100*n/d).toFixed(1):0; }
const out={ last24:{ lt70, lt54, predLeSuspendPct: pct2(predLe,cycles), commErrorPct: pct2(failures,cycles), cycles }, headline };
fs.writeFileSync(path.join(dataDir,'mini_alert.json'), JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
