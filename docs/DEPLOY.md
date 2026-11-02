# 配信のしかた（静的サイトとして公開する）

MLightNote はサーバー側の処理を持たない静的サイトです。本番ビルド（HTML・JavaScript・CSS）を、静的ファイルを配信できる場所に置くだけで動きます。

## 1. ビルドする

```bash
npm ci
npm run build --workspace mlightnote-web     # → web/dist/
```

`web/dist/` の中身：

| ファイル | 内容 |
|---|---|
| `index.html` | 入口のページ |
| `assets/` | JavaScript・CSS・処理エンジンの Worker（ファイル名にハッシュ付き。長期キャッシュしてよい） |
| `_headers` | セキュリティヘッダーの設定（Cloudflare Pages・Netlify 用。§3） |
| `third-party-licenses.txt` | 同梱しているオープンソースソフトウェアのライセンス一覧。**配布するときは削除しないでください** |

### パスの下に置く場合

`https://example.com/mlightnote/` のように、ドメインのトップ以外に置くときは、そのパスを `MLIGHTNOTE_BASE` で指定してビルドします（最初と最後の `/` を付けます）。

```bash
MLIGHTNOTE_BASE=/mlightnote/ npm run build --workspace mlightnote-web
```

`index.html` が `/mlightnote/assets/…` を読み込むようになります。`web/dist/` の中身を、配信先の `/mlightnote/` に置いてください。

- アプリには URL のルーティングが無い（常に入口のページだけ）ので、「すべてのパスを `index.html` に返す」設定は不要です。
- `_headers` の `/assets/*` の行は、パスの下に置く場合 `/mlightnote/assets/*` に書き換えてください。

## 2. 配信先に求められること

| 必須 | 内容 |
|---|---|
| ✅ | HTTPS で配信する（Web Worker、IndexedDB、Web Audio はブラウザの「安全なコンテキスト」が前提） |
| ✅ | `.js` を `text/javascript`（または `application/javascript`）で返す（処理エンジンはモジュール Worker として読み込む） |
| 推奨 | §3 のセキュリティヘッダーを付ける |
| 推奨 | `assets/` 以下に長期キャッシュ（`Cache-Control: public, max-age=31536000, immutable`） |

## 3. セキュリティヘッダー

アプリは、読み込んだ後に外部と通信せず、インラインのスクリプトやスタイルも使いません。そのため、次の厳しいヘッダーで動きます。

```text
Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

- **Cloudflare Pages・Netlify：** ビルド結果の `_headers` がそのまま使われます。
- **nginx：** `deploy/nginx.conf` に同じ設定があります（`make deploy` で使うもの）。
- `web/public/_headers` と `deploy/nginx.conf` の値は、単体テスト（`web/src/test/deployHeaders.test.ts`）で一致を確認しています。変えるときは両方を変えてください。

**ページにスクリプトを差し込む機能は使わないでください。** アクセス解析のタグ、メールアドレスの難読化、スクリプトの読み込み最適化（Cloudflare なら Web Analytics の自動挿入、Email Address Obfuscation、Rocket Loader、Zaraz）などは、CSP で止められてエラーになります。

## 4. 自分のサーバーで動かす（Docker）

```bash
make deploy        # docker compose build → up -d → 本番構成のスモークテスト
```

http://127.0.0.1:8080 で開けます（ポートは `.env` の `MLIGHTNOTE_PORT`）。nginx の非 root・読み取り専用の構成です（`deploy/`、`compose.yaml`）。インターネットに公開する場合は、前段に HTTPS を終端するリバースプロキシを置いてください。

## 5. 公開後の確認

```bash
MLIGHTNOTE_SMOKE_URL=https://example.com/mlightnote/ node_modules/.bin/playwright test --config playwright.docker.config.ts
```

公開した URL に対して、本番構成のスモークテスト（楽譜の読み込み・表示・再生・再読み込み後の保存、ライセンス一覧の配信）を実行します。あわせて、ブラウザの開発者ツールで次を確認してください。

- **Console** に CSP 違反などのエラーが出ていない
- **Network** に、配信元以外への通信が無い

## 6. 利用者のデータについて

- 楽譜は利用者のブラウザの中（IndexedDB、名前は `mlightnote`）にだけ保存され、配信元には送られません。
- 保存場所は **オリジン（スキーム＋ドメイン＋ポート）ごと** です。配信先のドメインを変えると、利用者の保存データは新しいドメインに出てきません。移すときは `.mlight` をダウンロードして読み込み直してもらいます。
- 同じオリジンの別のパスに、ほかのアプリを置くと、ブラウザの保存領域を互いに読める状態になります。中身を把握しているアプリだけを同じオリジンに置いてください。
