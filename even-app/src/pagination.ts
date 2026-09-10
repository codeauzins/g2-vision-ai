/**
 * G2 canvas is 576×288. Firmware uses one LVGL font (no size control).
 * Official docs: a full-screen text container holds roughly 400–500 characters.
 *
 * We paginate against that measured capacity, not a 140-char notification limit.
 *
 * Layout inside the capturing text container:
 *   line 1: "Ask AI          1/4"
 *   line 2: blank
 *   remaining: body
 *
 * Header uses ~24 characters + a newline, so body budget is slightly below
 * the 450-character full-screen estimate. Word wrap uses ~42 characters per
 * line (576px minus 8px padding, proportional font ≈ 13px average glyph).
 * Line height ≈ 20px → ~13 body lines after the header.
 */
export const G2_DISPLAY = {
  width: 576,
  height: 288,
  padding: 4,
  approxCharWidth: 13,
  approxLineHeight: 20,
  headerLines: 2,
} as const;

export const CHARS_PER_LINE = Math.max(
  24,
  Math.floor((G2_DISPLAY.width - G2_DISPLAY.padding * 2) / G2_DISPLAY.approxCharWidth),
);

export const BODY_LINES = Math.max(
  4,
  Math.floor((G2_DISPLAY.height - G2_DISPLAY.padding * 2) / G2_DISPLAY.approxLineHeight) -
    G2_DISPLAY.headerLines,
);

/** Soft character budget per page body (paragraph-aware splitter). */
export const PAGE_CHAR_BUDGET = Math.min(380, CHARS_PER_LINE * BODY_LINES);

export type PageSet = {
  pages: string[];
  total: number;
};

export function paginate(text: string, budget = PAGE_CHAR_BUDGET): PageSet {
  const cleaned = normalizeAnswer(text);
  if (!cleaned) return { pages: [''], total: 1 };

  const chunks = splitToBudget(cleaned, budget);
  return { pages: chunks, total: chunks.length };
}

export function pageIndicator(index: number, total: number): string {
  return `${index + 1}/${total}`;
}

export function formatHudPage(title: string, body: string, index: number, total: number): string {
  const indicator = pageIndicator(index, total);
  const header = padHeader(title, indicator);
  return `${header}\n\n${body}`.trimEnd();
}

export function compactAnswer(text: string, budget = PAGE_CHAR_BUDGET): string {
  const cleaned = normalizeAnswer(text);
  const sentences = splitSentences(cleaned);
  let out = '';
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > Math.min(budget, 280) && out) break;
    out = next;
    if (out.length >= Math.min(budget, 280)) break;
  }
  return out || cleaned.slice(0, budget);
}

export function normalizeAnswer(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function padHeader(title: string, indicator: string): string {
  const gap = Math.max(1, CHARS_PER_LINE - title.length - indicator.length);
  return `${title}${' '.repeat(gap)}${indicator}`.slice(0, CHARS_PER_LINE + 8);
}

function splitToBudget(text: string, budget: number): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const pages: string[] = [];
  let current = '';

  const flush = () => {
    if (current) {
      pages.push(current.trim());
      current = '';
    }
  };

  for (const paragraph of paragraphs) {
    const block = paragraph.trim();
    if (!block) continue;

    if (block.length <= budget) {
      const candidate = current ? `${current}\n\n${block}` : block;
      if (candidate.length <= budget) {
        current = candidate;
      } else {
        flush();
        current = block;
      }
      continue;
    }

    flush();
    for (const piece of splitLongBlock(block, budget)) {
      if (current && `${current}\n\n${piece}`.length <= budget) {
        current = `${current}\n\n${piece}`;
      } else {
        flush();
        current = piece;
      }
    }
  }
  flush();
  return pages.length ? pages : [''];
}

function splitLongBlock(block: string, budget: number): string[] {
  const sentences = splitSentences(block);
  const parts: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > budget) {
      if (current) {
        parts.push(current.trim());
        current = '';
      }
      parts.push(...splitWords(sentence, budget));
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= budget) {
      current = candidate;
    } else {
      if (current) parts.push(current.trim());
      current = sentence;
    }
  }
  if (current) parts.push(current.trim());
  return parts;
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?\n]+[.!?]?(\s+|$)|[^\n]+/g);
  if (!matches) return [text];
  return matches.map((s) => s.trim()).filter(Boolean);
}

function splitWords(text: string, budget: number): string[] {
  const words = text.split(/\s+/);
  const parts: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > budget) {
      if (current) {
        parts.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += budget) {
        parts.push(word.slice(i, i + budget));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= budget) {
      current = candidate;
    } else {
      parts.push(current);
      current = word;
    }
  }
  if (current) parts.push(current);
  return parts;
}
