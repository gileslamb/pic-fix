/* Pixfix V2 Worker — the gated library API.
   Step 1: read path (GET /library, GET /health).
   Step 2: share-sheet capture (POST /share) — two trust levels via bearer token.

   Bindings (see wrangler.toml):
     DB                 D1 database 'pixfix'
   Secrets (wrangler secret put — never in the repo):
     ANTHROPIC_API_KEY  categorisation (parent shares)
     PARENT_TOKEN       parent share sheet → auto-categorise → approved
     CHILD_TOKEN        child share → pending queue (categorise on approval, step 4)
*/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const GROUP_KEYS = ['make', 'learn', 'move', 'watch', 'wind'];
const GROUP_LABELS = { make: 'Make', learn: 'Learn', move: 'Move', watch: 'Watch together', wind: 'Wind-down' };

/* Map a D1 row to the shape the app already consumes (SEED item shape). */
const toItem = (r) => ({
  t: r.title,
  g: r.food_group,
  yt: r.yt_id,
  channel: r.channel || undefined,
  added: r.added_at || undefined,
  src: r.added_by || 'seed',
});

const nowSecs = () => Math.floor(Date.now() / 1000);

/* Pull an 11-char YouTube id from a share. Handles youtu.be, youtube.com/watch,
   /shorts, /live, /embed, m.youtube.com, and a bare id. */
function parseYouTubeId(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const ok = (id) => (/^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);
  if (host === 'youtu.be') return ok(u.pathname.slice(1).split('/')[0]);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v');
    if (v) return ok(v);
    const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/);
    if (m) return ok(m[1]);
  }
  return null;
}

/* Title + channel with no API key, via YouTube's oEmbed endpoint. */
async function fetchOEmbed(id) {
  try {
    const target = `https://www.youtube.com/watch?v=${id}`;
    const r = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`,
      { headers: { 'User-Agent': 'pixfix-worker' } }
    );
    if (!r.ok) return { title: null, channel: null };
    const d = await r.json();
    return { title: d.title || null, channel: d.author_name || null };
  } catch {
    return { title: null, channel: null };
  }
}

/* One Claude call → one of the five food-group keys, or null on any failure.
   Never throws: a categorisation failure must not lose the share. */
async function categorise(env, { title, channel }) {
  if (!env.ANTHROPIC_API_KEY || !title) return null;
  const system =
    "You sort children's YouTube videos into one of five food groups for a kids' app. " +
    'Reply with ONLY a compact JSON object {"food_group":"KEY"} where KEY is exactly one of: ' +
    'make, learn, move, watch, wind.\n' +
    '- make: crafts, drawing, building, cooking, how-to-make\n' +
    '- learn: educational, facts, science, history, nature framed to teach\n' +
    '- move: physical activity, dance, yoga, exercise, follow-along movement\n' +
    '- watch: stories, shows, cartoons, vlogs, things to watch together\n' +
    '- wind: calm, bedtime, relaxing, read-alouds, quiet time\n' +
    'Choose the single best fit. Output nothing but the JSON.';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 64,
        system,
        messages: [{ role: 'user', content: `Title: ${title}\nChannel: ${channel || 'unknown'}` }],
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const key = JSON.parse(m[0]).food_group;
    return GROUP_KEYS.includes(key) ? key : null;
  } catch {
    return null;
  }
}

async function handleShare(request, env) {
  // token: Authorization: Bearer <t>, else body.token, else ?token=
  const url = new URL(request.url);
  let body = {};
  try { body = await request.json(); } catch { /* may be query-only */ }
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const token = bearer || body.token || url.searchParams.get('token') || '';

  let trust = null;
  if (env.PARENT_TOKEN && token === env.PARENT_TOKEN) trust = 'parent';
  else if (env.CHILD_TOKEN && token === env.CHILD_TOKEN) trust = 'child';
  if (!trust) return json({ error: 'unauthorized', message: 'Bad or missing token.' }, 401);

  const shared = body.url || url.searchParams.get('url') || '';
  const ytId = parseYouTubeId(shared);
  if (!ytId) return json({ error: 'bad_url', message: "That doesn't look like a YouTube link." }, 400);

  // Dedupe on yt_id — friendly, not an error.
  const existing = await env.DB.prepare(
    'SELECT yt_id, title, status FROM videos WHERE yt_id = ?'
  ).bind(ytId).first();
  if (existing) {
    return json({
      status: 'exists',
      yt_id: ytId,
      title: existing.title,
      message: `Already in the library — "${existing.title || ytId}".`,
    });
  }

  const { title, channel } = await fetchOEmbed(ytId);
  const t = nowSecs();

  if (trust === 'parent') {
    const food_group = await categorise(env, { title, channel }); // null on any failure
    await env.DB.prepare(
      `INSERT INTO videos (yt_id, title, channel, food_group, status, added_by, added_at, approved_at)
       VALUES (?, ?, ?, ?, 'approved', 'parent', ?, ?)`
    ).bind(ytId, title, channel, food_group, t, t).run();
    const name = title || ytId;
    const message = food_group
      ? `Added "${name}" to ${GROUP_LABELS[food_group]}.`
      : `Added "${name}" — needs a food group (set it in the grown-up section).`;
    return json({ status: 'added', yt_id: ytId, title, channel, food_group, message });
  }

  // child → pending; categorisation happens on approval (step 4)
  await env.DB.prepare(
    `INSERT INTO videos (yt_id, title, channel, food_group, status, added_by, added_at)
     VALUES (?, ?, ?, NULL, 'pending', 'child', ?)`
  ).bind(ytId, title, channel, t).run();
  return json({
    status: 'pending',
    yt_id: ytId,
    title,
    message: `Sent "${title || ytId}" for a grown-up to approve.`,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      if (pathname === '/health' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM videos WHERE status = 'approved'"
        ).all();
        return json({ ok: true, approved: results?.[0]?.n ?? 0 });
      }

      if (pathname === '/library' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT yt_id, title, channel, food_group, added_by, added_at
             FROM videos
            WHERE status = 'approved'
            ORDER BY COALESCE(added_at, 0) DESC, id DESC`
        ).all();
        return json((results || []).map(toItem));
      }

      if (pathname === '/share' && request.method === 'POST') {
        return await handleShare(request, env);
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'server_error', detail: String(err) }, 500);
    }
  },
};
