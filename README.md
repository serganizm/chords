# Мои аккорды

Статический сайт с текстами песен и аккордами. Исходные тексты находятся в
[`songs/`](songs/); при публикации из них создаются каталог и файлы в `dist/`.

## Публикация на GitHub Pages

Workflow [Deploy GitHub Pages](.github/workflows/deploy-pages.yml) запускается
после каждого push в ветку `main` и вручную из вкладки **Actions**. Он собирает
содержимое `dist/` и публикует его в GitHub Pages.

Перед первым запуском откройте в репозитории **Settings → Pages** и в разделе
**Build and deployment** выберите источник **GitHub Actions**. После завершения
workflow сайт будет доступен по адресу:

`https://c.wethead.ru/` (резерв: `https://serganizm.github.io/chords/`)

Для локального обновления каталога нужна только Node.js:

```bash
node scripts/build-songs.mjs
```

## Вход Google и публикация песен

Добавлять и править песни в GitHub может только аккаунт из `ALLOWED_EMAILS`.
API — Cloudflare Worker в [`worker/`](worker/). После деплоя вставьте его URL
в `dist/index.html` в мета-тег `chords-api`. Инструкция: [`worker/README.md`](worker/README.md).
