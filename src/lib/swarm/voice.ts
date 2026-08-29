type SpeechRecognitionEventLike = {
  results: ArrayLike<{
    isFinal: boolean;
    0?: { transcript?: string };
  }>;
};

type SpeechRecognitionErrorLike = { error?: string };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const speechStopListeners = new Set<() => void>();
let activeUtterance: SpeechSynthesisUtterance | undefined;

function notifySpeechStopped(): void {
  for (const listener of speechStopListeners) listener();
}

export function onSpeechStopped(listener: () => void): () => void {
  speechStopListeners.add(listener);
  return () => speechStopListeners.delete(listener);
}

function recognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

export function voiceInputAvailable(): boolean {
  return Boolean(recognitionConstructor());
}

export function voiceOutputAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gu, " Code block omitted. ")
    .replace(/!\[[^\]]*\]\([^)]+\)/gu, " Image. ")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[*_`>#~-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function speakText(
  text: string,
  options?: { onEnd?: () => void; onError?: () => void },
): boolean {
  if (!voiceOutputAvailable()) return false;
  const spoken = stripForSpeech(text).slice(0, 12_000);
  if (!spoken) return false;
  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onend = () => {
    if (activeUtterance !== utterance) return;
    activeUtterance = undefined;
    notifySpeechStopped();
    options?.onEnd?.();
  };
  utterance.onerror = () => {
    if (activeUtterance !== utterance) return;
    activeUtterance = undefined;
    notifySpeechStopped();
    options?.onError?.();
  };
  activeUtterance = utterance;
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking(): void {
  // Clear first so a late onend/onerror from the canceled utterance cannot
  // reset UI state belonging to the next utterance.
  activeUtterance = undefined;
  if (voiceOutputAvailable()) window.speechSynthesis.cancel();
  notifySpeechStopped();
}

export function startVoiceInput(options: {
  lang?: string;
  onText: (text: string) => void;
  onState: (listening: boolean) => void;
  onError?: (message: string) => void;
}): (() => void) | undefined {
  const Constructor = recognitionConstructor();
  if (!Constructor) return undefined;
  const recognition = new Constructor();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = options.lang ?? navigator.language ?? "en-US";
  recognition.onresult = (event) => {
    const text = Array.from(event.results)
      .filter((result) => result.isFinal)
      .map((result) => result[0]?.transcript?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (text) options.onText(text);
  };
  let ended = false;
  const markEnded = () => {
    if (ended) return;
    ended = true;
    options.onState(false);
  };
  recognition.onerror = (event) => {
    options.onError?.(event.error || "Voice input failed.");
    markEnded();
  };
  recognition.onend = markEnded;
  options.onState(true);
  try {
    recognition.start();
  } catch (error) {
    markEnded();
    options.onError?.(error instanceof Error ? error.message : "Voice input failed to start.");
    return undefined;
  }
  return () => {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    if (ended) return;
    try {
      recognition.stop();
    } catch {
      // Some engines throw InvalidStateError when recognition already stopped.
    }
    markEnded();
  };
}
