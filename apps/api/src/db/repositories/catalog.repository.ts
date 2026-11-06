import { Queryable } from '../pool';
import {
  AvailabilityLock,
  ClinicHoliday,
  Professional,
  ProfessionalReservation,
  ProfessionalTimeOff,
  ProfessionalWorkingHour,
  Resource,
  ResourceReservation,
  Service,
  ServiceProfessionalRequirement,
  ServiceVariant,
} from './rows';

const SERVICE_COLUMNS = `id, tenant_id as "tenantId", name, description, keywords,
  is_evaluation as "isEvaluation", duration_minutes as "durationMinutes", price,
  price_disclosure_allowed as "priceDisclosureAllowed",
  direct_booking_allowed as "directBookingAllowed",
  requires_evaluation as "requiresEvaluation",
  preparation_instructions as "preparationInstructions",
  required_documents as "requiredDocuments",
  buffer_before_minutes as "bufferBeforeMinutes",
  buffer_after_minutes as "bufferAfterMinutes", status`;

const PROFESSIONAL_COLUMNS = `id, tenant_id as "tenantId", clinic_user_id as "clinicUserId",
  location_id as "locationId", name, specialty, calendar_ref as "calendarRef", status`;

const RESERVATION_COLUMNS = `id, tenant_id as "tenantId", appointment_id as "appointmentId",
  professional_id as "professionalId", start_at as "startAt", end_at as "endAt", status`;

export class CatalogRepository {
  constructor(private readonly db: Queryable) {}

  async findService(tenantId: string, serviceId: string): Promise<Service | null> {
    const { rows } = await this.db.query(
      `select ${SERVICE_COLUMNS} from services where tenant_id = $1 and id = $2`,
      [tenantId, serviceId],
    );
    return (rows[0] as Service | undefined) ?? null;
  }

  async updateServicePricing(
    tenantId: string,
    serviceId: string,
    input: {
      durationMinutes: number;
      price: number;
      priceDisclosureAllowed: boolean;
      status: 'active' | 'inactive';
    },
  ): Promise<void> {
    await this.db.query(
      `update services
       set duration_minutes = $3, price = $4, price_disclosure_allowed = $5,
           status = $6, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [
        tenantId,
        serviceId,
        input.durationMinutes,
        input.price,
        input.priceDisclosureAllowed,
        input.status,
      ],
    );
  }

  async listAllServices(tenantId: string): Promise<Service[]> {
    const { rows } = await this.db.query(
      `select ${SERVICE_COLUMNS} from services
       where tenant_id = $1
       order by name`,
      [tenantId],
    );
    return rows as Service[];
  }

  async listActiveServices(tenantId: string): Promise<Service[]> {
    const { rows } = await this.db.query(
      `select ${SERVICE_COLUMNS} from services
       where tenant_id = $1 and status = 'active' order by name`,
      [tenantId],
    );
    return rows as Service[];
  }

  async findEvaluationService(tenantId: string): Promise<Service | null> {
    const { rows } = await this.db.query(
      `select ${SERVICE_COLUMNS} from services
       where tenant_id = $1 and is_evaluation = true and status = 'active'
       order by name limit 1`,
      [tenantId],
    );
    return (rows[0] as Service | undefined) ?? null;
  }

  async findVariant(
    tenantId: string,
    serviceId: string,
    quantity: number,
  ): Promise<ServiceVariant | null> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", service_id as "serviceId",
              min_quantity as "minQuantity", max_quantity as "maxQuantity",
              price, duration_minutes as "durationMinutes"
       from service_variants
       where tenant_id = $1 and service_id = $2
         and min_quantity <= $3 and max_quantity >= $3
       order by min_quantity desc limit 1`,
      [tenantId, serviceId, quantity],
    );
    return (rows[0] as ServiceVariant | undefined) ?? null;
  }

  async listProfessionalsForService(
    tenantId: string,
    serviceId: string,
  ): Promise<Professional[]> {
    const { rows } = await this.db.query(
      `select ${PROFESSIONAL_COLUMNS.split(',').map((column) => `p.${column.trim()}`).join(', ')}
       from professionals p
       join professional_services ps
         on ps.tenant_id = p.tenant_id and ps.professional_id = p.id
       where p.tenant_id = $1 and ps.service_id = $2 and p.status = 'active'
       order by p.name`,
      [tenantId, serviceId],
    );
    return rows as Professional[];
  }

  async listRequirements(
    tenantId: string,
    serviceId: string,
  ): Promise<ServiceProfessionalRequirement[]> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", service_id as "serviceId",
              professional_id as "professionalId", role, required
       from service_professional_requirements
       where tenant_id = $1 and service_id = $2
       order by professional_id`,
      [tenantId, serviceId],
    );
    return rows as ServiceProfessionalRequirement[];
  }

  async listProfessionals(
    tenantId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const { rows } = await this.db.query(
      `select id, name from professionals
       where tenant_id = $1 and status = 'active' order by name`,
      [tenantId],
    );
    return rows as Array<{ id: string; name: string }>;
  }

  async listAllTimeOff(tenantId: string): Promise<
    Array<{
      id: string;
      professionalName: string;
      startAt: Date;
      endAt: Date;
      reason: string | null;
    }>
  > {
    const { rows } = await this.db.query(
      `select t.id, p.name as "professionalName", t.start_at as "startAt",
              t.end_at as "endAt", t.reason
       from professional_time_off t
       join professionals p on p.tenant_id = t.tenant_id and p.id = t.professional_id
       where t.tenant_id = $1
       order by t.start_at`,
      [tenantId],
    );
    return rows as Array<{
      id: string;
      professionalName: string;
      startAt: Date;
      endAt: Date;
      reason: string | null;
    }>;
  }

  async addTimeOff(
    tenantId: string,
    input: { professionalId: string; startAt: Date; endAt: Date; reason: string | null },
  ): Promise<void> {
    await this.db.query(
      `insert into professional_time_off (tenant_id, professional_id, start_at, end_at, reason)
       values ($1, $2, $3, $4, $5)`,
      [tenantId, input.professionalId, input.startAt, input.endAt, input.reason],
    );
  }

  async deleteTimeOff(tenantId: string, id: string): Promise<void> {
    await this.db.query(
      `delete from professional_time_off where tenant_id = $1 and id = $2`,
      [tenantId, id],
    );
  }

  async listProfessionalCalendars(
    tenantId: string,
    professionalIds: string[],
  ): Promise<Array<{ id: string; calendarId: string | null }>> {
    if (professionalIds.length === 0) return [];
    const { rows } = await this.db.query(
      `select id, calendar_id as "calendarId" from professionals
       where tenant_id = $1 and id = any($2::uuid[])`,
      [tenantId, professionalIds],
    );
    return rows as Array<{ id: string; calendarId: string | null }>;
  }

  async listAllWorkingHours(tenantId: string): Promise<
    Array<{
      id: string;
      professionalId: string;
      professionalName: string;
      locationId: string;
      weekday: number;
      startTime: string;
      endTime: string;
    }>
  > {
    const { rows } = await this.db.query(
      `select w.id, w.professional_id as "professionalId", p.name as "professionalName",
              w.location_id as "locationId", w.weekday,
              to_char(w.start_time, 'HH24:MI') as "startTime",
              to_char(w.end_time, 'HH24:MI') as "endTime"
       from professional_working_hours w
       join professionals p on p.tenant_id = w.tenant_id and p.id = w.professional_id
       where w.tenant_id = $1
       order by p.name, w.weekday, w.start_time`,
      [tenantId],
    );
    return rows as Array<{
      id: string;
      professionalId: string;
      professionalName: string;
      locationId: string;
      weekday: number;
      startTime: string;
      endTime: string;
    }>;
  }

  async upsertWorkingHour(
    tenantId: string,
    input: {
      professionalId: string;
      locationId: string;
      weekday: number;
      startTime: string;
      endTime: string;
    },
  ): Promise<void> {
    await this.db.query(
      `insert into professional_working_hours
         (tenant_id, professional_id, location_id, weekday, start_time, end_time)
       values ($1, $2, $3, $4, $5::time, $6::time)`,
      [
        tenantId,
        input.professionalId,
        input.locationId,
        input.weekday,
        input.startTime,
        input.endTime,
      ],
    );
  }

  async deleteWorkingHour(tenantId: string, id: string): Promise<void> {
    await this.db.query(
      `delete from professional_working_hours where tenant_id = $1 and id = $2`,
      [tenantId, id],
    );
  }

  async listAllHolidays(
    tenantId: string,
  ): Promise<Array<{ id: string; locationId: string | null; date: string; name: string }>> {
    const { rows } = await this.db.query(
      `select id, location_id as "locationId", holiday_date::text as "date", name
       from clinic_holidays
       where tenant_id = $1
       order by holiday_date`,
      [tenantId],
    );
    return rows as Array<{
      id: string;
      locationId: string | null;
      date: string;
      name: string;
    }>;
  }

  async addHoliday(
    tenantId: string,
    input: { locationId: string | null; date: string; name: string },
  ): Promise<void> {
    await this.db.query(
      `insert into clinic_holidays (tenant_id, location_id, holiday_date, name)
       values ($1, $2, $3::date, $4)`,
      [tenantId, input.locationId, input.date, input.name],
    );
  }

  async deleteHoliday(tenantId: string, id: string): Promise<void> {
    await this.db.query(
      `delete from clinic_holidays where tenant_id = $1 and id = $2`,
      [tenantId, id],
    );
  }

  async listWorkingHours(
    tenantId: string,
    professionalIds: string[],
    locationId: string,
    from: Date,
    to: Date,
  ): Promise<ProfessionalWorkingHour[]> {
    if (professionalIds.length === 0) return [];
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", professional_id as "professionalId",
              location_id as "locationId", weekday, start_time as "startTime",
              end_time as "endTime", valid_from::text as "validFrom", valid_to::text as "validTo"
       from professional_working_hours
       where tenant_id = $1 and professional_id = any($2::uuid[])
         and location_id = $5
         and valid_from <= $4::date and (valid_to is null or valid_to >= $3::date)`,
      [
        tenantId,
        professionalIds,
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
        locationId,
      ],
    );
    return rows as ProfessionalWorkingHour[];
  }

  async listTimeOff(
    tenantId: string,
    professionalIds: string[],
    from: Date,
    to: Date,
  ): Promise<ProfessionalTimeOff[]> {
    if (professionalIds.length === 0) return [];
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", professional_id as "professionalId",
              start_at as "startAt", end_at as "endAt", reason
       from professional_time_off
       where tenant_id = $1 and professional_id = any($2::uuid[])
         and start_at < $4 and end_at > $3`,
      [tenantId, professionalIds, from, to],
    );
    return rows as ProfessionalTimeOff[];
  }

  async listHolidays(
    tenantId: string,
    locationId: string,
    from: Date,
    to: Date,
  ): Promise<ClinicHoliday[]> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", location_id as "locationId",
              holiday_date::text as "date", name
       from clinic_holidays
       where tenant_id = $1 and (location_id = $2 or location_id is null)
         and holiday_date >= $3::date and holiday_date <= $4::date`,
      [tenantId, locationId, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)],
    );
    return rows as ClinicHoliday[];
  }

  async listReservations(
    tenantId: string,
    professionalIds: string[],
    from: Date,
    to: Date,
  ): Promise<ProfessionalReservation[]> {
    if (professionalIds.length === 0) return [];
    const { rows } = await this.db.query(
      `select ${RESERVATION_COLUMNS}
       from professional_reservations
       where tenant_id = $1 and professional_id = any($2::uuid[])
         and status in ('BOOKED', 'RESCHEDULE_PENDING')
         and start_at < $4 and end_at > $3`,
      [tenantId, professionalIds, from, to],
    );
    return rows as ProfessionalReservation[];
  }

  async listResourceReservations(
    tenantId: string,
    resourceId: string,
    from: Date,
    to: Date,
  ): Promise<ResourceReservation[]> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", appointment_id as "appointmentId",
              resource_id as "resourceId", start_at as "startAt", end_at as "endAt", status
       from resource_reservations
       where tenant_id = $1 and resource_id = $2
         and status in ('BOOKED', 'RESCHEDULE_PENDING')
         and start_at < $4 and end_at > $3`,
      [tenantId, resourceId, from, to],
    );
    return rows as ResourceReservation[];
  }

  async listActiveLocks(
    tenantId: string,
    professionalIds: string[],
    from: Date,
    to: Date,
    now: Date,
  ): Promise<AvailabilityLock[]> {
    if (professionalIds.length === 0) return [];
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", professional_id as "professionalId",
              start_at as "startAt", end_at as "endAt", expires_at as "expiresAt",
              operation_id as "operationId", status
       from availability_locks
       where tenant_id = $1 and professional_id = any($2::uuid[])
         and status = 'ACTIVE' and expires_at > $5
         and start_at < $4 and end_at > $3`,
      [tenantId, professionalIds, from, to, now],
    );
    return rows as AvailabilityLock[];
  }

  async findLocation(
    tenantId: string,
    locationId: string,
  ): Promise<{ id: string; timezone: string } | null> {
    const { rows } = await this.db.query(
      `select id, timezone from locations where tenant_id = $1 and id = $2`,
      [tenantId, locationId],
    );
    return (rows[0] as { id: string; timezone: string } | undefined) ?? null;
  }

  async listActiveResources(tenantId: string, locationId: string): Promise<Resource[]> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", location_id as "locationId", name, kind, status
       from resources
       where tenant_id = $1 and location_id = $2 and status = 'active'
       order by name`,
      [tenantId, locationId],
    );
    return rows as Resource[];
  }

  async listActiveLocations(
    tenantId: string,
  ): Promise<Array<{ id: string; name: string; timezone: string }>> {
    const { rows } = await this.db.query(
      `select id, name, timezone from locations
       where tenant_id = $1 and status = 'active'
       order by name`,
      [tenantId],
    );
    return rows as Array<{ id: string; name: string; timezone: string }>;
  }
}
