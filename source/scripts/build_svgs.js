#!/usr/bin/env node
/**
 * Build static SVG snapshots for Telegram/web fallbacks.
 * - tir_donut.svg (from metrics_digest.json)
 * - agp.svg (from agp.json)
 * - gri_hourly.svg (LBGI/HBGI by hour from entries)
 * - gri_zone.svg (overall LBGI/HBGI point on simple zones)
 */
const fs = require('fs');
const path = require('path');

function loadJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
const root = path.join(process.env.HOME,'.openclaw','workspace-diabetes');
const dataDir = path.join(root,'data');
const outDir = path.join(root,'dist');
fs.mkdirSync(outDir,{recursive:true});

const metrics = loadJson(path.join(dataDir,'metrics_digest.json'))||{};
const agp = loadJson(path.join(dataDir,'agp.json'))||{};
const entries = loadJson(fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_entries_')).map(f=>path.join(dataDir,f)).sort().pop()||'')||[];

// 1) TIR donut
(function(){
  const tir = metrics.tir||{};
  const counts = [tir.veryLow||0, (tir.low||0)-(tir.veryLow||0), tir.inRange||0, (tir.high||0)-(tir.veryHigh||0), tir.veryHigh||0];
  const labels = ['<54','<70','70–180','>180','>250'];
  const colors = ['#8e44ad','#3498db','#2ecc71','#e67e22','#e74c3c'];
  const total = counts.reduce((a,b)=>a+b,0)||1;
  const W=240,H=240,cx=120,cy=120,r=80,sw=28;
  const C = 2*Math.PI*r;
  let acc=0; let segs='';
  for(let i=0;i<counts.length;i++){
    const p = counts[i]/total; const segLen = p*C; const off = -acc*C; acc += p;
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[i]}" stroke-width="${sw}" transform="rotate(-90 ${cx} ${cy})" stroke-dasharray="${segLen} ${C-segLen}" stroke-dashoffset="${off}"/>`;
  }
  const svg = `<?xml version="1.0"?><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>${segs}<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,Arial" font-size="14">TIR</text></svg>`;
  fs.writeFileSync(path.join(outDir,'tir_donut.svg'), svg);
})();

// Helpers for AGP
function sanitize(arr){ if(!Array.isArray(arr)) return []; const out=[]; let last=null; for(let i=0;i<arr.length;i++){ let v=arr[i]; if(v==null||Number.isNaN(v)) v=last; if(v==null){ for(let j=i+1;j<arr.length;j++){ if(arr[j]!=null && !Number.isNaN(arr[j])) { v=arr[j]; break; } } } if(v==null) v=0; out.push(v); last=v; } return out; }
// 2) AGP svg
(function(){
  const n=(agp.p50||[]).length||288; const W=720, H=260, padL=40, padT=10, padB=36, padR=10; const ymin=40, ymax=360;
  const p50=sanitize(agp.p50||[]), p25=sanitize(agp.p25||[]), p75=sanitize(agp.p75||[]), p05=sanitize(agp.p05||[]), p95=sanitize(agp.p95||[]);
  const iw=W-padL-padR, ih=H-padT-padB;
  const x=(i)=> padL + iw*(i/(n-1)); const y=(mg)=> padT + ih*(1-Math.max(0,Math.min(1,(mg-ymin)/(ymax-ymin))));
  function pathFrom(arr){ let d=''; for(let i=0;i<n;i++){ const xi=x(i), yi=y(arr[i]); d += (i? ' L ':'M ')+xi.toFixed(2)+' '+yi.toFixed(2); } return d; }
  function bandPath(low,high){ let d=''; for(let i=0;i<n;i++){ d += (i? ' L ':'M ')+x(i).toFixed(2)+' '+y(high[i]).toFixed(2); } for(let i=n-1;i>=0;i--){ d += ' L '+x(i).toFixed(2)+' '+y(low[i]).toFixed(2);} d+=' Z'; return d; }
  const band95 = bandPath(p05,p95); const band75 = bandPath(p25,p75); const med = pathFrom(p50);
  const y70=y(70), y180=y(180);
  // Axes/grid
  const yTicksVals=[60,100,140,180,220,260,300,340];
  let yTicks=''; yTicksVals.forEach(v=>{ const yy=y(v); yTicks+=`<line x1="${padL}" y1="${yy}" x2="${padL+iw}" y2="${yy}" stroke="#eee"/>`+`<text x="${padL-8}" y="${yy+4}" text-anchor="end" font-size="10" fill="#666" font-family="system-ui,Arial">${v}</text>`; });
  const hourMarks=[6,9,12,15,18,21];
  let xGrid=''; hourMarks.forEach(h=>{ const i=h*12; const xx=x(i); xGrid+=`<line x1="${xx}" y1="${padT}" x2="${xx}" y2="${padT+ih}" stroke="#eee"/>`+`<text x="${xx}" y="${padT+ih+14}" text-anchor="middle" font-size="10" fill="#666" font-family="system-ui,Arial">${h}</text>`; });
  const svg = `<?xml version="1.0"?><svg viewBox="0 0 ${W} ${H}" width="100%" height="260" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>${yTicks}${xGrid}<rect x="${padL}" y="${Math.min(y70,y180)}" width="${iw}" height="${Math.abs(y180-y70)}" fill="rgba(39,174,96,0.07)"/><path d="${band95}" fill="rgba(231,76,60,0.06)" stroke="none"/><path d="${band75}" fill="rgba(230,126,34,0.22)" stroke="none"/><path d="${med}" fill="none" stroke="#2c3e50" stroke-width="2"/></svg>`;
  fs.writeFileSync(path.join(outDir,'agp.svg'), svg);
})();

// 3) Hourly GRI stacked bars
(function(){
  // risk transform
  function r(g){ return 1.509 * ( Math.pow(Math.log(g), 1.084) - 5.381 ); }
  const TZ='America/Chicago';
  function hourOf(ms){ const d=new Date(ms); const parts=new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',hour12:false}).formatToParts(d).reduce((o,p)=>{o[p.type]=p.value;return o;},{}); return +parts.hour; }
  const sgv = entries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date|| (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.mg==='number'&&typeof x.ms==='number');
  const byH=Array.from({length:24},()=>[]); sgv.forEach(p=>{ byH[hourOf(p.ms)].push(p.mg); });
  const L=[],Hc=[]; // LBGI/HBGI per hour
  for(let h=0;h<24;h++){ const arr=byH[h]; if(arr.length){ const rs=arr.filter(g=>g>0).map(r); const lows=rs.filter(v=>v<0).map(v=>v*v); const highs=rs.filter(v=>v>0).map(v=>v*v); const LBGI = lows.length? 10* (lows.reduce((a,b)=>a+b,0)/lows.length) : 0; const HBGI = highs.length? 10* (highs.reduce((a,b)=>a+b,0)/highs.length) : 0; L.push(LBGI); Hc.push(HBGI); } else { L.push(0); Hc.push(0); } }
  const W=720,H=220,padL=36,padR=12,padT=16,padB=24,iw=W-padL-padR,ih=H-padT-padB; const maxV=Math.max(1, ...L, ...Hc);
  // y-axis ticks at 0,10,20,30,40 (capped to maxV)
  const top=Math.min(40, Math.ceil(maxV/10)*10);
  let yGrid=''; for(let v=0; v<=top; v+=10){ const yy=padT + (ih)*(1 - (v/top)); yGrid += `<line x1="${padL}" y1="${yy}" x2="${padL+iw}" y2="${yy}" stroke="#eee"/>`+`<text x="${padL-8}" y="${yy+3}" text-anchor="end" font-size="10" fill="#666" font-family="system-ui,Arial">${v}</text>`; }
  let bars='';
  for(let h=0;h<24;h++){ const xx=padL + iw*(h/24) + 4; const bw=(iw/24)-8; const hHyper= (Hc[h]/top)*(ih-6); const hHypo =(L[h]/top)*(ih-6); const yHyper=padT + (ih-6) - hHyper; const yHypo = yHyper - hHypo; bars+=`<rect x="${xx.toFixed(1)}" y="${yHyper.toFixed(1)}" width="${bw.toFixed(1)}" height="${hHyper.toFixed(1)}" fill="#e67e22"/><rect x="${xx.toFixed(1)}" y="${yHypo.toFixed(1)}" width="${bw.toFixed(1)}" height="${hHypo.toFixed(1)}" fill="#8e44ad"/>`; }
  let xTicks=''; for(let h=0;h<24;h+=3){ const xx=padL + iw*(h/24); xTicks+=`<text x="${xx}" y="${H-6}" font-size="10" fill="#666" font-family="system-ui,Arial">${h}</text>`; }
  const svg=`<?xml version="1.0"?><svg viewBox="0 0 ${W} ${H}" width="100%" height="220" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>${yGrid}${bars}${xTicks}<text x="${W-10}" y="${padT}" text-anchor="end" font-size="10" fill="#666" font-family="system-ui,Arial">LBGI (purple) + HBGI (orange) by hour</text></svg>`;
  fs.writeFileSync(path.join(outDir,'gri_hourly.svg'), svg);
})();

// 4) GRI zone plot (simple)
(function(){
  const L= (metrics.risk&&metrics.risk.LBGI)||0; const Hc=(metrics.risk&&metrics.risk.HBGI)||0;
  const W=320,H=240,pad=30,iw=W-2*pad,ih=H-2*pad; const xScale=(v)=> pad + iw*(v/20); const yScale=(v)=> pad + ih*(1- (v/40));
  // Simple zone gradients
  let zones='';
  zones += `<rect x="${pad}" y="${pad}" width="${iw}" height="${ih}" fill="#fef0ef"/>`;
  zones += `<rect x="${pad}" y="${yScale(20)}" width="${iw}" height="${ih/2}" fill="#fdebd0"/>`;
  zones += `<rect x="${pad}" y="${yScale(10)}" width="${iw}" height="${ih/4}" fill="#eaf2f8"/>`;
  zones += `<rect x="${pad}" y="${yScale(5)}" width="${iw}" height="${ih/8}" fill="#eafaf1"/>`;
  const ptX=xScale(Math.min(20,L)); const ptY=yScale(Math.min(40,Hc));
  const svg = `<?xml version="1.0"?><svg viewBox="0 0 ${W} ${H}" width="100%" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>${zones}<line x1="${pad}" y1="${yScale(0)}" x2="${pad}" y2="${pad}" stroke="#999"/><line x1="${pad}" y1="${yScale(0)}" x2="${pad+iw}" y2="${yScale(0)}" stroke="#999"/><text x="${pad+iw/2}" y="${H-6}" text-anchor="middle" font-size="10" fill="#666" font-family="system-ui,Arial">Hypo component (proxy LBGI)</text><text transform="rotate(-90 ${12} ${pad+ih/2})" x="12" y="${pad+ih/2}" text-anchor="middle" font-size="10" fill="#666" font-family="system-ui,Arial">Hyper component (proxy HBGI)</text><circle cx="${ptX}" cy="${ptY}" r="4" fill="#2c3e50" stroke="#fff" stroke-width="1.5"/></svg>`;
  fs.writeFileSync(path.join(outDir,'gri_zone.svg'), svg);
})();

console.log(path.join(outDir,'tir_donut.svg'));
console.log(path.join(outDir,'agp.svg'));
console.log(path.join(outDir,'gri_hourly.svg'));
console.log(path.join(outDir,'gri_zone.svg'));
