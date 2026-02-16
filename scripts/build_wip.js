#!/usr/bin/env node
const fs=require('fs'); const path=require('path');
const dataDir = path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
const ctxPath = path.join(dataDir,'correction_context.json');
const basePath = path.join(__dirname,'..','index-20260215-2101.html');
const outPath = path.join(__dirname,'..','index-20260215-WIP.html');

function load(p){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{ return null; } }
const ctx = load(ctxPath)||{groups:[]};
const base = fs.readFileSync(basePath,'utf8');

function fmt(x){ if(x==null||Number.isNaN(x)) return 'n/a'; const v = Math.round(x); return isFinite(v)? v: 'n/a'; }

const rows = (ctx.groups||[]).map(g=>{
  return `<tr><td>${g.group}</td><td>${g.n||0}</td><td>${fmt(g.medDropPerU120)}</td><td>${fmt(g.medDrop2h)}</td><td>${fmt(g.medDrop3h)}</td><td>${fmt(g.pctIneffective2h)}%</td></tr>`;
}).join('\n');

const table = `\n<section id="corrections-mvp" style="margin:22px 0">\n  <h3>MVP: 120m dose-normalized corrections</h3>\n  <div class="muted" style="margin:6px 0 10px">Window: ${ctx.meta&&ctx.meta.window||'n/a'} · Metric: median drop per unit at 120m (mg/dL/U)</div>\n  <div class="card" style="padding:10px;overflow:auto">\n    <table style="min-width:520px"><thead><tr><th>Daypart × IOB band</th><th>n</th><th>Med drop/U @120m</th><th>Med raw 2h</th><th>Med raw 3h</th><th>% ineff@2h</th></tr></thead><tbody>${rows||''}</tbody></table>\n  </div>\n</section>`;

// Inject after Corrections Lens block or before closing body
let out = base;
const anchor = '<div class="heatmap-note">';
const idx = base.indexOf(anchor);
if(idx>=0){
  // insert after the heatmap note block close (find end of that div)
  const closeIdx = base.indexOf('</div>', idx);
  if(closeIdx>0){ out = base.slice(0, closeIdx+6) + table + base.slice(closeIdx+6); }
}
fs.writeFileSync(outPath,out,'utf8');
console.log(outPath);
