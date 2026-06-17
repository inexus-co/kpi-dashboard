# KPI Dashboards

社内向けKPIダッシュボードの自動生成・公開リポジトリ。各ダッシュボードHTMLは
**AES-256-GCMで暗号化**してリポジトリ直下に置き、GitHub Pages（`main` / ルート配信）で公開する。
閲覧にはパスワードが必要（復号は閲覧者ブラウザ内＝WebCryptoでのみ行われ、平文はサーバに載らない）。

> ⚠️ このリポジトリ直下の `auto/build/` ＋ ルート直下の `*.html` ＋ `auto/cache-*.enc` が
> **唯一の正（source of truth）**。過去にローカルで作られた `build/` + `docs/` という別レイアウトの
> 試作があるが、それは**未デプロイ・廃止**。新規作業は必ず本リポの構成に合わせること。

## 構成

```
<repo root>/
├── *.html                 公開ダッシュボード（暗号化済み・GitHub Pagesで配信）
└── auto/
    ├── build/             生成スクリプト一式
    ├── cache-*.enc        永続データ（暗号化tar・コミット対象）
    └── cache/             実行時の作業ディレクトリ（.gitignore）
```

各ダッシュボードは共通のパイプラインで生成する：

```
データ取得/集計  →  内側HTML(平文)を描画  →  encrypt-wrap.js で暗号化  →  git-push-retry.sh で main へ push
 (*-fetch/parse)      (build-*/render-*)        (→ <name>.html)            (Pagesが自動配信)
```

- `auto/build/encrypt-wrap.js` … 内側HTML(平文)を AES-256-GCM/PBKDF2 で暗号化し、パスワードゲート付き自己完結HTMLに包む。
- `auto/build/git-push-retry.sh` … `pull --rebase` 付きリトライで `main` に push（複数ジョブの同時実行に耐える）。
- `auto/cache-*.enc` … API/ログ等の永続データを暗号化tarで保存（実行時に復号→更新→再封緘）。

## 新しいダッシュボードを追加するには

1. `auto/build/` に取得・集計・描画スクリプトを追加（既存の `*-publish.sh` / `build-*.js` / `render-*.js` を雛形にする）。
2. 公開HTMLは**リポジトリ直下**に出力（既存と同じ。`docs/` は使わない）。
3. 永続データが必要なら `auto/cache-<name>.enc`（暗号化tar）に蓄積し、作業ファイルは `auto/cache/`（.gitignore）に置く。
4. 生成は `encrypt-wrap.js` で暗号化し、`git-push-retry.sh` で push する。

## 実行・運用

- 自動実行はクラウドのスケジュール実行（毎朝、ジョブごとに数分ずらして push 競合を回避）。
- 秘密情報はリポジトリに置かず、実行環境の環境変数で渡す（暗号鍵・閲覧パスワード等）。
- コミットはボット名義。
- **詳細な運用手順（ジョブ一覧・データ源・鍵管理・トラブル対応）は社内の運用メモ（RUNBOOK）に記載**し、本リポジトリ（公開）には含めない。
