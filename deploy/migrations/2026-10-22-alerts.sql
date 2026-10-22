-- 従業員のお知らせ：だれが読んだか／プッシュ通知を送ったか（追加のみ）。
CREATE TABLE IF NOT EXISTS alert_reads (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  key text NOT NULL,
  read_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT alert_reads_user_key_unique UNIQUE (user_id, key)
);
CREATE TABLE IF NOT EXISTS alert_pushes (
  key text PRIMARY KEY,
  pushed_at timestamp NOT NULL DEFAULT now()
);
