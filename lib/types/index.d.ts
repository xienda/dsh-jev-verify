/** Plugin configuration schema mirror (see Config in lib/index.js). */
export interface JevVerifyConfig {
  enabled?: boolean;
  apiKey?: string;
  apiKeyEnv?: string;
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
  maxQuestionsPerCall?: number;
  verifyEnabled?: boolean;
}
export function apply(ctx: unknown, config: JevVerifyConfig): void;
export const name: string;
export const inject: string[];
export const Config: unknown;
export function verifyAgainstLiveApi(options: unknown): Promise<unknown>;
