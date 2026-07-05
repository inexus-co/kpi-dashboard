# CLAUDE.md

このリポジトリは iNexus の KPI ダッシュボード群（GitHub Pages で公開）を自動生成・公開するためのもの。

## 言語

- **すべての出力は日本語で書くこと。** ユーザーへの応答・通知（PushNotification）・エラー報告・コミットメッセージを含む。コード内のコメントも日本語。

## 構成

- ルート直下の `*.html` … `encrypt-wrap.js` で暗号化された公開ダッシュボード（GitHub Pages で配信）
- `auto/build/` … 生成・公開スクリプト（唯一の正）
- `auto/cache-*.enc` … 暗号化された永続キャッシュ（環境変数 `CACHE_KEY` で復号。`auto/build/cache-open.sh` 参照）
- `auto/cache/` … 作業用ディレクトリ（`auto/.gitignore` で無視。コミットされない）

## 注意

- ダッシュボードには社外共有されているページがある（例: `ise-chat-usage.html`）。Routine の指示なく内容・体裁を変更しない。
- push は各 publish スクリプト（内部で `auto/build/git-push-retry.sh`）経由で main へ行う。
