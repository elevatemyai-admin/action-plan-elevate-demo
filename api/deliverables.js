// api/deliverables.js
//
// Reads a client's Deliverables table in Airtable, so "What We're Building"
// on the action plan page always shows the current version. Edit
// deliverables in Airtable (wording, status, timing, order) and the page
// updates on the next refresh. No re-upload, no redeploy.
//
// Read-only on purpose: deliverables come from the signed agreement, so
// they're changed in Airtable by our team, never from the public page.
//
// Uses the same environment variables as api/tasks.js, no new ones:
//   AIRTABLE_TOKEN    - that client's scoped Personal Access Token
//   AIRTABLE_BASE_ID  - that client's base
// The table is found by its name, "Deliverables", inside that same base.
// If the table doesn't exist yet, the page simply hides the section.
//
// Airtable columns (exact names):
//   Name | Summary | Includes | Status | Timing | Order | Tasks
//   Includes: one item per line (Long text field)
//   Status:   Not started / In progress / In review / Delivered / Ongoing
//   Tasks:    created automatically by Airtable when the Tasks table gets a
//             "Deliverable" link field. The page uses it to show
//             "3 of 8 tasks done" on each deliverable.
//
//   GET /api/deliverables  -> { deliverables: [ { id, name, summary, includes[], status, timing, order, taskIds[] } ] }

const TABLE_NAME = 'Deliverables';

// Tolerates invisible characters or stray spaces in column names (a CSV import can add them).
function clean(fields) {
  const out = {};
  Object.keys(fields || {}).forEach(k => { out[k.replace(/\uFEFF/g, '').trim()] = fields[k]; });
  return out;
}
function toDeliverable(rec) {
  const f = clean(rec.fields);
  const str = v => (v == null ? '' : String(v));
  return {
    id: rec.id,
    name: str(f['Name']).trim(),
    summary: str(f['Summary']).trim(),
    includes: str(f['Includes']).split(/\r?\n/).map(s => s.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean),
    status: str(f['Status']).trim(),
    timing: str(f['Timing']).trim(),
    order: Number(f['Order']) || 0,
    taskIds: Array.isArray(f['Tasks']) ? f['Tasks'].filter(v => typeof v === 'string') : []
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Deliverables are edited in Airtable.' });
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) {
    return res.status(500).json({ error: 'Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID in Vercel environment variables.' });
  }
  const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(TABLE_NAME)}`;
  const headers = { Authorization: `Bearer ${token}` };
  try {
    let records = [];
    let offset;
    do {
      const r = await fetch(url + (offset ? `?offset=${encodeURIComponent(offset)}` : ''), { headers });
      const data = await r.json();
      // No Deliverables table yet: return an empty list so the page just hides the section.
      if (r.status === 404 || r.status === 403) return res.status(200).json({ deliverables: [] });
      if (!r.ok) return res.status(r.status).json({ error: data.error || data });
      records = records.concat(data.records || []);
      offset = data.offset;
    } while (offset);
    const list = records.map(toDeliverable).filter(d => d.name).sort((a, b) => a.order - b.order);
    return res.status(200).json({ deliverables: list });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message || err) });
  }
};
