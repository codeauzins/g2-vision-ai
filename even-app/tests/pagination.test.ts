import { describe, expect, it } from 'vitest';
import { DEMO_ANSWER } from '../src/demo.js';
import { TITLE } from '../src/state.js';
import {
  BODY_LINES,
  CHARS_PER_LINE,
  DISPLAY_LINES,
  compactAnswer,
  countWrappedLines,
  formatHudPage,
  pageIndicator,
  paginate,
  wrapToLines,
} from '../src/pagination.js';

describe('pagination', () => {
  it('keeps short answers on one page', () => {
    const set = paginate('Green square on a table.');
    expect(set.total).toBe(1);
    expect(set.pages[0]).toContain('Green square');
  });

  it('fits every page on one G2 screen with no leftover wrap', () => {
    const set = paginate(DEMO_ANSWER);
    expect(set.total).toBeGreaterThan(1);
    for (const page of set.pages) {
      expect(countWrappedLines(page)).toBeLessThanOrEqual(BODY_LINES);
      for (const line of wrapToLines(page)) {
        expect(line.length).toBeLessThanOrEqual(CHARS_PER_LINE);
      }
      const hud = formatHudPage(TITLE, page, 0, set.total);
      expect(countWrappedLines(hud)).toBeLessThanOrEqual(DISPLAY_LINES);
    }
    expect(set.pages.join(' ')).toContain("Today's specials");
    expect(set.pages.join(' ')).toContain('risotto');
  });

  it('starts a new page instead of overflowing a long paragraph', () => {
    const set = paginate(`${'word '.repeat(80)}end`);
    expect(set.total).toBeGreaterThan(1);
    for (const page of set.pages) {
      expect(countWrappedLines(page)).toBeLessThanOrEqual(BODY_LINES);
    }
    expect(set.pages.join(' ')).toContain('end');
  });

  it('does not split words unless a token exceeds the line width', () => {
    const lines = wrapToLines('alpha bravo charlie delta echo', 14);
    for (const line of lines) {
      expect(line.startsWith(' ') || line.endsWith(' ')).toBe(false);
      expect(line.length).toBeLessThanOrEqual(14);
    }
  });

  it('formats a page indicator', () => {
    expect(pageIndicator(0, 4)).toBe('1/4');
    const hud = formatHudPage(TITLE, 'Ready', 0, 1);
    expect(hud.startsWith('A-AI')).toBe(true);
    expect(hud).toContain('A-AI');
    expect(hud).toContain('1/1');
    expect(hud).toContain('Ready');
    expect(countWrappedLines(hud)).toBeLessThanOrEqual(DISPLAY_LINES);
  });

  it('builds a one-screen short answer', () => {
    const short = compactAnswer(DEMO_ANSWER);
    expect(short.length).toBeLessThan(DEMO_ANSWER.length);
    expect(short).toContain('Street menu');
    expect(countWrappedLines(short)).toBeLessThanOrEqual(BODY_LINES);
  });
});
