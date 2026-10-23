import { logger } from "./logger";

/**
 * 住所から緯度経度を出す（国土地理院の住所検索。無料・登録不要）。
 *   https://msearch.gsi.go.jp/address-search/AddressSearch?q=住所
 * 返事は [{ geometry: { coordinates: [経度, 緯度] }, properties: { title: "東京都小平市花小金井一丁目" } }, …]。
 * 番地までは当たらないことがある（丁目までの位置になる）ので、見つかった地名（label）も返して画面で確かめてもらう。
 * 届かない・見つからないときは null（取引先の登録は止めない）。
 */
export interface GeoHit { lat: number; lng: number; label: string }

const cache = new Map<string, { at: number; hit: GeoHit | null }>();

export async function geocode(address: string): Promise<GeoHit | null> {
  const q = address.replace(/\s+/g, " ").trim();
  if (!q) return null;
  const c = cache.get(q);
  if (c && Date.now() - c.at < 24 * 3600_000) return c.hit;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`, { signal: ctl.signal, headers: { "User-Agent": "mikawa-payroll" } });
    clearTimeout(t);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const list = (await res.json()) as Array<{ geometry?: { coordinates?: [number, number] }; properties?: { title?: string } }>;
    const top = list.find((x) => Array.isArray(x.geometry?.coordinates));
    const hit = top ? { lng: Number(top.geometry!.coordinates![0]), lat: Number(top.geometry!.coordinates![1]), label: String(top.properties?.title ?? "") } : null;
    const ok = hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng) ? hit : null;
    cache.set(q, { at: Date.now(), hit: ok });
    if (cache.size > 500) cache.clear();
    return ok;
  } catch (err) {
    logger.warn({ err: String(err) }, "住所から位置を出せませんでした（国土地理院の住所検索）");
    return null;
  }
}
