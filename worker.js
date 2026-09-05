/**
 * Cloudflare Worker — results store for the bachelor party game.
 *
 * Holds the GitHub token so the public page never has to. Commits the game
 * results to results.json in the repo.
 *
 *   GET  /results   public, no auth   -> { rounds, updatedAt }
 *   POST /results   needs X-Party-Key -> commits and returns the saved state
 *   GET  /health    public
 *
 * Secrets (wrangler secret put):
 *   GITHUB_TOKEN  fine-grained PAT, Contents: read+write, this repo only
 *   PARTY_KEY     shared passphrase the host types into the app once
 *
 * Vars (wrangler.toml):
 *   REPO_OWNER, REPO_NAME, FILE_PATH, BRANCH, ALLOWED_ORIGIN
 */

const GITHUB_API = 'https://api.github.com';

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Party-Key',
    'Access-Control-Max-Age': '86400'
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...cors(env)
    }
  });
}

function ghHeaders(env) {
  return {
    Authorization: 'Bearer ' + env.GITHUB_TOKEN,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'areeb-bachelor-trip-worker'
  };
}

function contentsUrl(env) {
  const path = env.FILE_PATH || 'results.json';
  return `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${path}`;
}

/* Base64 that survives emoji — btoa alone throws on non-Latin1. */
function encodeContent(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function decodeContent(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function readResults(env) {
  const branch = env.BRANCH || 'main';
  const res = await fetch(`${contentsUrl(env)}?ref=${branch}&t=${Date.now()}`, {
    headers: ghHeaders(env),
    cf: { cacheTtl: 0, cacheEverything: false }
  });

  if (res.status === 404) return { state: { rounds: [], updatedAt: null }, sha: null };
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status} ${await res.text()}`);

  const meta = await res.json();
  let state = { rounds: [], updatedAt: null };
  try {
    const parsed = JSON.parse(decodeContent(meta.content));
    if (parsed && Array.isArray(parsed.rounds)) state = parsed;
  } catch (err) {
    /* Unparseable file — treat as empty rather than wedging the game. */
  }
  return { state, sha: meta.sha };
}

async function writeResults(env, state, sha) {
  const body = {
    message: `Update results (${state.rounds.length} rounds)`,
    content: encodeContent(JSON.stringify(state, null, 2) + '\n'),
    branch: env.BRANCH || 'main'
  };
  if (sha) body.sha = sha;

  const res = await fetch(contentsUrl(env), {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`GitHub write failed: ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }

    if (url.pathname === '/health') {
      return json({ ok: true, configured: Boolean(env.GITHUB_TOKEN && env.PARTY_KEY) }, 200, env);
    }

    if (url.pathname !== '/results') {
      return json({ error: 'not found' }, 404, env);
    }

    try {
      if (request.method === 'GET') {
        const { state } = await readResults(env);
        return json(state, 200, env);
      }

      if (request.method === 'POST') {
        if (!env.PARTY_KEY || request.headers.get('X-Party-Key') !== env.PARTY_KEY) {
          return json({ error: 'bad party key' }, 401, env);
        }

        let incoming;
        try {
          incoming = await request.json();
        } catch (err) {
          return json({ error: 'body must be JSON' }, 400, env);
        }
        if (!incoming || !Array.isArray(incoming.rounds)) {
          return json({ error: 'expected { rounds: [...] }' }, 400, env);
        }

        const state = {
          rounds: incoming.rounds,
          updatedAt: new Date().toISOString()
        };

        /* One retry: another device may have committed between read and write. */
        let sha;
        try {
          ({ sha } = await readResults(env));
          await writeResults(env, state, sha);
        } catch (err) {
          if (err.status === 409 || err.status === 422) {
            ({ sha } = await readResults(env));
            await writeResults(env, state, sha);
          } else {
            throw err;
          }
        }

        return json(state, 200, env);
      }

      return json({ error: 'method not allowed' }, 405, env);
    } catch (err) {
      return json({ error: String(err.message || err) }, 502, env);
    }
  }
};
