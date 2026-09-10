export const MODES = ['general', 'ocr', 'translate', 'explain', 'short'] as const;
export type AnalysisMode = (typeof MODES)[number];

export type JobStatus = 'processing' | 'complete' | 'error';

export type JobView = {
  jobId: string;
  status: JobStatus;
  seq: number;
  mode?: string;
  answer?: string;
  error?: string;
  errorCode?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type LatestResponse = {
  ok: boolean;
  result: JobView | null;
};

export type OpenAIStatusResponse = {
  ok: boolean;
  openaiKeySet?: boolean;
  model?: string;
  code?: string;
  error?: string;
  cached?: boolean;
};

export type ScreenKind = 'checking' | 'waiting' | 'processing' | 'result' | 'error';

export type GlassesScreen = {
  kind: ScreenKind;
  title: string;
  body: string;
  pages: string[];
  pageIndex: number;
  jobId?: string;
  seq?: number;
};

export type PollOutcome =
  | { kind: 'empty' }
  | { kind: 'same' }
  | { kind: 'processing'; job: JobView }
  | { kind: 'complete'; job: JobView }
  | { kind: 'error'; job: JobView };
