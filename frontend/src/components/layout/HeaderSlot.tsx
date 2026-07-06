import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";
import { TabPanelContext } from "@/components/layout/tabPanel";

/**
 * A slot in the persistent {@link AppHeader}. Pages inject page-specific header
 * content — the chat session title, Files/Tools toggles, a plain page title —
 * WITHOUT rebuilding the shared right-side controls (Search, Theme, Avatar,
 * More). Those live in `AppHeader` and never re-mount on navigation.
 *
 * `start` renders on the left (grows to fill), `end` renders just before the
 * fixed right cluster. The provider is mounted once by `AppLayout`, so setting
 * or clearing a slot only swaps the injected node — the header instance is stable.
 */
export interface HeaderSlotContent {
  start?: ReactNode;
  end?: ReactNode;
}

interface HeaderSlotValue {
  slot: HeaderSlotContent;
  setSlot: (content: HeaderSlotContent) => void;
  clearSlot: () => void;
}

const HeaderSlotContext = createContext<HeaderSlotValue | null>(null);

export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HeaderSlotContent>({});
  const clearSlot = useCallback(() => setSlot({}), []);
  const value = useMemo<HeaderSlotValue>(
    () => ({ slot, setSlot, clearSlot }),
    [slot, clearSlot],
  );
  return (
    <HeaderSlotContext.Provider value={value}>
      {children}
    </HeaderSlotContext.Provider>
  );
}

/** Read the current header slot content (used by `AppHeader`). */
// eslint-disable-next-line react-refresh/only-export-components
export function useHeaderSlotContent(): HeaderSlotContent {
  return useContext(HeaderSlotContext)?.slot ?? {};
}

/**
 * Publish header content for the calling page's lifetime; cleared on unmount.
 * Pass stable primitive `deps` (title, counts) — the `content` node is rebuilt
 * only when they change, so the header re-renders no more than necessary.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useHeaderSlot(
  content: HeaderSlotContent,
  deps: DependencyList,
): void {
  const ctx = useContext(HeaderSlotContext);
  // Under mobile keep-alive, several pages stay mounted at once. Only the
  // ACTIVE tab may own the single header slot; an inactive panel must not
  // publish (or clear) it. Outside a tab panel (desktop, non-tab routes) the
  // context is absent, so `active` is always true — behavior is unchanged.
  const panel = useContext(TabPanelContext);
  const active = panel ? panel.active : true;
  useEffect(() => {
    if (!active) return;
    ctx?.setSlot(content);
    return () => ctx?.clearSlot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, active]);
}

/** Convenience: render a plain page title into the header's left slot. */
// eslint-disable-next-line react-refresh/only-export-components
export function usePageTitle(title: string): void {
  useHeaderSlot(
    {
      start: (
        <h1 className="truncate font-display text-lg font-bold">{title}</h1>
      ),
    },
    [title],
  );
}
