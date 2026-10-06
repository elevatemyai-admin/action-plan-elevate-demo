// =============================================================================
// api/chat.js
// This runs on Vercel's servers, NOT in the visitor's browser. That's what
// keeps your Anthropic API key secret. The browser calls this endpoint at
// /api/chat, and this file is the only place the actual key ever appears.
//
// SETUP NEEDED (see DEPLOY-GUIDE.md): add an environment variable in your
// Vercel project called ANTHROPIC_API_KEY with your real key as the value.
//
// EDIT PER CLIENT: the SYSTEM_PROMPT below is generic on purpose. Swap in
// the client's actual name/business and what kind of content you want the
// chat to draw out (newsletter content, testimonials, case-study material,
// whatever fits). Keep the same "ask one light follow-up at a time, don't
// make up facts" structure. That's what keeps it useful and trustworthy.
// =============================================================================

const SYSTEM_PROMPT = `You are a warm, curious assistant helping [CLIENT NAME] at [BUSINESS NAME] think out loud about what's happening in their business. Your job is to draw out concrete, specific details: updates, stories, moments worth sharing, anything that could become real content later.

Keep your responses short (2-4 sentences). Ask one light follow-up question at a time to pull out more specific, colorful detail (names, numbers, small moments) rather than general summaries. Don't be formal or corporate. Be genuinely curious, like a friend who wants to hear the good stuff. Never make up facts about their business; only work with what they tell you. Write in plain sentences and never use em dashes.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No messages provided' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. See DEPLOY-GUIDE.md.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: messages
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message || 'Claude API error' });
    }

    const text = (data.content || [])
      .map((block) => (block.type === 'text' ? block.text : ''))
      .filter(Boolean)
      .join('\n');

    return res.status(200).json({ reply: text });
  } catch (err) {
    return res.status(500).json({ error: 'Could not reach Claude. Please try again.' });
  }
}
