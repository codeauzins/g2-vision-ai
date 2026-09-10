import { describe, expect, it } from 'vitest';
import { DEMO_ANSWER } from '../src/demo.js';
import {
  PAGE_CHAR_BUDGET,
  compactAnswer,
  formatHudPage,
  pageIndicator,
  paginate,
} from '../src/pagination.js';

describe('pagination', () => {
  it('keeps short answers on one page', () => {
    const set = paginate('Green square on a table.');
    expect(set.total).toBe(1);
    expect(set.pages[0]).toContain('Green square');
  });

  it('splits the demo answer across several G2 pages without a 140-char cap', () => {
    const set = paginate(DEMO_ANSWER);
    expect(set.total).toBeGreaterThanOrEqual(3);
    expect(set.total).toBeLessThanOrEqual(8);
    for (const page of set.pages) {
      expect(page.length).toBeLessThanOrEqual(PAGE_CHAR_BUDGET + 8);
    }
    expect(Math.max(...set.pages.map((p) => p.length))).toBeGreaterThan(140);
    expect(set.pages.join(' ')).toContain("Today's specials");
    expect(set.pages.join(' ')).toContain('risotto');
  });

  it('prefers paragraph boundaries', () => {
    const a = 'A'.repeat(80);
    const b = 'B'.repeat(80);
    const set = paginate(`${a}\n\n${b}`, 100);
    expect(set.pages[0]).toBe(a);
    expect(set.pages[1]).toBe(b);
  });

  it('does not split words unless a token exceeds the budget', () => {
    const set = paginate('alpha bravo charlie delta echo', 14);
    for (const page of set.pages) {
      expect(page.startsWith(' ') || page.endsWith(' ')).toBe(false);
      if (!page.includes(' ')) {
        expect(['alpha', 'bravo', 'charlie', 'delta', 'echo'].some((w) => page.includes(w))).toBe(
          true,
        );
      }
    }
  });

  it('formats a page indicator', () => {
    expect(pageIndicator(0, 4)).toBe('1/4');
    const hud = formatHudPage('Ask AI', 'Ready', 0, 1);
    expect(hud).toContain('Ask AI');
    expect(hud).toContain('1/1');
    expect(hud).toContain('Ready');
  });

  it('builds a one-page short answer', () => {
    const short = compactAnswer(DEMO_ANSWER);
    expect(short.length).toBeLessThan(DEMO_ANSWER.length);
    expect(short).toContain('Street menu');
  });
});
