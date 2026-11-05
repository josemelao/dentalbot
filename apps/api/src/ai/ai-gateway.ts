import { IntentResponse } from '../contracts/intent';

export interface IntentRequest {
  tenantId: string;
  conversationId: string | null;
  messageId: string | null;
  text: string;
  recentMessages: Array<{ direction: 'in' | 'out'; content: string | null }>;
}

export interface AiGateway {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  classifyIntent(request: IntentRequest): Promise<IntentResponse>;
}
