export interface LlmRequest {
  system: string;
  user: string;
}

/**
 * Provider-agnostic chat completion. Both providers return JSON text; the
 * caller validates the shape, so a bad model answer can never reach a patient.
 */
export interface LlmClient {
  readonly provider: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<string>;
}
