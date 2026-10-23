/**
 * 画面ごとのガイド（右上の「ガイド」で順番に説明する）。
 * target の書き方（components/guide/guide.tsx の findTarget）
 *   css:セレクタ        … その要素を照らす
 *   text:文字           … その文字で始まるボタン・タブ・見出しなどを照らす（空白は無視）
 *   card:文字           … その文字を含む枠（カード）ごと照らす
 *   なし                … 画面の真ん中に説明だけ出す
 * 照らす物が見つからないときも説明は出る。画面の言葉を変えたら、ここも直す。
 */
export interface GuideStep { title: string; body: string; target?: string }
export interface Guide { key: string; title: string; steps: GuideStep[] }

/** 左のメニュー（スマホでは隠れているので、メニューを開くボタンを照らす） */
const nav = (href: string) => `css:[data-tour-nav="${href}"] || css:button[aria-label=メニューを開く]`;
const AGAIN: GuideStep = {
  title: "もう一度見たいときは",
  body: "このガイドは、右上の「ガイド」を押すといつでも最初から見られます。\n← → キーで進む・戻る、Esc で閉じられます。",
  target: "css:[data-tour=guide-btn]",
};

const GUIDES: Record<string, Guide> = {
  "/": {
    key: "dashboard", title: "ダッシュボード", steps: [
      { title: "ようこそ", body: "ここは給与と勤怠の全体をひと目で見る画面です。\nはじめに、左のメニューで何ができるかを順番にご案内します。" },
      { title: "毎日の仕事", body: "「リアルタイムマップ」でスタッフの今いる場所、「メッセージ」でスタッフとのやりとり、「勤怠管理」で今日の出勤・退勤を見ます。", target: nav("/attendance") },
      { title: "月の締め", body: "月末は「月の勤怠表」で打刻を確かめ →「月次実績入力」で勤怠を取り込み → 「給与明細」で計算・確定・印刷、の順に進めます。", target: nav("/monthly-input") },
      { title: "給与明細", body: "計算した明細の確認・確定・印刷・振込の書き出しはここです。", target: nav("/payroll") },
      { title: "マスター管理", body: "社員・手当・差引・取引先など、計算のもとになる情報はここで登録します。", target: nav("/allowances") },
      { title: "見たい月を選ぶ", body: "ダッシュボードに出す月を切り替えます。", target: "text:2026年" },
      { title: "お知らせと要対応", body: "年齢で保険料が変わる人、固定残業代が足りない人など、気をつけることが自動で並びます。押すと詳しく出ます。\n「要対応」は先に片付けてください。", target: "card:従業員のお知らせ" },
      { title: "今月の数字", body: "支給総額・確定した人数・手取りの平均・社会保険料と税金を出しています。", target: "card:支給総額" },
      { title: "ベルのマーク", body: "打刻の修正申請やメッセージなど、新しい知らせが届くと数字が付きます。", target: "css:[data-tour=bell]" },
      { title: "アップデート", body: "このシステムに加えた変更は、左のいちばん下「アップデート」で見られます。新しいものがあると NEW が付きます。", target: nav("/updates") },
      AGAIN,
    ],
  },
  "/realtime-map": {
    key: "realtime-map", title: "リアルタイムマップ", steps: [
      { title: "スタッフの今いる場所", body: "出勤中のスタッフの位置が地図に出ます。位置はスタッフのスマホの打刻ページから届きます（出勤中だけ）。" },
      { title: "4つの切り替え", body: "「社員」＝今の位置／「道すじ」＝1日に通った道／「場所」＝取引先や現場の登録／「到着・出発」＝登録した場所に着いた・出た時刻。", target: "text:社員" },
      { title: "状態で絞る", body: "出勤中・休憩中・未出勤などで一覧を絞れます。「位置が届かない」は、スマホから位置がしばらく来ていない人です。", target: "text:すべて" },
      { title: "社員の一覧", body: "名前を押すと、地図がその人の場所へ動きます。", target: "css:#layout-main input[placeholder*=氏名]" },
      { title: "近い人を探す", body: "押してから地図の上の場所を押すと、そこにいちばん近いスタッフが順に出ます。急ぎの仕事を頼みたいときに。", target: "text:近い人を探す" },
      { title: "設定", body: "位置を残す日数や、長く止まっている人を知らせる時間などを決めます。", target: "css:[data-map-tool=settings]" },
      { title: "最新にする", body: "位置は自動で新しくなりますが、すぐ見たいときは「更新」を押してください。", target: "text:更新" },
      AGAIN,
    ],
  },
  "/messages": {
    key: "messages", title: "メッセージ", steps: [
      { title: "スタッフとのやりとり", body: "スタッフのスマホ（打刻ページ）とメッセージを送り合えます。写真やPDFも送れます。" },
      { title: "相手を選ぶ", body: "左の一覧から相手を選ぶと、右に会話が出ます。名前や所属で探せます。", target: "css:#layout-main input[placeholder*=氏名]" },
      { title: "一斉送信", body: "メガホンのボタンで、選んだスタッフ全員に同じメッセージを送れます（事務所だけの機能です）。所属ごとにまとめて選べます。", target: "css:button[title=一斉送信]" },
      { title: "通知", body: "ベルのボタンで、このパソコンに新しいメッセージの通知を出せます。", target: "css:#layout-main button[title*=通知]" },
      { title: "既読", body: "こちらから送ったメッセージは、スタッフが開くと「既読 時:分」に変わります。まだ読まれていなければ「未読」です。" },
      AGAIN,
    ],
  },
  "/attendance": {
    key: "attendance", title: "勤怠管理", steps: [
      { title: "今日の出勤・退勤", body: "スタッフの打刻がそのまま届き、自動で新しくなります（LIVE）。" },
      { title: "日付", body: "前の日・次の日に切り替えて、ほかの日の勤怠も見られます。", target: "text:2026年" },
      { title: "状態の数", body: "出勤中・休憩中・退勤済・未出勤の人数です。押すとその人だけに絞れます。「要確認」は打ち忘れなど直したほうがよい人です。", target: "text:全員" },
      { title: "見方を切り替える", body: "「やること」＝片付ける順に並べた一覧／「一覧」＝全員の表／「タイムライン」＝1日の時間の帯。", target: "text:やること" },
      { title: "1人ずつの詳しい画面", body: "名前を押すと右に、その人の打刻と予定が出ます。メッセージを送る・地図で見る・QRコードを出すこともここから。", target: "text:メッセージ" },
      { title: "打刻を足す・直す", body: "打ち忘れは「打刻を追加」で事務所から入れられます。休みは「欠勤・休暇登録」で入れます。", target: "text:打刻を追加" },
      { title: "ほかの画面へ", body: "月の表は「月の勤怠表」、スタッフからの修正申請・アルコールチェック・日報は「修正申請・アルコール・日報」へ。", target: "text:月の勤怠表" },
      AGAIN,
    ],
  },
  "/attendance-month": {
    key: "attendance-month", title: "月の勤怠表", steps: [
      { title: "1か月の勤怠を1枚で", body: "縦が社員、横が日付です。マスの上が出勤、下が退勤の時刻です。" },
      { title: "色の意味", body: "出勤なし・退勤なし、遅刻・早退、休み、予定だけ、を色で分けています。色の付いたマスを先に確かめてください。", target: "card:出勤なし・退勤なし" },
      { title: "マスを押して直す", body: "マスを押すとその日の予定を直せます。名前を押すと、曜日ごとの決まった出勤の予定（予定の型）を決められます。", target: "re:予定の型" },
      { title: "締めの確認", body: "直すものが残っていないか、修正申請が残っていないかがここに出ます。", target: "card:締めの確認" },
      { title: "月次実績へ取り込む", body: "確かめ終わったら、このボタンで月次実績入力へ進みます。勤怠の日数・時間がまとめて入ります。", target: "text:月次実績入力へ" },
      { title: "書き出し・印刷", body: "CSV（表計算用）や印刷もできます。", target: "text:CSV" },
      AGAIN,
    ],
  },
  "/attendance-records": {
    key: "attendance-records", title: "勤怠の記録", steps: [
      { title: "スタッフから届いたもの", body: "打刻の修正申請・アルコールチェック・日報など、スタッフのスマホから届いた記録を確かめる画面です。" },
      { title: "種類を切り替える", body: "修正申請／アルコールチェック／日報／改善基準（月の拘束時間など）／勤怠の設定、を上で切り替えます。", target: "text:修正申請" },
      { title: "修正申請を片付ける", body: "「確認待ち」が、まだ事務所が見ていない申請です。中身を見て「承認」か「見送り」を選ぶと、打刻に反映されます。", target: "text:確認待ち" },
      { title: "改善基準", body: "トラックの運転者の拘束時間・休息の決まりを超えていないかを、月ごとに確かめられます。", target: "text:改善基準" },
      { title: "勤怠の設定", body: "遅刻の猶予や休憩の決まりなど、勤怠の数え方はここで決めます。", target: "text:勤怠の設定" },
      AGAIN,
    ],
  },
  "/monthly-input": {
    key: "monthly-input", title: "月次実績入力", steps: [
      { title: "給与のもとになる数字", body: "社員ごとに、出勤日数・残業時間・走行距離・手当などを入れて、給与を計算する画面です。" },
      { title: "月を選ぶ", body: "入力する月です。", target: "text:2026年" },
      { title: "勤怠から一括反映", body: "打刻の記録から、出勤日数・残業・深夜の時間を全員まとめて入れます。まずこれを押すと早いです。", target: "text:勤怠から一括反映" },
      { title: "絞り込み", body: "未入力・変更あり（保存していない）・未計算・確定済で絞れます。", target: "text:全員" },
      { title: "社員を選ぶ", body: "左の一覧から社員を選ぶと右に入力欄が出ます。Ctrl＋↑↓ で前後の社員へ移れます。", target: "re:(月給|日給|時給).*¥" },
      { title: "実績と手当", body: "「実績入力」は日数・時間・距離、「手当・控除」はその月の手当や差し引くものです。", target: "text:実績入力" },
      { title: "保存して計算", body: "入れ終わったら押します。給与が計算され、給与明細に反映されます。\n確定した月は表示だけになります。直すときは給与明細で「確定解除」をしてください。", target: "text:この社員を保存して計算" },
      AGAIN,
    ],
  },
  "/payroll": {
    key: "payroll", title: "給与明細", steps: [
      { title: "給与明細の一覧", body: "月ごとに全員の給与明細を確認・確定・印刷します。" },
      { title: "月を選ぶ", body: "見たい月を選びます。", target: "text:2026年" },
      { title: "確定前チェック", body: "確定する前に、直したほうがよいところ（入力の漏れ、大きな増減など）をまとめて確かめます。", target: "card:確定前チェック" },
      { title: "一括計算・一括確定", body: "全員をまとめて計算し直す／まとめて確定します。確定すると明細は変えられなくなります（直すときは「確定解除」）。", target: "text:一括計算" },
      { title: "書き出し", body: "「CSV出力」は表計算用、「振込一覧」は銀行に出す振込のデータです。", target: "text:振込一覧" },
      { title: "印刷", body: "印刷する人を選んで、まとめて印刷できます。", target: "text:印刷…" },
      { title: "1人ずつの明細", body: "行を押すと、その人の明細の中身が開きます。「詳細」で明細書の画面へ進みます。", target: "re:^.+EMP\\d+" },
      AGAIN,
    ],
  },
  "/payroll/": {
    key: "payroll-detail", title: "給与明細の詳細", steps: [
      { title: "1人分の給与明細書", body: "支給・控除・勤怠の中身を確かめる画面です。" },
      { title: "支給項目", body: "基本給・残業代・手当など、払うものです。", target: "text:支給項目" },
      { title: "控除項目", body: "社会保険料・税金など、差し引くものです。", target: "text:控除項目" },
      { title: "勤怠実績", body: "この明細の計算に使った日数と時間です。", target: "text:勤怠実績" },
      { title: "確定と印刷", body: "中身がよければ「明細を確定する」。印刷もここからできます。", target: "text:明細を確定する" },
      AGAIN,
    ],
  },
  "/journal": {
    key: "journal", title: "仕訳（会計）", steps: [
      { title: "給与の仕訳", body: "確定した給与から、会計ソフトに入れる振替伝票（仕訳）を作る画面です。" },
      { title: "年と月", body: "仕訳を作る月を選びます。", target: "text:2026年" },
      { title: "データ生成・更新", body: "押すと、その月の給与明細から仕訳を作ります。明細を直したら、もう一度押してください。", target: "text:データ生成・更新" },
      { title: "会計ソフト用に書き出す", body: "会計ソフトの形を選んで「CSVをダウンロード」。そのまま会計ソフトに取り込めます。", target: "text:CSVをダウンロード" },
      AGAIN,
    ],
  },
  "/payroll-law": {
    key: "payroll-law", title: "給与と法令", steps: [
      { title: "法令まわりの準備", body: "有給・住民税・算定基礎・年末調整・賞与・賃金台帳などをまとめた画面です。CSVや印刷には個人情報が入るので、扱いに気をつけてください。" },
      { title: "やることを選ぶ", body: "上のタブで切り替えます。社員の法令の情報（入社日・扶養など）、住民税、有給の日数、算定・月変、年末調整の準備、賞与、賃金台帳・名簿、雇用保険の不足、最低賃金・残業。", target: "text:社員の法令の情報" },
      { title: "社員を選ぶ", body: "左から社員を選ぶと、その人の情報が右に出ます。", target: "text:EMP" },
      { title: "有給", body: "付与された日数と使った日数、年5日の取得ができているかを確かめられます。", target: "text:有給" },
      { title: "最低賃金・残業", body: "最低賃金を下回っていないか、残業が36協定の上限を超えていないかを確かめます。", target: "text:最低賃金・残業" },
      AGAIN,
    ],
  },
  "/calendar": {
    key: "calendar", title: "カレンダー", steps: [
      { title: "会社の出勤日と休日", body: "1年分（4月〜翌3月）の出勤日・休日を決める画面です。出勤日数の数え方に使います。" },
      { title: "日付を押して切り替え", body: "日付を押すと、出勤日と休日が入れ替わります。祝日・土日は赤、平日は黒で出ます。", target: "text:1" },
      { title: "年度を変える", body: "左右の矢印で前の年度・次の年度へ。", target: "css:#layout-main button[title=翌年度]" },
      { title: "リセット", body: "その年度を最初の状態（土日祝が休み）に戻します。", target: "text:2026年度のリセット" },
      { title: "印刷", body: "1年分のカレンダーを印刷できます。", target: "text:印刷" },
      AGAIN,
    ],
  },
  "/allowances": {
    key: "allowances", title: "マスター管理", steps: [
      { title: "計算のもとになる情報", body: "社員・手当・差引・取引先などを登録しておく画面です。ここを正しくしておくと、毎月の入力が減ります。" },
      { title: "社員マスター", body: "社員の名前・給与の形（月給・日給・時給）・保険・口座・打刻の暗証番号など。", target: "text:社員マスター" },
      { title: "手当・差引", body: "毎月払う手当、差し引くもの（積立金など）の種類と金額を決めます。", target: "text:手当マスター" },
      { title: "標準報酬", body: "社会保険料の計算に使う、社員ごとの標準報酬月額の履歴です。", target: "text:標準報酬" },
      { title: "取引先マスター", body: "荷主・現場の名前と住所。住所を入れるとリアルタイムマップに載り、スタッフが着いた・出た時刻が残ります。", target: "text:取引先マスター" },
      { title: "計算テーブル", body: "税額表など、計算に使う表です。", target: "text:計算テーブルマスター" },
      { title: "新しく登録する", body: "いま開いている種類に、新しく1件足します。", target: "text:新規登録" },
      AGAIN,
    ],
  },
  "/users": {
    key: "users", title: "ユーザー管理", steps: [
      { title: "このシステムに入れる人", body: "管理画面にログインできる人（事務所のかた）の一覧です。スタッフのスマホの打刻ページとは別です。" },
      { title: "新しく作る", body: "名前・ログインID・パスワード・権限を決めて作ります。", target: "text:新規ユーザー作成" },
      { title: "権限", body: "「管理者」はすべて操作できます。「閲覧のみ」は見るだけで、変えたり送ったりはできません。", target: "text:権限" },
      AGAIN,
    ],
  },
  "/audit": {
    key: "audit", title: "操作の記録", steps: [
      { title: "だれが・いつ・何をしたか", body: "給与の確定、社員の情報の変更、ログインなど、このシステムでの操作がすべて残ります。" },
      { title: "探す", body: "名前や言葉で探せます。", target: "text:探す" },
      { title: "種類で絞る", body: "勤怠・給与・社員・設定などで絞れます。", target: "text:すべて" },
      { title: "期間", body: "今日・7日間・30日間、または日付を決めて見られます。", target: "text:今日" },
      { title: "断られた操作", body: "権限がなくて断られた操作だけを見られます。おかしな操作がないか確かめるときに。", target: "text:断られた操作だけ" },
      { title: "中身を見る", body: "行を押すと、変える前と後の値まで見られます。", target: "re:^\\d{2}:\\d{2}:\\d{2}" },
      AGAIN,
    ],
  },
  "/settings": {
    key: "settings", title: "会社設定", steps: [
      { title: "会社の基本の設定", body: "会社名、締め日・支払日、日給の単価、振込の口座、最低賃金など、計算の決まりをまとめた画面です。" },
      { title: "会社名と締め日", body: "給与の締め日・支払日はここで決めます。", target: "text:給与締め日" },
      { title: "振込の設定", body: "銀行に出す振込データに使う会社の口座です。銀行と契約したときの番号を入れます。", target: "text:委託者コード" },
      { title: "最低賃金", body: "毎年10月ごろに改定されるので、入れ直してください。", target: "text:最低賃金（時間額）" },
      { title: "保存", body: "変えたら必ず「設定を保存する」を押してください。", target: "text:設定を保存する" },
      AGAIN,
    ],
  },
  "/updates": {
    key: "updates", title: "アップデート", steps: [
      { title: "変更の記録", body: "このシステムに加えた変更を、新しい順に並べています。何が変わったか分からないときはここを見てください。" },
      AGAIN,
    ],
  },
};

/** いまの画面のガイド（無ければ null） */
export function guideFor(location: string): Guide | null {
  const path = location.split("?")[0]!.replace(/\/+$/, "") || "/";
  if (GUIDES[path]) return GUIDES[path]!;
  if (/^\/payroll\/\d+/.test(path)) return GUIDES["/payroll/"]!;
  return null;
}
export const ALL_GUIDES = GUIDES;
