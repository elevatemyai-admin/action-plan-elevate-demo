// api/thoughts.js
//
// Backend for the "Drop a thought" quick-capture list on the action plan page.
// Thoughts live in a "Thoughts" table inside the client's own Airtable base,
// so they sync across every device that loads the page.
//
// Uses the same environment variables as api/tasks.js -- no new ones:
//   AIRTABLE_TOKEN    - that client's scoped Personal Access Token
//   AIRTABLE_BASE_ID  - that client's base
// The table is found by its name, "Thoughts", inside that same base.
//
// Airtable columns (exact names, all plain text):
//   Text | Author | Assignee | Created | Approved
//
//   GET    /api/thoughts                        -> { thoughts }
//   POST   /api/thoughts { text, author }       -> { thoughts }
//   PATCH  /api/thoughts { id, approved?, assignee? } -> { thoughts }
//   DELETE /api/thoughts { id }                 -> { thoughts }
// Every response returns the full list, newest first.

const TABLE_NAME = 'Thoughts';

// Tolerates invisible characters or stray spaces in column names (a CSV import can add them).
function clean(fields) {
  const out = {};
  Object.keys(fields || {}).forEach(k => { out[k.replace(/\uFEFF/g, '').trim()] = fields[k]; });
  return out;
}
function isYes(v) {
  if (v === true) return true;
  return /^(yes|true|1|checked)$/i.test(String(v == null ? '' : v).trim());
}
function toThought(rec) {
  const f = clean(rec.fields);
  const str = v => (v == null ? '' : String(v));
  return {
    id: rec.id,
    text: str(f['Text']),
    author: str(f['Author']) || 'Client',
    assignee: str(f['Assignee']),
    createdAt: str(f['Created']) || rec.createdTime,
    approved: isYes(f['Approved'])
  };
}

module.exports = async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) {
    return res.status(500).json({ error: 'Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID in Vercel environment variables.' });
  }
  const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(TABLE_NAME)}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function listAll() {
    let records = [];
    let offset;
    do {
      const r = await fetch(url + (offset ? `?offset=${encodeURIComponent(offset)}` : ''), { headers });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data.error || data));
      records = records.concat(data.records || []);
      offset = data.offset;
    } while (offset);
    return records
      .map(toThought)
      .filter(t => t.text)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function write(method, payload) {
    const r = await fetch(url, { method, headers, body: JSON.stringify(payload) });
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data.error || data));
    return data;
  }

  try {
    const body = req.body || {};

    if (req.method === 'GET') {
      return res.status(200).json({ thoughts: await listAll() });
    }

    if (req.method === 'POST') {
      const text = (body.text || '').trim();
      if (!text) return res.status(400).json({ error: 'No text provided' });
      const author = body.author || 'Client';
      await write('POST', {
        records: [{ fields: {
          'Text': text,
          'Author': author,
          'Assignee': author,
          'Created': new Date().toISOString(),
          'Approved': ''
        } }],
        typecast: true
      });
      return res.status(200).json({ thoughts: await listAll() });
    }

    if (req.method === 'PATCH') {
      if (!body.id) return res.status(400).json({ error: 'Missing thought id.' });
      const fields = {};
      if (typeof body.approved === 'boolean') fields['Approved'] = body.approved ? 'Yes' : '';
      if (typeof body.assignee === 'string') fields['Assignee'] = body.assignee;
      if (Object.keys(fields).length) {
        await write('PATCH', { records: [{ id: body.id, fields }], typecast: true });
      }
      return res.status(200).json({ thoughts: await listAll() });
    }

    if (req.method === 'DELETE') {
      if (!body.id) return res.status(400).json({ error: 'Missing thought id.' });
      const r = await fetch(`${url}/${encodeURIComponent(body.id)}`, { method: 'DELETE', headers });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(JSON.stringify(data.error || data));
      }
      return res.status(200).json({ thoughts: await listAll() });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('api/thoughts error:', err);
    return res.status(500).json({ error: 'Could not reach Airtable. Please try again.' });
  }
};
