import { HumanTicket, KnowledgeEntry } from '../db/repositories/rows';
import type { FlowResult } from '../scheduling/scheduling-flow.service';

export type Decision =
  | { kind: 'ANSWER_FAQ'; entry: KnowledgeEntry }
  | { kind: 'EMERGENCY_PROTOCOL'; rule: string }
  | { kind: 'HOLDING_ESCALATED'; ticket: HumanTicket }
  | { kind: 'CLARIFY'; reason: string }
  | { kind: 'UNSUPPORTED_MEDIA' }
  | { kind: 'HUMAN_ACTIVE_SILENT' }
  | { kind: 'GREETING' }
  | { kind: 'FLOW_REPLY'; result: FlowResult };
