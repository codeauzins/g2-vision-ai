import { describe, expect, it } from 'vitest';
import { burstUserPrompt, buildInstructions, parseMode, userPrompt } from '../src/modes.js';

describe('modes', () => {
  it('defaults unknown values to general', () => {
    expect(parseMode(undefined)).toBe('general');
    expect(parseMode('nope')).toBe('general');
    expect(parseMode('ocr')).toBe('ocr');
  });

  it('builds glasses-oriented instructions', () => {
    const text = buildInstructions('short', 'What brand is this?');
    expect(text).toContain('smart glasses');
    expect(text).toContain('What brand is this?');
    expect(userPrompt('ocr')).toMatch(/text/i);
  });

  it('asks OpenAI to pick the sharpest burst frame', () => {
    expect(burstUserPrompt('general')).toMatch(/most legible/i);
    expect(burstUserPrompt('ocr', 'What is the price?')).toContain('What is the price?');
  });
});
