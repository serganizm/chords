# API публикации песен

Cloudflare Worker проверяет Google-вход и пишет файлы только в `songs/`.

## Деплой

```bash
cd worker
npx wrangler login
npx wrangler secret put ALLOWED_EMAILS
# вставить через запятую, например: serganizm@gmail.com,stabrovsky.g@gmail.com
npx wrangler secret put GITHUB_TOKEN
# вставить fine-grained PAT
npx wrangler deploy
```

После деплоя Wrangler напечатает URL вида `https://chords-api.<аккаунт>.workers.dev`.
Его нужно прописать в `dist/index.html` в мета-теге `chords-api`.

Сейчас: `https://chords-api.serganizm.workers.dev`

Если токен GitHub не может писать в репозиторий, песня попадает в очередь KV.
Action `publish-queued-songs` забирает её по GitHub OIDC и коммитит в `songs/`.
