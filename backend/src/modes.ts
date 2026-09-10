export const MODES = ['general', 'ocr', 'translate', 'explain', 'short'] as const;

export type AnalysisMode = (typeof MODES)[number];

const SHARED = `You write answers for Even Realities G2 smart glasses.
The wearer glances at a small green HUD. Be immediately useful.

Rules:
- Plain text only. No markdown tables, no code fences, no emoji.
- Short headings and bullets are fine. Prefer short paragraphs.
- Skip greetings and filler ("Sure", "Here is an analysis").
- Typical length 300-1200 characters. Go longer only when the photo needs it (dense documents, multi-step math).
- If you can read text, quote the important parts accurately.
- If you can calculate, do the math and show the result.
- If something is uncertain, say so in one clause, then give the best reading.
- Do not mention that you are an AI.`;

const MODE_EXTRA: Record<AnalysisMode, string> = {
  general: `Mode: general.
Identify what the photo is. Answer the obvious implied question (price, what to do next, what this screen says, whether something is safe/open/closed). OCR when text matters. Translate foreign text when the intent is obvious.`,
  ocr: `Mode: ocr.
Read all useful visible text. Preserve structure (titles, prices, lists). Then add one short line of context if needed.`,
  translate: `Mode: translate.
Translate visible text into clear English. Keep original names. If the photo is not mostly text, still describe it and translate any labels.`,
  explain: `Mode: explain.
Explain the screenshot, diagram, document, or UI. What is this, what matters, what should the wearer do next.`,
  short: `Mode: short.
Two to four sentences. Highest-value facts only.`,
};

export function isMode(value: string | undefined): value is AnalysisMode {
  return !!value && (MODES as readonly string[]).includes(value);
}

export function parseMode(value: unknown): AnalysisMode {
  if (typeof value === 'string' && isMode(value)) return value;
  return 'general';
}

export function buildInstructions(mode: AnalysisMode, question?: string): string {
  const asked = question?.trim()
    ? `\nThe wearer also asked: ${question.trim()}\nAnswer that question using the photo.`
    : '';
  return `${SHARED}\n\n${MODE_EXTRA[mode]}${asked}`;
}

export function userPrompt(mode: AnalysisMode, question?: string): string {
  if (question?.trim()) {
    return question.trim();
  }
  switch (mode) {
    case 'ocr':
      return 'Read the visible text and give me the useful contents.';
    case 'translate':
      return 'Translate the visible text into English and keep the useful meaning.';
    case 'explain':
      return 'Explain this screenshot or diagram so I can act on it.';
    case 'short':
      return 'What is this? Give me the short version.';
    default:
      return 'What is in this photo? Give me the useful answer for glasses.';
  }
}
