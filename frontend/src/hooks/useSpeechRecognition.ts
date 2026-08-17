// Thin wrapper around the Web Speech API (SpeechRecognition, prefixed as
// webkitSpeechRecognition in Chrome/Safari; absent in Firefox). Feature
// detection happens in an effect so the SSR prerender never touches
// `window` — `supported` is false until mounted in a capable browser,
// which also keeps hydration consistent.
//
// One call to start() opens a *logical* dictation session that can span
// several native recognition runs: browsers (especially Chrome on Android)
// end recognition on their own after a pause, which would feel broken
// mid-sentence. When a native run ends without the user pressing stop, we
// quietly restart it and carry the accumulated transcript forward, up to a
// few silent runs in a row (~30s of patience) before giving up. Within a
// session, finalized segments accumulate; `onTranscript` always receives
// the full finalized text plus the current interim segment.

import { useCallback, useEffect, useRef, useState } from "react";

/** Student-safe error buckets — never surface raw browser error codes. */
export type SpeechErrorCode = "permission" | "no-mic" | "network" | "unknown";

export interface UseSpeechRecognitionOptions {
  /** BCP-47 language tag; defaults to the browser UI language. */
  lang?: string;
  /**
   * Fires on every recognition result. `finalText` is all finalized speech
   * of the current session; `interimText` is the in-flight (still mutable)
   * segment, empty once it finalizes.
   */
  onTranscript: (finalText: string, interimText: string) => void;
  onError?: (code: SpeechErrorCode) => void;
  /** Fires exactly once per session, after it fully ends. */
  onEnd?: (info: { transcript: string; canceled: boolean }) => void;
}

export interface SpeechRecognitionHandle {
  /** Whether this browser implements the Web Speech API. */
  supported: boolean;
  /** Whether a dictation session is currently active. */
  listening: boolean;
  start: () => void;
  /** End the session, keeping the transcript. */
  stop: () => void;
  /** End the session, discarding the transcript. */
  cancel: () => void;
}

interface Session {
  /** Finalized text carried over from earlier native runs in this session. */
  carryFinal: string;
  /** Finalized text of the current native run. */
  nativeFinal: string;
  stopping: boolean;
  canceled: boolean;
  /** Consecutive native runs that ended without hearing anything. */
  silentRuns: number;
}

const MAX_SILENT_RUNS = 3;

function getRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function toErrorCode(error: string): SpeechErrorCode | null {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission";
    case "audio-capture":
      return "no-mic";
    case "network":
      return "network";
    // Expected during normal operation — never an error to the user.
    case "no-speech":
    case "aborted":
      return null;
    default:
      return "unknown";
  }
}

export function useSpeechRecognition({
  lang,
  onTranscript,
  onError,
  onEnd,
}: UseSpeechRecognitionOptions): SpeechRecognitionHandle {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const sessionRef = useRef<Session | null>(null);

  // Keep callbacks in refs so a session survives re-renders without the
  // recognition instance holding stale closures.
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const onEndRef = useRef(onEnd);
  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;
  onEndRef.current = onEnd;
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    setSupported(getRecognitionCtor() != null);
    return () => {
      if (sessionRef.current) sessionRef.current.canceled = true;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      sessionRef.current = null;
    };
  }, []);

  const finishSession = useCallback((s: Session) => {
    recognitionRef.current = null;
    sessionRef.current = null;
    setListening(false);
    onEndRef.current?.({ transcript: s.carryFinal, canceled: s.canceled });
  }, []);

  const spawnNative = useCallback(
    (s: Session) => {
      const Ctor = getRecognitionCtor();
      if (!Ctor) return finishSession(s);

      const recognition = new Ctor();
      recognition.lang = langRef.current ?? navigator.language ?? "en-IN";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (e) => {
        // Rebuild from the full result list every time: some mobile engines
        // re-emit earlier results, so appending would duplicate text.
        let final = "";
        let interim = "";
        for (let i = 0; i < e.results.length; i++) {
          const segment = e.results[i][0]?.transcript ?? "";
          if (e.results[i].isFinal) final += segment;
          else interim += segment;
        }
        s.nativeFinal = final;
        if (final || interim) s.silentRuns = 0;
        onTranscriptRef.current(s.carryFinal + final, interim);
      };

      recognition.onerror = (e) => {
        const code = toErrorCode(e.error);
        if (code) {
          // Fatal — make the pending onend final instead of restarting.
          s.stopping = true;
          if (!s.canceled) onErrorRef.current?.(code);
        }
      };

      // Fires after stop()/abort(), on sustained silence, and after errors —
      // the one reliable teardown point across browsers.
      recognition.onend = () => {
        s.carryFinal += s.nativeFinal;
        s.nativeFinal = "";
        if (s.stopping || s.canceled) return finishSession(s);
        // Spontaneous end (silence timeout / engine hiccup): keep the
        // session alive so a pause doesn't feel like a dropped call.
        s.silentRuns += 1;
        if (s.silentRuns > MAX_SILENT_RUNS) return finishSession(s);
        try {
          spawnNative(s);
        } catch {
          finishSession(s);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    },
    [finishSession],
  );

  const start = useCallback(() => {
    if (sessionRef.current || !getRecognitionCtor()) return;
    const session: Session = {
      carryFinal: "",
      nativeFinal: "",
      stopping: false,
      canceled: false,
      silentRuns: 0,
    };
    sessionRef.current = session;
    setListening(true);
    try {
      spawnNative(session);
    } catch {
      finishSession(session);
      onErrorRef.current?.("unknown");
    }
  }, [spawnNative, finishSession]);

  const stop = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    s.stopping = true;
    if (recognitionRef.current) recognitionRef.current.stop();
    else finishSession(s);
  }, [finishSession]);

  const cancel = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    s.canceled = true;
    if (recognitionRef.current) recognitionRef.current.abort();
    else finishSession(s);
  }, [finishSession]);

  return { supported, listening, start, stop, cancel };
}
