import { ChannelAdapter } from './channel-adapter';
import { HumanTicket, OwnerRecipient } from '../db/repositories/rows';

export interface OwnerNotification {
  ticket: HumanTicket;
  patientLabel: string;
  text: string;
}

export interface OwnerNotifier {
  notify(
    notification: OwnerNotification,
    recipients: OwnerRecipient[],
  ): Promise<{ deliveredTo: string[] }>;
}

export class RecordingOwnerNotifier implements OwnerNotifier {
  readonly deliveries: Array<{ ticketId: string; ownerId: string; text: string }> = [];
  failed = false;

  async notify(
    notification: OwnerNotification,
    recipients: OwnerRecipient[],
  ): Promise<{ deliveredTo: string[] }> {
    if (this.failed) {
      throw new Error('owner notification failed');
    }

    for (const recipient of recipients) {
      this.deliveries.push({
        ticketId: notification.ticket.id,
        ownerId: recipient.userId,
        text: notification.text,
      });
    }

    return { deliveredTo: recipients.map((recipient) => recipient.userId) };
  }
}

/**
 * Delivers the ticket card to each owner over the clinic's own channel.
 * A failure for one owner must not stop the others; the ticket stays open when
 * nobody could be reached.
 */
export class ChannelOwnerNotifier implements OwnerNotifier {
  constructor(private readonly channel: ChannelAdapter) {}

  async notify(
    notification: OwnerNotification,
    recipients: OwnerRecipient[],
  ): Promise<{ deliveredTo: string[] }> {
    const deliveredTo: string[] = [];

    for (const recipient of recipients) {
      try {
        await this.channel.send({
          externalUserId: recipient.externalUserId,
          text: notification.text,
        });
        deliveredTo.push(recipient.userId);
      } catch {
        // Try the next owner; the SLA fallback covers the patient.
      }
    }

    return { deliveredTo };
  }
}

/**
 * Stand-in used by tests and by deployments with no owner channel linked.
 * Returning an empty delivery list keeps the ticket `open` instead of falsely
 * marking it notified.
 */
export class NoopOwnerNotifier implements OwnerNotifier {
  async notify(): Promise<{ deliveredTo: string[] }> {
    return { deliveredTo: [] };
  }
}
