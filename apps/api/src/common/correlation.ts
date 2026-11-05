import { randomUUID } from 'node:crypto';

export interface CorrelatedRequest {
  header(name: string): string | undefined;
  correlationId?: string;
}

export interface CorrelatedResponse {
  setHeader(name: string, value: string): void;
}

export function correlationMiddleware(
  req: CorrelatedRequest,
  res: CorrelatedResponse,
  next: () => void,
): void {
  const incoming = req.header('x-correlation-id');
  const correlationId = incoming && incoming.trim().length > 0 ? incoming : randomUUID();

  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  next();
}
