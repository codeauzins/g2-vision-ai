import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT } from './modes.js';

export type PromptSettings = {
  systemPrompt: string;
  userPrompt: string;
  updatedAt?: string;
};

export interface PromptStore {
  get(): Promise<PromptSettings>;
  save(patch: Partial<Pick<PromptSettings, 'systemPrompt' | 'userPrompt'>>): Promise<PromptSettings>;
  reset(): Promise<PromptSettings>;
}

export function defaultPromptSettings(): PromptSettings {
  return {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    userPrompt: DEFAULT_USER_PROMPT,
  };
}

export function normalizePromptSettings(raw: Partial<PromptSettings> | undefined): PromptSettings {
  const defaults = defaultPromptSettings();
  const systemPrompt = raw?.systemPrompt?.trim() || defaults.systemPrompt;
  const userPrompt = raw?.userPrompt?.trim() || defaults.userPrompt;
  return {
    systemPrompt,
    userPrompt,
    updatedAt: raw?.updatedAt,
  };
}

export class MemoryPromptStore implements PromptStore {
  protected current = defaultPromptSettings();

  async get(): Promise<PromptSettings> {
    return { ...this.current };
  }

  async save(patch: Partial<Pick<PromptSettings, 'systemPrompt' | 'userPrompt'>>): Promise<PromptSettings> {
    this.current = normalizePromptSettings({
      ...this.current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    return this.get();
  }

  async reset(): Promise<PromptSettings> {
    this.current = { ...defaultPromptSettings(), updatedAt: new Date().toISOString() };
    return this.get();
  }
}

export class FilePromptStore extends MemoryPromptStore {
  constructor(private readonly filePath: string) {
    super();
    this.loadSync();
  }

  override async save(patch: Partial<Pick<PromptSettings, 'systemPrompt' | 'userPrompt'>>): Promise<PromptSettings> {
    const next = await super.save(patch);
    await this.flush(next);
    return next;
  }

  override async reset(): Promise<PromptSettings> {
    const next = await super.reset();
    await this.flush(next);
    return next;
  }

  private loadSync(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<PromptSettings>;
      this.current = normalizePromptSettings(parsed);
    } catch {
      this.current = defaultPromptSettings();
    }
  }

  private async flush(settings: PromptSettings): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(settings, null, 2), 'utf8');
  }
}
