import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Key, Trash2, ShieldCheck, Users, Eye, EyeOff, UserCircle } from "lucide-react";

const userSchema = z.object({
  username: z.string().min(2, "ユーザー名は2文字以上で入力してください"),
  displayName: z.string().min(1, "氏名を入力してください"),
  password: z.string().min(6, "パスワードは6文字以上で入力してください").optional().or(z.literal("")),
  role: z.string().default("admin"),
});

type UserFormValues = z.infer<typeof userSchema>;

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function UserManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      username: "",
      displayName: "",
      password: "",
      role: "admin",
    },
  });

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${BASE}/api/users`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "取得失敗");
      }
      const data = await res.json();
      setUsers(data);
    } catch (error: any) {
      toast({ title: "エラー", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const onSubmit = async (data: UserFormValues) => {
    try {
      const url = editingUser ? `${BASE}/api/users/${editingUser.id}` : `${BASE}/api/users`;
      const method = editingUser ? "PATCH" : "POST";
      
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "操作に失敗しました");
      }

      toast({ title: editingUser ? "更新完了" : "作成完了", description: "ユーザー情報を保存しました。" });
      setIsDialogOpen(false);
      fetchUsers();
      form.reset();
    } catch (error: any) {
      toast({ title: "エラー", description: error.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("このユーザーを削除してもよろしいですか？")) return;

    try {
      const res = await fetch(`${BASE}/api/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "削除に失敗しました");
      }
      toast({ title: "削除完了", description: "ユーザーを削除しました。" });
      fetchUsers();
    } catch (error: any) {
      toast({ title: "エラー", description: error.message, variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">ユーザー管理</h2>
              <p className="text-sm text-muted-foreground mt-1">
                システムにアクセスできる管理者・事務スタッフのアカウントを管理します。
              </p>
            </div>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) {
              setEditingUser(null);
              setShowPassword(false);
              form.reset({ username: "", displayName: "", password: "", role: "admin" });
            }
          }}>
            <DialogTrigger asChild>
              <Button className="shadow-md">
                <UserPlus className="mr-2 h-4 w-4" />
                新規ユーザー作成
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>{editingUser ? "ユーザー情報の編集" : "新規ユーザー作成"}</DialogTitle>
                <DialogDescription>
                  {editingUser ? "氏名やパスワードの変更が行えます。" : "新しい事務スタッフのアカウントを発行します。"}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                  <FormField
                    control={form.control}
                    name="displayName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>氏名</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="例: 三川 太郎" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ユーザー名 (ログイン用ID)</FormLabel>
                        <FormControl>
                          <Input {...field} disabled={!!editingUser} placeholder="例: tanaka_admin" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{editingUser ? "新しいパスワード (変更する場合のみ)" : "パスワード"}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input 
                              type={showPassword ? "text" : "password"} 
                              {...field} 
                              placeholder="******" 
                              className="pr-10"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                              onClick={() => setShowPassword(!showPassword)}
                            >
                              {showPassword ? (
                                <EyeOff className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <Eye className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter className="pt-4">
                    <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
                      {editingUser ? "更新する" : "作成する"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-sm border-border/60">
          <CardHeader className="bg-muted/30 py-4">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              アカウント一覧
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/10">
                  <TableHead className="w-[200px]">氏名</TableHead>
                  <TableHead className="w-[180px]">ユーザー名</TableHead>
                  <TableHead className="w-[120px]">権限</TableHead>
                  <TableHead>登録日</TableHead>
                  <TableHead className="text-right px-6">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">読み込み中...</TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">登録されているユーザーがいません。</TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.id} className="hover:bg-muted/5">
                      <TableCell className="font-bold">
                        <div className="flex items-center gap-2">
                          <UserCircle className="h-4 w-4 text-muted-foreground/50" />
                          {user.displayName || "—"}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-muted-foreground">{user.username}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 border border-blue-100">
                          {user.role}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(user.createdAt).toLocaleDateString("ja-JP")}
                      </TableCell>
                      <TableCell className="text-right px-6 space-x-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0"
                          onClick={() => {
                            setEditingUser(user);
                            form.reset({ 
                              username: user.username, 
                              displayName: user.displayName || "", 
                              password: "", 
                              role: user.role 
                            });
                            setIsDialogOpen(true);
                          }}
                        >
                          <Key className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0 hover:text-destructive"
                          onClick={() => handleDelete(user.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
