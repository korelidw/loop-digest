#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

function fmtPct(x) { return (x*100).toFixed(1) + '%'; }
function fmtDate(ms) { const d = new Date(ms); return isNaN(d) ? null : d.toISOString(); }

const dataDir = path.join(process.env.HOME, '.openclaw', 'workspace-diabetes', 'data');
const entriesPath = fs.readdirSync(dataDir).filter(f => f.startsWith('ns_entries_')).map(f => path.join(dataDir,f)).sort().pop();
const treatsPath = fs.readdirSync(dataDir).filter(f => f.startsWith('ns_treatments_')).map(f => path.join(dataDir,f)).sort().pop();
const devstatPath = fs.readdirSync(dataDir).filter(f => f.startsWith('ns_devicestatus_')).map(f => path.join(dataDir,f)).sort().pop();
const profilePath = path.join(dataDir, 'ns_profile_latest.json');

const outPath = path.join(dataDir, 'analysis_basic.json');
const summary = { ok: true, files: { entriesPath, treatsPath, devstatPath, profilePath } };

// Entries (CGM)
const entries = loadJson(entriesPath) || [];
summary.entries = { count: entries.length };
if (entries.length > 0) {
  const dates = entries.map(e => e.date).filter(x => typeof x === 'number');
  if (dates.length) {
    const min = Math.min(...dates);
    const max = Math.max(...dates);
    const durMs = Math.max(0, max - min);
    const expected = durMs / (5 * 60 * 1000); // 5-min cadence
    const coverage = expected > 0 ? Math.min(1, entries.length / expected) : null;
    summary.entries.earliest = fmtDate(min);
    summary.entries.latest = fmtDate(max);
    summary.entries.durationDays = +(durMs / (24*60*60*1000)).toFixed(2);
    summary.entries.expectedAt5min = Math.round(expected);
    summary.entries.coverage5min = coverage !== null ? +coverage.toFixed(3) : null;
  }
}

// Treatments
const treats = loadJson(treatsPath) || [];
summary.treatments = {
  count: treats.length,
  carbsCount: treats.filter(t => typeof t.carbs === 'number' && t.carbs > 0).length,
  insulinCount: treats.filter(t => typeof t.insulin === 'number' && t.insulin > 0).length,
};

// Devicestatus
const devs = loadJson(devstatPath) || [];
summary.devicestatus = { count: Array.isArray(devs) ? devs.length : 0 };

// Profile presence
const profile = loadJson(profilePath);
summary.profile = { present: !!profile };

fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.log(outPath);
