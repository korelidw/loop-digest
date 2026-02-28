#!/usr/bin/env node
/**
 * Scenario Cards (first pass):
 * - School lunch timing what-ifs: compare %>180 across lead bins and infer directional delta for +10/+20 min shifts.
 * - Clean-correction ISF sweeps: by time-of-day and IOB band, infer direction of change in 2–3h drops and GRI components when ISF ±10–20%.
 *
 * Outputs data/scenario_cards.json with an array of cards following AGENTS.md template fields.
 */
const fs = require('fs');
const path = require('path');

function load(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function pct(x){ return typeof x==='number'? x: null; }
function asPct(x){ return (x!=null? x.toFixed(1): null); }

const dataDir = path.join(process.env.HOME,'.openclaw','workspace-diabetes','data');
const meal = load(path.join(dataDir,'meal_timing_analysis.json')) || {};
const corr = load(path.join(dataDir,'correction_context.json')) || {groups:[]};
const overlay = load(path.join(dataDir,'overlay_daily.json')) || {};

const cards=[];

// Helper: compute directional message comparing two bins
function dirDeltaTAR(vFrom, vTo){
  if(!vFrom||!vTo||!vFrom.n||!vTo.n) return null;
  const d = (vTo.pctHigh||0) - (vFrom.pctHigh||0);
  if(Math.abs(d)<2) return {dir:'flat', d};
  return {dir: d<0? 'decrease TAR':'increase TAR', d};
}

// 1) School lunch timing what-ifs (overall, since entrée categories not tagged yet)
(function(){
  const lunch = meal.schoolLunch || {};
  const bins = ['pre>=20','pre10-19','pre5-9','pre0-4','post0-9','post10-19','post>=20','none(-60..+30)'];
  function pick(bin){ return lunch[bin] && lunch[bin].n>=3? lunch[bin]: null; }
  const scenarios=[];
  // From pre0-4 -> pre10-19 (+10) ; pre0-4 -> pre>=20 (+20) ; post0-9 -> pre0-4 (+10 pre) ; none -> pre0-4
  const pairs=[
    {from:'pre0-4', to:'+10→ pre10-19', vFrom:pick('pre0-4'), vTo:pick('pre10-19')},
    {from:'pre0-4', to:'+20→ pre>=20', vFrom:pick('pre0-4'), vTo:pick('pre>=20')},
    {from:'post0-9', to:'+10→ pre0-4', vFrom:pick('post0-9'), vTo:pick('pre0-4')},
    {from:'none(-60..+30)', to:'+10→ pre0-4', vFrom:pick('none(-60..+30)'), vTo:pick('pre0-4')}
  ];
  for(const p of pairs){ if(p.vFrom && p.vTo){ const dd=dirDeltaTAR(p.vFrom,p.vTo); scenarios.push({from:p.from, to:p.to, nFrom:p.vFrom.n, nTo:p.vTo.n, dd, base:p.vFrom}); } }
  if(scenarios.length){
    // Build a single scenario card summarizing directionality
    const bullets = scenarios.map(s=>{
      const dir = s.dd? s.dd.dir: 'n/a'; const d = s.dd? s.dd.d: 0; const arrow = d<0? '↓':'↑';
      return `Shift ${s.to.replace('→','to')} vs ${s.from}: ${arrow}${Math.abs(d).toFixed(1)} pp in lunch TAR (4h >180) · samples ${s.nFrom}→${s.nTo}`;
    });
    const gatingNotes = [];
    const days = (overlay.days||[]);
    const highSuspendDays = days.filter(d=> (d.pctPredLeSuspend||0) >= 20).length;
    if(highSuspendDays>0){ gatingNotes.push(`${highSuspendDays} day(s) with high Loop suspend predictions may blunt pre-bolus effects.`); }
    cards.push({
      title: 'School lunch: earlier pre-bolus likely reduces post-meal TAR',
      timeWindow: 'Weekdays 11:20–12:10 (school lunch)',
      levers: ['timing','ICR'],
      direction: 'timing: earlier likely better; if constrained/late → consider ICR stronger',
      evidence: bullets,
      confidence: scenarios.length>=2? 'Medium' : 'Low',
      confounders: ['Entrée categories not tagged yet','Potential missed carb entries','Activity around lunch'],
      safety: ['Respect Loop suspend and AB caps; do not stack manual boluses','If frequent lows in 2–3 h after lunch, favor timing over ICR changes'],
      nextStep: 'Validate with 2–3 lunches: try +10 min earlier pre-bolus when feasible; track %>180 at +90–180 min and lows <70.'
    });
  }
})();

// 2) Clean-correction ISF sweeps (±10–20%)
(function(){
  const groups = (corr.groups||[]).filter(g=> g.n>=3);
  groups.forEach(g=>{
    // Heuristics: if medDrop2h < 30 and pctIneffective2h high, stronger ISF may decrease hyper but increase hypo risk.
    const ine = g.pctIneffective2h||0; const d2 = g.medDrop2h==null? 0: g.medDrop2h; const d3 = g.medDrop3h==null? 0: g.medDrop3h;
    let dirHyper = 'decrease'; let dirHypo = 'increase';
    if(d2>=50){ // already strong corrections
      dirHyper = 'flat/decrease'; dirHypo = 'increase';
    } else if(ine<=20 && d2>=35){ dirHyper='flat'; dirHypo='slight increase'; }
    const safety = ['Avoid back-to-back corrections within DIA','Higher ISF increases drop magnitude; watch lows 2–3h post-bolus'];
    const card = {
      title: `Corrections: ISF ±10–20% — ${g.group}`,
      timeWindow: g.group,
      levers: ['ISF'],
      direction: 'ISF stronger → larger drops; weaker → smaller drops',
      evidence: [
        `n=${g.n}, 2h drop median ${d2? d2.toFixed(0): 'n/a'} mg/dL; 3h ${d3? d3.toFixed(0): 'n/a'}`,
        `Ineffective at 2h (<30 mg/dL drop): ${ine.toFixed(1)}%`
      ],
      confidence: g.n>=8? 'Medium' : 'Low',
      confounders: ['Unlogged carbs or correction-to-meal overlap','IOB estimation noise from devicestatus sampling'],
      safety,
      nextStep: 'Sandbox 1–2 clean corrections in this band: observe 2h/3h drops and lows; adjust hypothesis direction only (no numeric changes).',
      griDelta: { hyper: dirHyper, hypo: dirHypo }
    };
    cards.push(card);
  });
})();

const outPath = path.join(dataDir,'scenario_cards.json');
fs.writeFileSync(outPath, JSON.stringify({cards},null,2));
console.log(outPath);
