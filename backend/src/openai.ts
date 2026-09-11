import OpenAI from 'openai';
import { buildInstructions, userPrompt, type AnalysisMode } from './modes.js';

export type VisionAnalyzeInput = {
  imageDataUrl: string;
  mode: AnalysisMode;
  question?: string;
  instructions?: string;
  userText?: string;
};

export type OpenAIKeyCheck = {
  ok: boolean;
  model: string;
  openaiKeySet: boolean;
  code?: string;
  error?: string;
};

export interface VisionClient {
  analyze(input: VisionAnalyzeInput): Promise<string>;
  checkApiKey(): Promise<OpenAIKeyCheck>;
}

export class OpenAIVisionClient implements VisionClient {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly apiKey: string,
  ) {}

  async checkApiKey(): Promise<OpenAIKeyCheck> {
    if (!this.apiKey) {
      return {
        ok: false,
        model: this.model,
        openaiKeySet: false,
        code: 'openai_auth',
        error: 'OPENAI_API_KEY is not set',
      };
    }
    try {
      await this.client.models.retrieve(this.model);
      return { ok: true, model: this.model, openaiKeySet: true };
    } catch (err) {
      const status = (err as { status?: number }).status;
      const message = err instanceof Error ? err.message : String(err);
      const auth = status === 401 || /invalid api key|incorrect api key|unauthorized/i.test(message);
      return {
        ok: false,
        model: this.model,
        openaiKeySet: true,
        code: auth ? 'openai_auth' : 'openai_error',
        error: auth ? 'OpenAI key rejected' : message.slice(0, 180),
      };
    }
  }

  async analyze(input: VisionAnalyzeInput): Promise<string> {
    try {
      const response = await this.client.responses.create({
        model: this.model,
        instructions: input.instructions ?? buildInstructions(input.mode, input.question),
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: input.userText ?? userPrompt(input.mode, input.question) },
              { type: 'input_image', image_url: input.imageDataUrl, detail: 'high' },
            ],
          },
        ],
      });

      const text = response.output_text?.trim();
      if (!text) {
        throw new Error('OpenAI returned an empty answer');
      }
      return text;
    } catch (err) {
      const status = (err as { status?: number }).status;
      const message = err instanceof Error ? err.message : String(err);
      if (status === 401 || /invalid api key|incorrect api key|unauthorized/i.test(message)) {
        throw new Error('openai_auth');
      }
      throw err;
    }
  }
}

export function createOpenAIClient(apiKey: string, baseUrl: string, model: string): OpenAIVisionClient {
  return new OpenAIVisionClient(
    new OpenAI({
      apiKey,
      baseURL: baseUrl,
      timeout: 45_000,
    }),
    model,
    apiKey,
  );
}
