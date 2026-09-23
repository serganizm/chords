const ALLOWED_ORIGINS = [
  'https://serganizm.github.io',
  'http://127.0.0.1:8765',
  'http://localhost:8765',
];
const MAX_TEXT = 200000;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });
}

function cleanPart(value) {
  return String(value || '').replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
}

function pathFromNames(artist, title) {
  const a = cleanPart(artist);
  const t = cleanPart(title);
  if (!a || !t) throw new Error('Укажите исполнителя и название');
  if (a.includes('..') || t.includes('..')) throw new Error('Некорректное имя');
  return `songs/${a} - ${t}.txt`;
}

function pathFromSource(source) {
  const name = String(source || '').replace(/^songs\//, '').split('/').pop() || '';
  if (!/^[^.].+\.txt$/i.test(name) || name.includes('..')) throw new Error('Некорректный файл');
  return `songs/${name}`;
}

function resolvePath(body, url) {
  const source = body.source || url?.searchParams.get('source') || '';
  const artist = String(body.artist || url?.searchParams.get('artist') || '').trim();
  const title = String(body.title || url?.searchParams.get('title') || '').trim();
  const path = source ? pathFromSource(source) : pathFromNames(artist, title);
  if (!path.startsWith('songs/') || path.includes('..')) throw new Error('Можно писать только в songs/');
  return path;
}

function allowedEmails(env) {
  return String(env.ALLOWED_EMAILS || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

async function verifyGoogle(idToken, clientId) {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!response.ok) throw new Error('Недействительный вход');
  const payload = await response.json();
  if (payload.aud !== clientId) throw new Error('Недействительный вход');
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw new Error('Email не подтверждён');
  return String(payload.email || '').toLowerCase();
}

async function requireUser(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new Error('Нужен вход');
  const email = await verifyGoogle(token, env.GOOGLE_CLIENT_ID);
  return { email, allowed: allowedEmails(env).includes(email) };
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(content) {
  const binary = atob(String(content || '').replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function githubError(status, data, fallback) {
  const detail = String(data?.message || '').replace(/\s+/g, ' ').trim();
  if (status === 401 || status === 403) {
    return new Error(detail ? `GitHub отказал в доступе: ${detail}` : 'GitHub отказал в доступе. Проверьте токен и право Contents: Read and write');
  }
  return new Error(detail || fallback);
}

async function githubFile(env, path, options = {}) {
  const [owner, repo] = String(env.GITHUB_REPO || '').split('/');
  const branch = env.GITHUB_BRANCH || 'main';
  if (!owner || !repo || !env.GITHUB_TOKEN) throw new Error('GitHub не настроен');
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (!options.method || options.method === 'GET') url.searchParams.set('ref', branch);
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'chords-worker',
    ...options.headers,
  };
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  return { response, data, branch };
}

async function getGithubFile(env, path) {
  const { response, data } = await githubFile(env, path);
  if (response.status === 404) return null;
  if (!response.ok) throw githubError(response.status, data, 'Не удалось прочитать файл в GitHub');
  return { text: fromBase64(data.content).replace(/\r\n?/g, '\n'), sha: data.sha };
}

async function putGithubFile(env, path, text, message) {
  const normalized = text.endsWith('\n') ? text : `${text}\n`;
  const existing = await getGithubFile(env, path);
  const { response, data, branch } = await githubFile(env, path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: toBase64(normalized),
      branch,
      sha: existing?.sha,
    }),
  });
  if (!response.ok) throw githubError(response.status, data, 'Не удалось записать файл в GitHub');
  return { path, sha: data.content?.sha || data.commit?.sha || existing?.sha };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/me') {
        const user = await requireUser(request, env);
        return json({
          email: user.email,
          allowed: user.allowed,
          github: Boolean(env.GITHUB_TOKEN),
        }, 200, origin);
      }

      if (request.method === 'GET' && url.pathname === '/songs') {
        const user = await requireUser(request, env);
        if (!user.allowed) return json({ error: 'Этот аккаунт не может менять библиотеку' }, 403, origin);
        const path = resolvePath({}, url);
        const file = await getGithubFile(env, path);
        return json({ exists: Boolean(file), path, text: file?.text || '' }, 200, origin);
      }

      if (request.method === 'POST' && url.pathname === '/songs') {
        const user = await requireUser(request, env);
        if (!user.allowed) return json({ error: 'Этот аккаунт не может менять библиотеку' }, 403, origin);
        const body = await request.json().catch(() => ({}));
        const artist = String(body.artist || '').trim();
        const title = String(body.title || '').trim();
        const text = String(body.text || '').replace(/\r\n?/g, '\n').trim();
        if (!text) return json({ error: 'Текст песни не может быть пустым' }, 400, origin);
        if (text.length > MAX_TEXT) return json({ error: 'Текст слишком длинный' }, 400, origin);
        const path = resolvePath(body, url);
        const action = body.source ? 'Update' : 'Add';
        await putGithubFile(env, path, text, `${action} lyrics for '${artist} - ${title}'`);
        return json({ ok: true, path }, 200, origin);
      }

      return json({ error: 'Not found' }, 404, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка';
      const status = /вход|аккаунт/i.test(message) ? 401 : /отказал|не настроен/i.test(message) ? 502 : 400;
      return json({ error: message }, status, origin);
    }
  },
};
