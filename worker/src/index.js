/* Pixfix V2 Worker — the gated library API.
   Step 1: read path (GET /library, GET /health).
   Step 2: share-sheet capture (POST /share) — two trust levels via bearer token.

   Bindings (see wrangler.toml):
     DB                 D1 database 'pixfix'
   Secrets (wrangler secret put — never in the repo):
     ANTHROPIC_API_KEY  categorisation (parent shares)
     PARENT_TOKEN       parent share sheet → auto-categorise → approved
     CHILD_TOKEN        child share → pending queue (categorise on approval, step 4)

   Trust on POST /share: parent token → approved; child token OR no token → pending.
   The in-app add form posts tokenless, so nothing puts a parent secret on the iPad —
   everything a child adds in-app lands in the pending queue for grown-up approval.
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

/* iOS/macOS Shortcuts choke on turning a JSON body into a dictionary. When the
   caller opts into text (Accept: text/plain, or ?format=text) reply with the
   bare human message as text/plain — the Shortcut can show it with no parsing. */
function wantsText(request, url) {
  const accept = (request.headers.get('Accept') || '').toLowerCase();
  return url.searchParams.get('format') === 'text' || accept.includes('text/plain');
}
function reply(request, url, obj, status = 200) {
  if (wantsText(request, url)) {
    return new Response(`${obj.message || obj.error || ''}\n`, {
      status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS },
    });
  }
  return json(obj, status);
}

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

/* Bearer token off a request (header, then body, then ?token=). */
function tokenOf(request, url, body) {
  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return bearer || (body && body.token) || url.searchParams.get('token') || '';
}
/* True iff the request carries the parent token. Gates every /admin/* endpoint. */
function isParent(request, url, body, env) {
  return !!env.PARENT_TOKEN && tokenOf(request, url, body) === env.PARENT_TOKEN;
}

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

async function handleShare(request, env, ctx) {
  // token: Authorization: Bearer <t>, else body.token, else ?token=
  const url = new URL(request.url);
  let body = {};
  try { body = await request.json(); } catch { /* may be query-only */ }
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const token = bearer || body.token || url.searchParams.get('token') || '';

  let trust = null, tokenless = false;
  if (env.PARENT_TOKEN && token === env.PARENT_TOKEN) trust = 'parent';
  else if (env.CHILD_TOKEN && token === env.CHILD_TOKEN) trust = 'child';
  else if (!token) { trust = 'child'; tokenless = true; } // the in-app add form → pending queue; no parent token ever lives on-device
  // A present-but-wrong token is still rejected — absence means "untrusted client, queue me", not a failed auth.
  if (!trust) return reply(request, url, { error: 'unauthorized', message: 'Bad token.' }, 401);

  // Hardening for the tokenless path (a token is a shared secret and is exempt;
  // iOS Shortcuts send no Origin). Browser adds must come from an allowed origin.
  // Origin is spoofable by non-browser clients, so this pairs with the pending
  // cap below — together they bound anonymous abuse. Permissive only if
  // ALLOWED_ORIGINS is unset, so nothing breaks before it's configured.
  if (tokenless) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(origin)) {
      return reply(request, url, { error: 'forbidden_origin', message: 'Add videos from inside the Pixfix app.' }, 403);
    }
  }

  const shared = body.url || url.searchParams.get('url') || '';
  const ytId = parseYouTubeId(shared);
  if (!ytId) return reply(request, url, { error: 'bad_url', message: "That doesn't look like a YouTube link." }, 400);

  // Dedupe on yt_id — friendly, not an error. BUT a PARENT share of an existing
  // non-approved row APPROVES it in place: pending→approved and declined→approved.
  // This is the interim release valve until the Step 4 back office — "parent
  // re-shares it" becomes a one-tap approval. The reply states what actually
  // happened so the parent's phone notification confirms the approval fired.
  const existing = await env.DB.prepare(
    'SELECT yt_id, title, channel, food_group, status FROM videos WHERE yt_id = ?'
  ).bind(ytId).first();
  if (existing) {
    if (trust === 'parent' && existing.status !== 'approved') {
      const was = existing.status; // 'pending' | 'declined'
      const supplied = GROUP_KEYS.includes(body.food_group) ? body.food_group : null;
      const food_group =
        existing.food_group || supplied || (await categorise(env, { title: existing.title, channel: existing.channel }));
      await env.DB.prepare(
        "UPDATE videos SET status = 'approved', food_group = ?, approved_at = ? WHERE yt_id = ?"
      ).bind(food_group, nowSecs(), ytId).run();
      const name = existing.title || ytId;
      return reply(request, url, {
        status: 'approved',
        yt_id: ytId,
        title: existing.title,
        food_group,
        message: `Approved "${name}" (was ${was})${food_group ? ` — ${GROUP_LABELS[food_group]}` : ' — needs a food group'}.`,
      });
    }
    // Non-parent re-request of an existing video. Decline is AUTHORITATIVE: a
    // declined video is NOT resurrected into pending — only a parent act (the
    // reshare-upgrade above, or the back office) can revive it. Copy keeps the app
    // as the world and the parent as the gate ("a grown-up said…", never a scold).
    const name = existing.title || ytId;
    if (existing.status === 'declined') {
      return reply(request, url, { status: 'declined', yt_id: ytId, title: existing.title, message: `A grown-up said not this one — "${name}".` });
    }
    if (existing.status === 'pending') {
      return reply(request, url, { status: 'pending', yt_id: ytId, title: existing.title, message: `Already waiting for a grown-up — "${name}".` });
    }
    return reply(request, url, { status: 'exists', yt_id: ytId, title: existing.title, message: `Already in the library — "${name}".` });
  }

  // Pending cap — bound the approval queue so an abuser (or a runaway client)
  // can't flood D1. Only gates NEW pending inserts; approved adds and 'exists'
  // replies above are unaffected. Default 200, override with env PENDING_CAP.
  if (trust === 'child') {
    const cap = parseInt(env.PENDING_CAP || '200', 10);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM videos WHERE status = 'pending'").first();
    if ((row?.n ?? 0) >= cap) {
      return reply(request, url, { error: 'queue_full', message: 'The approval queue is full — ask a grown-up to review it.' }, 429);
    }
  }

  const { title, channel } = await fetchOEmbed(ytId);
  const t = nowSecs();

  if (trust === 'parent') {
    // A supplied, valid food_group is preserved verbatim — this is how the one-time
    // pf-lib → D1 migration carries Gabriella's existing curation across intact rather
    // than re-rolling it through the categoriser. Absent/invalid → auto-categorise.
    const supplied = GROUP_KEYS.includes(body.food_group) ? body.food_group : null;
    const food_group = supplied || (await categorise(env, { title, channel })); // null on any failure
    await env.DB.prepare(
      `INSERT INTO videos (yt_id, title, channel, food_group, status, added_by, added_at, approved_at)
       VALUES (?, ?, ?, ?, 'approved', 'parent', ?, ?)`
    ).bind(ytId, title, channel, food_group, t, t).run();
    const name = title || ytId;
    const message = food_group
      ? `Added "${name}" to ${GROUP_LABELS[food_group]}.`
      : `Added "${name}" — needs a food group (set it in the grown-up section).`;
    return reply(request, url, { status: 'added', yt_id: ytId, title, channel, food_group, message });
  }

  // child → pending. Categorise in the BACKGROUND (ctx.waitUntil) so the submit
  // returns immediately; the suggested food group lands in the row a moment later
  // and shows pre-selected in the back-office queue, where the parent confirms or
  // overrides it. (Was: categorise-on-approval — moved earlier so there's a real
  // suggestion to approve, not a blank.)
  await env.DB.prepare(
    `INSERT INTO videos (yt_id, title, channel, food_group, status, added_by, added_at)
     VALUES (?, ?, ?, NULL, 'pending', 'child', ?)`
  ).bind(ytId, title, channel, t).run();
  if (ctx && ctx.waitUntil) ctx.waitUntil(categoriseInBackground(env, ytId, title, channel));
  return reply(request, url, {
    status: 'pending',
    yt_id: ytId,
    title,
    message: `Sent "${title || ytId}" for a grown-up to approve.`,
  });
}

/* Fill a still-pending row's food group asynchronously (see the child path above).
   Guarded so it never overrides a parent override or a row that's since been
   approved/declined: only writes when the row is still pending AND uncategorised. */
async function categoriseInBackground(env, ytId, title, channel) {
  const food_group = await categorise(env, { title, channel });
  if (!food_group) return;
  await env.DB.prepare(
    "UPDATE videos SET food_group = ? WHERE yt_id = ? AND status = 'pending' AND food_group IS NULL"
  ).bind(food_group, ytId).run();
}

/* ---- the grown-up back office (all parent-token gated) ---- */
async function handleAdmin(request, env) {
  const url = new URL(request.url);
  let body = {};
  if (request.method === 'POST') { try { body = await request.json(); } catch { /* empty */ } }
  if (!isParent(request, url, body, env)) {
    return json({ error: 'unauthorized', message: 'Parent token required.' }, 401);
  }
  const sub = url.pathname.slice('/admin/'.length);

  // Cheap credential check — the app calls this to validate a token on unlock.
  if (sub === 'ping' && request.method === 'GET') return json({ ok: true });

  // The queue: pending first (newest first), then declined (so nothing is silent).
  if (sub === 'queue' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT yt_id, title, channel, food_group, status, added_by, added_at
         FROM videos
        WHERE status IN ('pending','declined')
        ORDER BY (status = 'pending') DESC, COALESCE(added_at, 0) DESC, id DESC`
    ).all();
    return json((results || []).map((r) => ({
      yt_id: r.yt_id, title: r.title, channel: r.channel,
      food_group: r.food_group || null, status: r.status,
      added_by: r.added_by, added_at: r.added_at || null,
    })));
  }

  // Approve: parent override wins, else the stored suggestion, else categorise now.
  if (sub === 'approve' && request.method === 'POST') {
    const ytId = String(body.yt_id || '');
    if (!ytId) return json({ error: 'bad_request', message: 'yt_id required.' }, 400);
    const row = await env.DB.prepare('SELECT title, channel, food_group FROM videos WHERE yt_id = ?').bind(ytId).first();
    if (!row) return json({ error: 'not_found' }, 404);
    const override = GROUP_KEYS.includes(body.food_group) ? body.food_group : null;
    const food_group = override || row.food_group || (await categorise(env, { title: row.title, channel: row.channel }));
    await env.DB.prepare("UPDATE videos SET status = 'approved', food_group = ?, approved_at = ? WHERE yt_id = ?")
      .bind(food_group, nowSecs(), ytId).run();
    return json({ status: 'approved', yt_id: ytId, food_group });
  }

  // Decline is authoritative — the row stays declined until a parent revives it.
  if (sub === 'decline' && request.method === 'POST') {
    const ytId = String(body.yt_id || '');
    if (!ytId) return json({ error: 'bad_request', message: 'yt_id required.' }, 400);
    await env.DB.prepare("UPDATE videos SET status = 'declined' WHERE yt_id = ?").bind(ytId).run();
    return json({ status: 'declined', yt_id: ytId });
  }

  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      if (pathname === '/health' && request.method === 'GET') {
        const row = await env.DB.prepare(
          "SELECT SUM(status = 'approved') AS approved, SUM(status = 'pending') AS pending FROM videos"
        ).first();
        return json({ ok: true, approved: row?.approved ?? 0, pending: row?.pending ?? 0 });
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
        return await handleShare(request, env, ctx);
      }

      if (pathname.startsWith('/admin/')) {
        return await handleAdmin(request, env);
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'server_error', detail: String(err) }, 500);
    }
  },
};
