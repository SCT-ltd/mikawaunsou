import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { 
  useListJournalEntries, 
  useGenerateJournalEntries,
  getListJournalEntriesQueryKey,
  ExportJournalEntriesCsvFormat
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatDate, formatMonth } from "@/lib/format";
import { RefreshCcw, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function JournalEntries() {
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const [format, setFormat] = useState<string>(ExportJournalEntriesCsvFormat.yayoi);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: entries, isLoading } = useListJournalEntries({ year, month });
  const generateEntries = useGenerateJournalEntries();

  const handleGenerate = async () => {
    try {
      await generateEntries.mutateAsync({ data: { year, month } });
      queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey({ year, month }) });
      toast({
        title: "生成完了",
        description: `${formatMonth(year, month)}の仕訳データを生成しました。`,
      });
    } catch (error) {
      toast({
        title: "エラー",
        description: "仕訳データの生成に失敗しました。給与データが確定されているか確認してください。",
        variant: "destructive",
      });
    }
  };

  const handleExportCsv = () => {
    const url = `/api/journal-entries/export/csv?year=${year}&month=${month}&format=${format}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `仕訳データ_${format}_${year}${month}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    toast({
      title: "CSVエクスポート",
      description: "会計ソフト連携用CSVのダウンロードを開始しました。",
    });
  };

  const years = Array.from({ length: 3 }, (_, i) => currentDate.getFullYear() - 1 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  // Group by debit/credit for visual balance
  const totalDebit = entries?.reduce((sum, e) => sum + e.amount, 0) || 0;
  // In a real double-entry system these would match exactly, we'll just sum all amounts
  // since the API returns individual lines

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-2xl font-bold tracking-tight">会計連携（振替伝票）</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-2">
              <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
                <SelectTrigger className="w-[100px] bg-card">
                  <SelectValue placeholder="年" />
                </SelectTrigger>
                <SelectContent>
                  {years.map(y => (
                    <SelectItem key={y} value={y.toString()}>{y}年</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
                <SelectTrigger className="w-[80px] bg-card">
                  <SelectValue placeholder="月" />
                </SelectTrigger>
                <SelectContent>
                  {months.map(m => (
                    <SelectItem key={m} value={m.toString()}>{m}月</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="secondary" onClick={handleGenerate} disabled={generateEntries.isPending}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              データ生成・更新
            </Button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            <div className="rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">日付</TableHead>
                    <TableHead>借方勘定科目</TableHead>
                    <TableHead className="text-right">借方金額</TableHead>
                    <TableHead>貸方勘定科目</TableHead>
                    <TableHead className="text-right">貸方金額</TableHead>
                    <TableHead>摘要</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        読み込み中...
                      </TableCell>
                    </TableRow>
                  ) : !entries || entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        データがありません。「データ生成・更新」ボタンをクリックしてください。
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {entries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>{formatDate(entry.entryDate)}</TableCell>
                          <TableCell>{entry.debitAccount}</TableCell>
                          <TableCell className="text-right">{formatCurrency(entry.amount)}</TableCell>
                          <TableCell>{entry.creditAccount}</TableCell>
                          <TableCell className="text-right">{formatCurrency(entry.amount)}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{entry.description}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold bg-muted/20">
                        <TableCell colSpan={2} className="text-right">合計</TableCell>
                        <TableCell className="text-right">{formatCurrency(totalDebit)}</TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-right">{formatCurrency(totalDebit)}</TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>会計ソフト用エクスポート</CardTitle>
                <CardDescription>
                  生成された仕訳データを選択した会計ソフトのフォーマットでCSV出力します。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">出力フォーマット</label>
                  <Select value={format} onValueChange={setFormat}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ExportJournalEntriesCsvFormat.yayoi}>弥生会計</SelectItem>
                      <SelectItem value={ExportJournalEntriesCsvFormat.freee}>freee会計</SelectItem>
                      <SelectItem value={ExportJournalEntriesCsvFormat.moneyforward}>マネーフォワードクラウド会計</SelectItem>
                      <SelectItem value={ExportJournalEntriesCsvFormat.generic}>汎用フォーマット</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button 
                  className="w-full" 
                  onClick={handleExportCsv}
                  disabled={!entries || entries.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  CSVをダウンロード
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}