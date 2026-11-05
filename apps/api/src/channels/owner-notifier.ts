import { ClinicUser, HumanTicket } from '../db/repositories/rows';

export interface OwnerNotifier {
  notifyTicket(
    ticket: HumanTicket,
    owners: ClinicUser[],
  ): Promise<{ deliveredTo: string[] }>;
}

export class RecordingOwnerNotifier implements OwnerNotifier {
  readonly deliveries: Array<{ ticketId: string; ownerId: string }> = [];
  failed = false;

  async notifyTicket(
    ticket: HumanTicket,
    owners: ClinicUser[],
  ): Promise<{ deliveredTo: string[] }> {
    if (this.failed) {
      throw new Error('owner notification failed');
    }

    for (const owner of owners) {
      this.deliveries.push({ ticketId: ticket.id, ownerId: owner.id });
    }

    return { deliveredTo: owners.map((owner) => owner.id) };
  }
}
