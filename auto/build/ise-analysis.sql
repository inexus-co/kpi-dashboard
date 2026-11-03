-- ISEちゃん 利用レポート（ise-analysis.html）の集計クエリ。BigQuery（inexus-prod）で実行する。
-- 🚨 会話の本文（question / answer）は外へ出さない。出すのは件数と教材ページの番号だけ。
-- 分類は ise-classify.js が Claude で新しい質問だけ1回行い、結果を ise_report.question_labels・conv_story に残す（2026-11-03〜）。
-- ここはその結果を読んで数えるだけ（AI は呼ばない）。それまでは AI.CLASSIFY（Gemini）で毎朝全期間を分類し直していた。
-- 結果は build-ise-analysis.js の入力（ise_analysis.json）の各キーに入れる。

-- [daily] 日ごとの質問数・会話数・教材ページを案内した回答の数
SELECT FORMAT_DATE('%Y-%m-%d', DATE(timestamp,'Asia/Tokyo')) d, COUNT(*) turns,
 COUNTIF(jsonPayload.previous_response_id IS NULL OR jsonPayload.previous_response_id='') convs,
 COUNTIF(REGEXP_CONTAINS(jsonPayload.answer, r'ise-rika\.cf\.ocha\.ac\.jp/\d+')) links
FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout` WHERE jsonPayload.event='ise_chat' GROUP BY d ORDER BY d;

-- [hour] 時間帯（0〜23）ごとの質問数
SELECT EXTRACT(HOUR FROM DATETIME(timestamp,'Asia/Tokyo')) h, COUNT(*) n
FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout` WHERE jsonPayload.event='ise_chat' GROUP BY h;
-- [dow] 曜日（1=日〜7=土）ごとの質問数
SELECT EXTRACT(DAYOFWEEK FROM DATETIME(timestamp,'Asia/Tokyo')) w, COUNT(*) n
FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout` WHERE jsonPayload.event='ise_chat' GROUP BY w;

-- [purpose] 会話の最初の質問を8つに分けた件数（月別）
SELECT purpose cat, FORMAT_DATETIME('%m', DATETIME(ts,'Asia/Tokyo')) m, COUNT(*) n
FROM `inexus-prod.ise_report.question_labels` WHERE is_start AND purpose IS NOT NULL GROUP BY cat, m;

-- [unit] すべての質問を理科の4分野＋理科以外に分けた件数（月別）
SELECT unit cat, FORMAT_DATETIME('%m', DATETIME(ts,'Asia/Tokyo')) m, COUNT(*) n
FROM `inexus-prod.ise_report.question_labels` WHERE unit IS NOT NULL GROUP BY cat, m;

-- [materials] 回答の中で案内した教材ページ（番号）の上位10と、その題名。
-- 題名は ISEちゃんの裏側のデータベース（Cloud SQL の ise_prod.ise_posts＝WordPress の記事更新で自動で取り込み直される写し）から
-- BigQuery の接続 inexus-kids-db 経由で引く。題名が変わっても自動で追いかける。
WITH l AS (SELECT REGEXP_EXTRACT_ALL(jsonPayload.answer, r'ise-rika\.cf\.ocha\.ac\.jp/(\d+)') ids
  FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout` WHERE jsonPayload.event='ise_chat'),
c AS (SELECT id, COUNT(*) n FROM l, UNNEST(ids) id GROUP BY id),
p AS (SELECT CAST(id AS STRING) id, title FROM EXTERNAL_QUERY('981847209128.asia-northeast1.inexus-kids-db', 'SELECT id, title FROM ise_prod.ise_posts'))
SELECT c.id, p.title, c.n FROM c LEFT JOIN p USING(id) ORDER BY c.n DESC LIMIT 10;

-- [recent] 直近14日の会話（新しい順に最大30件）。会話の最初の質問と最初の回答、使い道の分類、
-- その会話の中の往復の数。ページ下の「実際のやり取り」に載せる（お茶大には会話をそのまま見せてよい＝2026-07-01 渡邉さん）。
-- 🚨 本文を扱うのはこのクエリだけ。結果のファイル（recent.json）はコミットしない（auto/cache の中だけ）。
WITH RECURSIVE t AS (
  SELECT DATETIME(timestamp,'Asia/Tokyo') jst, jsonPayload.question q, jsonPayload.answer a,
    jsonPayload.response_id rid, NULLIF(jsonPayload.previous_response_id,'') prev
  FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout`
  WHERE jsonPayload.event='ise_chat' AND DATE(timestamp,'Asia/Tokyo') >= DATE_SUB(CURRENT_DATE('Asia/Tokyo'), INTERVAL 14 DAY)),
roots AS (SELECT * FROM t WHERE prev IS NULL ORDER BY jst DESC LIMIT 30),
chain AS (
  SELECT rid AS root, rid FROM roots
  UNION ALL
  SELECT c.root, t.rid FROM chain c JOIN t ON t.prev = c.rid)
SELECT FORMAT_DATETIME('%Y-%m-%d %H:%M', r.jst) jst, r.q question, r.a answer,
  l.purpose cat,
  IFNULL(n.turns, 1) turns
FROM roots r LEFT JOIN (SELECT root, COUNT(*) turns FROM chain GROUP BY root) n ON n.root = r.rid
  LEFT JOIN `inexus-prod.ise_report.question_labels` l ON l.rid = r.rid
ORDER BY r.jst DESC;

-- [watch] 見守り：直近24時間の質問のうち、命や身の安全に差し迫った心配がある内容（時刻と質問の文）。
-- 旧ページのルーティンがしていた「危機的な発言のチェック」を引き継ぐ。
-- 拾うのは「本当に大事なとき」だけ（2026-10-21 渡邉さん）。ISEちゃんはお茶大のサービスで、こちらは運営の受託＝
-- 利用者に何か言う立場ではない。見つかった日だけ、Slack の #ptnr-お茶の水女子大学（C08SVEUKW01）へ
-- 「このようなものがありました」とシンプルに知らせる（渡邉さんの許可・2026-10-21）。
-- 直近24時間にしているのは、毎朝の実行で同じものを2回知らせないため。
-- 台風・地震などの災害や、けが・病気のときの行動を聞く知識の質問は外す（10/25「今台風がおきています。どう行動したらいい？」を拾った・2026-10-29 渡邉さん了承）。
-- 外す判定は「本人の気持ち・つらさの訴え」と並べて聞く＝2択だと「大人の人いない」まで知識の質問に寄った（10/29 実測）。
-- 2026-11-02〜 会話ごとの2段目の判定：会話の始まりからの質問をまとめて読ませ、会話全体が物語・ごっこ遊び・ゲームで、
-- 本人の現実の訴えが混じっていないものは、Slack へ知らせない（11/01 の「堕天使」「回復魔法」の会話を12件知らせた・渡邉さん了承）。
-- 外したものもページの「見守り」の節には印を付けて残す（[watchconv] の story）。迷うもの・本人の訴えが混じるものは知らせる側に倒す。
-- 1問ずつ・直前2問だけで読ませる形は、会話の出だしの問いを「本人の訴え」と読んだ（11/02 実測）＝会話全体で1回判定する。
WITH RECURSIVE t AS (
  SELECT rid, ANY_VALUE(jst) jst, ANY_VALUE(prev) prev, ANY_VALUE(q) q FROM (
    SELECT DATETIME(timestamp,'Asia/Tokyo') jst, jsonPayload.response_id rid, NULLIF(jsonPayload.previous_response_id,'') prev, jsonPayload.question q
    FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout`
    WHERE jsonPayload.event='ise_chat' AND DATE(timestamp,'Asia/Tokyo') >= DATE_SUB(CURRENT_DATE('Asia/Tokyo'), INTERVAL 45 DAY)) GROUP BY rid),
flagged AS (
  SELECT rid FROM t JOIN `inexus-prod.ise_report.question_labels` l USING (rid) WHERE l.danger = 'danger'
    AND t.jst >= DATETIME_SUB(CURRENT_DATETIME('Asia/Tokyo'), INTERVAL 24 HOUR)),
up AS (
  SELECT f.rid start, t.rid cur, t.prev, 0 n FROM flagged f JOIN t USING (rid)
  UNION ALL
  SELECT u.start, t.rid, t.prev, u.n+1 FROM up u JOIN t ON t.rid = u.prev WHERE u.n < 300),
roots AS (SELECT start rid, ARRAY_AGG(cur ORDER BY n DESC LIMIT 1)[OFFSET(0)] root FROM up GROUP BY start),
down AS (
  SELECT root, root rid, 0 depth FROM (SELECT DISTINCT root FROM roots)
  UNION ALL
  SELECT d.root, t.rid, d.depth+1 FROM down d JOIN t ON t.prev = d.rid WHERE d.depth < 300),
story AS (SELECT root, story FROM `inexus-prod.ise_report.conv_story`)
SELECT FORMAT_DATETIME('%m/%d %H:%M', t.jst) jst, SUBSTR(t.q, 1, 120) question
FROM flagged f JOIN t USING (rid) JOIN roots r USING (rid) LEFT JOIN story s ON s.root = r.root
WHERE NOT IFNULL(s.story, FALSE)
ORDER BY jst;

-- [watchconv] 見守りの会話（直近14日）。心配な質問があった会話ごとに、その質問と前2往復・後1往復を本文つきで出す。
-- ページの「見守り」の節（#watch）に載せ、Slack の知らせからリンクで見に行けるようにする（2026-10-24 渡邉さん「通報だけでは何をすればいいか分からない・詳しく見に行ける場所を」）。
-- 🚨 本文を扱うクエリ。結果（watchconv.json）は auto/cache の中だけに置き、コミットしない。
-- 会話は response_id → previous_response_id でつながる。長い会話（90往復超）もあるので、さかのぼりは 300 段まで・最初の質問を探すために 45 日分を見る。
WITH RECURSIVE t AS (
  SELECT rid, ANY_VALUE(jst) jst, ANY_VALUE(prev) prev, ANY_VALUE(q) q, ANY_VALUE(a) a FROM (
    SELECT DATETIME(timestamp,'Asia/Tokyo') jst, jsonPayload.response_id rid, NULLIF(jsonPayload.previous_response_id,'') prev,
      jsonPayload.question q, jsonPayload.answer a
    FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout`
    WHERE jsonPayload.event='ise_chat' AND DATE(timestamp,'Asia/Tokyo') >= DATE_SUB(CURRENT_DATE('Asia/Tokyo'), INTERVAL 45 DAY)) GROUP BY rid),
flagged AS (
  SELECT rid FROM t JOIN `inexus-prod.ise_report.question_labels` l USING (rid) WHERE l.danger = 'danger'
    AND t.jst >= DATETIME_SUB(CURRENT_DATETIME('Asia/Tokyo'), INTERVAL 14 DAY)),
up AS (
  SELECT f.rid start, t.rid cur, t.prev, 0 n FROM flagged f JOIN t USING (rid)
  UNION ALL
  SELECT u.start, t.rid, t.prev, u.n+1 FROM up u JOIN t ON t.rid = u.prev WHERE u.n < 300),
roots AS (SELECT DISTINCT ARRAY_AGG(cur ORDER BY n DESC LIMIT 1)[OFFSET(0)] root FROM up GROUP BY start),
down AS (
  SELECT root, root rid, 0 depth FROM roots
  UNION ALL
  SELECT d.root, t.rid, d.depth+1 FROM down d JOIN t ON t.prev = d.rid WHERE d.depth < 300),
turns AS (SELECT d.root, d.depth, d.rid, f.rid IS NOT NULL flag FROM down d LEFT JOIN flagged f USING (rid)),
win AS (SELECT DISTINCT x.root, x.depth, x.rid, x.flag FROM turns x JOIN turns y ON x.root = y.root AND y.flag AND x.depth BETWEEN y.depth - 2 AND y.depth + 1),
conv AS (SELECT root, COUNT(*) total FROM turns GROUP BY root),
-- 会話全体が物語・ごっこ遊びか（[watch] と同じ判定。true の会話は Slack へ知らせず、ページに印を付けて載せる）
story AS (SELECT root, story FROM `inexus-prod.ise_report.conv_story`)
SELECT FORMAT_DATETIME('%Y-%m-%d %H:%M', r.jst) conv_start, c.total, w.depth + 1 turn,
  FORMAT_DATETIME('%m/%d %H:%M', t.jst) jst, t.q question, t.a answer, w.flag, IFNULL(s.story, FALSE) story
FROM win w JOIN t USING (rid) JOIN conv c USING (root) JOIN t r ON r.rid = w.root LEFT JOIN story s ON s.root = w.root
ORDER BY conv_start DESC, turn;

