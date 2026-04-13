import { useState } from "react";
import { Link, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { useListEmployees } from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function EmployeeList() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  
  const { data: employees, isLoading } = useListEmployees();

  const filteredEmployees = employees?.filter(emp => 
    emp.name.includes(search) || 
    emp.nameKana.includes(search) || 
    emp.employeeCode.includes(search) ||
    emp.department.includes(search)
  ) || [];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">社員一覧</h2>
          <Button onClick={() => setLocation("/employees/new")}>
            <Plus className="mr-2 h-4 w-4" />
            新規登録
          </Button>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="社員番号、名前、部署で検索..."
              className="pl-8 bg-card"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">社員番号</TableHead>
                <TableHead>氏名</TableHead>
                <TableHead>部署</TableHead>
                <TableHead>役職</TableHead>
                <TableHead className="text-right">基本給</TableHead>
                <TableHead>入社日</TableHead>
                <TableHead>ステータス</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    読み込み中...
                  </TableCell>
                </TableRow>
              ) : filteredEmployees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    社員が見つかりません
                  </TableCell>
                </TableRow>
              ) : (
                filteredEmployees.map((employee) => (
                  <TableRow 
                    key={employee.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setLocation(`/employees/${employee.id}`)}
                  >
                    <TableCell className="font-medium">{employee.employeeCode}</TableCell>
                    <TableCell>
                      <div>{employee.name}</div>
                      <div className="text-xs text-muted-foreground">{employee.nameKana}</div>
                    </TableCell>
                    <TableCell>{employee.department}</TableCell>
                    <TableCell>{employee.position || "-"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(employee.baseSalary)}</TableCell>
                    <TableCell>{formatDate(employee.hireDate)}</TableCell>
                    <TableCell>
                      {employee.isActive ? (
                        <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700">在籍中</Badge>
                      ) : (
                        <Badge variant="secondary">退職済</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppLayout>
  );
}
