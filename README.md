# MLightNote

ブラウザだけで動くフルバンド向け楽譜ビューアー／軽量エディター／MIDIプレイヤーです（サーバー不要の静的サイト）。MusicXML・MIDIを読み込んで五線譜として表示し、パート譜の表示・印刷、再生、曲情報やパート設定の編集、独自形式 `.mlight` での保存と再オープンができます。

仕様と実装状況は [APP_DESIGN.md](APP_DESIGN.md) を参照してください（§0 に「何ができて何ができていないか」を常に最新で記載しています）。

## 起動

```bash
make deploy            # 本番ビルドを nginx の静的サイトとして起動し、ブラウザで動作確認
```

ブラウザで <http://127.0.0.1:8080> を開きます。ポートは `.env` の `MLIGHTNOTE_PORT` で変更できます。中身は静的ファイル（`web/dist/`）だけなので、静的ホスティングに置いて公開できます（`/mlightnote/` のようなパスの下にも置けます）。手順は [docs/DEPLOY.md](docs/DEPLOY.md) を参照してください。

読み込み・採譜・保存はすべてブラウザ内（Web Worker と IndexedDB）で行い、楽譜ファイルがどこかへ送信されることはありません。プロジェクトはそのブラウザにだけ保存されるので、別のPCで開く・バックアップするには `.mlight` をダウンロードしてください。

## できること

| 機能 | 内容 |
|---|---|
| 読み込み | MusicXML（`.xml` `.musicxml` `.mxl`）、MIDI（SMF Format 0/1）、`.mlight` |
| 表示 | 本物の五線譜（大譜表、コードネーム、タイ、連桁、調号・音部記号変化）、フルスコア／単一パート、実音表示、ズーム |
| MIDI採譜 | 量子化、和音化、小節を跨ぐタイ分割、休符補完、2トラックの大譜表統合、テンポ反映 |
| 再生 | 再生／一時停止／停止／シーク、ミキサー画面（全パートのフェーダー・パン・M/S・メーター）、譜面上の再生カーソルと自動追従、小節クリックでシーク、A-Bループ、テンポ25〜200%、メトロノーム、全体音量、パート別の音量・パン・ミュート・ソロ・GM音色（内蔵シンセ） |
| 印刷 | A4／Letter、縦／横、ブラウザ印刷・PDF保存（プレビューと出力のページ数一致を検証済み） |
| 編集 | 曲名・作曲者等、パート名・略称・音色・ミキサー。元に戻す／やり直す、他タブとの競合検出 |
| 保存 | 保存、`.mlight` ダウンロード、`.mlight` を開き直すと編集内容を復元（原本は完全保持）、不要なプロジェクトの削除 |
| 診断 | インポートレポート（警告コード、元ファイルのSHA-256） |

### キーボードショートカット

| 操作 | キー |
|---|---|
| 再生／一時停止 | `Space` |
| 停止 | `Shift+Space` |
| 前／次の小節 | `←`／`→` |
| 曲頭／最終小節 | `Home`／`End` |
| ループ切替（未設定なら現在の小節） | `L` |
| メトロノーム切替 | `M` |
| ミキサーの表示／非表示 | `X` |
| 保存 | `Ctrl+S`（macOS: `Cmd+S`） |
| 元に戻す／やり直す | `Ctrl+Z`／`Ctrl+Shift+Z` |

## 開発

必要なもの：Node.js 24、npm 12。`make deploy` には Docker（Compose v2）。

```bash
npm install            # web と E2E の依存関係
make web-dev           # http://127.0.0.1:5173
make verify            # Vitest（Go 版との一致テストを含む）、tsc、本番ビルド
make e2e               # Playwright E2E（Vite dev server を自動起動）
make deploy            # docker compose build → up -d → 本番構成でのブラウザ動作確認
```

`testdata/` の楽譜は、一致テストと E2E テストのフィクスチャです。長い実在の曲を使う一部の E2E テストは、手元の `samplefiles/`（または環境変数 `MLIGHTNOTE_SAMPLES_DIR`）に楽譜がある場合だけ動き、無ければスキップされます。実在の曲は著作権があるため、リポジトリには含めません。

### 構成

```
web/src/
  app/ features/ shared/   React 19 の画面（OSMD で譜面描画、Web Audio で再生）
  services/api/            画面から処理エンジンへの窓口（Worker 呼び出し、タブ間の同期）
  engine/                  処理エンジン（Web Worker 上で動く）
    domain/                正規化スコアモデル、有理数、音高・移調、編集オーバーレイ
    importers/             musicxml（.xml/.mxl）、midi（SMF パーサ＋採譜）
    exporters/displayxml/  表示用 MusicXML の生成（パート絞込・実音表示）
    playback/              再生プラン（反復展開、テンポ・強弱）
    editing/               型付きコマンド、revision、undo/redo、競合検出
    mlight/                .mlight パッケージの読み書きと検証
    storage/               IndexedDB（1操作＝1トランザクション）
    service/               13種類の操作（旧サーバー API と同じ入出力・エラーコード）
    __golden__/            旧 Go 実装の出力（一致テストの正解データ。固定）
testdata/                  小さなテスト用楽譜
e2e/ e2e-docker/           Playwright（開発サーバー向け／本番構成のスモーク）
deploy/                    Dockerfile、nginx（ローカルの静的配信、CSP）
docs/                      配信手順書（DEPLOY.md）、移行の経緯（history/）
```

初版は Go の API サーバーを持つ構成で、その処理を TypeScript に移植してブラウザだけで動くようにしました。経緯は [docs/history/FRONTEND_MIGRATION_PLAN.md](docs/history/FRONTEND_MIGRATION_PLAN.md) を参照してください。

## 貢献・不具合の報告

不具合の報告や提案は GitHub の Issue へどうぞ。プルリクエストでは `make verify` と `node_modules/.bin/playwright test` が通ることを確認してください（CI でも同じものを実行します）。テスト用の楽譜を追加する場合は、自作またはパブリックドメインのものに限ります。脆弱性は [SECURITY.md](SECURITY.md) の方法で非公開に報告してください。

## ライセンス

[MIT License](LICENSE)。アプリに同梱しているオープンソースソフトウェア（OpenSheetMusicDisplay、VexFlow、React など）のライセンスは、ビルド結果の `third-party-licenses.txt`（アプリのマニュアルからもリンク）にまとめています。
