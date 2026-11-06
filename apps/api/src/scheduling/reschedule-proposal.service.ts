import { ChannelAdapter } from '../channels/channel-adapter';
import { DomainError } from '../common/errors';
import { normalizeText } from '../common/text';
import { AppointmentsRepository } from '../db/repositories/appointments.repository';
import { CatalogRepository } from '../db/repositories/catalog.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import {
  ProposalSlot,
  RescheduleProposalRepository,
} from '../db/repositories/reschedule-proposals.repository';
import { AvailabilityService } from './availability.service';
import { BookingService } from './booking.service';
import { proposalMessages } from './proposal-messages';
import { FlowResult } from './scheduling-flow.service';
import { formatSlot } from './scheduling-messages';
import { OfferedSlot, Slot } from './types';

const ORDINALS: Record<string, number> = {
  primeiro: 0,
  primeira: 0,
  segundo: 1,
  segunda: 1,
  terceiro: 2,
  terceira: 2,
  quarto: 3,
  quarta: 3,
  ultimo: -1,
  ultima: -1,
};

const toOffered = (slot: Slot): ProposalSlot => ({
  startAt: slot.startAt.toISOString(),
  professionalIds: slot.professionalIds,
  resourceId: slot.resourceId,
});

const asOffered = (slots: ProposalSlot[]): OfferedSlot[] =>
  slots.map((slot) => ({
    startAt: slot.startAt,
    professionalIds: slot.professionalIds,
    resourceId: slot.resourceId,
  }));

export interface RescheduleProposalDependencies {
  proposals: RescheduleProposalRepository;
  appointments: AppointmentsRepository;
  catalog: CatalogRepository;
  availability: AvailabilityService;
  booking: BookingService;
  patients: PatientsRepository;
  messages: MessagesRepository;
  conversations: ConversationsRepository;
  channel: ChannelAdapter;
  now: () => Date;
  ttlHours: number;
  horizonDays: number;
}

export interface ProposeResult {
  status: 'SENT' | 'NO_SLOTS';
  proposalId?: string;
  slots?: number;
}

/**
 * The clinic proposes new times; the patient chooses. The proposal is the only
 * thing that can start a reschedule from the clinic side, and it always ends
 * with the patient picking a slot.
 */
export class RescheduleProposalService {
  constructor(private readonly deps: RescheduleProposalDependencies) {}

  async propose(input: {
    tenantId: string;
    appointmentId: string;
    userId: string | null;
  }): Promise<ProposeResult> {
    const appointment = await this.deps.appointments.findById(
      input.tenantId,
      input.appointmentId,
    );
    if (!appointment) {
      throw new DomainError('APPOINTMENT_NOT_FOUND', 404, 'Appointment not found');
    }
    if (appointment.status !== 'BOOKED') {
      throw new DomainError('APPOINTMENT_NOT_BOOKED', 409, 'Appointment is not booked');
    }

    const contact = await this.deps.patients.findContactById(
      input.tenantId,
      appointment.patientContactId,
    );
    if (!contact) {
      throw new DomainError('CONTACT_NOT_FOUND', 404, 'Contact not found');
    }

    const conversation = await this.deps.conversations.findOpenByContact(
      input.tenantId,
      appointment.patientContactId,
    );
    if (!conversation) {
      throw new DomainError('CONVERSATION_NOT_FOUND', 409, 'No open conversation');
    }

    const locations = await this.deps.catalog.listActiveLocations(input.tenantId);
    const location =
      locations.find((item) => item.id === appointment.locationId) ?? locations[0];
    if (!location) {
      throw new DomainError('LOCATION_NOT_FOUND', 409, 'No active location');
    }

    const professionals = await this.deps.appointments.listProfessionalIds(
      input.tenantId,
      appointment.id,
    );
    const now = this.deps.now();

    const slots = await this.deps.availability.findSlots({
      tenantId: input.tenantId,
      serviceId: appointment.serviceId,
      quantity: 1,
      professionalId: professionals.length === 1 ? professionals[0] : null,
      locationId: appointment.locationId,
      from: now,
      to: new Date(now.getTime() + this.deps.horizonDays * 86_400_000),
      now,
    });

    if (slots.length === 0) return { status: 'NO_SLOTS' };

    const offered = slots.slice(0, 3).map(toOffered);
    const expiresAt = new Date(now.getTime() + this.deps.ttlHours * 3_600_000);

    const proposal = await this.deps.proposals.create({
      tenantId: input.tenantId,
      appointmentId: appointment.id,
      conversationId: conversation.id,
      slots: offered,
      expiresAt,
      createdBy: input.userId,
    });

    const service = await this.deps.catalog.findService(
      input.tenantId,
      appointment.serviceId,
    );
    const text = proposalMessages.offer(
      service?.name ?? 'sua consulta',
      formatSlot(appointment.startAt.toISOString(), location.timezone),
      asOffered(offered),
      location.timezone,
    );

    await this.deps.channel.send({ externalUserId: contact.externalUserId, text });
    await this.deps.messages.appendOutbound({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      channel: contact.channel,
      content: text,
      deliveryStatus: 'sent',
    });
    await this.deps.conversations.touchOutbound(input.tenantId, conversation.id, now);

    return { status: 'SENT', proposalId: proposal.id, slots: offered.length };
  }

  /** Returns null when the conversation has no pending proposal. */
  async handleReply(input: {
    tenantId: string;
    conversationId: string;
    text: string;
  }): Promise<FlowResult | null> {
    const proposal = await this.deps.proposals.findLatestByConversation(
      input.tenantId,
      input.conversationId,
    );
    if (!proposal) return null;

    if (proposal.expiresAt.getTime() <= this.deps.now().getTime()) {
      await this.deps.proposals.markStatus(input.tenantId, proposal.id, 'EXPIRED');
      return {
        reply: proposalMessages.expired(),
        context: null,
        status: 'REQUIRES_HUMAN',
        escalate: {
          reason: 'UNKNOWN',
          summary: 'Proposta de remarcação expirada sem resposta',
        },
      };
    }

    const normalized = normalizeText(input.text);
    if (/^(nao|cancelar|melhor nao|deixa)/.test(normalized)) {
      await this.deps.proposals.markStatus(input.tenantId, proposal.id, 'CANCELLED');
      return { reply: proposalMessages.kept(), context: null, status: 'COMPLETED' };
    }

    const timezone = await this.timezoneFor(input.tenantId, proposal.appointmentId);
    const index = this.parseChoice(normalized, proposal.slots.length);

    if (index === null) {
      return {
        reply: proposalMessages.askAgain(asOffered(proposal.slots), timezone),
        context: null,
        status: 'PENDING',
      };
    }

    const slot = proposal.slots[index];
    const result = await this.deps.booking.reschedule({
      tenantId: input.tenantId,
      appointmentId: proposal.appointmentId,
      newStartAt: new Date(slot.startAt),
      professionalIds: slot.professionalIds,
      idempotencyKey: `proposal-${proposal.id}`,
    });

    if (result.status === 'BOOKED') {
      await this.deps.proposals.markStatus(input.tenantId, proposal.id, 'ACCEPTED');
      return {
        reply: proposalMessages.rescheduled(slot.startAt, timezone),
        context: null,
        status: 'COMPLETED',
        appointmentId: result.appointment.id,
      };
    }

    if (result.status === 'CONFLICT') {
      const alternatives = result.alternatives.slice(0, 3).map(toOffered);
      await this.deps.proposals.updateSlots(
        input.tenantId,
        proposal.id,
        alternatives,
        new Date(this.deps.now().getTime() + this.deps.ttlHours * 3_600_000),
      );
      return {
        reply: proposalMessages.conflict(asOffered(alternatives), timezone),
        context: null,
        status: 'PENDING',
      };
    }

    return {
      reply:
        'Recebi sua escolha, mas preciso confirmar com a agenda antes de garantir. Vou pedir para a equipe te ajudar.',
      context: null,
      status: 'REQUIRES_HUMAN',
      operationId: result.operationId,
      escalate: {
        reason: 'UNKNOWN',
        summary: `Remarcação por proposta incerta (operação ${result.operationId})`,
      },
    };
  }

  private parseChoice(normalized: string, length: number): number | null {
    const digit = normalized.match(/^(\d{1,2})\b/);
    if (digit) {
      const index = Number(digit[1]) - 1;
      return index >= 0 && index < length ? index : null;
    }

    const ordinal = normalized.match(
      /\b(primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|ultim[oa])\b/,
    )?.[1];
    if (ordinal) {
      const base = ORDINALS[ordinal];
      const index = base === -1 ? length - 1 : base;
      return index >= 0 && index < length ? index : null;
    }

    return null;
  }

  private async timezoneFor(tenantId: string, appointmentId: string): Promise<string> {
    const appointment = await this.deps.appointments.findById(tenantId, appointmentId);
    const locations = await this.deps.catalog.listActiveLocations(tenantId);
    const location = locations.find((item) => item.id === appointment?.locationId);
    return location?.timezone ?? 'America/Sao_Paulo';
  }
}
