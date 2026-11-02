# セキュリティの報告

MLightNote の脆弱性を見つけた場合は、公開の Issue には書かず、GitHub の **Security** タブ → **Report a vulnerability**（非公開の報告）から知らせてください。

- 再現手順と、影響があると考える範囲を書いてください。
- 受け取ったら、できるだけ早く返信します。修正を公開するまでは内容を公開しないでください。

MLightNote はブラウザだけで動く静的サイトで、サーバーに楽譜やデータを送りません。主な防御は、取り込むファイル（MusicXML、MXL、MIDI、`.mlight`）の検証と、厳しい Content-Security-Policy です（[APP_DESIGN.md](APP_DESIGN.md) §16）。
