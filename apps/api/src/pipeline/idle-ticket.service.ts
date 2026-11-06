import { TicketsRepository } from '../db/repositories/tickets.repository';
import { EscalationService } from './escalation.service';

export interface IdleTicketDependencies {
  tickets: TicketsRepository;
  escalation: EscalationService;
  now: () => Date;
  idleMinutes: number;
}

export interface IdleSweepResult {
  tenantId: string;
  idle: number;
  alerted: number;
}

/**
 * An accepted ticket silences the bot and also disables the patient-facing SLA
 * fallback. Without this, a human who takes over and walks away leaves the
 * patient waiting forever with nobody warned.
 */
export class IdleTicketService {
  constructor(private readonly deps: IdleTicketDependencies) {}

  async sweepTenant(tenantId: string): Promise<IdleSweepResult> {
    const cutoff = new Date(
      this.deps.now().getTime() - this.deps.idleMinutes * 60_000,
    );
    const tickets = await this.deps.tickets.listIdleAccepted(tenantId, cutoff);

    let alerted = 0;
    for (const ticket of tickets) {
      const { deliveredTo } = await this.deps.escalation.notifyIdle(
        ticket,
        this.deps.idleMinutes,
      );
      if (deliveredTo.length > 0) alerted += 1;
    }

    return { tenantId, idle: tickets.length, alerted };
  }
}
