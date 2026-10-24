-- ISEちゃん 利用レポート（ise-analysis.html）の集計クエリ。BigQuery（inexus-prod）で実行する。
-- 🚨 会話の本文（question / answer）は外へ出さない。出すのは件数と教材ページの番号だけ。
-- 分類（AI.CLASSIFY）は BigQuery の中で行い、件数だけを受け取る。
-- 結果は build-ise-analysis.js の入力（ise_analysis.json）の各キーに入れる。

-- [daily] 日ごとの質問数・会話数・教材ページを案内した回答の数
SELECT FORMAT_DATE('%Y-%m-%d', DATE(timestamp,'Asia/Tokyo')) d, COUNT(*) turns,
 COUNTIF(jsonPayload.previous_response_id IS NULL OR jsonPayload.previous_response_id='') convs,
 COUNTIF(REGEXP_CONTAINS(jsonPayload.answer, r'ise-rika\.cf\.ocha\.ac\.jp/\d+')) links
FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout` WHERE jsonPayload.event='ise_chat' GROUP BY d ORDER BY d;

-- [hour] [dow] 時間帯（0〜23）と曜日（1=日〜7=土）ごとの質問数
SELECT EXTRACT(HOUR FROM DATETIME(timestamp,'Asia/Tokyo')) h, COUNT(*) n
FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout` WHERE jsonPayload.event='ise_chat' GROUP BY h;
SELECT EXTRACT(DAYOFWEEK FROM DATETIME(timestamp,'Asia/Tokyo')) w, COUNT(*) n
FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout` WHERE jsonPayload.event='ise_chat' GROUP BY w;

-- [purpose] 会話の最初の質問を8つに分けた件数（月別）
SELECT AI.CLASSIFY(jsonPayload.question, ['理科の質問・実験の相談','理科の教材や資料をさがす','他の教科の勉強（算数・国語・社会・英語など）','作文・レポート・発表の手伝い','あいさつ・ためし打ち・短い一言','いせちゃん自身についての質問','気持ち・悩み・生活の相談','遊び・ふざけ・その他の雑談']) cat,
 FORMAT_DATETIME('%m', DATETIME(timestamp,'Asia/Tokyo')) m, COUNT(*) n
FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout`
WHERE jsonPayload.event='ise_chat' AND (jsonPayload.previous_response_id IS NULL OR jsonPayload.previous_response_id='')
GROUP BY cat, m;

-- [unit] すべての質問を理科の4分野＋理科以外に分けた件数（月別）
SELECT AI.CLASSIFY(jsonPayload.question, ['物理（電気・光・力・音・磁石）','化学（物質・水溶液・燃焼・状態変化）','生物（植物・動物・人体）','地学（天気・地層・天体）','理科以外・雑談']) cat,
 FORMAT_DATETIME('%m', DATETIME(timestamp,'Asia/Tokyo')) m, COUNT(*) n
FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout` WHERE jsonPayload.event='ise_chat' GROUP BY cat, m;

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
  AI.CLASSIFY(r.q, ['理科の質問・実験の相談','理科の教材や資料をさがす','他の教科の勉強（算数・国語・社会・英語など）','作文・レポート・発表の手伝い','あいさつ・ためし打ち・短い一言','いせちゃん自身についての質問','気持ち・悩み・生活の相談','遊び・ふざけ・その他の雑談']) cat,
  IFNULL(n.turns, 1) turns
FROM roots r LEFT JOIN (SELECT root, COUNT(*) turns FROM chain GROUP BY root) n ON n.root = r.rid
ORDER BY r.jst DESC;

-- [watch] 見守り：直近24時間の質問のうち、命や身の安全に差し迫った心配がある内容（時刻と質問の文）。
-- 旧ページのルーティンがしていた「危機的な発言のチェック」を引き継ぐ。
-- 拾うのは「本当に大事なとき」だけ（2026-10-21 渡邉さん）。ISEちゃんはお茶大のサービスで、こちらは運営の受託＝
-- 利用者に何か言う立場ではない。見つかった日だけ、Slack の #ptnr-お茶の水女子大学（C08SVEUKW01）へ
-- 「このようなものがありました」とシンプルに知らせる（渡邉さんの許可・2026-10-21）。
-- 直近24時間にしているのは、毎朝の実行で同じものを2回知らせないため。
SELECT FORMAT_DATETIME('%m/%d %H:%M', DATETIME(timestamp,'Asia/Tokyo')) jst, SUBSTR(jsonPayload.question, 1, 120) question
FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout`
WHERE jsonPayload.event='ise_chat' AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
  AND AI.CLASSIFY(jsonPayload.question, ['命や身の安全に差し迫った心配がある内容（死にたい・自分を傷つける・虐待や暴力を受けている・身の危険を訴えている）','それ以外']) LIKE '命や身の安全%'
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
  SELECT rid FROM t WHERE jst >= DATETIME_SUB(CURRENT_DATETIME('Asia/Tokyo'), INTERVAL 14 DAY)
    AND AI.CLASSIFY(q, ['命や身の安全に差し迫った心配がある内容（死にたい・自分を傷つける・虐待や暴力を受けている・身の危険を訴えている）','それ以外']) LIKE '命や身の安全%'),
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
conv AS (SELECT root, COUNT(*) total FROM turns GROUP BY root)
SELECT FORMAT_DATETIME('%Y-%m-%d %H:%M', r.jst) conv_start, c.total, w.depth + 1 turn,
  FORMAT_DATETIME('%m/%d %H:%M', t.jst) jst, t.q question, t.a answer, w.flag
FROM win w JOIN t USING (rid) JOIN conv c USING (root) JOIN t r ON r.rid = w.root
ORDER BY conv_start DESC, turn;

