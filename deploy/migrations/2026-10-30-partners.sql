-- 取引先マスター（地図の「場所」と同じ表に、電話・担当者・位置の出どころを足す）。追加のみ
ALTER TABLE places ADD COLUMN IF NOT EXISTS geo_source text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS geo_label text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS contact text;
-- 住所から位置が出せなかった取引先も登録できるように（地図には出さない）
ALTER TABLE places ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE places ALTER COLUMN longitude DROP NOT NULL;
-- これまで地図で押して登録した場所は「地図で決めた」位置
UPDATE places SET geo_source = 'manual' WHERE geo_source IS NULL AND latitude IS NOT NULL;
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamp NOT NULL DEFAULT now());
INSERT INTO schema_migrations (name) VALUES ('2026-10-30-partners.sql') ON CONFLICT DO NOTHING;
