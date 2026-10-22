import { useAuth } from "@/context/auth-context";

/**
 * 書き込み（保存・計算・確定など）ができる人か。
 * 「閲覧のみ」の人はサーバーが書き込みを断る（api-server/src/lib/roles.ts）ので、
 * 押しても失敗するだけのボタンは出さないか、押せないようにする。
 */
export function useCanWrite(): boolean {
  const { user } = useAuth();
  return !!user && user.role !== "viewer";
}

/** 管理者だけができる操作（会社設定・ユーザー管理など）か */
export function useIsAdmin(): boolean {
  const { user } = useAuth();
  return user?.role === "admin";
}
