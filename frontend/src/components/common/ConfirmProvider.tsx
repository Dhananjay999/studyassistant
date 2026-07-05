// Imperative confirmation dialogs. Mount <ConfirmProvider> once near the app
// root, then call `const confirm = useConfirm()` anywhere and `await confirm({
// title, ... })` — it resolves `true` if the user confirms, `false` otherwise.
//
// Built on ConfirmModal (ResponsiveModal), so every confirmation — logout,
// delete, discard, warnings — is a native-style bottom sheet on mobile and a
// centered dialog on desktop, with one shared, consistent look.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { useBackClose } from "@/hooks/useBackClose";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  // Resolver for the in-flight confirm() promise.
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setOpen(false);
  }, []);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  // Back gesture/button dismisses the confirmation (resolving false), so it
  // stacks naturally above any overlay that opened it.
  useBackClose(open, () => settle(false));

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmModal
        open={open}
        // A dismiss (tap-outside on non-destructive, drag-down, Escape, Cancel)
        // resolves the promise as `false`.
        onOpenChange={(next) => {
          if (!next) settle(false);
        }}
        title={options?.title ?? ""}
        description={options?.description}
        confirmText={options?.confirmText}
        cancelText={options?.cancelText}
        destructive={options?.destructive}
        onConfirm={() => settle(true)}
      />
    </ConfirmContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }
  return ctx;
}
