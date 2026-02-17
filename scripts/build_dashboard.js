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
const now = new Date();
const ver = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
const tzNowFmt = new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false});
const buildTimeStr = tzNowFmt.format(now);

// Loop settings strip
let ls = (Array.isArray(profile) && profile.length && (profile[0].loopSettings || profile[0])) || {};
const loopStrip = `Strategy: ${esc(ls.dosingStrategy||'n/a')} · Suspend: ${esc(ls.minimumBGGuard||'?')} mg/dL · Targets: ${ls.preMealTargetRange? esc(ls.preMealTargetRange.join('–')): 'n/a'} · MaxBasal: ${esc(ls.maximumBasalRatePerHour||'?')} U/hr · MaxBolus: ${esc(ls.maximumBolus||'?')} U · DIA: 6h`;

// Hypotheses table rows
let cardsRows = '';
(review.cards||[]).slice(0,5).forEach(c=>{
  cardsRows += `<tr><td>${esc(c.title)}</td><td>${esc((c.levers||[]).join(',')||'')}</td><td>${esc(c.direction||'')}</td><td>${esc(c.confidence||'')}</td></tr>`;
});

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
  if(val==null || Number.isNaN(val)) return 'n/a';
  const rounded = Math.round(val);
  if(rounded===0) return `Δ${hours}h 0`;
  return `${rounded>0?'↓':'↑'} ${Math.abs(rounded)} mg/dL`;
}
function heatmapCellOverlay(entry){
  if(!entry || entry.n==null) return 'n/a';
  const pct = entry.pctIneffective2h!=null ? Math.round(entry.pctIneffective2h) + '%' : 'n/a';
  return `${entry.n} | ${pct}`;
}
function buildHeatmapSvg(hours){
  const measureKey = hours===3 ? 'medDrop3h' : 'medDrop2h';
  const cols = correctionDayparts.length;
  const rows = correctionIobBands.length;
  const cellW = 140;
  const cellH = 88;
  const leftW = 150;
  const topH = 70;
  const width = leftW + cellW * cols;
  const height = topH + cellH * rows + 30;
  let headerTexts = '';
  correctionDayparts.forEach((dp,idx)=>{
    const x = leftW + idx*cellW + cellW/2;
    headerTexts += `<text x="${x}" y="32" text-anchor="middle" font-size="14" font-weight="600">${dp.label}</text>`;
    if(dp.window){
      headerTexts += `<text x="${x}" y="50" text-anchor="middle" font-size="11" fill="#666">${dp.window}</text>`;
    }
  });
  let rowLabels = '';
  correctionIobBands.forEach((band,idx)=>{
    const y = topH + idx*cellH + cellH/2;
    rowLabels += `<text x="${leftW-12}" y="${y}" text-anchor="end" font-size="13" font-weight="600">${band.label}</text>`;
  });
  let cells = '';
  correctionIobBands.forEach((band,rIdx)=>{
    correctionDayparts.forEach((dp,cIdx)=>{
      const entry = (correctionGrid[band.key]||{})[dp.key] || {};
      const dropVal = entry[measureKey];
      const fill = colorForDrop(dropVal);
      const x = leftW + cIdx*cellW + 8;
      const y = topH + rIdx*cellH + 8;
      const rectW = cellW - 16;
      const rectH = cellH - 18;
      const overlay = heatmapCellOverlay(entry);
      const dropText = dropGlyph(dropVal,hours);
      const textColor = (dropVal!=null && dropVal>50) ? '#fefefe' : '#1b1b1b';
      cells += `<g>`;
      cells += `<rect x="${x}" y="${y}" width="${rectW}" height="${rectH}" rx="14" fill="${fill}" stroke="#d4d4d4" stroke-width="0.6"/>`;
      cells += `<text x="${x+rectW/2}" y="${y+rectH/2-6}" text-anchor="middle" font-size="13" font-weight="600" fill="${textColor}">${dropText}</text>`;
      cells += `<text x="${x+rectW/2}" y="${y+rectH-12}" text-anchor="middle" font-size="11" fill="${textColor}" opacity="0.9">${overlay}</text>`;
      cells += `</g>`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="Corrections heatmap ${hours}h"><style>text{font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;} .sentinel-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px}
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

</style><text x="20" y="20" font-size="14" font-weight="600">Corrections lens · Median ${hours}h drop (mg/dL)</text>${headerTexts}${rowLabels}${cells}<text x="${leftW}" y="${height-10}" font-size="10" fill="#555">Overlay: n | %ineff2h (ineffective = &lt;20 mg/dL drop)</text></svg>`;
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
function rowsFromBucket(label, obj){
  let out='';
  Object.entries(obj||{}).forEach(([bin,v])=>{
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
  return `<span class="gate-chip ${g.level}" title="${esc(g.label)}: ${val} (${g.label} gate)"><span>${esc(g.label)}</span><strong>${esc(val)}</strong></span>`;
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
      {label:'ICR stronger ~10%', detail:'expect ↓ peaks; moderate low risk; validate with 3–5 logged lunches', score:2, impact:'trims peaks when timing is capped', ...baseRisk},
      {label:'ICR stronger ~20%', detail:'larger effect; higher low risk; only if milder options insufficient', score:1, impact:'is reserved if gentler shifts fail', ...baseRisk},
      {label:'Timing unchanged (baseline)', detail:'for comparison / logging control', score:0, impact:'keeps a baseline reference', ...baseRisk}
    ];
  }
  if(title.includes('correction')||title.includes('isf')){
    return [
      {label:'ISF stronger ~20%', detail:'↑↑ 2–3h drops; ↓ 90–180 min TAR; avoid stacking', score:3, impact:'cleans up stubborn corrections fastest', ...baseRisk},
      {label:'ISF stronger ~10%', detail:'↑ 2–3h drops; ↓ TAR; monitor predicted lows', score:2, impact:'delivers moderate clean-up with less risk', ...baseRisk},
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
(scenarios.cards||[]).forEach((card,idx)=>{
  const options = optionsRankedFor(card);
  const quickTake = quickTakeFor(card, options);
  if(options.length){
    actionablePool.push({cardTitle: card.title, option: options[0]});
  }
  const compactList = options.slice(0,3).map(o=>`<li><span class="option-label">${esc(o.label)}</span> — ${esc(o.detail)} ${riskChip(o.riskLevel,o.riskTooltip)}</li>`).join('');
  const expandedList = options.map(o=>`<li><span class="option-label">${esc(o.label)}</span> — ${esc(o.detail)} ${riskChip(o.riskLevel,o.riskTooltip)}</li>`).join('');
  const link = linkHypothesisFor(card);
  const levers = (card.levers||[]).join(', ');
  const why = scenarioDetailsList(card.evidence||[]);
  const risks = scenarioDetailsList(listify(card.safety,['Watch predicted lows + stacking']));
  const validation = scenarioDetailsList(listify(card.nextStep||card.next||card.validation,[]));
  scenarioCardsHtml += `<article class="scenario-card">
    <header>
      <div>
        <h4>${esc(card.title)}</h4>
        ${link? `<div class="scenario-link">Linked hypothesis: ${esc(link)}</div>`:''}
        <div class="scenario-context">${esc(card.timeWindow||'')}</div>
        <div class="scenario-meta">Lever(s): ${esc(levers)} · Direction: ${esc(card.direction||'')} · Confidence: ${esc(card.confidence||'')}</div>
      </div>
      ${gateChipRow()}
    </header>
    ${quickTake? `<p class="quick-take">${esc(quickTake)}</p>`:''}
    <div class="view view-compact">
      <ol>${compactList}</ol>
    </div>
    <div class="view view-expanded">
      <ol>${expandedList}</ol>
      <details>
        <summary>Why this ranking</summary>
        ${why}
      </details>
      <details>
        <summary>Risks</summary>
        ${risks}
      </details>
      <details>
        <summary>Validation</summary>
        ${validation}
      </details>
    </div>
  </article>`;
});

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

// Collapsed hypotheses at top
const hypothesesTableHtml = `<table><thead><tr><th>Title</th><th>Lever</th><th>Dir</th><th>Confidence</th></tr></thead><tbody>${cardsRows}</tbody></table>`;
const hypothesesCollapsedHtml = `<details><summary><strong>Hypotheses</strong> (collapsed)</summary>${hypothesesTableHtml}</details>`;

// Experiments v1 section (from data/experiments.json)
const experiments = load(path.join(dataDir,'experiments.json'))||{};
function listFrom(arr){ if(!Array.isArray(arr)||!arr.length) return '<div class="muted">None</div>'; return '<ul>'+arr.map(x=>`<li><strong>${esc(x.title||'')}</strong> — ${esc(x.window||'')}<br><small>Goal: ${esc(x.goal||'')} · Metric: ${esc(x.metric||'')} · Owner: ${esc(x.owner||'')} · Status: ${esc(x.status||'')}</small><br><small>${esc(x.notes||'')}</small></li>`).join('')+'</ul>'; }
const experimentsHtml = `<div class="card"><h3>Experiments v1</h3><div><small>Last update: ${esc(experiments.updatedAt||'n/a')}</small></div>${listFrom(experiments.active)}<details><summary>Past</summary>${listFrom(experiments.past)}</details></div>`;

// Dinner Lens (simple summary)
function dinnerSummaryHtml(){
  const m = (review&&review.meals)||{}; const d=m.dinner||null; if(!d||!d.n) return '<div class="muted">Not enough dinners for reliable patterns.</div>';
  const pct = Math.round(d.pctHigh||0); const pk = d.medianPeak!=null? Math.round(d.medianPeak): null; const t180 = d.medianTimeTo180Min!=null? Math.round(d.medianTimeTo180Min)+'m' : (d.pctHigh>0? '>4h':'≤180');
  return `<ul><li>Dinner %>180: ${pct}%</li>${pk!=null? `<li>Median peak: ${pk}</li>`:''}<li>T→180 (med): ${t180}</li></ul>`;
}
const dinnerLensHtml = `<div class="card"><h3>Dinner Lens</h3>${dinnerSummaryHtml()}<div class="muted">Directional only if n is small; use with School Meal Lens for daytime context.</div></div>`;

// Corrections @120m · ISF Bias table
function isfAtHour(h){
  try{
    const sens = (((profile||[])[0]||{}).store||{}).Default.sens||[];
    // Find last sens change at/before hour h
    let val=null; let best=-1; sens.forEach(s=>{ const th=(s.timeAsSeconds||0)/3600; if(th<=h && th>best){ best=th; val=s.value; } });
    return val!=null? +val : null;
  }catch{ return null; }
}
function expectedIsfForDaypart(day){
  const map={overnight:1, morning:6, midday:11, evening:17};
  const key = Object.keys(map).find(k=> (day||'').toLowerCase().startsWith(k));
  const h = key? map[key]: null; if(h==null) return null; return isfAtHour(h);
}
function isfBiasRows(){
  const rows = (correctionCtx.groups||[]).slice().map(g=>{
    const parts=(g.group||'').toLowerCase().split('|').map(s=>s.trim());
    const day=parts[0]||''; const exp=expectedIsfForDaypart(day);
    const obs = (g.medDropPerU120!=null)? +g.medDropPerU120 : null;
    const bias = (obs!=null && exp!=null)? +(obs/exp).toFixed(2): null;
    const biasTxt = bias!=null? (bias>1? `ISF stronger (${bias}×)` : `ISF weaker (${bias}×)`) : 'n/a';
    return `<tr><td>${esc(g.group||'')}</td><td>${esc(g.n||0)}</td><td>${esc(g.medDrop2h!=null? Math.round(g.medDrop2h): 'n/a')}</td><td>${esc(obs!=null? Math.round(obs): 'n/a')}</td><td>${esc(exp!=null? Math.round(exp): 'n/a')}</td><td>${esc(biasTxt)}</td></tr>`;
  });
  return rows.join('');
}
const isfBiasTableHtml = `<div class="card"><h3>Corrections @120m (ISF Bias)</h3><table><thead><tr><th>Context</th><th>n</th><th>Median 2h Δ</th><th>Observed drop/U @120m</th><th>Expected ISF</th><th>ISF Bias</th></tr></thead><tbody>${isfBiasRows()}</tbody></table><div class="muted">Bias = Observed ÷ Expected ISF by daypart. Treat small‑n rows as directional only.</div></div>`;

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
const correctionsHeatmapBlock = corrHeatmap2hSvg || '<div class="muted">Corrections heatmap unavailable</div>';

// KPI chip strip (TIR/TBR/TAR, CV, GRI) with optional deltas vs prior window
function sum(obj, keys){ return keys.reduce((a,k)=> a + (obj[k]||0), 0); }
function pct(part,total){ if(!total) return 0; return +(100*part/total).toFixed(0); }
const tirCounts = metrics.tir || {};
const totalReadings = (metrics.meta&&metrics.meta.count)|| sum(tirCounts, ['veryLow','low','inRange','high','veryHigh']);
const nowVals = {
  TIR: pct(tirCounts.inRange||0, totalReadings),
  TBR: pct(sum(tirCounts,['veryLow','low']), totalReadings),
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
  chip('TAR', nowVals.TAR, priorVals&&priorVals.TAR, '%'),
  chip('CV', nowVals.CV, priorVals&&priorVals.CV, ''),
  chip('GRI', nowVals.GRI, priorVals&&priorVals.GRI, '')
].join('')}<div class="kpi-meta">Coverage: ${metrics.meta&&metrics.meta.coverage?(metrics.meta.coverage*100).toFixed(0):'0'}%</div></div>`;

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
 .reliability-chips{display:flex;gap:8px;flex-wrap:wrap}
 .sub-bar{margin-top:6px}
 .corrections-card svg{display:block;margin:0}
 .heatmap-note{font-size:11px;color:#555;margin-top:6px}
 .heatmap-interpretation h4{margin:8px 0 4px;font-size:12px}
 .heatmap-interpretation ul{margin:4px 0 0 16px}
 @media(max-width:960px){ .reliability-chips{width:100%} .kpi-meta{width:100%;margin-left:0} }
 @media(max-width:768px){ .scenario-card header{flex-direction:column} .gate-row{justify-content:flex-start} }
</style>
</head>
<body>
<h1>Loop Digest Dashboard</h1>
<div class="header"><strong>Build:</strong> ${ver} · <strong>Build time (CT):</strong> ${esc(buildTimeStr)} · <strong>Data window (CT):</strong> ${esc(startStr)} → ${esc(endStr)} · <strong>File:</strong> index-${ver}.html · <strong>Inputs hash:</strong> ${hash}</div>
<div class="strip">${esc(loopStrip)}</div>
<small>Time zone: ${(review && review.meta && review.meta.tz) ? review.meta.tz : 'America/Chicago'} · Last progress update: ${esc(progress.updatedAt||'n/a')}</small>
<div class="row">
 <div class="card header-card">
  <div class="header-top" style="display:flex;align-items:flex-start;gap:12px;justify-content:space-between;flex-wrap:wrap">
    ${kpiStripHtml}
    <div class="reliability-chips">${reliabilityChipsBlock}</div>
  </div>
  <div class="sub-bar muted">Built ${esc(buildTimeStr)} CT • Data ${esc(startStr)} → ${esc(endStr)} • v=${ver}</div>
  <details style="margin-top:6px">
    <summary><strong>Reliability & safety details</strong> (daily Pred ≤ suspend, Comm errors, and 14‑day sparkline)</summary>
    <div class="sentinel-header" style="margin-top:6px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div class="sentinel-asof">As of ${esc(sentinelStamp)}</div>
    </div>
    <table><thead><tr><th>Day</th><th>Pred ≤ suspend</th><th>Comm errors</th></tr></thead><tbody>${sentinelRows}</tbody></table>
    ${reliabilitySparkBlock}
  </details>
 </div>
</div>
<div class="muted"><a href="docs/experiments.md">Methods &amp; Experiments</a></div>
${hypothesesCollapsedHtml}
${mostActionableHtml}
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
 ${dinnerLensHtml}
 ${experimentsHtml}
</div>
<div class="row">
 <div class="card scenario-wrapper">
  ${scenarioSectionHtml}
 </div>
</div>
<div class="row">
 <div class="card corrections-card">
  <div class="corrections-meta">
    <h3>Corrections Lens</h3>
    <div class="heatmap-toggle"><strong>2h</strong> · <a href="${corrHeatmap3hHref}" target="_blank" rel="noopener">3h SVG</a></div>
  </div>
  ${correctionsHeatmapBlock}
  <div class="heatmap-note">Blue = stronger drops, white = neutral, orange/red = weak or rising corrections. Overlay text shows n | %ineff2h.</div>
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
 ${isfBiasTableHtml}
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
