/**
 * The only file that knows which AI provider we use.
 * Swap providers by reimplementing `generateJson` with the same signature.
 */

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
/**
 * Tried in order. Free-tier models are often busy or slow to start, so a model
 * that fails or stays silent hands over to the next one.
 */
const DEFAULT_MODELS = "gemini-3.5-flash,gemini-3.6-flash,gemini-flash-lite-latest,gemini-3.5-flash-lite";
/** If a model has not started answering after this long, start the next one alongside it. */
const HEDGE_AFTER_MS = 15_000;
/** Give up entirely if nothing has started answering after this long. */
const START_TIMEOUT_MS = 75_000;

export type AiPart = { text: string } | { image: { mimeType: string; base64: string } };

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Options = {
  parts: AiPart[];
  /** JSON schema (OpenAPI subset) the reply must follow. */
  schema: unknown;
  temperature?: number;
  /** Called with the full text so far each time more of the reply arrives. */
  onPartial?: (textSoFar: string) => void;
  signal?: AbortSignal;
};

/**
 * Start the request on the first model. Whenever the current model fails, or
 * stays silent past the hedge delay, also start the next one. The first model
 * to begin answering wins and the rest are cancelled.
 */
function openStream(models: string[], key: string, body: string, signal?: AbortSignal): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const controllers: AbortController[] = [];
    let next = 0;
    let pending = 0;
    let settled = false;
    let lastFailure = new AiError("No AI model is configured.", 500);
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (winner: AbortController | null, outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      clearTimeout(deadline);
      signal?.removeEventListener("abort", onCallerAbort);
      for (const c of controllers) if (c !== winner) c.abort();
      outcome();
    };
    const onCallerAbort = () => finish(null, () => reject(new AiError("The request was cancelled.", 499)));
    const deadline = setTimeout(
      () => finish(null, () => reject(new AiError("The AI took too long to start answering.", 504))),
      START_TIMEOUT_MS,
    );
    signal?.addEventListener("abort", onCallerAbort);

    const launch = () => {
      if (settled || next >= models.length) return;
      const model = models[next++];
      const controller = new AbortController();
      controllers.push(controller);
      pending++;
      clearTimeout(hedgeTimer);
      hedgeTimer = setTimeout(launch, HEDGE_AFTER_MS);

      fetch(`${API_ROOT}/models/${model}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body,
        signal: controller.signal,
      })
        .then(async (res) => {
          if (res.ok && res.body) return finish(controller, () => resolve(res));
          const detail = await res.text().catch(() => "");
          let message = detail.slice(0, 300);
          try {
            message = JSON.parse(detail).error.message;
          } catch {}
          throw new AiError(message || `AI request failed (${res.status}).`, res.status);
        })
        .catch((err) => {
          if (settled) return;
          lastFailure = err instanceof AiError ? err : new AiError(`${model} could not be reached.`, 502);
          console.warn(`AI model ${model} failed (${lastFailure.status}): ${lastFailure.message}`);
          pending--;
          if (next < models.length) launch();
          else if (pending === 0) finish(null, () => reject(lastFailure));
        });
    };
    launch();
  });
}

/** Ask the model for JSON and stream the reply. Returns the parsed object. */
export async function generateJson({ parts, schema, temperature = 0.2, onPartial, signal }: Options): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiError("GEMINI_API_KEY is not set.", 500);
  const models = (process.env.GEMINI_MODEL || DEFAULT_MODELS)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: parts.map((p) =>
          "text" in p ? { text: p.text } : { inline_data: { mime_type: p.image.mimeType, data: p.image.base64 } },
        ),
      },
    ],
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
      responseSchema: schema,
      thinkingConfig: { thinkingLevel: "low" },
    },
  });

  const res = await openStream(models, key, body, signal);

  // Server-sent events: each "data:" line is a JSON chunk carrying a slice of text.
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const chunk = JSON.parse(payload);
        const piece: string = (chunk.candidates?.[0]?.content?.parts ?? [])
          .filter((p: { thought?: boolean; text?: string }) => !p.thought && typeof p.text === "string")
          .map((p: { text: string }) => p.text)
          .join("");
        if (piece) {
          text += piece;
          onPartial?.(text);
        }
      } catch {
        // Ignore keep-alive or partial lines.
      }
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("The AI reply was not valid JSON.", 502);
  }
}
