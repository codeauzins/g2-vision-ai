/**
 * G2 canvas is 576×288. Firmware uses one LVGL font (no size control).
 * Overflow on the capturing text container firmware-scrolls, which fights
 * our page turns. Each page is therefore packed to a conservative line
 * grid so the HUD never overflows.
 *
 * Layout:
 *   line 1: title + page indicator
 *   line 2: blank
 *   remaining: body (at most BODY_LINES wrapped rows)
 *
 * Glyph metrics are pessimistic (wide Latin, tall line box) so wrapping
 * on device should match or be looser than this grid.
 */
export const G2_DISPLAY = {
  width: 576,
  height: 288,
  padding: 4,
  approxCharWidth: 16,
  approxLineHeight: 28,
  headerLines: 2,
} as const;

export const CHARS_PER_LINE = Math.max(
  20,
  Math.floor((G2_DISPLAY.width - G2_DISPLAY.padding * 2) / G2_DISPLAY.approxCharWidth),
);

export const DISPLAY_LINES = Math.max(
  6,
  Math.floor((G2_DISPLAY.height - G2_DISPLAY.padding * 2) / G2_DISPLAY.approxLineHeight),
);

export const BODY_LINES = Math.max(4, DISPLAY_LINES - G2_DISPLAY.headerLines);

/** Upper bound if every body row is full. Real pages are limited by BODY_LINES. */
export const PAGE_CHAR_BUDGET = CHARS_PER_LINE * BODY_LINES;

export type PageSet = {
  pages: string[];
  total: number;
};

export function wrapToLines(text: string, width = CHARS_PER_LINE): string[] {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    if (!raw) {
      lines.push('');
      continue;
    }
    const words = raw.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      if (word.length > width) {
        if (line) {
          lines.push(line);
          line = '';
        }
        for (let i = 0; i < word.length; i += width) {
          lines.push(word.slice(i, i + width));
        }
        continue;
      }
      const next = line ? `${line} ${word}` : word;
      if (next.length <= width) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function countWrappedLines(text: string, width = CHARS_PER_LINE): number {
  return wrapToLines(text, width).length;
}

export function paginate(text: string): PageSet {
  const cleaned = normalizeAnswer(text);
  if (!cleaned) return { pages: [''], total: 1 };

  const lines = wrapToLines(cleaned);
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += BODY_LINES) {
    const chunk = lines.slice(i, i + BODY_LINES).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    if (chunk) pages.push(chunk);
  }
  return { pages: pages.length ? pages : [''], total: Math.max(1, pages.length) };
}

export function pageIndicator(index: number, total: number): string {
  return `${index + 1}/${total}`;
}

export function formatHudPage(title: string, body: string, index: number, total: number): string {
  const indicator = pageIndicator(index, total);
  const header = padHeader(title, indicator);
  return `${header}\n\n${body}`.trimEnd();
}

export function compactAnswer(text: string): string {
  const cleaned = normalizeAnswer(text);
  const sentences = splitSentences(cleaned);
  let out = '';
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (countWrappedLines(next) > BODY_LINES && out) break;
    out = next;
    if (countWrappedLines(out) >= BODY_LINES) break;
  }
  if (out) return wrapToLines(out).slice(0, BODY_LINES).join('\n');
  return wrapToLines(cleaned).slice(0, BODY_LINES).join('\n');
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
  return `${title}${' '.repeat(gap)}${indicator}`.slice(0, CHARS_PER_LINE);
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?\n]+[.!?]?(\s+|$)|[^\n]+/g);
  if (!matches) return [text];
  return matches.map((s) => s.trim()).filter(Boolean);
}
