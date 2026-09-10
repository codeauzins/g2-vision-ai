import OpenAI from 'openai';
import { buildInstructions, userPrompt, type AnalysisMode } from './modes.js';

export type VisionAnalyzeInput = {
  imageDataUrl: string;
  mode: AnalysisMode;
  question?: string;
};

export interface VisionClient {
  analyze(input: VisionAnalyzeInput): Promise<string>;
}

export class OpenAIVisionClient implements VisionClient {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async analyze(input: VisionAnalyzeInput): Promise<string> {
    const response = await this.client.responses.create({
      model: this.model,
      instructions: buildInstructions(input.mode, input.question),
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: userPrompt(input.mode, input.question) },
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
  }
}

export function createOpenAIClient(apiKey: string, baseUrl: string, model: string): OpenAIVisionClient {
  return new OpenAIVisionClient(
    new OpenAI({
      apiKey,
      baseURL: baseUrl,
    }),
    model,
  );
}
