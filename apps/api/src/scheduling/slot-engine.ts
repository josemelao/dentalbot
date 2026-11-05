import { DateTime, Interval } from 'luxon';
import { Slot, SlotEngineInput } from './types';

interface DayContext {
  zone: string;
  now: DateTime;
  horizonEnd: DateTime;
  duration: number;
  bufferBefore: number;
  bufferAfter: number;
  professionalIds: string[];
  resourceId: string | null;
}

export class SlotEngine {
  findSlots(input: SlotEngineInput): Slot[] {
    const zone = input.timezone;
    const now = DateTime.fromJSDate(input.request.now, { zone });
    const duration = input.variant?.durationMinutes ?? input.service.durationMinutes;
    const professionalGroups = this.resolveProfessionalGroups(input);

    if (professionalGroups.length === 0) return [];

    const resourceId =
      input.resources.find((resource) => resource.status === 'active')?.id ?? null;
    const from = DateTime.fromJSDate(input.request.from, { zone }).startOf('day');
    const to = DateTime.fromJSDate(input.request.to, { zone }).endOf('day');
    const baseContext = {
      zone,
      now,
      horizonEnd: now.plus({ days: input.maxHorizonDays }),
      duration,
      bufferBefore: input.service.bufferBeforeMinutes,
      bufferAfter: input.service.bufferAfterMinutes,
      resourceId,
    };

    const slots: Slot[] = [];
    for (const professionalIds of professionalGroups) {
      const ctx: DayContext = { ...baseContext, professionalIds };
      for (let day = from; day <= to; day = day.plus({ days: 1 })) {
        slots.push(...this.slotsForDay(input, day, ctx));
      }
    }

    return this.dedupe(slots);
  }

  private resolveProfessionalGroups(input: SlotEngineInput): string[][] {
    const qualified = new Set(
      input.qualifiedProfessionals
        .filter((professional) => professional.status === 'active')
        .map((professional) => professional.id),
    );
    const required = input.requirements
      .filter((requirement) => requirement.required)
      .map((requirement) => requirement.professionalId);
    const requested = input.request.professionalId;

    if (required.length > 0) {
      if (!required.every((id) => qualified.has(id))) return [];
      if (requested && !required.includes(requested)) return [];
      return [required];
    }

    if (requested) {
      return qualified.has(requested) ? [[requested]] : [];
    }

    return [...qualified].map((id) => [id]);
  }

  private slotsForDay(input: SlotEngineInput, day: DateTime, ctx: DayContext): Slot[] {
    if (this.isHoliday(input, day)) return [];

    const freeByProfessional = ctx.professionalIds.map((professionalId) =>
      this.freeIntervals(input, day, professionalId, ctx),
    );
    let common = freeByProfessional[0] ?? [];
    for (let index = 1; index < freeByProfessional.length; index += 1) {
      common = this.intersect(common, freeByProfessional[index]);
    }
    if (common.length === 0) return [];

    const blocks: Interval[] = [];
    for (const professionalId of ctx.professionalIds) {
      for (const reservation of input.reservations) {
        if (
          reservation.professionalId === professionalId &&
          (reservation.status === 'BOOKED' || reservation.status === 'RESCHEDULE_PENDING')
        ) {
          blocks.push(this.block(reservation.startAt, reservation.endAt, ctx));
        }
      }
      for (const lock of input.locks) {
        if (
          lock.professionalId === professionalId &&
          lock.status === 'ACTIVE' &&
          lock.expiresAt.getTime() > input.request.now.getTime()
        ) {
          blocks.push(this.block(lock.startAt, lock.endAt, ctx));
        }
      }
    }

    if (ctx.resourceId) {
      for (const reservation of input.resourceReservations) {
        if (
          reservation.resourceId === ctx.resourceId &&
          (reservation.status === 'BOOKED' || reservation.status === 'RESCHEDULE_PENDING')
        ) {
          blocks.push(this.block(reservation.startAt, reservation.endAt, ctx));
        }
      }
    }

    let available = common;
    for (const block of blocks) {
      available = available.flatMap((interval) => interval.difference(block));
    }
    if (available.length === 0) return [];

    const slots: Slot[] = [];
    const earliestStart = ctx.now.plus({ minutes: input.minAdvanceMinutes });

    for (const interval of available) {
      const intervalStart = interval.start;
      const intervalEnd = interval.end;
      if (!intervalStart || !intervalEnd) continue;

      let start = intervalStart
        .plus({ minutes: ctx.bufferBefore })
        .set({ second: 0, millisecond: 0 });
      const minutesFromMidnight = start.hour * 60 + start.minute;
      const remainder = minutesFromMidnight % input.granularityMinutes;
      if (remainder !== 0) {
        start = start.plus({ minutes: input.granularityMinutes - remainder });
      }

      const latest = intervalEnd.minus({ minutes: ctx.duration + ctx.bufferAfter });
      while (start <= latest) {
        if (
          start >= earliestStart &&
          start.plus({ minutes: ctx.duration }) <= ctx.horizonEnd
        ) {
          slots.push({
            startAt: start.toJSDate(),
            endAt: start.plus({ minutes: ctx.duration }).toJSDate(),
            professionalIds: ctx.professionalIds,
            resourceId: ctx.resourceId,
          });
        }
        start = start.plus({ minutes: input.granularityMinutes });
      }
    }

    return slots;
  }

  private freeIntervals(
    input: SlotEngineInput,
    day: DateTime,
    professionalId: string,
    ctx: DayContext,
  ): Interval[] {
    const weekday = day.weekday % 7;
    const isoDate = day.toISODate() ?? '';
    let intervals = input.workingHours
      .filter(
        (hour) =>
          hour.professionalId === professionalId &&
          hour.weekday === weekday &&
          (!hour.validFrom || hour.validFrom <= isoDate) &&
          (!hour.validTo || hour.validTo >= isoDate),
      )
      .map((hour) => {
        const [startHour, startMinute] = hour.startTime.split(':').map(Number);
        const [endHour, endMinute] = hour.endTime.split(':').map(Number);
        return Interval.fromDateTimes(
          day.set({ hour: startHour, minute: startMinute, second: 0, millisecond: 0 }),
          day.set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 }),
        );
      });

    for (const off of input.timeOff) {
      if (off.professionalId !== professionalId) continue;
      const block = Interval.fromDateTimes(
        DateTime.fromJSDate(off.startAt, { zone: ctx.zone }),
        DateTime.fromJSDate(off.endAt, { zone: ctx.zone }),
      );
      intervals = intervals.flatMap((interval) => interval.difference(block));
    }

    return intervals;
  }

  private block(startAt: Date, endAt: Date, ctx: DayContext): Interval {
    return Interval.fromDateTimes(
      DateTime.fromJSDate(startAt, { zone: ctx.zone }),
      DateTime.fromJSDate(endAt, { zone: ctx.zone }),
    );
  }

  private intersect(left: Interval[], right: Interval[]): Interval[] {
    const result: Interval[] = [];
    for (const a of left) {
      for (const b of right) {
        const intersection = a.intersection(b);
        if (intersection && intersection.length('minutes') > 0) {
          result.push(intersection);
        }
      }
    }
    return result;
  }

  private isHoliday(input: SlotEngineInput, day: DateTime): boolean {
    const isoDate = day.toISODate();
    return input.holidays.some(
      (holiday) =>
        holiday.date === isoDate &&
        (holiday.locationId === null || holiday.locationId === input.request.locationId),
    );
  }

  private dedupe(slots: Slot[]): Slot[] {
    const seen = new Set<string>();
    const result: Slot[] = [];
    for (const slot of slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
      const key = `${slot.startAt.toISOString()}|${slot.professionalIds.slice().sort().join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(slot);
    }
    return result;
  }
}
