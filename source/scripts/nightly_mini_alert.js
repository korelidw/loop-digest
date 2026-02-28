#!/usr/bin/env node
const https = require('https');
const BASE = 'https://emmettk.herokuapp.com';
const nowMs = Date.now();
const sinceMs = nowMs - 24*60*60*1000;

function get(url){
  return new Promise((resolve, reject)=>{
    https.get(url, res=>{
      let data='';
      res.on('data', d=> data+=d);
      res.on('end', ()=>{
        try{ resolve(JSON.parse(data)); }catch(e){ reject(new Error('Parse error for '+url+': '+e.message+'\n'+data.slice(0,500))); }
      });
    }).on('error', reject);
  });
}

(async()=>{
  try{
    const sgv = await get(`${BASE}/api/v1/entries/sgv.json?count=3000`);
    const sgv24 = sgv.filter(e=> (e.date||0) >= sinceMs);
    const vals = sgv24.map(e=> e.sgv).filter(v=> typeof v==='number');
    const n = vals.length;
    const lt70 = vals.filter(v=> v<70).length;
    const lt54 = vals.filter(v=> v<54).length;
    const tir = n? Math.round(100 * vals.filter(v=> v>=70 && v<=180).length / n) : null;
    const tbr = n? Math.round(100 * lt70 / n) : null;

    const dev = await get(`${BASE}/api/v1/devicestatus.json?count=2000`);
    const dev24 = dev.filter(d=>{
      const t = new Date(d.created_at || d.dateString || d._id?.toString?.() || 0).getTime();
      const ms = d.date ? d.date : t;
      return ms >= sinceMs;
    });

    // Glucose safety limit
    let gsl = 70;
    for(const d of dev24){
      const l = d.loop || (d.device && d.device.loop) || null;
      const s = l && (l.settings || l.configuration || null);
      if(s && typeof s.glucoseSafetyLimit === 'number'){ gsl = s.glucoseSafetyLimit; break; }
    }

    // Predicted values
    let predTotal=0, predAtOrBelow=0;
    for(const d of dev24){
      const l = d.loop || null;
      if(!l) continue;
      const p = l.predicted || l.prediction || null;
      if(!p) continue;
      let arr = null;
      if(Array.isArray(p)) arr = p;
      else if(p && Array.isArray(p.values)) arr = p.values;
      if(!arr) continue;
      for(const v of arr){
        const val = (typeof v==='number')? v : (v && (v.sgv||v.glucose||v.y));
        if(typeof val==='number'){
          predTotal++;
          if(val <= gsl) predAtOrBelow++;
        }
      }
    }
    const predictedSuspendPct = predTotal? Math.round(100*predAtOrBelow/predTotal) : null;

    // Pump comm errors
    let loopCycles=0, pumpErrors=0, anyErrors=0;
    for(const d of dev24){
      const l = d.loop || null;
      if(!l) continue;
      loopCycles++;
      const fr = l.failureReason || l.error || d.error || null;
      let txt = '';
      if(typeof fr === 'string') txt = fr;
      else if(fr && typeof fr.displayable==='string') txt = fr.displayable;
      else if(fr && typeof fr.reason==='string') txt = fr.reason;
      else if(fr && typeof fr.type==='string') txt = fr.type;
      txt = (txt||'').toLowerCase();
      if(txt) anyErrors++;
      if(txt.includes('pump') || txt.includes('comms') || txt.includes('communication')) pumpErrors++;
    }
    const pumpCommErrorPct = loopCycles? Math.round(100*pumpErrors/loopCycles) : null;

    const out = { nowIso: new Date(nowMs).toISOString(), points:n, lt70, lt54, tir, tbr, glucoseSafetyLimit:gsl, predictedSuspendPct, pumpCommErrorPct, loopCycles, anyErrors };
    console.log(JSON.stringify(out,null,2));
  }catch(e){
    console.error('ERR', e.message);
    process.exit(2);
  }
})();
