import { DomainError } from '../common/errors';
import { CalendarAdapter } from '../calendar/calendar-adapter';
import { CatalogRepository } from '../db/repositories/catalog.repository';
import { SlotEngine } from './slot-engine';
import { Slot, SlotRequest } from './types';

export interface AvailabilityConfig {
  granularityMinutes: number;
  minAdvanceMinutes: number;
  maxHorizonDays: number;
}

export class AvailabilityService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly engine: SlotEngine,
    private readonly config: AvailabilityConfig,
    private readonly calendar?: CalendarAdapter,
  ) {}

  async findSlots(request: SlotRequest): Promise<Slot[]> {
    const service = await this.catalog.findService(request.tenantId, request.serviceId);
    if (!service) {
      throw new DomainError('SERVICE_NOT_FOUND', 404, 'Service not found');
    }

    const location = await this.catalog.findLocation(request.tenantId, request.locationId);
    if (!location) {
      throw new DomainError('LOCATION_NOT_FOUND', 404, 'Location not found');
    }

    const variant = await this.catalog.findVariant(
      request.tenantId,
      request.serviceId,
      request.quantity,
    );
    const professionals = await this.catalog.listProfessionalsForService(
      request.tenantId,
      request.serviceId,
    );
    const requirements = await this.catalog.listRequirements(
      request.tenantId,
      request.serviceId,
    );
    const professionalIds = professionals.map((professional) => professional.id);
    const workingHours = await this.catalog.listWorkingHours(
      request.tenantId,
      professionalIds,
      request.locationId,
      request.from,
      request.to,
    );
    const timeOff = await this.catalog.listTimeOff(
      request.tenantId,
      professionalIds,
      request.from,
      request.to,
    );
    const holidays = await this.catalog.listHolidays(
      request.tenantId,
      request.locationId,
      request.from,
      request.to,
    );
    const reservations = await this.catalog.listReservations(
      request.tenantId,
      professionalIds,
      request.from,
      request.to,
    );
    const resources = await this.catalog.listActiveResources(
      request.tenantId,
      request.locationId,
    );
    const resourceId = resources[0]?.id ?? null;
    const resourceReservations = resourceId
      ? await this.catalog.listResourceReservations(
          request.tenantId,
          resourceId,
          request.from,
          request.to,
        )
      : [];
    const locks = await this.catalog.listActiveLocks(
      request.tenantId,
      professionalIds,
      request.from,
      request.to,
      request.now,
    );

    const slots = this.engine.findSlots({
      request,
      service,
      variant,
      qualifiedProfessionals: professionals,
      requirements,
      workingHours,
      timeOff,
      holidays,
      reservations,
      resourceReservations,
      locks,
      resources,
      timezone: location.timezone,
      granularityMinutes: this.config.granularityMinutes,
      minAdvanceMinutes: this.config.minAdvanceMinutes,
      maxHorizonDays: this.config.maxHorizonDays,
    });

    return this.removeCalendarBusy(slots, request);
  }

  /** Drops slots that collide with the doctor's own calendar (personal events). */
  private async removeCalendarBusy(slots: Slot[], request: SlotRequest): Promise<Slot[]> {
    if (!this.calendar?.isBusy) return slots;

    let busy;
    try {
      busy = await this.calendar.isBusy(request.from, request.to);
    } catch {
      // A calendar outage must not block booking on the internal agenda.
      return slots;
    }

    if (busy.length === 0) return slots;
    return slots.filter(
      (slot) => !busy.some((block) => slot.startAt < block.endAt && slot.endAt > block.startAt),
    );
  }
}
