/**
 * 全銀協フォーマット（総合振込・給与振込）の書き出し。
 *
 * 形式の出どころ：一般社団法人 全国銀行協会「全銀協規定フォーマット」（総合振込／給与・賞与振込の
 * 依頼明細）。各行は固定長120バイト。ヘッダー（1）→ データ（2）を件数分 → トレーラー（8）→ エンド（9）。
 * 使える文字は JIS X 0201 の半角（英大文字・数字・半角カナ・一部の記号）だけ（コード区分 0＝JIS/SJIS）。
 * 銀行ごとに細かな指定（改行の有無・振込指定区分など）が違うため、そこは振込元の設定で選べるようにしてある。
 *
 *   ヘッダー  : データ区分1 / 種別コード2 / コード区分1 / 委託者コード10 / 委託者名40 / 取組日4(MMDD)
 *               / 仕向銀行番号4 / 仕向銀行名15 / 仕向支店番号3 / 仕向支店名15 / 預金種目1 / 口座番号7 / ダミー17
 *   データ    : データ区分1 / 被仕向銀行番号4 / 被仕向銀行名15 / 被仕向支店番号3 / 被仕向支店名15
 *               / 手形交換所番号4 / 預金種目1 / 口座番号7 / 受取人名30 / 振込金額10 / 新規コード1
 *               / 顧客コード1 10 / 顧客コード2 10 / 振込指定区分1 / 識別表示1 / ダミー7
 *   トレーラー: データ区分1 / 合計件数6 / 合計金額12 / ダミー101
 *   エンド    : データ区分1 / ダミー119
 */

// 全角カナ → 半角カナ（濁点・半濁点は2文字に分かれる）
const FULL = "ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ";
const HALF = [
  "ｱ", "ｱ", "ｲ", "ｲ", "ｳ", "ｳ", "ｴ", "ｴ", "ｵ", "ｵ", "ｶ", "ｶﾞ", "ｷ", "ｷﾞ", "ｸ", "ｸﾞ", "ｹ", "ｹﾞ", "ｺ", "ｺﾞ",
  "ｻ", "ｻﾞ", "ｼ", "ｼﾞ", "ｽ", "ｽﾞ", "ｾ", "ｾﾞ", "ｿ", "ｿﾞ", "ﾀ", "ﾀﾞ", "ﾁ", "ﾁﾞ", "ﾂ", "ﾂ", "ﾂﾞ", "ﾃ", "ﾃﾞ", "ﾄ", "ﾄﾞ",
  "ﾅ", "ﾆ", "ﾇ", "ﾈ", "ﾉ", "ﾊ", "ﾊﾞ", "ﾊﾟ", "ﾋ", "ﾋﾞ", "ﾋﾟ", "ﾌ", "ﾌﾞ", "ﾌﾟ", "ﾍ", "ﾍﾞ", "ﾍﾟ", "ﾎ", "ﾎﾞ", "ﾎﾟ",
  "ﾏ", "ﾐ", "ﾑ", "ﾒ", "ﾓ", "ﾔ", "ﾔ", "ﾕ", "ﾕ", "ﾖ", "ﾖ", "ﾗ", "ﾘ", "ﾙ", "ﾚ", "ﾛ", "ﾜ", "ﾜ", "ｲ", "ｴ", "ｦ", "ﾝ", "ｳﾞ", "ｶ", "ｹ",
];
// ※ 拗音・促音の小さい字（ャ・ッ など）は、全銀の決まりで大きい字にする（上の表で ｬ ではなく ﾔ にしてある）

// 全銀で使える半角の文字（数字・英大文字・半角カナ・濁点・半濁点・空白と一部の記号）
const ALLOWED = /^[0-9A-Zｱ-ﾝﾞﾟｦ ().,\-/]*$/;

/** 名前（カナ）を全銀で使える半角の文字に直す。直せない字（漢字など）があれば null。 */
export function toZenginKana(input: string): string | null {
  let s = (input ?? "").normalize("NFKC"); // 全角英数→半角、半角カナ→全角カナ にそろえてから直す
  // ひらがな→カタカナ
  s = s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  s = s.toUpperCase().replace(/[　]/g, " ").replace(/[ー－‐−]/g, "-").replace(/[（]/g, "(").replace(/[）]/g, ")").replace(/[・･]/g, ".");
  let out = "";
  for (const ch of s) {
    const i = FULL.indexOf(ch);
    if (i >= 0) { out += HALF[i]; continue; }
    if (ch === "゛") { out += "ﾞ"; continue; }
    if (ch === "゜") { out += "ﾟ"; continue; }
    out += ch;
  }
  out = out.replace(/\s+/g, " ").trim();
  return ALLOWED.test(out) ? out : null;
}

/** 半角の文字列を JIS X 0201（Shift_JIS の1バイト）に直す。ASCII はそのまま、半角カナは 0xA1〜0xDF。 */
function toBytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0xff61 && c <= 0xff9f) out.push(c - 0xff61 + 0xa1);
    else if (c < 0x80) out.push(c);
    else out.push(0x20); // ここには来ない（toZenginKana で弾いている）
  }
  return out;
}

/** 左詰め・後ろを空白で埋める（長ければ切る）。バイト数で数える */
function alpha(s: string, len: number): number[] {
  const b = toBytes(s).slice(0, len);
  while (b.length < len) b.push(0x20);
  return b;
}

/** 右詰め・前を0で埋める数字 */
function num(n: string | number, len: number): number[] {
  const s = String(n).replace(/\D/g, "");
  if (s.length > len) throw new Error(`桁数が多すぎます（${len}桁まで）: ${s}`);
  return toBytes(s.padStart(len, "0"));
}

function blank(len: number): number[] {
  return new Array(len).fill(0x20);
}

export interface ZenginSource {
  consignorCode: string;
  consignorName: string;
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: number;
  accountNumber: string;
  kindCode: string;
  designation: string;
  newline: boolean;
}

export interface ZenginTarget {
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: number;
  accountNumber: string;
  holderKana: string;
  amount: number;
  /** 顧客コード（社員番号を数字だけにしたもの。入らなければ空欄）*/
  customerCode?: string;
}

/** 銀行名・支店名はカナで直せなければ空欄にする（データレコードでは任意の欄。推測で埋めない） */
function kanaOrBlank(s: string): string {
  return toZenginKana(s) ?? "";
}

/** 全銀の振込データ（Shift_JIS のバイト列）を作る。取組日は MMDD。 */
export function buildZengin(src: ZenginSource, transferMMDD: string, targets: ZenginTarget[]): Buffer {
  const lines: number[][] = [];
  const consignorName = toZenginKana(src.consignorName);
  if (consignorName === null) throw new Error("委託者名はカナで入れてください。");

  lines.push([
    ...toBytes("1"),
    ...num(src.kindCode, 2),
    ...toBytes("0"),
    ...num(src.consignorCode, 10),
    ...alpha(consignorName, 40),
    ...num(transferMMDD, 4),
    ...num(src.bankCode, 4),
    ...alpha(kanaOrBlank(src.bankName), 15),
    ...num(src.branchCode, 3),
    ...alpha(kanaOrBlank(src.branchName), 15),
    ...num(src.accountType, 1),
    ...num(src.accountNumber, 7),
    ...blank(17),
  ]);

  let total = 0;
  for (const t of targets) {
    const holder = toZenginKana(t.holderKana);
    if (!holder) throw new Error("口座名義（カナ）が入っていないか、カナ以外の字があります。");
    total += t.amount;
    const designation = (src.designation ?? "").slice(0, 1);
    lines.push([
      ...toBytes("2"),
      ...num(t.bankCode, 4),
      ...alpha(kanaOrBlank(t.bankName), 15),
      ...num(t.branchCode, 3),
      ...alpha(kanaOrBlank(t.branchName), 15),
      ...blank(4),
      ...num(t.accountType, 1),
      ...num(t.accountNumber, 7),
      ...alpha(holder, 30),
      ...num(Math.round(t.amount), 10),
      ...toBytes("0"),
      ...(t.customerCode ? num(t.customerCode.slice(-10), 10) : blank(10)),
      ...blank(10),
      ...alpha(designation, 1),
      ...blank(1),
      ...blank(7),
    ]);
  }

  lines.push([...toBytes("8"), ...num(targets.length, 6), ...num(total, 12), ...blank(101)]);
  lines.push([...toBytes("9"), ...blank(119)]);

  for (const l of lines) {
    if (l.length !== 120) throw new Error(`1行が120バイトになっていません（${l.length}バイト）`);
  }
  const sep = src.newline ? [0x0d, 0x0a] : [];
  return Buffer.from(lines.flatMap((l) => [...l, ...sep]));
}
