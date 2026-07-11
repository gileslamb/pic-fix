/* Pixfix V2 Worker — the gated library API.
   Step 1: read path only (GET /library, GET /health).
   Later steps add the share-sheet capture, child search, and approval endpoints.

   Bindings (see wrangler.toml):
     DB              D1 database 'pixfix'
   Secrets (added later, never in the repo):
     YOUTUBE_API_KEY, ANTHROPIC_API_KEY, PARENT_TOKEN, CHILD_TOKEN
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

/* Map a D1 row to the shape the app already consumes (SEED item shape). */
const toItem = (r) => ({
  t: r.title,
  g: r.food_group,
  yt: r.yt_id,
  channel: r.channel || undefined,
  added: r.added_at || undefined,
  src: r.added_by || 'seed',
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      // GET /health — sanity check
      if (pathname === '/health' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM videos WHERE status = 'approved'"
        ).all();
        return json({ ok: true, approved: results?.[0]?.n ?? 0 });
      }

      // GET /library — approved videos, newest first
      if (pathname === '/library' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT yt_id, title, channel, food_group, added_by, added_at
             FROM videos
            WHERE status = 'approved'
            ORDER BY COALESCE(added_at, 0) DESC, id DESC`
        ).all();
        return json((results || []).map(toItem));
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'server_error', detail: String(err) }, 500);
    }
  },
};
