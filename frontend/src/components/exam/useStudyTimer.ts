// A per-topic study timer that survives reloads and tab switches. The state
// kept in localStorage is { elapsedMs, runningSince }: time already banked
// plus, while running, the wall-clock instant it was last (re)started, so the
// elapsed time is always derived from real clocks rather than counted ticks.
// The 1s re-render interval runs only while running and the document is
// visible; a hidden tab keeps `runningSince`, so its time still counts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTimer } from "@/components/exam/examFormat";

export interface StudyTimerState {
  elapsedMs: number;
  runningSince: number | null;
}

export interface StudyTimer {
  /** Whole seconds studied so far (banked + the current run). */
  elapsedSeconds: number;
  /** "12:34" / "1:02:03". */
  formatted: string;
  running: boolean;
  start: () => void;
  pause: () => void;
  resume: () => void;
  /** Back to 00:00 and stopped. */
  reset: () => void;
  /** Pause and return the final whole seconds. */
  stop: () => number;
}

export const STUDY_TIMER_KEY_PREFIX = "aeva.examPrep.timer.v1:";

const EMPTY: StudyTimerState = { elapsedMs: 0, runningSince: null };

function keyFor(topicId: string): string {
  return `${STUDY_TIMER_KEY_PREFIX}${topicId}`;
}

function read(topicId: string): StudyTimerState {
  try {
    const raw = window.localStorage.getItem(keyFor(topicId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StudyTimerState>;
    const elapsedMs =
      typeof parsed.elapsedMs === "number" && parsed.elapsedMs >= 0
        ? parsed.elapsedMs
        : 0;
    const runningSince =
      typeof parsed.runningSince === "number" && parsed.runningSince > 0
        ? parsed.runningSince
        : null;
    return { elapsedMs, runningSince };
  } catch {
    return EMPTY;
  }
}

function write(topicId: string, state: StudyTimerState): void {
  try {
    if (state.elapsedMs === 0 && state.runningSince === null) {
      window.localStorage.removeItem(keyFor(topicId));
    } else {
      window.localStorage.setItem(keyFor(topicId), JSON.stringify(state));
    }
  } catch {
    // Storage unavailable (private mode): the timer still works in memory.
  }
}

function elapsedOf(state: StudyTimerState, now: number): number {
  const run = state.runningSince ? Math.max(0, now - state.runningSince) : 0;
  return state.elapsedMs + run;
}

export function useStudyTimer(
  topicId: string,
  { autoStart }: { autoStart: boolean },
): StudyTimer {
  const [state, setState] = useState<StudyTimerState>(() => read(topicId));
  const [now, setNow] = useState(() => Date.now());
  const loadedFor = useRef(topicId);
  const autoStartedFor = useRef<string | null>(null);

  // Another topic: load its own saved state.
  useEffect(() => {
    if (loadedFor.current === topicId) return;
    loadedFor.current = topicId;
    setState(read(topicId));
    setNow(Date.now());
  }, [topicId]);

  // Persist every change (the state is small).
  useEffect(() => {
    if (loadedFor.current !== topicId) return;
    write(topicId, state);
  }, [topicId, state]);

  // Auto-start once per topic (the caller passes false for completed topics).
  useEffect(() => {
    if (!autoStart || autoStartedFor.current === topicId) return;
    autoStartedFor.current = topicId;
    setState((s) => (s.runningSince ? s : { ...s, runningSince: Date.now() }));
    setNow(Date.now());
  }, [autoStart, topicId]);

  // Tick only while running and visible. On becoming visible again the
  // readout jumps to the real elapsed time (runningSince was kept).
  const running = state.runningSince !== null;
  useEffect(() => {
    if (!running) return;
    let interval: number | null = null;
    const startTicking = () => {
      if (interval !== null) return;
      setNow(Date.now());
      interval = window.setInterval(() => setNow(Date.now()), 1000);
    };
    const stopTicking = () => {
      if (interval === null) return;
      window.clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") startTicking();
      else stopTicking();
    };
    if (document.visibilityState === "visible") startTicking();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopTicking();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [running]);

  const start = useCallback(() => {
    setState((s) => (s.runningSince ? s : { ...s, runningSince: Date.now() }));
    setNow(Date.now());
  }, []);

  const pause = useCallback(() => {
    setState((s) =>
      s.runningSince
        ? { elapsedMs: elapsedOf(s, Date.now()), runningSince: null }
        : s,
    );
  }, []);

  const reset = useCallback(() => {
    setState(EMPTY);
    setNow(Date.now());
  }, []);

  // `stop` must hand back the final reading synchronously, so it reads the
  // latest state through a ref rather than the render-time value.
  const stateRef = useRef(state);
  stateRef.current = state;
  const stop = useCallback(() => {
    const finalMs = elapsedOf(stateRef.current, Date.now());
    setState({ elapsedMs: finalMs, runningSince: null });
    return Math.floor(finalMs / 1000);
  }, []);

  const elapsedSeconds = Math.floor(elapsedOf(state, now) / 1000);
  const formatted = useMemo(() => formatTimer(elapsedSeconds), [elapsedSeconds]);

  return {
    elapsedSeconds,
    formatted,
    running,
    start,
    pause,
    resume: start,
    reset,
    stop,
  };
}
