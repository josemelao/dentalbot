import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { normalizeText } from '../common/text';
import { AppointmentsRepository } from '../db/repositories/appointments.repository';
import { CatalogRepository } from '../db/repositories/catalog.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { Appointment, Service } from '../db/repositories/rows';
import { AvailabilityService } from './availability.service';
import { BookingService } from './booking.service';
import { schedulingMessages } from './scheduling-messages';
import { OfferedSlot, SchedulingContext, Slot } from './types';

const OfferedSlotSchema = z.object({
  startAt: z.string(),
  professionalIds: z.array(z.string()),
  resourceId: z.string().nullable(),
});

const SchedulingContextSchema = z.object({
  flow: z.enum(['SCHEDULE', 'RESCHEDULE', 'CANCEL']),
  step: z.enum(['SERVICE', 'SLOT', 'CONFIRM', 'IDENTITY']),
  serviceId: z.string().optional(),
  quantity: z.number().optional(),
  locationId: z.string().optional(),
  timezone: z.string().optional(),
  offeredSlots: z.array(OfferedSlotSchema).optional(),
  chosenSlot: OfferedSlotSchema.optional(),
  appointmentId: z.string().optional(),
  idempotencyKey: z.string(),
  expiresAt: z.string(),
});

export function parseSchedulingContext(raw: unknown): SchedulingContext | null {
  const parsed = SchedulingContextSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface FlowResult {
  reply: string;
  context: SchedulingContext | null;
  status: 'COMPLETED' | 'PENDING' | 'REQUIRES_HUMAN';
  appointmentId?: string;
  operationId?: string;
  escalate?: { reason: 'UNKNOWN' | 'HUMAN_REQUEST'; summary: string };
}

export interface SchedulingFlowDependencies {
  catalog: CatalogRepository;
  availability: AvailabilityService;
  appointments: AppointmentsRepository;
  patients: PatientsRepository;
  booking: BookingService;
  now: () => Date;
  horizonDays: number;
}

export interface StartFlowInput {
  tenantId: string;
  conversationId: string;
  patientContactId: string;
  text: string;
  intent: 'SCHEDULE_REQUEST' | 'RESCHEDULE_REQUEST' | 'CANCEL_REQUEST';
  context: SchedulingContext | null;
}

export interface ReplyFlowInput {
  tenantId: string;
  conversationId: string;
  patientContactId: string;
  text: string;
  context: SchedulingContext;
}

export class SchedulingFlowService {
  constructor(private readonly deps: SchedulingFlowDependencies) {}

  async start(input: StartFlowInput): Promise<FlowResult> {
    if (input.intent !== 'SCHEDULE_REQUEST') {
      const open = await this.deps.appointments.findByContact(
        input.tenantId,
        input.patientContactId,
        this.deps.now(),
      );
      if (open.length === 0) {
        return {
          reply: schedulingMessages.noAppointment(),
          context: null,
          status: 'REQUIRES_HUMAN',
          escalate: {
            reason: 'UNKNOWN',
            summary: 'Pedido de remarcação/cancelamento sem agendamento futuro',
          },
        };
      }
      if (open.length > 1) {
        return {
          reply: schedulingMessages.multipleAppointments(),
          context: null,
          status: 'REQUIRES_HUMAN',
          escalate: {
            reason: 'UNKNOWN',
            summary: 'Múltiplos agendamentos futuros; seleção manual necessária',
          },
        };
      }
      const context =
        input.context ??
        this.newContext(input.intent === 'RESCHEDULE_REQUEST' ? 'RESCHEDULE' : 'CANCEL');
      return {
        reply: schedulingMessages.askIdentity(),
        context: { ...context, step: 'IDENTITY', appointmentId: open[0].id },
        status: 'PENDING',
      };
    }

    const services = await this.deps.catalog.listActiveServices(input.tenantId);
    const matched = this.matchService(services, input.text);
    const context = input.context ?? this.newContext('SCHEDULE');

    if (!matched) {
      return {
        reply: schedulingMessages.askService(services.map((service) => service.name)),
        context: { ...context, step: 'SERVICE' },
        status: 'PENDING',
      };
    }

    return this.offerForService(input.tenantId, context, matched);
  }

  async handleReply(input: ReplyFlowInput): Promise<FlowResult> {
    if (new Date(input.context.expiresAt).getTime() <= this.deps.now().getTime()) {
      return { reply: schedulingMessages.expired(), context: null, status: 'PENDING' };
    }

    if (input.context.step === 'SERVICE') {
      const services = await this.deps.catalog.listActiveServices(input.tenantId);
      const matched = this.matchService(services, input.text);
      if (!matched) {
        return {
          reply: schedulingMessages.askService(services.map((service) => service.name)),
          context: input.context,
          status: 'PENDING',
        };
      }
      return this.offerForService(input.tenantId, input.context, matched);
    }

    if (input.context.step === 'IDENTITY') {
      return this.verifyIdentity(input);
    }

    if (input.context.step === 'SLOT') {
      const offered = input.context.offeredSlots ?? [];
      const timezone = input.context.timezone ?? 'America/Sao_Paulo';
      const index = Number(input.text.trim()) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= offered.length) {
        return {
          reply: schedulingMessages.askNumber(offered, timezone),
          context: input.context,
          status: 'PENDING',
        };
      }

      const chosen = offered[index];
      const service = input.context.serviceId
        ? await this.deps.catalog.findService(input.tenantId, input.context.serviceId)
        : null;
      return {
        reply: schedulingMessages.confirm(service?.name ?? 'consulta', chosen, timezone),
        context: { ...input.context, step: 'CONFIRM', chosenSlot: chosen },
        status: 'PENDING',
      };
    }

    if (input.context.step === 'CONFIRM') {
      const normalized = normalizeText(input.text);
      const yes = ['sim', 's', 'confirmo', 'pode', 'isso'].some(
        (word) => normalized === word || normalized.startsWith(`${word} `),
      );
      const no = ['nao', 'n'].some((word) => normalized === word);

      if (yes) {
        if (input.context.flow === 'CANCEL') return this.confirmCancel(input);
        if (input.context.flow === 'RESCHEDULE') return this.confirmReschedule(input);
        return this.confirmBooking(input);
      }

      if (no) {
        if (input.context.flow === 'CANCEL') {
          return {
            reply: schedulingMessages.keepAppointment(),
            context: null,
            status: 'COMPLETED',
          };
        }
        return this.offerAgain(input);
      }

      return {
        reply: schedulingMessages.confirmAgain(),
        context: input.context,
        status: 'PENDING',
      };
    }

    return { reply: schedulingMessages.expired(), context: null, status: 'PENDING' };
  }

  private async offerForService(
    tenantId: string,
    context: SchedulingContext,
    matched: Service,
  ): Promise<FlowResult> {
    let service = matched;
    let prefix = '';

    if (matched.requiresEvaluation || !matched.directBookingAllowed) {
      const evaluation = await this.deps.catalog.findEvaluationService(tenantId);
      if (!evaluation) {
        return {
          reply: schedulingMessages.noEvaluation(),
          context: null,
          status: 'REQUIRES_HUMAN',
          escalate: {
            reason: 'UNKNOWN',
            summary: `Serviço ${matched.name} exige avaliação, mas não há avaliação configurada`,
          },
        };
      }
      service = evaluation;
      prefix = schedulingMessages.evaluationIntro(matched.name);
    }

    const locations = await this.deps.catalog.listActiveLocations(tenantId);
    if (locations.length === 0) {
      return {
        reply: schedulingMessages.noLocation(),
        context: null,
        status: 'REQUIRES_HUMAN',
        escalate: { reason: 'UNKNOWN', summary: 'Nenhuma unidade ativa' },
      };
    }

    const location = locations[0];
    const now = this.deps.now();
    const slots = await this.deps.availability.findSlots({
      tenantId,
      serviceId: service.id,
      quantity: 1,
      professionalId: null,
      locationId: location.id,
      from: now,
      to: new Date(now.getTime() + this.deps.horizonDays * 86_400_000),
      now,
    });

    if (slots.length === 0) {
      return {
        reply: schedulingMessages.noSlots(service.name),
        context: null,
        status: 'REQUIRES_HUMAN',
        escalate: { reason: 'UNKNOWN', summary: `Sem horários para ${service.name}` },
      };
    }

    const offered = slots.slice(0, 3).map((slot) => this.toOffered(slot));
    return {
      reply: prefix + schedulingMessages.offerSlots(service.name, offered, location.timezone),
      context: {
        ...context,
        step: 'SLOT',
        serviceId: service.id,
        locationId: location.id,
        timezone: location.timezone,
        offeredSlots: offered,
      },
      status: 'PENDING',
    };
  }

  private async confirmBooking(input: ReplyFlowInput): Promise<FlowResult> {
    const { context } = input;
    const chosen = context.chosenSlot;
    if (!chosen || !context.serviceId || !context.locationId) {
      return { reply: schedulingMessages.expired(), context: null, status: 'PENDING' };
    }

    const service = await this.deps.catalog.findService(input.tenantId, context.serviceId);
    const timezone = context.timezone ?? 'America/Sao_Paulo';
    const result = await this.deps.booking.book({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      patientContactId: input.patientContactId,
      serviceId: context.serviceId,
      quantity: context.quantity ?? 1,
      professionalIds: chosen.professionalIds,
      locationId: context.locationId,
      resourceId: chosen.resourceId,
      startAt: new Date(chosen.startAt),
      idempotencyKey: context.idempotencyKey,
    });

    if (result.status === 'BOOKED') {
      return {
        reply: schedulingMessages.booked(service?.name ?? 'consulta', chosen, timezone),
        context: null,
        status: 'COMPLETED',
        appointmentId: result.appointment.id,
      };
    }

    if (result.status === 'CONFLICT') {
      const offered = result.alternatives.map((slot) => this.toOffered(slot));
      return {
        reply: schedulingMessages.conflict(offered, timezone),
        context: {
          ...context,
          step: 'SLOT',
          offeredSlots: offered,
          chosenSlot: undefined,
        },
        status: 'PENDING',
      };
    }

    return {
      reply: schedulingMessages.unknownConfirmation(),
      context: null,
      status: 'REQUIRES_HUMAN',
      operationId: result.operationId,
      escalate: {
        reason: 'UNKNOWN',
        summary: `Agendamento incerto (operação ${result.operationId})`,
      },
    };
  }

  private async offerAgain(input: ReplyFlowInput): Promise<FlowResult> {
    const timezone = input.context.timezone ?? 'America/Sao_Paulo';
    const offered = input.context.offeredSlots ?? [];
    if (offered.length === 0) {
      return { reply: schedulingMessages.expired(), context: null, status: 'PENDING' };
    }

    const service = input.context.serviceId
      ? await this.deps.catalog.findService(input.tenantId, input.context.serviceId)
      : null;
    return {
      reply: schedulingMessages.offerSlots(service?.name ?? 'consulta', offered, timezone),
      context: { ...input.context, step: 'SLOT', chosenSlot: undefined },
      status: 'PENDING',
    };
  }

  private async verifyIdentity(input: ReplyFlowInput): Promise<FlowResult> {
    const patient = await this.deps.patients.findPatientByContact(
      input.tenantId,
      input.patientContactId,
    );
    if (!patient || !patient.birthDate) {
      return {
        reply: schedulingMessages.noPatientRecord(),
        context: null,
        status: 'REQUIRES_HUMAN',
        escalate: {
          reason: 'UNKNOWN',
          summary: 'Identidade não verificável: paciente sem data de nascimento',
        },
      };
    }

    const parsed = this.parseIdentity(input.text);
    if (!parsed) {
      return {
        reply: schedulingMessages.identityFormat(),
        context: input.context,
        status: 'PENDING',
      };
    }

    const rawBirthDate: unknown = patient.birthDate;
    const birthDate =
      rawBirthDate instanceof Date
        ? rawBirthDate.toISOString().slice(0, 10)
        : String(rawBirthDate).slice(0, 10);
    if (
      normalizeText(parsed.name) !== normalizeText(patient.fullName) ||
      parsed.birthDate !== birthDate
    ) {
      return {
        reply: schedulingMessages.identityMismatch(),
        context: null,
        status: 'REQUIRES_HUMAN',
        escalate: { reason: 'UNKNOWN', summary: 'Identidade não confere' },
      };
    }

    const appointment = input.context.appointmentId
      ? await this.deps.appointments.findById(input.tenantId, input.context.appointmentId)
      : null;
    if (!appointment) {
      return {
        reply: schedulingMessages.noAppointment(),
        context: null,
        status: 'REQUIRES_HUMAN',
        escalate: {
          reason: 'UNKNOWN',
          summary: 'Agendamento não encontrado para remarcação/cancelamento',
        },
      };
    }

    if (input.context.flow === 'CANCEL') {
      const timezone = input.context.timezone ?? 'America/Sao_Paulo';
      return {
        reply: schedulingMessages.confirmCancel(appointment.startAt.toISOString(), timezone),
        context: { ...input.context, step: 'CONFIRM', timezone },
        status: 'PENDING',
      };
    }

    return this.offerReschedule(input.tenantId, input.context, appointment);
  }

  private parseIdentity(text: string): { name: string; birthDate: string } | null {
    const match = text.match(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/);
    if (!match) return null;

    const name = text.replace(match[0], '').replace(/[,;]/g, ' ').trim();
    if (name.length < 3) return null;

    const birthDate = match[0].includes('/')
      ? match[0].split('/').reverse().join('-')
      : match[0];
    return { name, birthDate };
  }

  private async offerReschedule(
    tenantId: string,
    context: SchedulingContext,
    appointment: Appointment,
  ): Promise<FlowResult> {
    const service = await this.deps.catalog.findService(tenantId, appointment.serviceId);
    const professionalIds = await this.deps.appointments.listProfessionalIds(
      tenantId,
      appointment.id,
    );
    const locations = await this.deps.catalog.listActiveLocations(tenantId);
    const location =
      locations.find((candidate) => candidate.id === appointment.locationId) ?? locations[0];

    if (!location) {
      return {
        reply: schedulingMessages.noLocation(),
        context: null,
        status: 'REQUIRES_HUMAN',
        escalate: { reason: 'UNKNOWN', summary: 'Nenhuma unidade ativa' },
      };
    }

    const now = this.deps.now();
    const slots = await this.deps.availability.findSlots({
      tenantId,
      serviceId: appointment.serviceId,
      quantity: 1,
      professionalId: professionalIds.length === 1 ? professionalIds[0] : null,
      locationId: appointment.locationId,
      from: now,
      to: new Date(now.getTime() + this.deps.horizonDays * 86_400_000),
      now,
    });

    if (slots.length === 0) {
      return {
        reply: schedulingMessages.noSlots(service?.name ?? 'consulta'),
        context: null,
        status: 'REQUIRES_HUMAN',
        escalate: {
          reason: 'UNKNOWN',
          summary: `Sem horários para remarcar ${service?.name ?? 'consulta'}`,
        },
      };
    }

    const offered = slots.slice(0, 3).map((slot) => this.toOffered(slot));
    return {
      reply: schedulingMessages.offerSlots(
        service?.name ?? 'consulta',
        offered,
        location.timezone,
      ),
      context: {
        ...context,
        step: 'SLOT',
        serviceId: appointment.serviceId,
        locationId: appointment.locationId,
        timezone: location.timezone,
        offeredSlots: offered,
        appointmentId: appointment.id,
      },
      status: 'PENDING',
    };
  }

  private async confirmReschedule(input: ReplyFlowInput): Promise<FlowResult> {
    const { context } = input;
    const chosen = context.chosenSlot;
    if (!chosen || !context.appointmentId) {
      return { reply: schedulingMessages.expired(), context: null, status: 'PENDING' };
    }

    const timezone = context.timezone ?? 'America/Sao_Paulo';
    const result = await this.deps.booking.reschedule({
      tenantId: input.tenantId,
      appointmentId: context.appointmentId,
      newStartAt: new Date(chosen.startAt),
      professionalIds: chosen.professionalIds,
      idempotencyKey: context.idempotencyKey,
    });

    if (result.status === 'BOOKED') {
      return {
        reply: schedulingMessages.rescheduled(chosen.startAt, timezone),
        context: null,
        status: 'COMPLETED',
        appointmentId: result.appointment.id,
      };
    }

    if (result.status === 'CONFLICT') {
      const offered = result.alternatives.map((slot) => this.toOffered(slot));
      return {
        reply: schedulingMessages.conflict(offered, timezone),
        context: {
          ...context,
          step: 'SLOT',
          offeredSlots: offered,
          chosenSlot: undefined,
        },
        status: 'PENDING',
      };
    }

    return {
      reply: schedulingMessages.unknownConfirmation(),
      context: null,
      status: 'REQUIRES_HUMAN',
      operationId: result.operationId,
      escalate: {
        reason: 'UNKNOWN',
        summary: `Remarcação incerta (operação ${result.operationId})`,
      },
    };
  }

  private async confirmCancel(input: ReplyFlowInput): Promise<FlowResult> {
    const { context } = input;
    if (!context.appointmentId) {
      return { reply: schedulingMessages.expired(), context: null, status: 'PENDING' };
    }

    const appointment = await this.deps.appointments.findById(
      input.tenantId,
      context.appointmentId,
    );
    if (!appointment) {
      return {
        reply: schedulingMessages.noAppointment(),
        context: null,
        status: 'REQUIRES_HUMAN',
        escalate: { reason: 'UNKNOWN', summary: 'Agendamento não encontrado' },
      };
    }

    const now = this.deps.now();
    const late = now.getTime() >= appointment.startAt.getTime() - 24 * 60 * 60_000;
    const result = await this.deps.booking.cancel({
      tenantId: input.tenantId,
      appointmentId: appointment.id,
      idempotencyKey: context.idempotencyKey,
      now,
    });

    if (result.status === 'CANCELLED') {
      return {
        reply: schedulingMessages.cancelled(late),
        context: null,
        status: 'COMPLETED',
      };
    }

    return {
      reply: schedulingMessages.unknownConfirmation(),
      context: null,
      status: 'REQUIRES_HUMAN',
      operationId: result.operationId,
      escalate: {
        reason: 'UNKNOWN',
        summary: `Cancelamento incerto (operação ${result.operationId})`,
      },
    };
  }

  private matchService(services: Service[], text: string): Service | null {
    const normalized = normalizeText(text);
    let best: { service: Service; score: number } | null = null;

    for (const service of services) {
      const candidates = [service.name, ...service.keywords]
        .map((candidate) => normalizeText(candidate))
        .filter((candidate) => candidate.length > 0);

      for (const candidate of candidates) {
        if (
          normalized.includes(candidate) &&
          (!best || candidate.length > best.score)
        ) {
          best = { service, score: candidate.length };
        }
      }
    }

    return best?.service ?? null;
  }

  private newContext(flow: SchedulingContext['flow']): SchedulingContext {
    const now = this.deps.now();
    return {
      flow,
      step: 'SERVICE',
      idempotencyKey: randomUUID(),
      expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    };
  }

  private toOffered(slot: Slot): OfferedSlot {
    return {
      startAt: slot.startAt.toISOString(),
      professionalIds: slot.professionalIds,
      resourceId: slot.resourceId,
    };
  }
}
