// Current variant of an experiment flag, re-read when flags load or change.
// `undefined` until the analytics provider has flags (and always on the
// server), which components render as the control variant.

import { useEffect, useState } from "react";
import { analytics } from "@/lib/analytics";

function read(flag: string): string | undefined {
  const value = analytics.getFeatureFlag(flag);
  if (typeof value === "string") return value;
  if (value === true) return "test";
  return undefined;
}

export function useExperimentVariant(flag: string): string | undefined {
  const [variant, setVariant] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const update = () => {
      if (alive) setVariant(read(flag));
    };
    update();
    analytics.onFeatureFlags(update);
    return () => {
      alive = false;
    };
  }, [flag]);
  return variant;
}
