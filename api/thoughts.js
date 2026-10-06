// =============================================================================
// api/thoughts.js: backend for the "Drop a thought" shared quick-capture
// list on the action-plan page. Uses the same Upstash Redis REST API
// pattern across every client, so thoughts sync live across every
// device/browser that loads this page. Nothing is emailed or downloaded,
// it's just always there the moment someone adds it.
//
// SETUP NEEDED PER NEW CLIENT:
// 1. This Vercel project needs KV_REST_API_URL and KV_REST_API_TOKEN
//    environment variables. Reuse the same Upstash Redis database as
//    other client projects (recommended, no need for a new database
//    per client); copy those two values over from any existing project's
//    Environment Variables.
// 2. EDIT the REDIS_KEY below to match this client's CLIENT.slug from
//    index.html, so each client's thoughts stay in their own namespace
//    inside the shared database.
// =============================================================================

const REDIS_URL = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;
const REDIS_KEY = 'thoughts:REPLACE-WITH-CLIENT-SLUG'; // EDIT: match CLIENT.slug

async function getThoughts(){
  const r = await fetch(`${REDIS_URL}/get/${REDIS_KEY}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : [];
}

async function saveThoughts(thoughts){
  await fetch(`${REDIS_URL}/set/${REDIS_KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: JSON.stringify(thoughts)
  });
}

export default async function handler(req, res) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: 'Server is missing KV_REST_API_URL / KV_REST_API_TOKEN.' });
  }

  try {
    if (req.method === 'GET') {
      const thoughts = await getThoughts();
      return res.status(200).json({ thoughts });
    }

    if (req.method === 'POST') {
      const { text, author } = req.body || {};
      if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });
      const thoughts = await getThoughts();
      thoughts.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        text: text.trim(),
        author: author || 'Client',
        assignee: author || 'Client',
        createdAt: new Date().toISOString(),
        approved: false
      });
      await saveThoughts(thoughts);
      return res.status(200).json({ thoughts });
    }

    if (req.method === 'PATCH') {
      const { id, approved, assignee } = req.body || {};
      const thoughts = await getThoughts();
      const idx = thoughts.findIndex((t) => t.id === id);
      if (idx >= 0) {
        if (typeof approved === 'boolean') thoughts[idx].approved = approved;
        if (typeof assignee === 'string') thoughts[idx].assignee = assignee;
      }
      await saveThoughts(thoughts);
      return res.status(200).json({ thoughts });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      let thoughts = await getThoughts();
      thoughts = thoughts.filter((t) => t.id !== id);
      await saveThoughts(thoughts);
      return res.status(200).json({ thoughts });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not reach storage. Please try again.' });
  }
}
