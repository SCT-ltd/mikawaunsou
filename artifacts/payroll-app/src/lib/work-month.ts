import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGetCompany } from "@workspace/api-client-react";

/**
 * 作業中の月（と社員）を画面どうしで共有する。
 *
 * 以前は画面ごとに「今日の年月」で始まっていた。10月22日に開くと10月が出るが、
 * 事務所が毎月はじめに作業するのは前の月の給与なので、毎回月を選び直す必要があった。
 * また月次実績入力で9月を選んでから給与明細へ移ると、また10月に戻っていた。
 *
 * 決め方（上から順に使う）
 *   1. アドレスの ?y=2026&m=9（お知らせ・ダッシュボードから開いたとき）
 *   2. このタブで最後に選んだ月（sessionStorage。別の画面へ移っても同じ月）
 *   3. 会社設定の締め日・支払日から、いま作業している給与の月を出す
 *
 * 選んだ月はアドレスにも入れるので、そのままブックマーク・再読み込みしても同じ月が開く。
 */

const STORE_KEY = "mikawa.workMonth";

export interface YM {
  year: number;
  month: number;
}

/**
 * 締め日・支払日から「いま作業中の給与の月」を出す。
 *   - 支払日が締め日より前（例: 末締め・翌月10日払い）… 支払日までは前の月、過ぎたら今月
 *   - 支払日が締め日より後（例: 15日締め・当月25日払い）… 支払日までは今月、過ぎたら翌月
 * ※推測を含む：締め日・支払日の意味は会社設定の説明どおり（月次実績の「月」＝締めた月）として扱う。
 */
export function defaultWorkMonth(closingDay: number | undefined, paymentDay: number | undefined, today = new Date()): YM {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();
  const close = closingDay ?? 31;
  const pay = paymentDay ?? 25;
  const shift = (delta: number): YM => {
    const t = new Date(y, m - 1 + delta, 1);
    return { year: t.getFullYear(), month: t.getMonth() + 1 };
  };
  if (pay <= close) return d <= pay ? shift(-1) : shift(0);
  return d <= pay ? shift(0) : shift(1);
}

function readUrl(): { ym: YM | null; emp: number | null } {
  const p = new URLSearchParams(window.location.search);
  const y = Number(p.get("y"));
  const m = Number(p.get("m"));
  const e = Number(p.get("emp"));
  return {
    ym: Number.isInteger(y) && y > 2000 && Number.isInteger(m) && m >= 1 && m <= 12 ? { year: y, month: m } : null,
    emp: Number.isInteger(e) && e > 0 ? e : null,
  };
}

function readStore(): YM | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "null") as YM | null;
    if (v && Number.isInteger(v.year) && Number.isInteger(v.month) && v.month >= 1 && v.month <= 12) return v;
  } catch { /* 読めなければ使わない */ }
  return null;
}

function writeStore(ym: YM) {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(ym)); } catch { /* 保存できなくても画面は動く */ }
}

/** アドレスの ?y= ?m= ?emp= を書き換える（履歴は増やさない） */
function writeUrl(ym: YM | null, emp: number | null | undefined) {
  const url = new URL(window.location.href);
  if (ym) {
    url.searchParams.set("y", String(ym.year));
    url.searchParams.set("m", String(ym.month));
  }
  if (emp !== undefined) {
    if (emp === null) url.searchParams.delete("emp");
    else url.searchParams.set("emp", String(emp));
  }
  const next = url.pathname + url.search + url.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState(window.history.state, "", next);
  }
}

/** 他の画面へ移るときの href に、いまの作業月を付ける（例: /payroll → /payroll?y=2026&m=9） */
export function withWorkMonth(href: string): string {
  const ym = readStore();
  if (!ym || /[?&]y=/.test(href)) return href;
  return `${href}${href.includes("?") ? "&" : "?"}y=${ym.year}&m=${ym.month}`;
}

/**
 * 作業中の月と、アドレスで指定された社員を返す。
 * ready が false のあいだ（会社設定の読み込み中で、アドレスにも控えにも月が無いとき）は
 * 仮の月を返すので、その間は読み込みを始めないこと。
 */
export function useWorkMonth() {
  const { data: company } = useGetCompany();
  const initial = useRef(readUrl());
  const [ym, setYm] = useState<YM | null>(() => initial.current.ym ?? readStore());
  const [empFromUrl] = useState<number | null>(initial.current.emp);

  // 月がまだ決まらないときは、会社設定が届いた時点で締め日・支払日から決める
  useEffect(() => {
    if (ym || !company) return;
    const c = company as { closingDay?: number; paymentDay?: number };
    setYm(defaultWorkMonth(c.closingDay, c.paymentDay));
  }, [ym, company]);

  // 決まった月はアドレスと控えの両方に入れる
  useEffect(() => {
    if (!ym) return;
    writeStore(ym);
    writeUrl(ym, undefined);
  }, [ym]);

  const setWorkMonth = useCallback((year: number, month: number) => setYm({ year, month }), []);
  /** アドレスの ?emp= を書き換える（選んだ社員を残しておくと、再読み込みしても同じ人が開く） */
  const setEmpInUrl = useCallback((id: number | null) => writeUrl(null, id), []);

  const fallback = useMemo(() => defaultWorkMonth(undefined, undefined), []);
  return {
    year: (ym ?? fallback).year,
    month: (ym ?? fallback).month,
    ready: ym !== null,
    setWorkMonth,
    empFromUrl,
    setEmpInUrl,
  };
}
