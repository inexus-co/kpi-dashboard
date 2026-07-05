-- いせちゃん対話ログ（ise-rika）増分取得クエリ。BigQuery execute_sql_readonly で実行し、
-- 結果をそのまま auto/cache/ise_new.json に保存する（merge-ise.js の入力形式）。
--
-- 手順:
--   1. bash auto/build/cache-open.sh cache-ise.enc でアーカイブを復号
--      （auto/cache/ise_archive.json / ise_ai.json / ise_meta.json が展開される）
--   2. auto/cache/ise_meta.json の sinceJst を下の <SINCE_JST> に代入して実行
--      （sinceJst は最終ターンの6時間前。オーバーラップの重複は merge-ise.js が rid で排除する）
--   3. 初回またはアーカイブが無い/壊れている場合は WHERE の DATETIME 条件行を外して全件取得
SELECT
  DATETIME(timestamp, 'Asia/Tokyo') AS jst,
  jsonPayload.event AS event,
  jsonPayload.question AS question,
  jsonPayload.answer AS answer,
  jsonPayload.error AS error,
  jsonPayload.response_id AS rid,
  jsonPayload.previous_response_id AS prevRid
FROM `inexus-prod.ise_analytics.run_googleapis_com_stdout`
WHERE jsonPayload.event = 'ise_chat'
  AND DATETIME(timestamp, 'Asia/Tokyo') > DATETIME '<SINCE_JST>'
ORDER BY timestamp
