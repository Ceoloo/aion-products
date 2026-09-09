/** Provider-neutral contracts; safe to import from browser composition. */
export type Effort = 'low' | 'medium' | 'high';

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  effort: Effort;
  model: string;
}

export interface LlmResponse {
  text: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}
