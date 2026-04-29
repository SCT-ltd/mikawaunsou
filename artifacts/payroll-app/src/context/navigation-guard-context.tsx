import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";

interface NavigationGuardContextType {
  isDirty: boolean;
  setIsDirty: (dirty: boolean) => void;
  requestNavigate: (href: string, navigate: (h: string) => void) => void;
  pendingHref: string | null;
  cancelPending: () => void;
  confirmPending: () => void;
}

const NavigationGuardContext = createContext<NavigationGuardContextType>({
  isDirty: false,
  setIsDirty: () => {},
  requestNavigate: (_href, navigate) => navigate(_href),
  pendingHref: null,
  cancelPending: () => {},
  confirmPending: () => {},
});

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const [isDirty, setIsDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const navigateFnRef = useRef<((h: string) => void) | null>(null);

  const requestNavigate = useCallback(
    (href: string, navigate: (h: string) => void) => {
      if (isDirty) {
        setPendingHref(href);
        navigateFnRef.current = navigate;
      } else {
        navigate(href);
      }
    },
    [isDirty]
  );

  const cancelPending = useCallback(() => {
    setPendingHref(null);
    navigateFnRef.current = null;
  }, []);

  const confirmPending = useCallback(() => {
    if (pendingHref && navigateFnRef.current) {
      const fn = navigateFnRef.current;
      const href = pendingHref;
      setPendingHref(null);
      navigateFnRef.current = null;
      setIsDirty(false);
      fn(href);
    }
  }, [pendingHref]);

  return (
    <NavigationGuardContext.Provider
      value={{ isDirty, setIsDirty, requestNavigate, pendingHref, cancelPending, confirmPending }}
    >
      {children}
    </NavigationGuardContext.Provider>
  );
}

export function useNavigationGuard() {
  return useContext(NavigationGuardContext);
}
