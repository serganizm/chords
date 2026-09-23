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

async function putGithubFile(env, path, text, message) {
  const [owner, repo] = String(env.GITHUB_REPO || '').split('/');
  if (!owner || !repo || !env.GITHUB_TOKEN) throw new Error('GitHub не настроен');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'chords-worker',
  };
  const existing = await fetch(url, { headers });
  let sha;
  if (existing.ok) sha = (await existing.json()).sha;
  else if (existing.status !== 404) throw new Error('Не удалось прочитать файл в GitHub');
  const put = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: toBase64(text.endsWith('\n') ? text : `${text}\n`), sha }),
  });
  if (!put.ok) throw new Error('Не удалось записать файл в GitHub');
  return put.json();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/me') {
        const user = await requireUser(request, env);
        return json({ email: user.email, allowed: user.allowed }, 200, origin);
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
        const path = body.source ? pathFromSource(body.source) : pathFromNames(artist, title);
        if (!path.startsWith('songs/') || path.includes('..')) return json({ error: 'Можно писать только в songs/' }, 400, origin);
        const action = body.source ? 'Update' : 'Add';
        await putGithubFile(env, path, text, `${action} lyrics for '${artist} - ${title}'`);
        return json({ ok: true, path }, 200, origin);
      }

      return json({ error: 'Not found' }, 404, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка';
      const status = /вход|аккаунт/i.test(message) ? 401 : 400;
      return json({ error: message }, status, origin);
    }
  },
};
