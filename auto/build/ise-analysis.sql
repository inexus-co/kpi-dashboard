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
