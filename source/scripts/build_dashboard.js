#!/usr/bin/env node
/**
 * Build Loop Digest dashboard HTML with inline SVGs + scenario gating details.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(process.env.HOME,'.openclaw','workspace-diabetes');
const dataDir = path.join(root,'data');
const distDir = path.join(root,'dist');
const siteDir = path.join(root,'site');
fs.mkdirSync(siteDir,{recursive:true});
fs.mkdirSync(distDir,{recursive:true});

function load(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
const metrics = load(path.join(dataDir,'metrics_digest.json'))||{};
const review = load(path.join(dataDir,'review_summary.json'))||{};
const overlay = load(path.join(dataDir,'overlay_daily.json'))||{};
const mealTiming = load(path.join(dataDir,'meal_timing_analysis.json'))||{};
const profile = load(path.join(dataDir,'ns_profile_latest.json'))||[];
const progress = load(path.join(dataDir,'progress_log.json'))||{};
const scenarios = load(path.join(dataDir,'scenario_cards.json'))||{cards:[]};
const constraints = load(path.join(dataDir,'constraints_summary.json'))||{};
const correctionCtx = load(path.join(dataDir,'correction_context.json'))||{groups:[]};
// Latest entries/treatments for 24h spotlight
let entriesPath = null, treatsPath = null;
try{
  const efiles = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_entries_')).sort();
  if(efiles.length) entriesPath = path.join(dataDir, efiles[efiles.length-1]);
  const tfiles = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_treatments_')).sort();
  if(tfiles.length) treatsPath = path.join(dataDir, tfiles[tfiles.length-1]);
}catch{}
const latestEntries = entriesPath? (load(entriesPath)||[]) : [];
const latestTreats = treatsPath? (load(treatsPath)||[]) : [];

const experiments = load(path.join(dataDir,'experiments.json'))||{active:[],past:[]};

function esc(x){ return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtPct(val){ if(val==null||Number.isNaN(val)) return 'n/a'; const abs=Math.abs(val); const digits = abs<10 ? 1 : 0; return +val.toFixed(digits) + '%'; }

// Header data window (from latest entries file)
let entriesFile = null;
try{
  const files = fs.readdirSync(dataDir).filter(f=>f.startsWith('ns_entries_')).sort();
  if(files.length) entriesFile = path.join(dataDir, files[files.length-1]);
}catch{}
let startStr='n/a', endStr='n/a';
if(entriesFile){
  try{
    const entries = JSON.parse(fs.readFileSync(entriesFile,'utf8'));
    const sgv = entries.map(e=>({ms: e.date || (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.ms==='number').sort((a,b)=>a.ms-b.ms);
    if(sgv.length){
      const tz='America/Chicago';
      const fmt = new Intl.DateTimeFormat('en-US',{timeZone:tz, month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false});
      startStr = fmt.format(new Date(sgv[0].ms));
      endStr = fmt.format(new Date(sgv[sgv.length-1].ms));
    }
  }catch{}
}

// Build/version stamp for cache-busting
const buildVerOverride = process.env.BUILD_VER && /^\d{8}-\d{4}$/.test(process.env.BUILD_VER)? process.env.BUILD_VER : null;
let now = new Date();
if(buildVerOverride){
  const [datePart,timePart] = buildVerOverride.split('-');
  const year = +datePart.slice(0,4);
  const month = +datePart.slice(4,6);
  const day = +datePart.slice(6,8);
  const hour = +timePart.slice(0,2);
  const minute = +timePart.slice(2,4);
  const overrideDate = new Date(Date.UTC(year, month-1, day, hour, minute));
  if(!Number.isNaN(overrideDate.getTime())) now = overrideDate;
}
const ver = buildVerOverride || `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
const tzNowFmt = new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false});
const buildTimeStr = tzNowFmt.format(now);
// Git commit (repo) for traceability
const repoDir = path.join(process.env.HOME,'Documents','Github','loop-digest');
let gitSha = null; try { gitSha = require('child_process').execSync(`git -C "${repoDir}" rev-parse --short HEAD`,{stdio:['ignore','pipe','ignore']}).toString().trim(); } catch {}


// Loop settings strip
let ls = (Array.isArray(profile) && profile.length && (profile[0].loopSettings || profile[0])) || {};
const loopStrip = `Strategy: ${esc(ls.dosingStrategy||'n/a')} · Suspend: ${esc(ls.minimumBGGuard||'?')} mg/dL · Targets: ${ls.preMealTargetRange? esc(ls.preMealTargetRange.join('–')): 'n/a'} · MaxBasal: ${esc(ls.maximumBasalRatePerHour||'?')} U/hr · MaxBolus: ${esc(ls.maximumBolus||'?')} U · DIA: 6h`;

// Hypotheses table rows
let cardsRows = '';
(review.cards||[]).slice(0,5).forEach(c=>{
  const levers = (c.levers||[]).join(',')||'';
  const dir = c.direction||'';
  const leverTip = levers? ` title=\"Lever(s): ${esc(levers)}\"` : '';
  const dirTip = dir? ` title=\"Direction: ${esc(dir)}\"` : '';
  cardsRows += `<tr><td>${esc(c.title)}</td><td${leverTip}>${esc(levers)}</td><td${dirTip}>${esc(dir)}</td><td>${esc(c.confidence||'')}</td></tr>`;
});
const hypothesesCount = (review.cards||[]).length || 0;
const hypothesesLevers = Array.from(new Set((review.cards||[]).flatMap(c=> Array.isArray(c.levers)? c.levers: []))).filter(Boolean);
const hypothesesSummaryLine = hypothesesCount
  ? `${hypothesesCount} cards · Levers: ${hypothesesLevers.length? hypothesesLevers.join(', '): 'n/a'}`
  : 'No hypothesis cards available yet.';

// Safety Sentinels rows + header stamp
const sentinelDays = overlay.days||[];
const sentinelStamp = sentinelDays.length? sentinelDays[sentinelDays.length-1].day : 'n/a';
function badge(val, th){ if(val==null) return '<span class="pill muted">n/a</span>'; let c='green'; if(val>=th.red) c='red'; else if(val>=th.amber) c='orange'; return `<span class="pill ${c}">${Math.round(val)}%</span>`; }
let sentinelRows='';
sentinelDays.forEach(d=>{
  sentinelRows += `<tr><td>${esc(d.day)}</td><td>${badge(d.pctPredLeSuspend,{amber:15,red:25})}</td><td>${badge(d.pctFailures,{amber:10,red:20})}</td></tr>`;
});


const correctionDayparts = [
  {key:'overnight', label:'Overnight', window:'0–4'},
  {key:'morning', label:'Morning', window:'6–9'},
  {key:'midday', label:'Midday', window:'11–13'},
  {key:'evening', label:'Evening', window:'17–21'},
  {key:'other', label:'Other', window:'All other'}
];
const correctionIobBands = [
  {key:'lt', label:'IOB <0.5'},
  {key:'mid', label:'IOB 0.5–1.5'},
  {key:'gt', label:'IOB >1.5'}
];

// Constraint overlay per daypart (Pred ≤ suspend avg by hour window)
const overlayHourly = (overlay && Array.isArray(overlay.hourly)) ? overlay.hourly : [];
function avgVals(vals){ const v = vals.filter(x=> typeof x==='number' && !Number.isNaN(x)); if(!v.length) return null; return v.reduce((a,b)=>a+b,0)/v.length; }
function hoursForDaypart(key){
  if(key==='overnight') return [0,1,2,3];
  if(key==='morning') return [6,7,8,9];
  if(key==='midday') return [11,12,13];
  if(key==='evening') return [17,18,19,20,21];
  return [];
}
const daypartAvgPred = correctionDayparts.reduce((acc,dp)=>{
  const hrs = hoursForDaypart(dp.key);
  const vals = hrs.map(h=> (overlayHourly[h] && overlayHourly[h].pctPredLeSuspend!=null)? overlayHourly[h].pctPredLeSuspend: null);
  acc[dp.key] = avgVals(vals);
  return acc;
},{});
function predBadgeColor(val){ if(val==null) return '#95a5a6'; if(val>=25) return '#e74c3c'; if(val>=15) return '#f39c12'; return '#1abc9c'; }
function parseCorrectionGroupKey(groupStr){
  if(!groupStr) return null;
  const parts = groupStr.toLowerCase().split('|').map(s=>s.trim());
  if(parts.length<2) return null;
  const dayPartToken = parts[0];
  const iobToken = parts[1];
  const day = correctionDayparts.find(dp=> dayPartToken.startsWith(dp.key));
  const row = correctionIobBands.find(band=>{
    if(band.key==='lt') return iobToken.includes('<0.5');
    if(band.key==='gt') return iobToken.includes('>1.5');
    return iobToken.includes('0.5-1.5');
  });
  if(!day || !row) return null;
  return {col: day.key, row: row.key};
}
const correctionGrid = {};
(correctionCtx.groups||[]).forEach(entry=>{
  const keys = parseCorrectionGroupKey(entry.group||'');
  if(!keys) return;
  if(!correctionGrid[keys.row]) correctionGrid[keys.row] = {};
  correctionGrid[keys.row][keys.col] = entry;
});
function hexToRgb(hex){
  const v = hex.replace('#','');
  return {
    r: parseInt(v.slice(0,2),16),
    g: parseInt(v.slice(2,4),16),
    b: parseInt(v.slice(4,6),16)
  };
}
function mixColors(start,end,t){
  const s = hexToRgb(start);
  const e = hexToRgb(end);
  const lerp = (a,b)=> Math.round(a + (b-a)*t);
  return `#${[lerp(s.r,e.r),lerp(s.g,e.g),lerp(s.b,e.b)].map(v=>v.toString(16).padStart(2,'0')).join('')}`;
}
function colorForDrop(val){
  if(val==null || Number.isNaN(val)) return '#f5f5f5';
  const capped = Math.max(-120, Math.min(120, val));
  if(capped>=0){
    return mixColors('#fefefe','#0b5cad', capped/120);
  }
  return mixColors('#fefefe','#d94801', Math.abs(capped)/120);
}
function dropGlyph(val, hours){
  // Show 0 with neutral styling when empty, not N/A
  if(val==null || Number.isNaN(val)) return `↓ 0 mg/dL`;
  const rounded = Math.round(val);
  if(rounded===0) return `Δ${hours}h 0`;
  return `${rounded>0?'↓':'↑'} ${Math.abs(rounded)} mg/dL`;
}
function heatmapCellOverlay(entry){
  // When no data, prefer a neutral '0 | 0%' instead of N/A to avoid alarming states
  if(!entry || entry.n==null) return '0 | 0%';
  const pct = entry.pctIneffective2h!=null ? Math.round(entry.pctIneffective2h) + '%' : '0%';
  return `${entry.n} | ${pct}`;
}
function buildHeatmapSvg(hours){
  const measureKey = hours===3 ? 'medDrop3h' : 'medDrop2h';
  const cols = correctionDayparts.length;
  const rows = correctionIobBands.length;
  // Slightly smaller base geometry for better fit on mobile; wrapper will allow horizontal scroll if still too wide
  const cellW = 120;
  const cellH = 78;
  const leftW = 140;
  const topH = 60;
  const width = leftW + cellW * cols;
  const height = topH + cellH * rows + 18;
  let headerTexts = '';
  correctionDayparts.forEach((dp,idx)=>{
    const x = leftW + idx*cellW + cellW/2;
    // Daypart label
    headerTexts += `<text x="${x}" y="28" text-anchor="middle" font-size="13" font-weight="600">${dp.label}</text>`;
    if(dp.window){
      headerTexts += `<text x="${x}" y="44" text-anchor="middle" font-size="10" fill="#666">${dp.window}</text>`;
    }
    // Pred ≤ suspend badge (avg for this daypart)
    const p = (daypartAvgPred && daypartAvgPred[dp.key]!=null) ? Math.round(daypartAvgPred[dp.key]) : null;
    const badgeFill = predBadgeColor(p);
    headerTexts += `<g><circle cx="${x}" cy="14" r="7" fill="${badgeFill}"/>${p!=null?`<text x="${x}" y="17" text-anchor="middle" font-size="9" fill="#fff">${p}</text>`:`<text x="${x}" y="17" text-anchor="middle" font-size="9" fill="#999">–</text>`}</g>`;
  });
  let rowLabels = '';
  correctionIobBands.forEach((band,idx)=>{
    const y = topH + idx*cellH + cellH/2;
    rowLabels += `<text x="${leftW-10}" y="${y}" text-anchor="end" font-size="12" font-weight="600">${band.label}</text>`;
  });
  let cells = '';
  correctionIobBands.forEach((band,rIdx)=>{
    correctionDayparts.forEach((dp,cIdx)=>{
      const entry = (correctionGrid[band.key]||{})[dp.key] || {};
      const dropVal = entry[measureKey];
      const fill = colorForDrop(dropVal);
      const x = leftW + cIdx*cellW + 6;
      const y = topH + rIdx*cellH + 6;
      const rectW = cellW - 12;
      const rectH = cellH - 14;
      const overlay = heatmapCellOverlay(entry);
      const dropText = dropGlyph(dropVal,hours);
      const textColor = (dropVal!=null && dropVal>50) ? '#fefefe' : '#1b1b1b';
      cells += `<g>`;
      cells += `<rect x="${x}" y="${y}" width="${rectW}" height="${rectH}" rx="12" fill="${fill}" stroke="#d4d4d4" stroke-width="0.6"/>`;
      cells += `<text x="${x+rectW/2}" y="${y+rectH/2-5}" text-anchor="middle" font-size="12" font-weight="600" fill="${textColor}">${dropText}</text>`;
      cells += `<text x="${x+rectW/2}" y="${y+rectH-10}" text-anchor="middle" font-size="10" fill="${textColor}" opacity="0.9">${overlay}</text>`;
      cells += `</g>`;
    });
  });
  // viewBox only — let CSS handle width:100%; height:auto
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Corrections heatmap ${hours}h"><style>text{font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;} .sentinel-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px}
 .sentinel-asof{font-size:12px;color:#555;margin-top:4px}
 .reliability-chips{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
 .reliability-chip{display:flex;flex-direction:column;gap:2px;padding:6px 10px;border-radius:10px;border:1px solid #e0e0e0;font-size:11px;min-width:130px;background:#fff}
 .reliability-chip span{color:#555;font-weight:500}
 .reliability-chip strong{font-size:15px;color:#111}
 .reliability-chip.low{background:#ecf9f1;border-color:#b4e3cf}
 .reliability-chip.med{background:#fff8e5;border-color:#f5d086}
 .reliability-chip.high{background:#fdecea;border-color:#fab1a0}
 .reliability-chip.muted{background:#f5f5f5;border-color:#ddd;color:#777}
 .spark-container{margin-top:12px}
 .spark-legend{display:flex;gap:16px;font-size:11px;color:#555;margin-top:6px}
 .spark-legend .pred{color:#0d6efd;font-weight:600}
 .spark-legend .comm{color:#f97316;font-weight:600}
 .corrections-card svg{width:100%;height:auto}
 .corrections-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px}
 .corrections-meta h3{margin:0}
 .heatmap-toggle{font-size:12px;color:#555}
 .heatmap-toggle strong{color:#0d6efd}
 .heatmap-toggle a{color:#0d6efd;font-weight:600;text-decoration:none}
 .heatmap-note{font-size:11px;color:#555;margin-top:6px}
 .card.corrections-card{flex:2 1 420px}

</style><text x="20" y="18" font-size="13" font-weight="600">Corrections lens · Median ${hours}h drop (mg/dL)</text>${headerTexts}${rowLabels}${cells}<text x="${leftW}" y="${height-6}" font-size="10" fill="#555">Overlay: n | %ineff2h (ineffective = &lt;20 mg/dL drop)</text></svg>`;
}
function writeHeatmap(hours){
  const svg = buildHeatmapSvg(hours);
  if(svg){
    fs.writeFileSync(path.join(distDir,`corr_heatmap_${hours}h.svg`), svg, 'utf8');
  }
}
writeHeatmap(2);
writeHeatmap(3);
function buildReliabilitySparkline(days){
  const series = (days||[]).slice(-14);
  if(!series.length) return '';
  const width = 420;
  const height = 120;
  const pad = {top:14,right:14,bottom:28,left:36};
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const xs = series.map((_,idx)=> series.length===1 ? pad.left + innerW/2 : pad.left + (idx/(series.length-1))*innerW);
  const predVals = series.map(d=> typeof d.pctPredLeSuspend==='number'? d.pctPredLeSuspend : null);
  const commVals = series.map(d=> typeof d.pctFailures==='number'? d.pctFailures : null);
  const allVals = predVals.concat(commVals).filter(v=> typeof v==='number');
  if(!allVals.length) return '';
  const maxVal = Math.max(35, Math.ceil(Math.max(...allVals)/5)*5);
  const scaleY = val => pad.top + innerH - (val/maxVal)*innerH;
  const pathFrom = vals=>{
    let d='';
    let penUp=true;
    vals.forEach((val,idx)=>{
      if(typeof val==='number'){
        const point = `${xs[idx].toFixed(1)},${scaleY(val).toFixed(1)}`;
        if(penUp){
          d += `M${point}`;
          penUp=false;
        }else{
          d += ` L${point}`;
        }
      }else{
        penUp=true;
      }
    });
    return d;
  };
  const predPath = pathFrom(predVals);
  const commPath = pathFrom(commVals);
  const baselineY = pad.top + innerH;
  const firstLabel = series[0].day || '';
  const lastLabel = series[series.length-1].day || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" aria-label="Reliability sparkline"><style>text{font-family: 'Inter', system-ui, -apple-system, sans-serif;}</style><line x1="${pad.left}" x2="${width-pad.right}" y1="${baselineY}" y2="${baselineY}" stroke="#e0e0e0" stroke-width="1"/>${predPath? `<path d="${predPath}" fill="none" stroke="#0d6efd" stroke-width="2" stroke-linecap="round"/>`:''}${commPath? `<path d="${commPath}" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round"/>`:''}<text x="${pad.left}" y="${height-8}" font-size="10" fill="#666">${firstLabel}</text><text x="${width-pad.right}" y="${height-8}" font-size="10" fill="#666" text-anchor="end">${lastLabel}</text></svg>`;
}
const reliabilitySparkSvgRaw = buildReliabilitySparkline(sentinelDays);
if(reliabilitySparkSvgRaw){
  fs.writeFileSync(path.join(distDir,'reliability_spark.svg'), reliabilitySparkSvgRaw, 'utf8');
}

// Day-of-week Pred≤suspend bar chart
function buildDayOfWeekSvg(days){
  const DOW_LABELS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const buckets={};
  (days||[]).forEach(d=>{
    if(!d.day||d.pctPredLeSuspend==null) return;
    const dt=new Date(d.day+'T12:00:00');
    const dow=dt.getDay();
    if(!buckets[dow]) buckets[dow]=[];
    buckets[dow].push(d.pctPredLeSuspend);
  });
  const avgs=DOW_LABELS.map((_,i)=>{ const vals=buckets[i]||[]; return vals.length? vals.reduce((s,v)=>s+v,0)/vals.length : null; });
  if(!avgs.some(v=>v!=null)) return '';
  const barW=38,gap=6,padLeft=30,padTop=22,padBottom=28,padRight=10,innerH=80;
  const totalW=padLeft+7*(barW+gap)-gap+padRight;
  const totalH=padTop+innerH+padBottom;
  const maxVal=Math.max(35,Math.ceil(Math.max(...avgs.filter(v=>v!=null))/5)*5);
  const refLineY=padTop+innerH-(10/maxVal)*innerH;
  let bars='',yTicks='';
  [10,20,Math.round(maxVal)].filter(v=>v<=maxVal).forEach(v=>{
    const yPos=padTop+innerH-(v/maxVal)*innerH;
    yTicks+=`<line x1="${padLeft-3}" x2="${padLeft}" y1="${yPos}" y2="${yPos}" stroke="#ccc" stroke-width="1"/><text x="${padLeft-5}" y="${yPos+3}" text-anchor="end" font-size="8" fill="#888">${v}</text>`;
  });
  DOW_LABELS.forEach((label,i)=>{
    const val=avgs[i];
    const x=padLeft+i*(barW+gap);
    const isWeekend=(i===0||i===6);
    if(val==null){
      bars+=`<rect x="${x}" y="${padTop+innerH-4}" width="${barW}" height="4" fill="#e0e0e0" rx="2"/><text x="${x+barW/2}" y="${padTop+innerH+14}" text-anchor="middle" font-size="9" fill="#aaa">${label}</text>`;
      return;
    }
    const barH=Math.max(4,(val/maxVal)*innerH);
    const y=padTop+innerH-barH;
    let fill='#1abc9c';
    if(val>=25) fill='#e74c3c';
    else if(val>=10) fill='#f39c12';
    const cn=avgs[i-1]!=null||avgs[i+1]!=null ? `(${buckets[i]?buckets[i].length:0}d)`:''; // sample count
    bars+=`<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${fill}" rx="3" opacity="${isWeekend?'1':'0.8'}" title="${label}: ${val.toFixed(1)}%"/>`;
    bars+=`<text x="${x+barW/2}" y="${y-4}" text-anchor="middle" font-size="9" fill="#333" font-weight="${val>=25?'700':'400'}">${Math.round(val)}%</text>`;
    bars+=`<text x="${x+barW/2}" y="${padTop+innerH+14}" text-anchor="middle" font-size="9" fill="${isWeekend?'#c0392b':'#444'}" font-weight="${isWeekend?'600':'400'}">${label}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" role="img" aria-label="Pred ≤ suspend by day of week (14-day averages)"><style>text{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}</style><text x="${padLeft}" y="14" font-size="10" font-weight="600" fill="#333">Pred ≤ suspend by day of week (14d avg)</text>${yTicks}<line x1="${padLeft}" x2="${totalW-padRight}" y1="${padTop+innerH}" y2="${padTop+innerH}" stroke="#e0e0e0" stroke-width="1"/><line x1="${padLeft}" x2="${totalW-padRight}" y1="${refLineY}" y2="${refLineY}" stroke="#1abc9c" stroke-width="1" stroke-dasharray="3,3" opacity="0.7"/><text x="${totalW-padRight-2}" y="${refLineY-2}" text-anchor="end" font-size="8" fill="#1abc9c">10%</text>${bars}</svg>`;
}
const dowPredSvgRaw = buildDayOfWeekSvg(sentinelDays);

// Day-of-week context annotation: latest day's actual vs historical DOW avg
function buildDowContextHtml(days){
  const DOW_LABELS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const buckets={};
  (days||[]).forEach(d=>{
    if(!d.day||d.pctPredLeSuspend==null) return;
    const dt=new Date(d.day+'T12:00:00');
    const dow=dt.getDay();
    if(!buckets[dow]) buckets[dow]=[];
    buckets[dow].push(d.pctPredLeSuspend);
  });
  const latest=(days||[]).length ? days[days.length-1] : null;
  if(!latest||latest.pctPredLeSuspend==null) return '';
  const latestDt=new Date(latest.day+'T12:00:00');
  const todayDow=latestDt.getDay();
  const todayVals=buckets[todayDow]||[];
  const dowAvg=todayVals.length ? todayVals.reduce((s,v)=>s+v,0)/todayVals.length : null;
  if(dowAvg==null) return '';
  const dowLabel=DOW_LABELS[todayDow];
  const actual=latest.pctPredLeSuspend;
  const diff=actual-dowAvg;
  const diffStr=(diff>0?'+':'')+Math.round(diff)+'pp vs '+dowLabel+' avg';
  const statusColor=Math.abs(diff)>6?'#b45309':'#059669';
  const isWeekend=todayDow===0||todayDow===6;
  const isMonday=todayDow===1;
  const context=isMonday?' · Mon is a behavioral transition day — carryover from weekend often elevates Pred≤suspend even with normal basal':(isWeekend?' · Weekend — elevated Pred≤suspend expected from unlogged carbs/behavioral disruption':'');
  return `<div style="font-size:11px;color:#444;margin-top:5px;padding:5px 9px;background:#f7f9fc;border-radius:6px;border:1px solid #dce8f7;line-height:1.5">📅 <strong>${esc(dowLabel)} (${esc(latest.day)}):</strong> <strong>${Math.round(actual)}%</strong> Pred≤suspend · ${esc(dowLabel)} 14d avg: <strong>${Math.round(dowAvg)}%</strong> (n=${todayVals.length} days) · <span style="color:${statusColor};font-weight:600">${diffStr}</span>${context}</div>`;
}
const dowContextHtml = buildDowContextHtml(sentinelDays);

const latestReliability = sentinelDays.length? sentinelDays[sentinelDays.length-1] : null;
function reliabilityLevel(value, ranges){
  if(value==null || Number.isNaN(value)) return 'muted';
  if((ranges.exclusiveHigh && value>ranges.high) || (!ranges.exclusiveHigh && value>=ranges.high)) return 'high';
  if(value>=ranges.med) return 'med';
  return 'low';
}
function reliabilityChip(label,value,ranges){
  const hasValue = typeof value==='number' && !Number.isNaN(value);
  const level = hasValue? reliabilityLevel(value,ranges) : 'muted';
  const text = hasValue? fmtPct(value) : 'n/a';
  return `<span class="reliability-chip ${level}"><span>${esc(label)}</span><strong>${esc(text)}</strong></span>`;
}
const reliabilityChipsHtml = latestReliability
  ? [
      reliabilityChip('Pred ≤ suspend · 24h', latestReliability.pctPredLeSuspend, {med:10, high:25}),
      reliabilityChip('Comm errors · 24h', latestReliability.pctFailures, {med:10, high:15, exclusiveHigh:true})
    ].join('')
  : '';


// School meal lens rows with new T→180 formatting
function formatT180(row){
  if(!row) return '—';
  const pctHigh = typeof row.pctHigh==='number'? row.pctHigh : null;
  if(pctHigh!==null && pctHigh<=0){ return '≤180'; }
  if(row.medianTimeTo180Min==null) return pctHigh===null? '—' : '>4h';
  return `${Math.round(row.medianTimeTo180Min)}m`;
}
function orderedBucketEntries(obj){
  const order = Array.isArray(mealTiming.leadBins)? mealTiming.leadBins: [];
  const seen = new Set();
  const list = [];
  order.forEach(bin=>{
    if(obj && obj[bin]){
      list.push([bin,obj[bin]]);
      seen.add(bin);
    }
  });
  Object.entries(obj||{}).forEach(([bin,val])=>{
    if(!seen.has(bin)) list.push([bin,val]);
  });
  return list;
}
function rowsFromBucket(label, obj){
  let out='';
  orderedBucketEntries(obj).forEach(([bin,v])=>{
    if(!v||!v.n) return;
    const startMed = (v.startBgMed!=null)? v.startBgMed : '—';
    const startIqr = (v.startBgIQR!=null)? v.startBgIQR : '—';
    const dPeakMed = (v.deltaPeakMed!=null)? v.deltaPeakMed : '—';
    const t180 = formatT180(v);
    const trend = v.startTrend? `${v.startTrend}${v.startTrendPct!=null? ' ('+v.startTrendPct+'%)':''}` : '—';
    out += `<tr><td>${esc(label)}</td><td>${esc(bin)}</td><td>${esc(v.n)}</td><td>${esc(startMed)}/${esc(startIqr)}</td><td>${esc(dPeakMed)}</td><td>${esc(t180)}</td><td>${esc(trend)}</td><td>${esc(v.pctHigh||0)}%</td><td>${esc(v.medianPeak||'')}</td></tr>`;
  });
  return out;
}
let schoolRows = '';
schoolRows += rowsFromBucket('Breakfast 7:00–8:00', mealTiming.schoolBreakfast||{});
schoolRows += rowsFromBucket('Lunch 11:20–12:10', mealTiming.schoolLunch||{});

let dinnerRows = rowsFromBucket('Dinner 17:30–20:00', mealTiming.dinner||{});
if(!dinnerRows){
  dinnerRows = '<tr><td colspan="9" class="muted">Not enough dinner data yet; log 3+ meals per bin for stats.</td></tr>';
}
function dinnerTakeaways(){
  const items = [];
  const rows = orderedBucketEntries(mealTiming.dinner||{}).map(([bin,data])=>({bin,data})).filter(r=>r.data && r.data.n);
  if(!rows.length) return '<li class="muted">No dinner meals met the filters this week.</li>';
  const totalN = rows.reduce((sum,r)=> sum + (r.data.n||0), 0);
  if(totalN){
    const weightedPct = rows.reduce((sum,r)=> sum + ((r.data.pctHigh||0)*(r.data.n||0)), 0) / totalN;
    items.push(`Dinner sample n=${totalN}; weighted %&gt;180 ≈${Math.round(weightedPct||0)}%.`);
  }
  const withPeak = rows.filter(r=> typeof r.data.medianPeak==='number').sort((a,b)=> (a.data.medianPeak||Infinity) - (b.data.medianPeak||Infinity));
  if(withPeak.length){
    items.push(`${esc(withPeak[0].bin)} dosing shows the lowest median peak (~${Math.round(withPeak[0].data.medianPeak)} mg/dL).`);
  }
  const withReturn = rows.filter(r=> typeof r.data.medianTimeTo180Min==='number').sort((a,b)=> (b.data.medianTimeTo180Min||0) - (a.data.medianTimeTo180Min||0));
  if(withReturn.length){
    items.push(`Return to 180 takes ~${Math.round(withReturn[0].data.medianTimeTo180Min)}m when ${esc(withReturn[0].bin)} (n=${withReturn[0].data.n}).`);
  }
  const withStart = rows.filter(r=> typeof r.data.startBgMed==='number').sort((a,b)=> (b.data.startBgMed||0) - (a.data.startBgMed||0));
  if(withStart.length){
    items.push(`Starts highest (~${Math.round(withStart[0].data.startBgMed)} mg/dL) when ${esc(withStart[0].bin)}; target temp before dinner if looping late.`);
  }
  if(!items.length) items.push('No strong dinner takeaways yet.');
  return items.map(t=>`<li>${t}</li>`).join('');
}
const dinnerTakeawaysHtml = dinnerTakeaways();

function formatLocalTs(ts){
  if(!ts) return null;
  const d = new Date(ts);
  if(Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit'});
  return fmt.format(d);
}
function experimentStatusClass(status){
  if(!status) return '';
  return status.toLowerCase().replace(/[^a-z0-9]+/g,'-');
}
// experiments section moved below after KPI and gating are defined

// Scenario helpers
const gatingState = (()=>{
  const pred = constraints.predictions && constraints.predictions.pctPredBelowSuspend;
  const ab = constraints.automaticBolus && constraints.automaticBolus.pctCyclesWithAB;
  const max = constraints.basal && constraints.basal.pctAtMaxBasal;
  function level(key,val){
    if(val==null) return {level:'unknown', word:'unknown', label:'n/a'};
    if(key==='pred'){
      if(val>=25) return {level:'high', word:'high', label:'High'};
      if(val>=10) return {level:'med', word:'moderate', label:'Medium'};
      return {level:'low', word:'low', label:'Low'};
    }
    if(key==='ab'){
      if(val>30) return {level:'high', word:'high', label:'High'};
      if(val>=15) return {level:'med', word:'moderate', label:'Medium'};
      return {level:'low', word:'low', label:'Low'};
    }
    if(key==='max'){
      if(val>=5) return {level:'high', word:'high', label:'High'};
      if(val>0) return {level:'med', word:'moderate', label:'Medium'};
      return {level:'low', word:'low', label:'Low'};
    }
    return {level:'unknown', word:'unknown', label:'n/a'};
  }
  return {
    pred: { value: pred, ...level('pred',pred), label: 'Pred ≤ suspend' },
    ab: { value: ab, ...level('ab',ab), label: 'AB cadence' },
    max: { value: max, ...level('max',max), label: 'Max basal hits' }
  };
})();

function gateChipHtml(key){
  const g = gatingState[key];
  if(!g || g.value==null) return '';
  const val = fmtPct(g.value);
  const tipMap = {
    pred: `Pred ≤ suspend (14d avg): ${val}. % of Loop cycles where the predicted glucose touches/crosses the suspend threshold. Green <10%: headroom for evaluating ISF/basal levers. Amber 10–25%: active constraint pressure — corrections may be gated, not ISF-limited. Red ≥25%: constraint-dominated; wait for headroom before making setting changes.`,
    ab: `AB cadence (14d avg): ${val}. % of Loop cycles with Automatic Bolus delivery. Green <15%: low algorithmic pressure. Amber 15–30%: Loop compensating frequently. Red >30%: high cadence — sustained high-glucose or Pred≤suspend pressure driving aggressive automated delivery.`,
    max: `Max basal hits (14d avg): ${val}. % of Loop cycles hitting the max basal rate cap. Green 0%: cap is not a binding constraint. Amber 0–5%: occasional cap hits. Red ≥5%: max basal ceiling is limiting delivery — raising it may help.`
  };
  return `<span class="gate-chip ${g.level}" title="${esc(tipMap[key]||g.label+': '+val)}"><span>${esc(g.label)}</span><strong>${esc(val)}</strong></span>`;
}
function gateChipRow(){
  return `<div class="gate-row">${['pred','ab','max'].map(gateChipHtml).join('')}</div>`;
}

const levelWord = {low:'low', med:'moderate', high:'high', unknown:'unknown'};
const riskOrder = {low:0, med:1, high:2, unknown:3};
function combinedRiskLevel(){
  if(gatingState.pred.level==='high' || gatingState.max.level==='high') return 'high';
  if(gatingState.pred.level==='med' || gatingState.max.level==='med') return 'med';
  return gatingState.pred.level==='unknown'? 'unknown':'low';
}

function optionRiskLevel(){
  return combinedRiskLevel();
}
function riskChip(level, tooltip){
  if(!level || level==='unknown') return '';
  const label = level==='med'? 'Med' : level.charAt(0).toUpperCase()+level.slice(1);
  return `<span class="risk-chip ${level}" title="${esc(tooltip||'Relative risk gate')}">${label}</span>`;
}

function linkHypothesisFor(card){
  const list = (review.cards||[]);
  const title = (card.title||'').toLowerCase();
  let match = null;
  if(title.includes('lunch')) match = list.find(h=> (h.window||'').toLowerCase().includes('lunch') || (h.title||'').toLowerCase().includes('post-lunch'));
  if(!match && (title.includes('correction')||title.includes('isf'))) match = list.find(h=> (h.title||'').toLowerCase().includes('correction') || (h.window||'').toLowerCase().includes('correction'));
  return match? match.title : '';
}

function optionsRankedFor(card){
  const predVal = constraints.predictions && constraints.predictions.pctPredBelowSuspend;
  const riskLevel = optionRiskLevel();
  const riskTooltip = `Risk gate: Pred ≤ suspend ${levelWord[gatingState.pred.level]} / Max basal ${levelWord[gatingState.max.level]}`;
  const baseRisk = {riskLevel, riskTooltip};
  const title = (card.title||'').toLowerCase();
  if(title.includes('lunch')||title.includes('school lunch')){
    return [
      {label:'+20 min pre-bolus', detail:'expect ↓↓↓ 4h TAR; higher predicted-low risk if carbs delayed', score:4, impact:'knocks down lunch TAR fastest', ...baseRisk},
      {label:'+10 min pre-bolus', detail:'expect ↓↓ 4h TAR; similar TBR; monitor predicted lows', score:3, impact:'reduces post-lunch peaks when on time', ...baseRisk},
      {label:'ICR stronger (directional)', detail:'expect ↓ peaks; validate with 3–5 logged lunches', score:2, impact:'trims peaks when timing is capped', ...baseRisk},
      {label:'ICR stronger (more aggressive)', detail:'larger effect; higher low risk; only if gentler shifts insufficient', score:1, impact:'is reserved if gentler shifts fail', ...baseRisk},
      {label:'Timing unchanged (baseline)', detail:'for comparison / logging control', score:0, impact:'keeps a baseline reference', ...baseRisk}
    ];
  }
  if(title.includes('correction')||title.includes('isf')){
    return [
      {label:'ISF stronger (directional)', detail:'↑↑ 2–3h drops; ↓ 90–180 min TAR; avoid stacking', score:3, impact:'cleans up stubborn corrections fastest', ...baseRisk},
      {label:'ISF slightly stronger (directional)', detail:'↑ 2–3h drops; ↓ TAR; monitor predicted lows', score:2, impact:'delivers moderate clean-up with less risk', ...baseRisk},
      {label:'As-is (baseline)', detail:'for comparison', score:1, impact:'keeps the status quo reference', ...baseRisk}
    ];
  }
  // fallback to generic options from card evidence if provided
  return (card.options||[]).map((opt,i)=>({label:opt, detail:'', score:(card.options.length-i), impact:'', ...baseRisk}));
}

function quickTakeFor(card, options){
  if(!options.length) return '';
  const top = options[0];
  const predWord = levelWord[gatingState.pred.level];
  const maxWord = levelWord[gatingState.max.level];
  const abWord = levelWord[gatingState.ab.level];
  const lead = top.label;
  const clause = gatingState.pred.level==='high'
    ? `Pred ≤ suspend pressure is ${predWord}`
    : `Pred ≤ suspend pressure is ${predWord}`;
  const suffix = gatingState.max.level==='high'
    ? 'max basal hits are frequent and we keep adjustments conservative'
    : gatingState.max.level==='med'
      ? 'max basal hits are creeping up, so levers stay off the basal cap'
      : 'max basal headroom stays open for timing/ISF moves';
  return `Quick take: ${clause} and AB cadence is ${abWord}, so ${lead} stays the lead lever because it ${top.impact||'balances impact and safety'} while ${suffix}.`;
}

function scenarioDetailsList(items){
  if(!items) return '<div class="muted">No data</div>';
  const clean = items.filter(it=>it);
  if(!clean.length) return '<div class="muted">No data</div>';
  return `<ul>${clean.map(it=>`<li>${esc(it)}</li>`).join('')}</ul>`;
}
function listify(val, fallback = []){
  if(Array.isArray(val)) return val;
  if(val) return [val];
  return fallback;
}

let scenarioCardsHtml='';
const actionablePool=[];
// Helper to build one-line context reason
function lunchWhyLine(){
  const L = mealTiming.schoolLunch||{};
  const a=L['pre0-4'], b=L['pre10-19'], c=L['pre>=20'];
  const n = [a,b,c].reduce((s,x)=> s + (x&&x.n||0),0);
  let line = `n=${n||0} lunches`;
  if(a&&b&&a.n&&b.n && a.pctHigh!=null && b.pctHigh!=null){
    const d = Math.round((b.pctHigh||0)-(a.pctHigh||0));
    line += `; pre10–19 vs pre0–4: ${d>0? '+'+d:d} pp %>180`;
  }
  if(a&&c&&a.n&&c.n && a.pctHigh!=null && c.pctHigh!=null){
    const d2 = Math.round((c.pctHigh||0)-(a.pctHigh||0));
    line += `; pre≥20 vs pre0–4: ${d2>0? '+'+d2:d2} pp`;
  }
  return line;
}
function corrCell(rowKey='lt', colKey='midday'){
  const g=(correctionGrid[rowKey]||{})[colKey]; return g||null;
}
function corrWhyLine(){
  const g=corrCell('lt','midday');
  if(!g) return 'No context available';
  const n=g.n||0; const ine=Math.round(g.pctIneffective2h||0); const d= g.medDrop2h!=null? Math.round(g.medDrop2h): null;
  return `n=${n} · ineffect2h ${ine}% · med 2h ${d!=null?(d>0? 'drop '+d: 'rise '+Math.abs(d)):'n/a'} mg/dL`;
}
// Build just two default scenario cards
(function(){
  // 1) Lunch timing (+10/+20)
  const lunchCard = (scenarios.cards||[]).find(c=> (c.title||'').toLowerCase().includes('lunch'));
  if(lunchCard){
    const options = optionsRankedFor(lunchCard);
    if(options.length){ actionablePool.push({cardTitle:lunchCard.title, option: options[0]}); }
    const link = linkHypothesisFor(lunchCard);
    const levers = (lunchCard.levers||[]).join(', ');
    const compactList = options.slice(0,2).map(o=>`<li><span class="option-label">${esc(o.label)}</span> — ${esc(o.detail)} ${riskChip(o.riskLevel,o.riskTooltip)}</li>`).join('');
    const expandedList = options.map(o=>`<li><span class="option-label">${esc(o.label)}</span> — ${esc(o.detail)} ${riskChip(o.riskLevel,o.riskTooltip)}</li>`).join('');
    // Advanced: show other meal windows (breakfast/dinner) bins for context
    function advancedMealsHtml(){
      const parts=[];
      function listWin(name,obj){
        const pairs = orderedBucketEntries(obj||{}).filter(([bin,v])=> v&&v.n).map(([bin,v])=> `${esc(bin)}: n=${v.n}, %>180 ${Math.round(v.pctHigh||0)}%`);
        if(pairs.length) parts.push(`<div><strong>${esc(name)}</strong><ul>${pairs.map(p=>`<li>${p}</li>`).join('')}</ul></div>`);
      }
      listWin('School lunch', mealTiming.schoolLunch||{});
      listWin('Breakfast', mealTiming.schoolBreakfast||{});
      listWin('Dinner', mealTiming.dinner||{});
      return parts.join('') || '<div class="muted">No additional meal bins.</div>';
    }
    scenarioCardsHtml += `<article class="scenario-card">
      <header>
        <div>
          <h4>${esc(lunchCard.title)}</h4>
          ${link? `<div class="scenario-link">Linked hypothesis: ${esc(link)}</div>`:''}
          <div class="scenario-context">${esc(lunchCard.timeWindow||'')}</div>
          <div class="scenario-meta">Lever(s): ${esc(levers)} · Direction: ${esc(lunchCard.direction||'')} · Confidence: ${esc(lunchCard.confidence||'')}</div>
          <div class="muted">Why this context: ${esc(lunchWhyLine())}</div>
        </div>
        ${gateChipRow()}
      </header>
      <div class="view view-compact">
        <ol>${compactList}</ol>
      </div>
      <div class="view view-expanded">
        <ol>${expandedList}</ol>
        <details>
          <summary>Advanced</summary>
          ${advancedMealsHtml()}
        </details>
      </div>
    </article>`;
  }
  // 2) Corrections — Midday (11–13), IOB<0.5 (merge IOB: default only shows low IOB)
  const corrCard = (scenarios.cards||[]).find(c=> (c.title||'').toLowerCase().includes('corrections'));
  if(corrCard){
    const options = optionsRankedFor(corrCard);
    if(options.length){ actionablePool.push({cardTitle:corrCard.title, option: options[0]}); }
    const link = linkHypothesisFor(corrCard);
    const levers = (corrCard.levers||[]).join(', ');
    const compactList = options.slice(0,3).map(o=>`<li><span class="option-label">${esc(o.label)}</span> — ${esc(o.detail)} ${riskChip(o.riskLevel,o.riskTooltip)}</li>`).join('');
    const expandedList = options.map(o=>`<li><span class="option-label">${esc(o.label)}</span> — ${esc(o.detail)} ${riskChip(o.riskLevel,o.riskTooltip)}</li>`).join('');
    // Advanced: show other dayparts/IOB buckets except 'other'
    function advancedCorrectionsHtml(){
      const parts=[];
      correctionIobBands.forEach(band=>{
        const row=(correctionGrid[band.key]||{});
        const items = correctionDayparts.filter(dp=> dp.key!=='other').map(dp=>{
          const g=row[dp.key]; if(!g||!g.n) return null;
          return `<li>${esc(dp.label)} · ${esc(band.label)} — n=${g.n}, ineffect2h ${Math.round(g.pctIneffective2h||0)}%</li>`;
        }).filter(Boolean);
        if(items.length) parts.push(`<div><strong>${esc(band.label)}</strong><ul>${items.join('')}</ul></div>`);
      });
      return parts.join('') || '<div class="muted">No additional correction contexts.</div>';
    }
    scenarioCardsHtml += `<article class="scenario-card">
      <header>
        <div>
          <h4>Corrections — Midday (11–13), IOB <0.5</h4>
          ${link? `<div class="scenario-link">Linked hypothesis: ${esc(link)}</div>`:''}
          <div class="scenario-context">${esc(corrCard.timeWindow||'Midday')} · Low IOB default</div>
          <div class="scenario-meta">Lever(s): ${esc(levers)} · Direction: ${esc(corrCard.direction||'')} · Confidence: ${esc(corrCard.confidence||'')}</div>
          <div class="muted">Why this context: ${esc(corrWhyLine())}</div>
        </div>
        ${gateChipRow()}
      </header>
      <div class="view view-compact">
        <ol>${compactList}</ol>
      </div>
      <div class="view view-expanded">
        <ol>${expandedList}</ol>
        <details>
          <summary>Advanced</summary>
          ${advancedCorrectionsHtml()}
        </details>
      </div>
    </article>`;
  }
})();

function renderMostActionable(){
  if(gatingState.pred.level==='high'){
    const val = gatingState.pred.value!=null? fmtPct(gatingState.pred.value) : 'n/a';
    return `<div class="card most-actionable"><strong>Most actionable (paused)</strong><div class="muted">Pred ≤ suspend is high (${val}); wait for safer headroom before surfacing changes.</div></div>`;
  }
  const picks = actionablePool
    .filter(p=>p && p.option)
    .sort((a,b)=> (b.option.score||0)-(a.option.score||0) || riskOrder[a.option.riskLevel]-riskOrder[b.option.riskLevel])
    .slice(0,2);
  if(!picks.length){
    return `<div class="card most-actionable"><strong>Most actionable</strong><div class="muted">No scenario options ready.</div></div>`;
  }
  const items = picks.map(p=>`<div class="ma-item"><span class="ma-card">${esc(p.cardTitle)}</span><span class="ma-arrow">→</span><span class="ma-option">${esc(p.option.label)}</span>${riskChip(p.option.riskLevel,p.option.riskTooltip)}</div>`).join('');
  return `<div class="card most-actionable"><strong>Most actionable</strong><div class="ma-list">${items}</div></div>`;
}
const mostActionableHtml = renderMostActionable();
// What to check today: last 24h possible missed‑carb times + weakest correction cells
const whatToCheckHtml = (()=>{
  try{
    const nowMs = Date.now();
    const last24 = nowMs - 24*3600*1000;
    const pts = latestEntries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date|| (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.mg==='number'&&typeof x.ms==='number'&& x.ms>=last24).sort((a,b)=>a.ms-b.ms);
    const carbs = latestTreats.filter(t=> typeof t.carbs==='number' && t.carbs>0).map(t=> t.mills || (t.created_at? Date.parse(t.created_at): (t.createdAt? Date.parse(t.createdAt): undefined))).filter(ms=> typeof ms==='number');
    function carbNear(ms){ return carbs.find(ct=> ct>= ms - 15*60000 && ct<= ms + 10*60000); }
    const cands=[]; for(let i=0;i<pts.length;i++){ const s=pts[i]; const win=pts.filter(p=> p.ms>s.ms && p.ms<= s.ms + 60*60000); if(!win.length) break; const rise=Math.max(...win.map(p=>p.mg - s.mg)); if(rise>=50 && !carbNear(s.ms)){ cands.push({ms:s.ms, rise:Math.round(rise)}); i+=6; } }
    cands.sort((a,b)=> b.rise-a.rise); const top=cands.slice(0,3);
    const f=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
    function fmt(ms){ return f.format(new Date(ms)); }
    const worst=(correctionCtx.groups||[]).filter(g=> (g.n||0)>=15).slice().sort((a,b)=> (b.pctIneffective2h||0)-(a.pctIneffective2h||0)).slice(0,2);
    function label(g){ const m=(g.group||'').split('|').map(s=>s.trim()); return `${m[0]} · ${m[1]}`; }
    // Build lines
    const lines=[];
    if(top.length){
      top.forEach(m=> lines.push(`Possible missed carbs around ${fmt(m.ms)} (rise ~${m.rise} mg/dL)`));
    } else {
      lines.push('No strong missed‑carb rises in the last 24h.');
    }
    if(worst.length){
      worst.forEach(w=> lines.push(`Weak corrections in ${label(w)} — n=${w.n}, ${Math.round(w.pctIneffective2h||0)}% ineffective @2h`));
    }
    function todayChip(text){
      if(/^possible missed carbs/i.test(text)) return {label:'Missed carb', cls:'missed'};
      if(/^weak corrections/i.test(text)) return {label:'Correction', cls:'correction'};
      if(/low|hypo/i.test(text)) return {label:'Hypo risk', cls:'hypo'};
      return null;
    }
    const lis = lines.map(it=>{ const chip=todayChip(it); const chipHtml = chip? `<span class=\"today-chip today-chip--${chip.cls}\">${chip.label}</span>`: ''; const cls = /No strong missed/.test(it)? ' class=\"muted\"': '' ; return `<li${cls}>${chipHtml}${it}</li>`; }).join('');
    return `<div class=\"card\"><h3>What to check today</h3><ul>${lis}</ul><div class=\"muted\">Directional cues only. If a missed‑carb aligns with real food, consider earlier logging/timing. For weak corrections, try clean trials in those contexts (avoid stacking; watch predicted‑lows).</div></div>`;
  }catch{ return ''; }
})();

// Dawn-effect anomaly callout (auto-triggers when morning IOB>1.5 is >=40pp more ineffective than overnight)
const dawnEffectCardHtml = (()=>{
  try{
    const mGt=(correctionGrid['gt']||{}).morning, oGt=(correctionGrid['gt']||{}).overnight;
    if(!mGt||!oGt) return '';
    const mI=mGt.pctIneffective2h, oI=oGt.pctIneffective2h;
    const mN=mGt.n||0, oN=oGt.n||0;
    if(mN<8||oN<5||mI==null||oI==null) return '';
    const gap=mI-oI;
    if(gap<40) return '';
    return `<div class="card" style="border-left:4px solid #7c3aed;margin-bottom:10px"><strong style="color:#7c3aed">⚠ Morning anomaly — dawn-effect resistance</strong><div style="font-size:12px;margin-top:6px;line-height:1.5">Morning IOB&gt;1.5: <strong>${Math.round(mI)}% ineffective</strong> (n=${mN}) vs Overnight IOB&gt;1.5: <strong>${Math.round(oI)}% ineffective</strong> (n=${oN}) — gap of <strong>${Math.round(gap)}pp</strong>. Even at high IOB where Loop delivers freely, morning corrections fail far more than overnight — this is inconsistent with a constraint or ISF explanation and points to <strong>physiological dawn-effect insulin resistance</strong> (cortisol/GH surge 03:00–07:00, not addressable by a single ISF change).</div><div class="muted" style="margin-top:4px">Do not act on this until Q5 (overnight basal) is stable. Accumulate fasting morning corrections (no breakfast bolus ±2h, no constraint active) before drawing conclusions.</div></div>`;
  }catch{return ''}
})();

// ISF 14:00–16:30 experiment null card — standalone prominent alert when experiment is ≥90% constraint-gated
// (Analyst 04/20 + Researcher 04/20 explicitly request this as a Code action)
const isfExperimentNullCardHtml = (()=>{
  try{
    const isf=(correctionCtx&&correctionCtx.experiments&&correctionCtx.experiments.isfRun)||null;
    if(!isf||!isf.recent) return '';
    const isfPred=isf.recent.pctPredLeSuspend0_180;
    if(isfPred==null||isfPred<90) return '';
    const n=isf.recent.n||'?';
    const win=isf.window||'14:00–16:30';
    const med2=isf.recent.medDrop2h!=null?Math.round(isf.recent.medDrop2h):null;
    return `<div class="card" style="border-left:4px solid #dc2626;background:#fef2f2;margin-bottom:10px"><strong style="color:#dc2626">🚫 ISF Experiment NULL — Redesign Required</strong> <span style="font-size:11px;color:#666;font-weight:normal">(${esc(win)})</span><div style="font-size:12px;margin-top:8px;line-height:1.65"><strong>Pred≤suspend during window: ${Math.round(isfPred)}%</strong> (n=${n} correction events) — every event in this window is constraint-gated. Loop is withholding delivery on all observed correction opportunities; no usable ISF signal can be extracted.<br><br>Root cause: midday unlogged meals likely drive glucose forecasts high, triggering Pred≤suspend through the afternoon and fully confounding this window. This is not an ISF measurement — it is a constraint measurement.<br><br><strong>Recommended next step:</strong> Shift clean-trial evaluation to the <em>Evening window (17:00–20:00)</em> using the protocol card below. Per Researcher 2026-04-20: target IOB 0.5–1.5, no food ±2h, Pred≤suspend NOT active at correction time, target ≥3 clean trials before drawing ISF direction conclusions.</div></div>`;
  }catch{return ''}
})();

// Evening ISF clean-trial protocol card (Q3 · Q10 — explicitly requested by Analyst/Researcher 04/20)
const eveningProtocolCardHtml = (()=>{
  try{
    const eMid=(correctionGrid['mid']||{}).evening||{};
    if(!eMid.n) return '';
    const pctI=eMid.pctIneffective2h!=null?Math.round(eMid.pctIneffective2h):null;
    const med2=eMid.medDrop2h!=null?Math.round(eMid.medDrop2h):null;
    const isf=(correctionCtx.experiments&&correctionCtx.experiments.isfRun)||null;
    const isfN=isf&&isf.recent?(isf.recent.n||'?'):'?';
    const isfPred=isf&&isf.recent?isf.recent.pctPredLeSuspend0_180:null;
    const nullMsg=(isfPred!=null&&isfPred>=100)?`🚫 ISF +10% · 14:00–16:30: NULL — 100% Pred≤suspend-gated (n=${isfN}). Zero usable ISF signal; redesign or abandon this window.`:'';
    const lvl=pctI!=null?(pctI>=75?'high':(pctI>=50?'med':'low')):'muted';
    const med2Lvl=med2!=null&&med2>0?'low':'high';
    return `<div class="card" style="border-left:4px solid #0891b2;margin-bottom:10px"><strong style="color:#0891b2">Evening ISF Clean-Trial Protocol</strong> <span style="font-weight:normal;font-size:11px;color:#555">(Q3 · Q10) · 17:00–20:00 CT · IOB 0.5–1.5 · No food ±2h · Pred≤suspend NOT active at correction time</span><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><span class="reliability-chip ${lvl}"><span>Evening IOB 0.5–1.5 baseline (n)</span><strong>${eMid.n}</strong></span><span class="reliability-chip ${lvl}"><span>%ineffective @2h</span><strong>${pctI!=null?pctI+'%':'n/a'}</strong></span><span class="reliability-chip ${med2Lvl}"><span>Median 2h Δ</span><strong>${med2!=null?(med2>0?'↓ '+med2:'↑ '+Math.abs(med2))+' mg/dL':'n/a'}</strong></span><span class="reliability-chip muted"><span>Clean trials target</span><strong>≥ 3</strong></span></div><div style="font-size:12px;line-height:1.6;margin-top:8px"><strong>Success criteria:</strong><br>≥2/3 clean trials Δ@2h &gt;20 mg/dL → <span style="color:#0891b2">constraints are the bottleneck</span> (ISF adequate).<br>≥2/3 clean trials Δ@2h &lt;20 mg/dL → <span style="color:#d97706">ISF-too-weak hypothesis gains weight</span> (discuss with clinician before any setting change).</div>${nullMsg?`<div style="margin-top:8px;padding:6px 10px;background:#fef3c7;border-radius:6px;font-size:11px">${esc(nullMsg)}</div>`:''}</div>`;
  }catch{return ''}
})();

// Scenario section shell with toggle controls
const scenarioSectionHtml = `<div class="scenario-shell">
  <input type="radio" name="scenario-mode" id="scenario-compact" checked>
  <input type="radio" name="scenario-mode" id="scenario-expanded">
  <div class="scenario-header">
    <h3>Scenario Cards</h3>
    <div class="scenario-toggle">
      <label for="scenario-compact">Compact</label>
      <label for="scenario-expanded">Expanded</label>
    </div>
  </div>
  <div class="scenario-cards">
    ${scenarioCardsHtml || '<div class="muted">No cards available.</div>'}
  </div>
  <div class="scenario-legend">Legend: Chips show Pred ≤ suspend (green <10%, amber 10–25%, red ≥25%), AB cadence (<15%, 15–30%, >30%), and Max basal hits (0%, 0–5%, ≥5%). Risk chips align with the same color scale.</div>
</div>`;

// Embed SVGs
function readSvg(name){ try { return fs.readFileSync(path.join(distDir,name),'utf8'); } catch { return ''; } }
function ensureA11y(raw,label){ if(!raw) return raw; return raw.replace('<svg','<svg role="img" aria-label="'+label.replace(/"/g,'&quot;')+'"'); }
const agpSvg = ensureA11y(readSvg('agp.svg'),'AGP: daily median with 25–75% and 5–95% bands, target 70–180 mg/dL');
const griHourlySvg = ensureA11y(readSvg('gri_hourly.svg'),'Hourly risk: LBGI (hypo, purple) and HBGI (hyper, orange)');
const corrHeatmap2hSvg = ensureA11y(readSvg('corr_heatmap_2h.svg'),'Corrections heatmap: median 2h change by daypart and IOB band');
const reliabilitySparkSvg = ensureA11y(readSvg('reliability_spark.svg'),'Reliability sparkline: Pred ≤ suspend and Comm errors (14 days)');
const corrHeatmap3hHref = '../dist/corr_heatmap_3h.svg?v='+ver;
const reliabilityChipsBlock = reliabilityChipsHtml || '<div class="muted">No 24h data</div>';
const reliabilitySparkBlock = reliabilitySparkSvg
  ? `<div class="spark-container">${reliabilitySparkSvg}<div class="spark-legend"><span class="pred">Pred ≤ suspend</span><span class="comm">Comm errors</span></div></div>`
  : '<div class="spark-container muted">Reliability sparkline unavailable</div>';
// Hourly reliability stripe (last 7d)
function buildHourlyStripe(hourly){
  const data = Array.isArray(hourly)? hourly: [];
  if(!data.length) return '';
  const width = 520, height = 38; // two rows
  const padL=8, padR=8;
  const cols = 24;
  const colW = (width - padL - padR) / cols;
  const maxPred = Math.max(25, ...data.map(d=> d.pctPredLeSuspend||0));
  const maxComm = Math.max(20, ...data.map(d=> d.pctFailures||0));
  const scaleY = (v,max)=> Math.max(2, Math.round((v/(max||1))*14));
  let rectsPred='', rectsComm='';
  data.forEach((d,i)=>{
    const x = Math.round(padL + i*colW) + 0.5;
    const h1 = scaleY(d.pctPredLeSuspend||0, maxPred);
    const h2 = scaleY(d.pctFailures||0, maxComm);
    rectsPred += `<rect x="${x}" y="2" width="${Math.max(2,Math.floor(colW-2))}" height="${h1}" fill="#0d6efd" opacity="0.85" rx="1"/>`;
    rectsComm += `<rect x="${x}" y="${22 - h2}" width="${Math.max(2,Math.floor(colW-2))}" height="${h2}" fill="#f97316" opacity="0.9" rx="1"/>`;
  });
  return `<div class="sub-bar" title="Hourly reliability (last 7d)"><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="Hourly reliability (last 7 days)"><style>text{font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif}</style>${rectsPred}${rectsComm}<text x="${padL}" y="14" font-size="9" fill="#666">Pred ≤ suspend</text><text x="${padL}" y="34" font-size="9" fill="#666">Comm errors</text><text x="${width-padR}" y="34" font-size="9" fill="#666" text-anchor="end">0–23h</text></svg></div>`;
}
const hourlyStripeBlock = buildHourlyStripe((overlay && overlay.hourly)||[]);
const correctionsHeatmapBlock = corrHeatmap2hSvg || '<div class="muted">Corrections heatmap unavailable</div>';
// Midday corrections tracker (11–13), contrasts 2h vs 3h and flags rebound
const middayTrackerBlock = (()=>{
  try{
    const lt = (correctionGrid['lt']||{}).midday || null;
    const mid = (correctionGrid['mid']||{}).midday || null;
    if(!lt && !mid) return '';
    function cell(g){ if(!g||!g.n) return null; const d2 = (g.medDrop2h!=null? Math.round(g.medDrop2h): null); const d3 = (g.medDrop3h!=null? Math.round(g.medDrop3h): null); const reb = (d2!=null && d3!=null) ? (d3 < d2) : false; const ine = g.pctIneffective2h!=null? Math.round(g.pctIneffective2h): null; return {n:g.n,d2,d3,reb,ine}; }
    const a = cell(lt), b = cell(mid);
    function chip(label,c){ if(!c) return `<span class="exp-chip muted"><span>${label}</span><strong>n/a</strong></span>`; const r = c.reb? 'high':'low'; return `<span class="exp-chip ${r}"><span>${label}</span><strong>${c.d2!=null?('Δ2h '+(c.d2>0?'↓ '+c.d2:'↑ '+Math.abs(c.d2))):'Δ2h n/a'} · ${c.d3!=null?('Δ3h '+(c.d3>0?'↓ '+c.d3:'↑ '+Math.abs(c.d3))):'Δ3h n/a'} · n=${c.n}${c.ine!=null?' · '+c.ine+'% ineffect2h':''}</strong></span>`; }
    const note = '<div class="muted" style="font-size:11px;margin-top:4px">Rebound = 3h drop smaller than 2h (or rise by 3h). Treat as directional; avoid stacking; verify carb logging.</div>';
    return `<div class="card" style="margin-top:10px"><h4 style="margin:0 0 6px">Midday corrections tracker</h4><div class="exp-chips">${chip('IOB <0.5',a)}${chip('IOB 0.5–1.5',b)}</div>${note}</div>`;
  }catch{return ''}
})();

// KPI chip strip (TIR/TBR/TAR, CV, GRI) with optional deltas vs prior window
function sum(obj, keys){ return keys.reduce((a,k)=> a + (obj[k]||0), 0); }
function pct(part,total){ if(!total) return 0; return +(100*part/total).toFixed(0); }
const tirCounts = metrics.tir || {};
const totalReadings = (metrics.meta&&metrics.meta.count)|| sum(tirCounts, ['veryLow','low','inRange','high','veryHigh']);
const nowVals = {
  TIR: pct(tirCounts.inRange||0, totalReadings),
  TBR: pct(sum(tirCounts,['veryLow','low']), totalReadings),
  // Note: metrics.tir.high already INCLUDES veryHigh (>250). Do not add veryHigh again.
  // TAR uses both high and veryHigh bins (>180 includes >250)
  TAR: pct(sum(tirCounts,['high','veryHigh']), totalReadings),
  CV: (metrics.cv!=null? +(+metrics.cv).toFixed(1): null),
  GRI: (metrics.risk&&metrics.risk.GRI!=null? +(+metrics.risk.GRI).toFixed(2): null)
};
// Try to load prior metrics from a conventional file name if present
const priorMetrics = load(path.join(dataDir,'metrics_digest_prev.json')) || load(path.join(dataDir,'metrics_prev.json')) || null;
let priorVals = null;
if(priorMetrics){
  const pTir = priorMetrics.tir||{};
  const pTotal = (priorMetrics.meta&&priorMetrics.meta.count)|| sum(pTir,['veryLow','low','inRange','high','veryHigh']);
  priorVals = {
    TIR: pct(pTir.inRange||0, pTotal),
    TBR: pct(sum(pTir,['veryLow','low']), pTotal),
    TAR: pct(sum(pTir,['high','veryHigh']), pTotal),
    CV: (priorMetrics.cv!=null? +(+priorMetrics.cv).toFixed(1): null),
    GRI: (priorMetrics.risk&&priorMetrics.risk.GRI!=null? +(+priorMetrics.risk.GRI).toFixed(2): null)
  };
}
function deltaStr(now, prev, unit='%'){
  if(now==null || prev==null) return '';
  const d = +(now - prev).toFixed(unit==='%'?0: (unit==='mg/dL'?0:2));
  const sign = d>0? '+': (d<0? '−':'');
  const abs = Math.abs(d);
  return ` <span class="delta" title="vs prior">(${sign}${abs}${unit==='%'?'':''})</span>`;
}
function chip(label, value, prev, unit){
  const text = (value==null)? 'n/a' : (unit==='%'? `${value}%` : `${value}`);
  const d = deltaStr(value, prev, unit);
  return `<div class="kpi-chip"><span class="kpi-label">${label}</span><span class="kpi-value">${text}${d||''}</span></div>`;
}
const kpiStripHtml = `<div class="kpi-strip">${[
  chip('TIR', nowVals.TIR, priorVals&&priorVals.TIR, '%'),
  chip('TBR', nowVals.TBR, priorVals&&priorVals.TBR, '%'),
  chip('TAR (incl. >250)', nowVals.TAR, priorVals&&priorVals.TAR, '%'),
  chip('CV', nowVals.CV, priorVals&&priorVals.CV, ''),
  chip('GRI', nowVals.GRI, priorVals&&priorVals.GRI, '')
].join('')}<div class=\"kpi-meta\">Coverage: ${metrics.meta&&metrics.meta.coverage?(metrics.meta.coverage*100).toFixed(0):'0'}%</div></div>
<div class=\"kpi-legend muted\" title=\"See memory/shared/definitions.md\">Note: TAR includes Very High (>250). Sums can exceed 100%. Exclusive bins planned next build.</div>`;

// Experiments: restored v0 formatting with chips
function formatChip(label, value, unit='%'){
  const text = (value==null)? 'n/a' : (unit==='%'? fmtPct(value) : String(value));
  return `<span class="exp-chip"><span>${esc(label)}</span><strong>${esc(text)}</strong></span>`;
}
function renderExperimentItem(exp){
  if(!exp) return '';
  const status = exp.status? `<span class="exp-status ${experimentStatusClass(exp.status)}">${esc(exp.status)}</span>`:'';
  const header = `<div class="exp-item-head"><div class="exp-head-left"><strong>${esc(exp.title||'Untitled')}</strong>${status}</div></div>`;
  const goal = exp.goal? `<div class="exp-goal">${esc(exp.goal)}</div>`:'';
  const metric = exp.metric? `<div class="exp-metric">Metric: ${esc(exp.metric)}</div>`:'';
  const metaParts = [];
  if(exp.window) metaParts.push(exp.window);
  if(exp.startDate) metaParts.push(`Start ${esc(exp.startDate)}`);
  if(exp.endDate || exp.plannedEndDate) metaParts.push(`End ${esc(exp.endDate||exp.plannedEndDate)}`);
  if(exp.owner) metaParts.push(`Owner ${esc(exp.owner)}`);
  const meta = metaParts.length? `<div class="exp-meta">${metaParts.join(' · ')}</div>`:'';
  const chips = [
    formatChip('TBR', nowVals.TBR, '%'),
    formatChip('TAR', nowVals.TAR, '%'),
    formatChip('Pred ≤ suspend', gatingState.pred && gatingState.pred.value),
    formatChip('AB cadence', gatingState.ab && gatingState.ab.value),
    formatChip('CV', nowVals.CV, ''),
    formatChip('GRI', nowVals.GRI, '')
  ].join('');
  const chipRow = `<div class="exp-chips">${chips}</div>`;
  const tags = Array.isArray(exp.tags) && exp.tags.length
    ? `<div class="exp-tags">${exp.tags.map(tag=>`<span class="exp-tag">${esc(tag)}</span>`).join('')}</div>`
    : '';
  const notes = exp.notes? `<div class="exp-notes">${esc(exp.notes)}</div>`:'';
  return `<li>${header}${goal}${metric}${meta}${chipRow}${tags}${notes}</li>`;
}
function renderExperimentList(list, emptyText){
  if(!Array.isArray(list) || !list.length) return `<li class="muted">${esc(emptyText)}</li>`;
  return list.map(renderExperimentItem).join('');
}
const experimentsActiveListHtml = renderExperimentList(experiments.active, 'No active experiments yet — tag an option to start.');
const experimentsPastListHtml = renderExperimentList(experiments.past, 'No past experiments logged.');
const experimentsUpdatedStr = formatLocalTs(experiments.updatedAt);

// Build stats + input hash
const buildStart = Date.now();
function fileSig(p){ try { const st=fs.statSync(p); return `${path.basename(p)}:${st.size}:${+st.mtime}`; } catch { return `${path.basename(p)}:na`; } }
const inputsForHash = [
  path.join(dataDir,'metrics_digest.json'),
  path.join(dataDir,'review_summary.json'),
  path.join(dataDir,'overlay_daily.json'),
  path.join(dataDir,'meal_timing_analysis.json'),
  path.join(dataDir,'ns_profile_latest.json'),
  path.join(dataDir,'correction_context.json')
];
const sigConcat = inputsForHash.map(fileSig).join('|');
const hash = require('crypto').createHash('sha1').update(sigConcat).digest('hex').slice(0,12);
const buildElapsedMs = ()=> (Date.now()-buildStart);

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
<meta http-equiv="Pragma" content="no-cache" />
<meta http-equiv="Expires" content="0" />
<title>Loop Digest Dashboard</title>
<style>
 body{font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:20px;background:#fafafa;color:#222}
 h1{font-size:20px;margin:0 0 8px}
 .row{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px}
 .card{border:1px solid #ddd;border-radius:10px;padding:12px;background:#fff;flex:1;min-width:280px;box-shadow:0 1px 2px rgba(0,0,0,0.04)}
 table{border-collapse:collapse;width:100%;font-size:12px}
 th,td{border-bottom:1px solid #eee;padding:6px 8px;text-align:left;vertical-align:top}
 small,.muted{color:#666;font-size:12px}
 .strip{font-size:11px;color:#444;margin:2px 0 10px}
 .header{background:#f7f7f7;border:1px solid #eee;border-radius:8px;padding:8px;margin:6px 0 10px}
 img,svg{max-width:100%;height:auto}
 .pill{display:inline-block;min-width:24px;padding:2px 6px;border-radius:999px;font-size:11px;color:#fff;text-align:center}
 .pill.green{background:#1abc9c}.pill.orange{background:#f39c12}.pill.red{background:#e74c3c}
 .pill.muted{background:#95a5a6}
 .gate-row{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-top:4px}
 .gate-chip{display:flex;flex-direction:column;align-items:flex-start;border-radius:8px;padding:4px 6px;font-size:10px;line-height:1;border:1px solid #ddd;min-width:90px}
 .gate-chip span{color:#555;font-weight:500}
 .gate-chip strong{font-size:13px;color:#111}
 .gate-chip.low{background:#ecf9f1;border-color:#a3e6c3}
 .gate-chip.med{background:#fff8e5;border-color:#f5d086}
 .gate-chip.high{background:#fdecea;border-color:#fab1a0}
 .scenario-shell{display:flex;flex-direction:column;gap:12px}
 .scenario-header{display:flex;align-items:center;justify-content:space-between;gap:12px}
 .scenario-toggle{display:flex;gap:8px;align-items:center;font-size:12px}
 .scenario-toggle label{padding:4px 10px;border:1px solid #ccc;border-radius:12px;cursor:pointer}
 .scenario-shell input{position:absolute;opacity:0;pointer-events:none}
 .scenario-cards{display:flex;flex-direction:column;gap:12px}
 .scenario-card{border:1px solid #eee;border-radius:10px;padding:12px;background:#fff}
 .scenario-card header{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
 .scenario-card h4{margin:0;font-size:16px}
 .scenario-link{font-size:11px;color:#555}
 .scenario-context{font-size:11px;color:#555}
 .scenario-meta{font-size:11px;color:#777;margin-top:2px}
 .quick-take{background:#f0f6ff;padding:8px;border-radius:8px;font-size:12px;margin:10px 0}
 .scenario-card ol{margin:0 0 0 18px;padding:0;font-size:12px}
 .scenario-card li{margin-bottom:6px}
 .option-label{font-weight:600}
 .risk-chip{display:inline-block;padding:2px 6px;font-size:10px;border-radius:999px;margin-left:6px}
 .risk-chip.low{background:#ecf9f1;color:#0b8457}
 .risk-chip.med{background:#fff3d6;color:#b27100}
 .risk-chip.high{background:#fdecea;color:#c23616}
 .scenario-card details{margin-top:6px;font-size:12px}
 .scenario-card details summary{cursor:pointer;font-weight:600}
 .scenario-card ul{margin:6px 0 0 18px;padding:0}
 .scenario-legend{font-size:11px;color:#555;display:none}
 .scenario-shell input ~ .scenario-cards .view-expanded{display:none}
 #scenario-compact:checked ~ .scenario-header .scenario-toggle label[for="scenario-compact"]{background:#1abc9c;color:#fff;border-color:#1abc9c}
 #scenario-expanded:checked ~ .scenario-header .scenario-toggle label[for="scenario-expanded"]{background:#1abc9c;color:#fff;border-color:#1abc9c}
 #scenario-expanded:checked ~ .scenario-header .scenario-toggle label[for="scenario-compact"]{background:#fff;color:#333;border-color:#ccc}
 #scenario-compact:checked ~ .scenario-header .scenario-toggle label[for="scenario-expanded"]{background:#fff;color:#333;border-color:#ccc}
 #scenario-expanded:checked ~ .scenario-cards .view-compact{display:none}
 #scenario-expanded:checked ~ .scenario-cards .view-expanded{display:block}
 #scenario-expanded:checked ~ .scenario-legend{display:block}
 .most-actionable{font-size:12px;margin:0 0 16px}
 .ma-list{display:flex;gap:12px;flex-wrap:wrap;margin-top:6px}
 .ma-item{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid #eee;border-radius:999px;font-size:12px}
 .ma-card{font-weight:600}
 .ma-arrow{color:#999}
 .scenario-shell{margin-top:8px}
 .scenario-wrapper{flex:2 1 420px;min-width:320px}
 .scenario-shell .scenario-toggle{gap:4px}
 .header-card .header-top{row-gap:8px}
 .kpi-strip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1}
 .kpi-chip{display:flex;flex-direction:column;padding:6px 10px;border:1px solid #eee;border-radius:10px;background:#fff;min-width:92px}
 .kpi-label{font-size:11px;color:#555}
 .kpi-value{font-size:16px;font-weight:600;color:#111}
 .kpi-meta{font-size:11px;color:#666;margin-left:auto}
 .delta{font-size:11px;color:#666;margin-left:4px}
 .hypotheses-card details{margin:0}
 .hypotheses-card summary{display:flex;align-items:center;justify-content:space-between;cursor:pointer;list-style:none;font-weight:600;font-size:14px}
 .hypotheses-card summary::-webkit-details-marker{display:none}
 .hyp-summary-meta{font-size:11px;color:#666;font-weight:400}
 .hypotheses-card table{margin-top:10px}
 .hyp-summary-line{font-size:11px;color:#666;margin-top:4px}
 .reliability-chips{display:flex;gap:8px;flex-wrap:wrap}
 .sub-bar{margin-top:6px}
 .corrections-card svg{display:block;margin:0;width:100%;height:auto}
 .heatmap-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
 .heatmap-note{font-size:11px;color:#555;margin-top:6px}
 .heatmap-interpretation h4{margin:8px 0 4px;font-size:12px}
 .heatmap-interpretation ul{margin:4px 0 0 16px}
 .dinner-card table{font-size:12px}
 .experiments-card ul{list-style:none;margin:0;padding:0}
 .experiments-card li{border:1px solid #eee;border-radius:10px;padding:10px;margin-bottom:10px;background:#fafafa}
 .exp-item-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
 .exp-item-head strong{font-size:14px}
 .exp-status{font-size:11px;border-radius:999px;padding:2px 8px;text-transform:capitalize}
 .exp-status.logging{background:#ecf9f1;color:#0b8457}
 .exp-status.planned{background:#fff3d6;color:#b27100}
 .exp-status.complete{background:#e5e7eb;color:#374151}
 .exp-status.paused{background:#fdecea;color:#c23616}
 .exp-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
 .exp-tag{font-size:10px;padding:2px 6px;border-radius:999px;background:#e7efff;color:#0b5cad}
 .exp-meta{font-size:11px;color:#555;margin-top:2px}
 .exp-goal{font-size:12px;margin-top:4px;font-weight:600;color:#111}
 .exp-metric{font-size:11px;margin-top:2px;color:#444}
 .exp-notes{font-size:12px;margin-top:6px;color:#444}
 .experiments-stamp{font-size:11px;color:#666;margin-top:4px}
 .exp-columns{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px}
 .exp-column{flex:1;min-width:260px}
 .exp-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
 .exp-chip{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:10px;border:1px solid #e0e0e0;font-size:10px;min-width:100px;background:#fff}
 .exp-chip span{color:#555;font-weight:500}
 .exp-chip strong{font-size:13px;color:#111}
 .today-chip{display:inline-block;margin-right:6px;padding:2px 6px;border-radius:999px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;background:#eef2ff;color:#1d4ed8}
 .today-chip--correction{background:#fef3c7;color:#b45309}
 .today-chip--hypo{background:#fee2e2;color:#b91c1c}
 @media(max-width:960px){ .reliability-chips{width:100%} .kpi-meta{width:100%;margin-left:0} }
 @media(max-width:768px){ .scenario-card header{flex-direction:column} .gate-row{justify-content:flex-start} }
.chip-adv{display:inline-block;margin-left:6px;padding:2px 6px;border-radius:10px;background:#1f6feb;color:#fff;font-size:11px;vertical-align:middle}
</style>
</head>
<body>
<h1>Loop Digest Dashboard ${(()=>{ try{ const defs=fs.readFileSync(path.join(root,'memory','shared','definitions.md'),'utf8'); return /Advanced Evidence Mode:\s*ENABLED/i.test(defs)? '<span class="chip-adv" title="Advanced Evidence mode">Advanced</span>' : ''; }catch{ return '' } })()}</h1>
<div class="header"><strong>Build:</strong> ${ver} · <strong>Build time (CT):</strong> ${esc(buildTimeStr)} · <strong>Commit:</strong> ${esc(gitSha||'n/a')} · <strong>Data window (CT):</strong> ${esc(startStr)} → ${esc(endStr)} · <strong>File:</strong> index-${ver}.html · <strong>Inputs hash:</strong> ${hash}</div>
<div class="strip">${esc(loopStrip)}</div>
<small>Time zone: ${(review && review.meta && review.meta.tz) ? review.meta.tz : 'America/Chicago'} · Last progress update: ${esc(progress.updatedAt||'n/a')}</small>
<div class="row">
 <div class="card header-card">
  <div class="header-top" style="display:flex;align-items:flex-start;gap:12px;justify-content:space-between;flex-wrap:wrap">
    ${kpiStripHtml}
    <div class="reliability-chips">${reliabilityChipsBlock}</div>
  </div>
  <div class=\"sub-bar muted\">Built ${esc(buildTimeStr)} CT • Data ${esc(startStr)} → ${esc(endStr)} • v=${ver} • <a href=\"https://korelidw.github.io/loop-digest/memory-multiagent-overview.html\" target=\"_blank\" rel=\"noopener\">Overview</a></div>
  ${(()=>{ // Missed-carb ribbon (last 24h)
    try{
      const nowMs = Date.now();
      const last24 = nowMs - 24*3600*1000;
      const pts = latestEntries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date|| (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.mg==='number'&&typeof x.ms==='number'&& x.ms>=last24).sort((a,b)=>a.ms-b.ms);
      if(pts.length<6) return '';
      const carbs = latestTreats.filter(t=> typeof t.carbs==='number' && t.carbs>0).map(t=> t.mills || (t.created_at? Date.parse(t.created_at): (t.createdAt? Date.parse(t.createdAt): undefined))).filter(ms=> typeof ms==='number');
      function carbNear(ms){ return carbs.find(ct=> ct>= ms - 15*60000 && ct<= ms + 10*60000); }
      const marks=[]; for(let i=0;i<pts.length;i++){ const s=pts[i]; const win=pts.filter(p=> p.ms>s.ms && p.ms<= s.ms + 60*60000); if(!win.length) break; const rise=Math.max(...win.map(p=>p.mg - s.mg)); if(rise>=50 && !carbNear(s.ms)){ marks.push({ms:s.ms, rise:Math.round(rise)}); i+=6; } }
      const width=520, height=24, padL=6, padR=6; const t0=pts[0].ms, t1=pts[pts.length-1].ms; const scaleX=ms=> padL + Math.round((ms-t0)/(t1-t0||1) * (width-padL-padR));
      const circles = marks.map(m=>`<circle cx=\"${scaleX(m.ms)}\" cy=\"12\" r=\"3\" fill=\"#ef4444\"/>`).join('');
      const carbDots = carbs.map(ms=>`<circle cx=\"${scaleX(ms)}\" cy=\"12\" r=\"2\" fill=\"#0ea5e9\" opacity=\"0.7\"/>`).join('');
      return `<div class=\"sub-bar\" title=\"Last 24h: red = possible missed-carb rise; blue = logged carbs\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\">${carbDots}${circles}<text x=\"${width-padR}\" y=\"20\" font-size=\"9\" fill=\"#666\" text-anchor=\"end\">24h</text></svg></div>`;
    }catch{return ''}
  })()}
  ${dowPredSvgRaw ? `<div class="sub-bar" style="margin-top:10px" title="Day-of-week Pred≤suspend averages — shows weekend behavioral pattern vs weekday baseline">${dowPredSvgRaw}<div style="font-size:10px;color:#666;margin-top:2px">Bars: green &lt;10%, amber 10–25%, red ≥25%. Dashed line = 10% weekday target. Weekday labels in gray, weekend in red.</div>${dowContextHtml}</div>` : ''}
  <details style="margin-top:6px">
    <summary><strong>Reliability & safety details</strong> (daily Pred ≤ suspend, Comm errors, and 14‑day sparkline)</summary>
    <div class="sentinel-header" style="margin-top:6px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div class="sentinel-asof">As of ${esc(sentinelStamp)}</div>
    </div>
    <table><thead><tr><th>Day</th><th>Pred ≤ suspend</th><th>Comm errors</th></tr></thead><tbody>${sentinelRows}</tbody></table>
    ${reliabilitySparkBlock}
    ${hourlyStripeBlock}
  </details>
 </div>
</div>
<div class="row">
  <div class="card hypotheses-card">
    <details>
      <summary>Top Hypotheses (n=${hypothesesCount})<span class="hyp-summary-meta">Click to expand table</span></summary>
      <div class="muted" style="margin:6px 0 8px">
        <span class="exp-tag" title="Analyst definitions — see definitions.md#analyst"><a href="../memory/shared/definitions.md#analyst" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">Analyst</a></span>
        <span class="exp-tag" title="Researcher definitions — see definitions.md#researcher"><a href="../memory/shared/definitions.md#researcher" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">Researcher</a></span>
      </div>
      <table><thead><tr><th>Title</th><th>Lever</th><th>Dir</th><th>Confidence</th></tr></thead><tbody>${cardsRows}</tbody></table>
    </details>
    <div class="hyp-summary-line">${esc(hypothesesSummaryLine)}</div>
  </div>
</div>
${mostActionableHtml}
${(()=>{ // High-ineffectiveness banner just under Most Actionable
  try{
    const worst=(correctionCtx.groups||[]).filter(g=> (g.n||0)>=15).slice().sort((a,b)=> (b.pctIneffective2h||0)-(a.pctIneffective2h||0)).slice(0,2);
    if(!worst.length) return '';
    function label(g){ const m=(g.group||'').split('|').map(s=>s.trim()); return `${m[0]} · ${m[1]}`; }
    const items = worst.map(w=>`<li>${esc(label(w))} — n=${w.n}, ${Math.round(w.pctIneffective2h||0)}% ineffective @2h</li>`).join('');
    return `<div class=\"card\" style=\"border-left:4px solid #ef4444\"><strong>High-ineffectiveness contexts</strong><ul style=\"margin:6px 0 0 16px\">${items}</ul><div class=\"muted\" style=\"margin-top:4px\">Directional only; try clean trials and avoid stacking.</div></div>`;
  }catch{return ''}
})()}
${(()=>{ // Experiment peek mini-card under Most Actionable
  const xp = correctionCtx && correctionCtx.experimentPeek;
  if(!xp || !xp.recent){
    return `<div class=\"card\" style=\"border-left:4px solid #0d6efd\"><div style=\"display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap\"><h3 style=\"margin:0\">Experiment peek</h3><div class=\"muted\">Recent vs 7d baseline</div></div><div class=\"exp-empty muted\" style=\"margin-top:4px;font-size:12px;line-height:1.4\">No experiment slices met the display rules.<br/>Add or update entries in <code>shared/experiment_ledger.jsonl</code> (or enable a Corrections lens in <code>data/correction_context.json</code>) and rebuild.</div></div>`;
  }
  function chip(label,val,goodDir){
    if(val==null || Number.isNaN(val)) return `<span class="exp-chip muted"><span>${esc(label)}</span><strong>n/a</strong></span>`;
    const signGood = (goodDir==='down' && val<0) || (goodDir==='up' && val>0) || (goodDir==='flat' && Math.abs(val)<0.1);
    const cls = signGood? 'low' : (goodDir==='down'? 'high':'high');
    const txt = (typeof val==='number'? (Math.abs(val)<1? val.toFixed(1): Math.round(val)) : val) + (label.includes('%')||label.includes('TAR')?'%':'');
    return `<span class="exp-chip ${cls}"><span>${esc(label)}</span><strong>${esc((val>0?'+':'')+txt)}</strong></span>`;
  }
  const n = xp.recent.n||0;
  const dIneff = xp.deltas && xp.deltas.dPctIneff2h;
  const d2 = xp.deltas && xp.deltas.dMedDrop2h;
  const d3 = xp.deltas && xp.deltas.dMedDrop3h;
  const dTar = xp.deltas && xp.deltas.dPctTAR90_180;
  const sPred = xp.safety && xp.safety.pctPredLeSuspend0_180;
  const sTbr = xp.safety && xp.safety.pctTBR0_180;
  const chips = [
    chip('Δ%ineff2h', dIneff, 'down'),
    chip('Δmed 2h drop', d2, 'up'),
    chip('Δmed 3h drop', d3, 'up'),
    chip('ΔTAR 90–180', dTar, 'down'),
    `<span class="exp-chip"><span>n (recent)</span><strong>${n}</strong></span>`,
    `<span class="exp-chip"><span>Pred ≤ suspend (0–180)</span><strong>${sPred!=null? fmtPct(sPred): 'n/a'}</strong></span>`,
    `<span class="exp-chip"><span>TBR (0–180)</span><strong>${sTbr!=null? fmtPct(sTbr): 'n/a'}</strong></span>`
  ].join('');
  return `<div class="card" style="border-left:4px solid #0d6efd"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><h3 style="margin:0">Experiment peek</h3><div class="muted">${esc(xp.context||'Corrections — Midday · IOB<0.5')} (recent vs 7d baseline)</div></div><div class="exp-chips" style="margin-top:8px">${chips}</div></div>`;
})()}
${whatToCheckHtml}
${dawnEffectCardHtml}
${isfExperimentNullCardHtml}
${eveningProtocolCardHtml}
<div class="row">
 <div class="card"><h3>AGP (14‑day)</h3>
  ${agpSvg || `<div class="muted">AGP unavailable</div>`}
  <div class="muted">Shaded bands: 25–75% (inner) and 5–95% (outer). Target band: 70–180 mg/dL.</div>
  <div class="heatmap-interpretation">
    <h4>How to read</h4>
    <ul>
      <li>Dark line = median; inner band = 25–75%; outer band = 5–95%.</li>
      <li>Green zone marks 70–180 mg/dL target.</li>
      <li>Look for repeat median excursions and wide bands (variability).</li>
    </ul>
    <h4>Key takeaways (auto‑generated)</h4>
    <ul id="agp-takeaways">${(()=>{
      const a = load(path.join(dataDir,'agp.json'))||{};
      const med = Array.isArray(a.p50)? a.p50: [];
      const hi = Array.isArray(a.p75)? a.p75: [];
      const lo = Array.isArray(a.p25)? a.p25: [];
      const items=[];
      function windowAvg(arr, startIdx, endIdx){ const s=Math.max(0,startIdx), e=Math.min(arr.length,endIdx); if(!arr.length||e<=s) return null; let sum=0,c=0; for(let i=s;i<e;i++){ const v=arr[i]; if(typeof v==='number'){ sum+=v; c++; } } return c? sum/c: null; }
      const idxOfHour = h=> Math.floor((h/24)*med.length);
      const overnight = windowAvg(med, idxOfHour(0), idxOfHour(4));
      const morning = windowAvg(med, idxOfHour(6), idxOfHour(9));
      const midday = windowAvg(med, idxOfHour(11), idxOfHour(13));
      const evening = windowAvg(med, idxOfHour(17), idxOfHour(21));
      function pushIf(label, val, cmp, txt){ if(val!=null && cmp(val)) items.push(`${label} median ~${Math.round(val)} mg/dL — ${txt}`); }
      pushIf('Overnight (0–4)', overnight, v=> v<100, 'lowish median; check basal drift vs suspend predictions');
      pushIf('Morning (6–9)', morning, v=> v>180, 'median above target; breakfast/ICR/timing likely drivers');
      pushIf('Midday (11–13)', midday, v=> v>180, 'post‑lunch elevation; lunch timing/ICR');
      pushIf('Evening (17–21)', evening, v=> v>180, 'post‑dinner elevation; dinner timing/ICR');
      function iqrAvg(start,end){ const p25=windowAvg(lo,start,end), p75=windowAvg(hi,start,end); return (p25!=null && p75!=null)? (p75-p25): null; }
      const iqrMorning = iqrAvg(idxOfHour(6),idxOfHour(9));
      if(iqrMorning!=null && iqrMorning>60) items.push(`High breakfast variability (IQR ~${Math.round(iqrMorning)} mg/dL); logging + timing can help disambiguate.`);
      if(!items.length) items.push('No strong median excursions detected; treat meal‑specific lenses as primary.');
      return items.map(t=>`<li>${esc(t)}</li>`).join('');
    })()}</ul>
  </div>
 </div>
 <div class="card"><h3>GRI components</h3>
  ${griHourlySvg || `<div class="muted">Hourly GRI unavailable</div>`}
  <div class="muted">Purple = LBGI (hypo risk), Orange = HBGI (hyper risk).</div>
 </div>
</div>
<div class="row">
 <div class="card"><h3>School Meal Lens</h3>
  ${(()=>{ // Meal fidelity rail
    try{
      const m = (review&&review.meals)||{};
      const nB = m.breakfast&&m.breakfast.n||0;
      const nL = m.lunch&&m.lunch.n||0;
      const nD = m.dinner&&m.dinner.n||0;
      const nowMs=Date.now(), last24=nowMs-24*3600*1000;
      const pts = latestEntries.map(e=>({mg:e.sgv||e.mgdl||e.mgdL, ms:e.date|| (e.dateString? Date.parse(e.dateString): undefined)})).filter(x=>typeof x.mg==='number'&&typeof x.ms==='number'&& x.ms>=last24).sort((a,b)=>a.ms-b.ms);
      const carbs = latestTreats.filter(t=> typeof t.carbs==='number' && t.carbs>0).map(t=> t.mills || (t.created_at? Date.parse(t.created_at): (t.createdAt? Date.parse(t.createdAt): undefined))).filter(ms=> typeof ms==='number');
      function carbNear(ms){ return carbs.find(ct=> ct>= ms - 15*60000 && ct<= ms + 10*60000); }
      let missed=0; for(let i=0;i<pts.length;i++){ const s=pts[i]; const win=pts.filter(p=> p.ms>s.ms && p.ms<= s.ms + 60*60000); if(!win.length) break; const rise=Math.max(...win.map(p=>p.mg - s.mg)); if(rise>=50 && !carbNear(s.ms)){ missed++; i+=6; } }
      return `<div class=\"exp-chips\"><span class=\"exp-chip\"><span>Breakfast n</span><strong>${nB}</strong></span><span class=\"exp-chip\"><span>Lunch n</span><strong>${nL}</strong></span><span class=\"exp-chip\"><span>Dinner n</span><strong>${nD}</strong></span><span class=\"exp-chip\"><span>Missed‑carb signals (24h)</span><strong>${missed}</strong></span></div>`;
    }catch{return ''}
  })()}
  <table><thead><tr><th>Window</th><th>Lead bin</th><th>n</th><th>Start BG (med/IQR)</th><th>ΔPeak (med)</th><th>T→180 (med)</th><th>Start trend</th><th>%>180</th><th>Median peak</th></tr></thead><tbody>${schoolRows}</tbody></table>
  <div class="muted">T→180 = return to 180 mg/dL after first >180 crossing within 4h. “≤180” = never >180; “>4h” = no return within 4h.</div>
  <div class="heatmap-interpretation">
    <h4>How to read</h4>
    <ul>
      <li>Lead bin: dosing timing relative to meal (e.g., pre≥20, pre0–4, post).</li>
      <li>ΔPeak: median peak minus start; lower is better if peaks are excessive.</li>
      <li>T→180: time to return ≤180 after first >180 within 4h.</li>
    </ul>
    <h4>Key takeaways (auto‑generated)</h4>
    <ul id="meals-takeaways">${(()=>{
      const m = (review&&review.meals)||{};
      const items=[];
      function pushIf(label, obj){ if(obj&&obj.n){ const pct = Math.round(obj.pctHigh||0); const pk = obj.medianPeak!=null? Math.round(obj.medianPeak): null; items.push(`${label}: ${pct}% >180${pk? `; median peak ~${pk}`:''}`); } }
      pushIf('Breakfast', m.breakfast);
      pushIf('Lunch', m.lunch);
      pushIf('Dinner', m.dinner);
      if(!items.length) items.push('Not enough meals for reliable patterns.');
      return items.map(t=>`<li>${esc(t)}</li>`).join('');
    })()}</ul>
  </div>
 </div>
</div>
<div class="row">
  <div class="card dinner-card"><h3>Dinner Lens</h3>
    <table><thead><tr><th>Window</th><th>Lead bin</th><th>n</th><th>Start BG (med/IQR)</th><th>ΔPeak (med)</th><th>T→180 (med)</th><th>Start trend</th><th>%>180</th><th>Median peak</th></tr></thead><tbody>${dinnerRows}</tbody></table>
    <div class="muted">Window fixed at 17:30–20:00; requires logged carbs ≥10g and bolus within −60/+30 min.</div>
    ${(()=>{ const rows=orderedBucketEntries(mealTiming.dinner||{}).filter(([bin,v])=>v&&v.n); const total=rows.reduce((s,[,v])=>s+(v.n||0),0); if(!total) return '<div class="muted" style="margin-top:4px;font-size:11px">⚠ No dinner meals met the filters this window. Ensure carbs ≥10g are logged and bolus is within −60/+30 min of meal start.</div>'; if(total<6) return `<div class="muted" style="margin-top:4px;font-size:11px">⚠ Thin dinner sample (n=${total}). Stats are directional only — wait for ≥6 logged dinners before drawing conclusions.</div>`; return ''; })()}
    <div class="heatmap-interpretation">
      <h4>How to read</h4>
      <ul>
        <li>Compare lead bins (pre≥20, pre10–19, pre0–4, post) to see which timing trims peaks fastest.</li>
        <li>ΔPeak: peak − start BG; lower suggests better coverage.</li>
        <li>T→180: median minutes to return ≤180; “>4h” = never returned inside the 4h window.</li>
      </ul>
      <h4>Key takeaways (auto‑generated)</h4>
      <ul id="dinner-takeaways">${dinnerTakeawaysHtml}</ul>
    </div>
  </div>
</div>
<div class="row">
  <div class="card experiments-card">
    <h3>Experiments</h3>
    <div class="experiments-stamp">Updated ${esc(experimentsUpdatedStr||'n/a')}</div>
    ${(()=>{
      function kpiDeltaChip(label, now, dVal, goodDir){
        const base = (now==null||Number.isNaN(now))? 'n/a' : (label.includes('%')? fmtPct(now): (typeof now==='number'? Math.round(now): now));
        let deltaTxt=''; let arrow='';
        if(typeof dVal==='number'){
          const isGood = (goodDir==='down' && dVal<0) || (goodDir==='up' && dVal>0) || (goodDir==='flat' && Math.abs(dVal)<0.1);
          arrow = dVal>0? '↑' : (dVal<0? '↓' : '→');
          deltaTxt = ` ${arrow}${Math.abs(Math.round(dVal))}${label.includes('%')?'%':''}`;
          return `<span class="exp-chip ${isGood? 'low':'high'}"><span>${esc(label)}</span><strong>${esc(base + deltaTxt)}</strong></span>`;
        }
        return `<span class="exp-chip"><span>${esc(label)}</span><strong>${esc(base)}</strong></span>`;
      }
      function safetyChip(label,val){ return `<span class="exp-chip"><span>${esc(label)}</span><strong>${val==null? 'n/a' : esc(fmtPct(val))}</strong></span>`; }
      function plainChip(label,val,unit=''){ return `<span class="exp-chip"><span>${esc(label)}</span><strong>${val==null? 'n/a' : esc(unit? (val+unit): String(val))}</strong></span>`; }
      function contextToggle(){
        const ctx = [
          gateChipHtml('pred'),
          gateChipHtml('ab'),
          gateChipHtml('max'),
          formatChip('TBR', nowVals.TBR, '%'),
          formatChip('TAR', nowVals.TAR, '%'),
          formatChip('CV', nowVals.CV, ''),
          formatChip('GRI', nowVals.GRI, '')
        ].join('');
        return `<details style="margin-top:6px"><summary><strong>Context</strong> (global chips)</summary><div class="exp-chips" style="margin-top:6px">${ctx}</div></details>`;
      }
      let cards='';
      // Lunch +10 pre-bolus
      const lunch = (mealTiming.experiments && mealTiming.experiments.lunchPrebolus) || null;
      if(lunch){
        const r=lunch.recent||{}, b=lunch.baseline7d||{}, d=lunch.deltas||{};
        const chips = [
          kpiDeltaChip('%>180 @4h', r.pctHigh, d.dPctHigh4h, 'down'),
          kpiDeltaChip('Median peak', r.medianPeak, d.dMedianPeak, 'down'),
          kpiDeltaChip('T→180 (min)', r.t180, d.dTto180, 'down'),
          plainChip('n', r.n||0),
          safetyChip('Pred ≤ suspend (0–240)', r.safetyPredLeSuspend0_240),
          safetyChip('TBR (0–240)', r.safetyTBR0_240),
          plainChip('On-time pre≥10', r.adherence10, '%'),
          plainChip('On-time pre≥20', r.adherence20, '%')
        ].join('');
        cards += `<div class="exp-card"><div class="exp-item-head"><div class="exp-head-left"><strong>${esc(lunch.title||'Lunch timing')}</strong></div><div class="muted">${esc(lunch.window||'Weekdays 11:20–12:10')}</div></div><div class="exp-chips" style="margin-top:6px">${chips}</div>${contextToggle()}</div>`;
      }
      // Corrections — Midday (mirror from expPeek)
      const mid = (correctionCtx && correctionCtx.experiments && correctionCtx.experiments.midDayLowIob) || (correctionCtx && correctionCtx.experimentPeek) || null;
      if(mid && mid.recent){
        const r=mid.recent, d=mid.deltas||{};
        const chips = [
          kpiDeltaChip('Δ%ineff2h', d.dPctIneff2h, null, 'down'),
          kpiDeltaChip('Δmed 2h drop', d.dMedDrop2h, null, 'up'),
          kpiDeltaChip('Δmed 3h drop', d.dMedDrop3h, null, 'up'),
          kpiDeltaChip('ΔTAR 90–180', d.dPctTAR90_180, null, 'down'),
          plainChip('n (recent)', r.n||0),
          safetyChip('Pred ≤ suspend (0–180)', r.pctPredLeSuspend0_180),
          safetyChip('TBR (0–180)', r.pctTBR0_180)
        ].join('');
        cards += `<div class="exp-card"><div class="exp-item-head"><div class="exp-head-left"><strong>${esc(mid.context||'Corrections — Midday, IOB<0.5')}</strong></div></div><div class="exp-chips" style="margin-top:6px">${chips}</div>${contextToggle()}</div>`;
      }
      // ISF +10% run window (14:00–16:30)
      const isf = (correctionCtx && correctionCtx.experiments && correctionCtx.experiments.isfRun) || null;
      if(isf){
        const r=isf.recent||{}, d=isf.deltas||{};
        const chips = [
          kpiDeltaChip('Δ%ineff2h', d.dPctIneff2h, null, 'down'),
          kpiDeltaChip('Δmed 2h drop', d.dMedDrop2h, null, 'up'),
          kpiDeltaChip('Δmed 3h drop', d.dMedDrop3h, null, 'up'),
          kpiDeltaChip('ΔTAR 90–180', d.dPctTAR90_180, null, 'down'),
          plainChip('n (recent)', r.n||0),
          safetyChip('Pred ≤ suspend (0–180)', r.pctPredLeSuspend0_180),
          safetyChip('TBR (0–180)', r.pctTBR0_180),
          plainChip('Adherence (clean)', (isf.adherence && isf.adherence.cleanCorrections)||0, '')
        ].join('');
        cards += `<div class="exp-card"><div class="exp-item-head"><div class="exp-head-left"><strong>${esc(isf.title||'ISF +10% run')}</strong></div><div class="muted">${esc(isf.window||'14:00–16:30')}</div></div><div class="exp-chips" style="margin-top:6px">${chips}</div>${contextToggle()}</div>`;
      }
      return cards || '<div class="muted">No experiment KPIs available.</div>';
    })()}
  </div>
</div>
<div class="row">
 <div class="card scenario-wrapper">
  ${scenarioSectionHtml}
 </div>
</div>
<div class="row">
 <div class="card corrections-card">
  <div class="corrections-meta">
    <h3>Corrections Lens @120m</h3>
    <div class="heatmap-toggle"><strong>2h</strong> · <a href="${corrHeatmap3hHref}" target="_blank" rel="noopener">3h SVG</a></div>
  </div>
  ${gateChipRow()}
  <div class="muted" style="font-size:11px;margin:6px 0">Clean-only toggle: ${(()=>{ try{ const clean=load(path.join(dataDir,'correction_context_clean.json')); return (clean&&Array.isArray(clean.groups))? '<strong>ON</strong> (compare deltas inline)': 'unavailable'; }catch{return 'unavailable'} })()}</div>
  <div class="heatmap-scroll">${correctionsHeatmapBlock}</div>
  <div class="heatmap-note">Blue = stronger drops, white = neutral, orange/red = weak or rising corrections. Overlay text shows n | %ineff2h.</div>
  ${middayTrackerBlock}
  <details class="isf-bias-wrap" style="margin-top:10px">
    <summary><strong>ISF Bias (Advanced)</strong></summary>
    <div class="muted" style="margin-top:6px">Directional only. Raw mg/dL/U hidden by design; categories based on median bias per U (|bias| ≤20 → Near expected; >20 → Stronger/Weaker). Rows with n&lt;30 or confounded by constraints are hidden.</div>
    <table style="margin-top:6px"><thead><tr><th>Daypart</th><th>IOB band</th><th>Category</th></tr></thead><tbody>${(()=>{
      const rows=[];
      function parse(g){ const m=(g.group||''); const p=m.toLowerCase().split('|').map(s=>s.trim()); return {day:p[0]||'',iob:p[1]||''}; }
      (correctionCtx.groups||[]).forEach(g=>{
        const {day,iob}=parse(g);
        if(day==='other') return; // drop 'other' context
        const n = g.n||0;
        if(n<30) return;
        if(g.constraintConfounded) return;
        const bias = (g.biasPerU!=null? g.biasPerU: null);
        if(bias==null) return;
        let cat='Near expected';
        if(Math.abs(bias)>20){ cat = bias>0? 'Stronger (observed > expected)': 'Weaker (observed < expected)'; }
        rows.push(`<tr><td>${esc(day)}</td><td>${esc(iob)}</td><td>${esc(cat)}</td></tr>`);
      });
      if(!rows.length) return '<tr><td colspan="3" class="muted">No eligible contexts.</td></tr>';
      return rows.join('');
    })()}</tbody></table>
  </details>
  <div class="heatmap-interpretation">
    <h4>How to read</h4>
    <ul>
      <li>Columns are dayparts; rows are IOB bands at the time of correction.</li>
      <li>Cell color encodes median BG change after the correction (bluer = larger drop).</li>
      <li>Text shows sample size and 2h ineffectiveness (n | %ineff2h; ineffective = &lt;20 mg/dL drop).</li>
    </ul>
    <h4>Key takeaways (auto‑generated)</h4>
    <ul id="corr-takeaways">${(()=>{
      const items=[];
      const groups=(correctionCtx.groups||[]).slice();
      // Parse into components
      function parse(g){
        const m=g.group||''; const p=m.toLowerCase().split('|').map(s=>s.trim());
        const day=p[0]||''; const iob=p[1]||''; return {day,iob};
      }
      const withN = groups.filter(g=> (g.n||0)>=15);
      // Under‑response: highest %ineffective2h
      const worst = withN.slice().sort((a,b)=> (b.pctIneffective2h||0)-(a.pctIneffective2h||0)).slice(0,2);
      worst.forEach(w=>{ const {day,iob}=parse(w); items.push(`Under‑response strongest in ${day} at ${iob} (n=${w.n}, ${Math.round(w.pctIneffective2h||0)}% ineffective; median 2h ${w.medDrop2h!=null?(w.medDrop2h>0?`drop ${Math.round(w.medDrop2h)} mg/dL`:`rise ${Math.abs(Math.round(w.medDrop2h))} mg/dL`):'n/a'})`); });
      // Effective contexts: biggest positive 2h drops
      const effective = withN.slice().sort((a,b)=> (b.medDrop2h||-999)-(a.medDrop2h||-999)).filter(x=> (x.medDrop2h||0)>30).slice(0,2);
      effective.forEach(e=>{ const {day,iob}=parse(e); items.push(`Corrections most effective in ${day} at ${iob} (n=${e.n}, median 2h drop ${Math.round(e.medDrop2h)} mg/dL)`); });
      // Small‑n note
      const small = (groups.filter(g=> (g.n||0)<10).length>0);
      if(small) items.push('Some cells have small n; treat those cells as directional only.');
      return items.map(t=>`<li>${esc(t)}</li>`).join('') || '<li class="muted">No takeaways yet</li>';
    })()}</ul>
  </div>
 </div>
</div>
</body></html>`;

const outVer = path.join(siteDir,`index-${ver}.html`);
const outLatest = path.join(siteDir,'index.html');
fs.writeFileSync(outVer, html);
// Also publish the full latest content as index.html (no redirect) to avoid CDN 404s
fs.writeFileSync(outLatest, html);
fs.writeFileSync(path.join(root,'version.txt'), ver+"\n");
console.log(outLatest);
console.log(outVer);
