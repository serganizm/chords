# API публикации песен

Cloudflare Worker проверяет Google-вход и пишет файлы только в `songs/`.

## Деплой

```bash
cd worker
npx wrangler login
npx wrangler secret put ALLOWED_EMAILS
# вставить: serganizm@gmail.com
npx wrangler secret put GITHUB_TOKEN
# вставить fine-grained PAT
npx wrangler deploy
```

После деплоя Wrangler напечатает URL вида `https://chords-api.<аккаунт>.workers.dev`.
Его нужно прописать в `dist/index.html` в мета-теге `chords-api`.

Сейчас: `https://chords-api.serganizm.workers.dev`
