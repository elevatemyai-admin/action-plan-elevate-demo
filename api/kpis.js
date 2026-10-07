// api/kpis.js
//
// Reads and updates a client's KPIs table in Airtable, so "Results so far"
// at the bottom of the action plan page can be viewed and updated from the
// page itself -- nobody needs an Airtable login.
//
// Uses the same environment variables as api/tasks.js -- no new ones:
//   AIRTABLE_TOKEN    - that client's scoped Personal Access Token
//   AIRTABLE_BASE_ID  - that client's base
// The table is found by its name, "KPIs", inside that same base.
//
// Airtable columns (exact names):
//   Measure | Starting Number | Date Recorded | Target | Current Number | Last Updated
//
//   GET   /api/kpis  -> { kpis: [ { id, measure, start, date, target, current, updated } ] }
//   POST  /api/kpis  { measure, start, date }                -> { kpi }   add a measure
//   PATCH /api/kpis  { id, current?, target?, updated }      -> { kpi }   update one
// Deleting a measure is done in Airtable only, so nothing gets removed by accident.

const TABLE_NAME = 'KPIs';

// Tolerates invisible characters or stray spaces in column names (a CSV import can add them).
function clean(fields) {
  const out = {};
  Object.keys(fields || {}).forEach(k => { out[k.replace(/\uFEFF/g, '').trim()] = fields[k]; });
  return out;
}
function toKpi(rec) {
  const f = clean(rec.fields);
  const str = v => (v == null ? '' : String(v));
  return {
    id: rec.id,
    measure: str(f['Measure']),
    start: str(f['Starting Number']),
    date: str(f['Date Recorded']),
    target: str(f['Target']),
    current: str(f['Current Number']),
    updated: str(f['Last Updated'])
  };
}
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

module.exports = async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) {
    return res.status(500).json({ error: 'Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID in Vercel environment variables.' });
  }
  const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(TABLE_NAME)}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
    if (req.method === 'GET') {
      let records = [];
      let offset;
      do {
        const r = await fetch(url + (offset ? `?offset=${encodeURIComponent(offset)}` : ''), { headers });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.error || data });
        records = records.concat(data.records || []);
        offset = data.offset;
      } while (offset);
      return res.status(200).json({ kpis: records.map(toKpi).filter(k => k.measure.trim()) });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (req.method === 'POST') {
      const measure = String(body.measure || '').trim();
      if (!measure) return res.status(400).json({ error: 'A measure needs a name.' });
      const fields = { 'Measure': measure, 'Starting Number': String(body.start || '').trim() };
      if (isDate(body.date)) fields['Date Recorded'] = body.date;
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ records: [{ fields }], typecast: true }) });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.error || data });
      return res.status(200).json({ kpi: toKpi(data.records[0]) });
    }

    if (req.method === 'PATCH') {
      if (!body.id) return res.status(400).json({ error: 'Missing measure id.' });
      const fields = {};
      if ('current' in body) fields['Current Number'] = String(body.current || '').trim();
      if ('target' in body) fields['Target'] = String(body.target || '').trim();
      if (isDate(body.updated)) fields['Last Updated'] = body.updated;
      const r = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ records: [{ id: body.id, fields }], typecast: true }) });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.error || data });
      return res.status(200).json({ kpi: toKpi(data.records[0]) });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Airtable request failed.' });
  }
};
