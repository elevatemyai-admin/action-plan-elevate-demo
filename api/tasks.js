// api/tasks.js
//
// Reads and writes a client's Tasks table in Airtable. This exact file gets
// copied, unchanged, into every future client's project -- the only things
// that differ per client are three environment variables set in that
// client's own Vercel project settings (never in this file, never in
// GitHub):
//   AIRTABLE_TOKEN     - that client's scoped Personal Access Token
//   AIRTABLE_BASE_ID    - e.g. appHWdDoEl6UgrS2M
//   AIRTABLE_TABLE_ID   - e.g. tbl1f8RDd79MidobS
//
// Endpoints (all same URL, different HTTP method):
//   GET    /api/tasks   -> { tasks: [...] }            every task, flattened
//   POST   /api/tasks   -> { task: {...} }              create one task
//   PATCH  /api/tasks   -> { task: {...} }              update one task
//   DELETE /api/tasks   -> { deleted: true, id }        delete one task
//
// The page never talks to Airtable directly -- it only ever calls this
// file, which is why the token above is safe here (server-side only) but
// would NOT be safe pasted into the page's own browser-facing code.
//
// SCHEMA CHANGE FROM THE OLD DEVON/ELEVATION-ROOM TABLES:
// "Phase" (This Week/30/60/90 Days/Someday) is gone, replaced by "When"
// (Today/This Week/Next Week/Future) -- a single-select field in Airtable.
// "Project" and "Group" are gone, replaced by "Tags" -- a MULTIPLE SELECT
// field in Airtable (not a linked record, not a plain string). A task can
// have zero or more tags; they're a filter, never a required nesting slot.
// "Parent ID" is kept, but now ONLY means "this is a sub-step/checklist
// item that belongs to the task it's linked to" -- it's no longer used for
// general categorization nesting.

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID;
const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;

const HEADERS = {
  Authorization: `Bearer ${AIRTABLE_TOKEN}`,
  'Content-Type': 'application/json'
};

// Airtable's real column names <-> the simpler names the page's JS uses.
const FIELD_MAP = {
  'Task ID': 'taskId',
  'Parent ID': 'parentId',       // linked-record field -> one record id (sub-steps only)
  'Task': 'task',
  'When': 'when',                 // single select: Today / This Week / Next Week / Future
  'Tags': 'tags',                 // multiple select: zero or more, filter-only
  'Order': 'order',
  'Done': 'done',
  'Assignee': 'assignee',
  'AI or Human': 'aiOrHuman',
  'Description': 'description',
  'Why It Matters': 'whyItMatters',
  'You Give': 'youGive',
  'You Get Back': 'youGetBack',
  'Hours Saved': 'hoursSaved',
  'Time Now': 'timeNow',
  'Time With AI': 'timeWithAI',
  'Resources': 'resources',
  'Notes': 'notes'
};
const REVERSE_FIELD_MAP = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([airtableName, pageName]) => [pageName, airtableName])
);

// Airtable returns "Parent ID" as an array of linked record ids (e.g.
// ["recXXXX"], or missing entirely if blank) -- flatten to one string or
// null. "Tags" (multiple select) comes back as a plain array of strings
// already -- just default it to [] instead of null/undefined so the page
// can always safely .map()/.filter() over it.
function flattenRecord(record) {
  const out = { id: record.id };
  for (const [airtableName, pageName] of Object.entries(FIELD_MAP)) {
    let value = record.fields[airtableName];
    if (pageName === 'parentId') {
      value = Array.isArray(value) && value.length ? value[0] : null;
    } else if (pageName === 'tags') {
      if (Array.isArray(value)) {
        value = value;
      } else if (typeof value === 'string' && value.trim()) {
        // Tags field came in as plain text (e.g. from a CSV import that
        // didn't get converted to a real Multiple Select field) -- split
        // on commas so the page still gets a usable list either way.
        value = value.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        value = [];
      }
    }
    out[pageName] = value === undefined ? (pageName === 'tags' ? [] : null) : value;
  }
  return out;
}

// Reverse direction: the page sends simple field names -- turn that back
// into Airtable's real column names. parentId re-wraps as the array format
// the linked field expects; tags is already the array format Airtable's
// multiple-select field expects, so it passes through unchanged.
function toAirtableFields(pageFields) {
  const fields = {};
  for (const [pageName, value] of Object.entries(pageFields)) {
    const airtableName = REVERSE_FIELD_MAP[pageName];
    if (!airtableName) continue; // silently ignore anything unrecognized
    fields[airtableName] = pageName === 'parentId' ? (value ? [value] : []) : value;
  }
  return fields;
}

// Airtable only returns 100 records per page -- this loop keeps every
// client's table correct forever, without ever needing a second look as
// task lists grow.
async function fetchAllRecords() {
  let records = [];
  let offset;
  do {
    const url = new URL(AIRTABLE_URL);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const airRes = await fetch(url, { headers: HEADERS });
    if (!airRes.ok) throw new Error(`Airtable GET failed: ${airRes.status}`);
    const data = await airRes.json();
    records = records.concat(data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

module.exports = async function handler(req, res) {
  try {
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID) {
      return res.status(500).json({
        error: 'Missing Airtable environment variables for this project. Check Vercel project settings.'
      });
    }

    if (req.method === 'GET') {
      const records = await fetchAllRecords();
      return res.status(200).json({ tasks: records.map(flattenRecord) });
    }

    if (req.method === 'POST') {
      const fields = toAirtableFields(req.body || {});
      const airRes = await fetch(AIRTABLE_URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ fields, typecast: true })
      });
      if (!airRes.ok) {
        const detail = await airRes.json().catch(() => ({}));
        throw new Error(detail.error && detail.error.message ? detail.error.message : `Airtable POST failed: ${airRes.status}`);
      }
      const created = await airRes.json();
      return res.status(200).json({ task: flattenRecord(created) });
    }

    if (req.method === 'PATCH') {
      const { id, ...pageFields } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing task id.' });
      const fields = toAirtableFields(pageFields);
      const airRes = await fetch(`${AIRTABLE_URL}/${id}`, {
        method: 'PATCH',
        headers: HEADERS,
        body: JSON.stringify({ fields, typecast: true })
      });
      if (!airRes.ok) {
        const detail = await airRes.json().catch(() => ({}));
        throw new Error(detail.error && detail.error.message ? detail.error.message : `Airtable PATCH failed: ${airRes.status}`);
      }
      const updated = await airRes.json();
      return res.status(200).json({ task: flattenRecord(updated) });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing task id.' });
      const airRes = await fetch(`${AIRTABLE_URL}/${id}`, {
        method: 'DELETE',
        headers: HEADERS
      });
      if (!airRes.ok) throw new Error(`Airtable DELETE failed: ${airRes.status}`);
      return res.status(200).json({ deleted: true, id });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
    return res.status(405).json({ error: `Method ${req.method} not allowed.` });
  } catch (err) {
    console.error('api/tasks error:', err);
    return res.status(500).json({ error: err.message || 'Something went wrong talking to Airtable.' });
  }
};
