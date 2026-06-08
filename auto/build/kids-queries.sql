-- Inexus Kids 利用実績ダッシュボード — 日次取得クエリ（全6本）
-- projectId: inexus-prod / location: asia-northeast1
-- いずれも execute_sql_readonly で実行し、結果(JSON)を build/raw/<name>.json に保存する。

-- [cumulative]  累計ユーザー数の推移（直近90日）
SELECT date, count
FROM `inexus-prod.kids_jp.all_user_aggregate_day`
WHERE env = 'all' AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
ORDER BY date;

-- [platform]  プラットフォーム別ユーザー構成（最新日を使用）
SELECT date, env, count
FROM `inexus-prod.kids_jp.all_user_aggregate_day`
WHERE env != 'all' AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY)
ORDER BY date;

-- [new_users]  新規ユーザー数（日次・直近30日）
SELECT date, count
FROM `inexus-prod.kids_jp.new_user_aggregate_day`
WHERE env = 'all' AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
ORDER BY date;

-- [dau]  DAU（日次アクティブユーザー・直近30日）
SELECT date, COUNT(DISTINCT uid) AS dau
FROM `inexus-prod.kids_jp.user_active_aggregate_day`
WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY date ORDER BY date;

-- [creators]  作品クリエイター累計（最新日を使用）
SELECT date, COUNT(*) AS c
FROM `inexus-prod.kids_jp.new_project_aggregate_day`
WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY)
GROUP BY date ORDER BY date DESC;

-- [engagement]  学習エンゲージメント＆作品アクション（日次・直近30日）
WITH np  AS (SELECT date, SUM(created)   v FROM `inexus-prod.kids_jp.new_project_aggregate_day`            WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) GROUP BY date),
     pub AS (SELECT date, SUM(published)  v FROM `inexus-prod.kids_jp.new_project_published_aggregate_day`  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) GROUP BY date),
     fav AS (SELECT date, SUM(favorited)  v FROM `inexus-prod.kids_jp.new_project_favorited_aggregate_day`  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) GROUP BY date),
     cop AS (SELECT date, SUM(copied)     v FROM `inexus-prod.kids_jp.new_project_copied_aggregate_day`     WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) GROUP BY date),
     prog AS (SELECT date, SUM(finished)  v FROM `inexus-prod.kids_jp.new_course_program_cleared_aggregate_day`   WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) GROUP BY date),
     algo AS (SELECT date, SUM(finished)  v FROM `inexus-prod.kids_jp.new_course_algorithm_cleared_aggregate_day` WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) GROUP BY date)
SELECT d.date,
       IFNULL(d.v,0)    AS created,
       IFNULL(pub.v,0)  AS published,
       IFNULL(fav.v,0)  AS favorited,
       IFNULL(cop.v,0)  AS copied,
       IFNULL(prog.v,0) AS prog_cleared,
       IFNULL(algo.v,0) AS algo_cleared
FROM np d
LEFT JOIN pub USING(date) LEFT JOIN fav USING(date) LEFT JOIN cop USING(date)
LEFT JOIN prog USING(date) LEFT JOIN algo USING(date)
ORDER BY d.date;
