-- いせちゃん対話ログ（ise-rika）取得クエリ。BigQuery execute_sql_readonly で実行し、
-- 結果をそのまま auto/cache/ise_raw.json として保存する（build-ise.js の入力形式）。
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
ORDER BY timestamp
