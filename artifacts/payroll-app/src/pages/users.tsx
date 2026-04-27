import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  UserPlus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ShieldCheck,
  Users,
  Loader2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type SystemUser = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
};

const ROLES = [
  { value: "admin", label: "管理者" },
  { value: "staff", label: "事務スタッフ" },
  { value: "viewer", label: "閲覧のみ" },
];

function roleLabel(role: string) {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

function roleBadgeVariant(role: string): "default" | "secondary" | "outline" {
  if (role === "admin") return "default";
  if (role === "staff") return "secondary";
  return "outline";
}

const createSchema = z.object({
  username: z.string().min(2, "2文字以上で入力してください"),
  displayName: z.string().min(1, "氏名は必須です"),
  password: z.string().min(6, "6文字以上で入力してください"),
  role: z.string().default("admin"),
});

const editSchema = z.object({
  username: z.string().min(2, "2文字以上で入力してください"),
  displayName: z.string().min(1, "氏名は必須です"),
  password: z.string().optional(),
  role: z.string().default("admin"),
});

type CreateValues = z.infer<typeof createSchema>;
type EditValues = z.infer<typeof editSchema>;
type FormValues = CreateValues | EditValues;

async function apiRequest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "エラーが発生しました");
  }
  return res.json();
}

export default function UserManagement() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SystemUser | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const isEditing = editTarget !== null;

  const form = useForm<FormValues>({
    resolver: zodResolver(isEditing ? editSchema : createSchema) as never,
    defaultValues: { username: "", displayName: "", password: "", role: "admin" },
  });

  const { data: users = [], isLoading } = useQuery<SystemUser[]>({
    queryKey: ["system-users"],
    queryFn: () => apiRequest("GET", "/users"),
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateValues) => apiRequest("POST", "/users", values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system-users"] });
      toast({ title: "作成しました", description: "新しいユーザーを登録しました。" });
      closeDialog();
    },
    onError: (e: Error) => {
      toast({ title: "作成に失敗しました", description: e.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: number; values: EditValues }) =>
      apiRequest("PATCH", `/users/${id}`, {
        displayName: values.displayName,
        role: values.role,
        ...(values.password && values.password.trim() !== "" ? { password: values.password } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system-users"] });
      toast({ title: "更新しました", description: "ユーザー情報を更新しました。" });
      closeDialog();
    },
    onError: (e: Error) => {
      toast({ title: "更新に失敗しました", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system-users"] });
      toast({ title: "削除しました", description: "ユーザーを削除しました。" });
    },
    onError: (e: Error) => {
      toast({ title: "削除に失敗しました", description: e.message, variant: "destructive" });
    },
  });

  function openCreate() {
    setEditTarget(null);
    form.reset({ username: "", displayName: "", password: "", role: "admin" });
    setShowPassword(false);
    setDialogOpen(true);
  }

  function openEdit(user: SystemUser) {
    setEditTarget(user);
    form.reset({ username: user.username, displayName: user.displayName, password: "", role: user.role });
    setShowPassword(false);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditTarget(null);
    form.reset();
  }

  function handleDelete(user: SystemUser) {
    if (!confirm(`「${user.displayName}」を削除しますか？この操作は元に戻せません。`)) return;
    deleteMutation.mutate(user.id);
  }

  function onSubmit(values: FormValues) {
    if (isEditing && editTarget) {
      updateMutation.mutate({ id: editTarget.id, values: values as EditValues });
    } else {
      createMutation.mutate(values as CreateValues);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* ページヘッダー */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              <h2 className="text-2xl font-bold tracking-tight">ユーザー管理</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              システムにアクセスする管理者・事務スタッフのアカウントを管理します。
            </p>
          </div>
          <Button onClick={openCreate} className="shrink-0 gap-2">
            <UserPlus className="h-4 w-4" />
            新規ユーザー作成
          </Button>
        </div>

        {/* ユーザーテーブル */}
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-[200px] font-semibold">氏名</TableHead>
                <TableHead className="w-[180px] font-semibold">ユーザー名 (ID)</TableHead>
                <TableHead className="w-[140px] font-semibold">権限</TableHead>
                <TableHead className="w-[160px] font-semibold">登録日</TableHead>
                <TableHead className="text-right font-semibold">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>読み込み中...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <ShieldCheck className="h-8 w-8 opacity-30" />
                      <p>登録されていません</p>
                      <p className="text-xs">「新規ユーザー作成」からアカウントを追加してください。</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id} className="group hover:bg-muted/30 transition-colors">
                    <TableCell className="font-medium">{user.displayName}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      @{user.username}
                    </TableCell>
                    <TableCell>
                      <Badge variant={roleBadgeVariant(user.role)} className="gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        {roleLabel(user.role)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString("ja-JP", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => openEdit(user)}
                          title="編集"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(user)}
                          disabled={deleteMutation.isPending}
                          title="削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* 作成・編集ダイアログ */}
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {isEditing ? (
                  <>
                    <Pencil className="h-5 w-5 text-primary" />
                    ユーザーを編集
                  </>
                ) : (
                  <>
                    <UserPlus className="h-5 w-5 text-primary" />
                    新規ユーザー作成
                  </>
                )}
              </DialogTitle>
            </DialogHeader>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
                {/* 氏名 */}
                <FormField
                  control={form.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>氏名 <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input placeholder="例：山田 太郎" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* ユーザー名 */}
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ユーザー名 (ログインID) <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input
                          placeholder="例：yamada.taro"
                          {...field}
                          disabled={isEditing}
                          className={isEditing ? "bg-muted text-muted-foreground" : ""}
                        />
                      </FormControl>
                      {isEditing && (
                        <p className="text-xs text-muted-foreground">ユーザー名は変更できません</p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* パスワード */}
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        パスワード
                        {!isEditing && <span className="text-destructive"> *</span>}
                        {isEditing && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            （変更する場合のみ入力）
                          </span>
                        )}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPassword ? "text" : "password"}
                            placeholder={isEditing ? "変更しない場合は空白のまま" : "6文字以上"}
                            className="pr-10"
                            {...field}
                          />
                          <button
                            type="button"
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setShowPassword((v) => !v)}
                            tabIndex={-1}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* 権限 */}
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>権限</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="権限を選択" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter className="gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={closeDialog} disabled={isPending}>
                    キャンセル
                  </Button>
                  <Button type="submit" disabled={isPending} className="gap-2">
                    {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isEditing ? "更新する" : "作成する"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
