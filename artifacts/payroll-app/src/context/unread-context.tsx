import { createContext, useContext, useState, useEffect, useCallback } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface UnreadContextValue {
  totalUnreadCount: number;
  refreshUnread: () => void;
}

const UnreadContext = createContext<UnreadContextValue>({
  totalUnreadCount: 0,
  refreshUnread: () => {},
});

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/messages/unread-count`);
      if (res.ok) {
        const data = (await res.json()) as { totalUnreadCount: number };
        setTotalUnreadCount(data.totalUnreadCount);
      }
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <UnreadContext.Provider value={{ totalUnreadCount, refreshUnread: refresh }}>
      {children}
    </UnreadContext.Provider>
  );
}

export function useUnread() {
  return useContext(UnreadContext);
}
