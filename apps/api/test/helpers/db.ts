import { Pool } from 'pg';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/dental_assistant_test';

let pool: Pool | null = null;

export function getTestPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  }
  return pool;
}

export function resetTestPool(): void {
  pool = null;
}

export interface SeedClinicOptions {
  suffix?: string;
  withConversation?: boolean;
}

export interface SeedClinicResult {
  tenantId: string;
  channelId: string;
  channelExternalId: string;
  suffix: string;
  ownerId: string;
  dentistId: string;
  conversationId?: string;
  contactId?: string;
}

export async function seedClinic(
  db: Pool,
  options: SeedClinicOptions = {},
): Promise<SeedClinicResult> {
  const suffix = options.suffix ?? 'pilot';

  const {
    rows: [clinic],
  } = await db.query<{ id: string }>(`insert into clinics (name) values ($1) returning id`, [
    `Clinic ${suffix}`,
  ]);

  const {
    rows: [channel],
  } = await db.query<{ id: string }>(
    `insert into clinic_channels (tenant_id, channel, provider, external_channel_id, display_name)
     values ($1, 'telegram', 'telegram', $2, $3) returning id`,
    [clinic.id, `bot-${suffix}`, `Bot ${suffix}`],
  );

  const {
    rows: [owner],
  } = await db.query<{ id: string }>(
    `insert into clinic_users (tenant_id, name, email, role)
     values ($1, 'Chow', $2, 'owner') returning id`,
    [clinic.id, `chow-${suffix}@example.com`],
  );

  const {
    rows: [dentist],
  } = await db.query<{ id: string }>(
    `insert into clinic_users (tenant_id, name, email, role)
     values ($1, 'Caio', $2, 'dentist') returning id`,
    [clinic.id, `caio-${suffix}@example.com`],
  );

  const result: SeedClinicResult = {
    tenantId: clinic.id,
    channelId: channel.id,
    channelExternalId: `bot-${suffix}`,
    suffix,
    ownerId: owner.id,
    dentistId: dentist.id,
  };

  if (options.withConversation) {
    const {
      rows: [contact],
    } = await db.query<{ id: string }>(
      `insert into patient_contacts (tenant_id, channel, external_user_id, display_name)
       values ($1, 'telegram', $2, 'Maria') returning id`,
      [clinic.id, `user-${suffix}`],
    );

    const {
      rows: [conversation],
    } = await db.query<{ id: string }>(
      `insert into conversations (tenant_id, patient_contact_id, channel)
       values ($1, $2, 'telegram') returning id`,
      [clinic.id, contact.id],
    );

    result.contactId = contact.id;
    result.conversationId = conversation.id;
  }

  return result;
}

export interface SeedKnowledgeEntry {
  category: string;
  question: string;
  answer: string;
  keywords: string[];
  status?: 'draft' | 'approved' | 'retired';
  validFrom?: Date;
  validTo?: Date | null;
}

export async function seedKnowledge(
  db: Pool,
  tenantId: string,
  entries: SeedKnowledgeEntry[],
): Promise<void> {
  for (const entry of entries) {
    await db.query(
      `insert into knowledge_entries
         (tenant_id, category, question, answer, keywords, status, valid_from, valid_to)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tenantId,
        entry.category,
        entry.question,
        entry.answer,
        entry.keywords,
        entry.status ?? 'approved',
        entry.validFrom ?? new Date(),
        entry.validTo ?? null,
      ],
    );
  }
}

export interface SeedSchedulingResult {
  locationId: string;
  resourceId: string;
  chowId: string;
  caioId: string;
  evaluationServiceId: string;
  cleaningServiceId: string;
  extractionServiceId: string;
  implantServiceId: string;
  jointServiceId: string;
}

interface UpsertServiceInput {
  name: string;
  keywords: string[];
  isEvaluation?: boolean;
  durationMinutes: number;
  price: number;
  priceDisclosureAllowed?: boolean;
  directBookingAllowed?: boolean;
  requiresEvaluation?: boolean;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  requiredDocuments?: string[];
}

async function upsertService(
  db: Pool,
  tenantId: string,
  input: UpsertServiceInput,
): Promise<string> {
  const {
    rows: [row],
  } = await db.query<{ id: string }>(
    `insert into services
       (tenant_id, name, keywords, is_evaluation, duration_minutes, price,
        price_disclosure_allowed, direct_booking_allowed, requires_evaluation,
        buffer_before_minutes, buffer_after_minutes, required_documents)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (tenant_id, name) do update set
       keywords = excluded.keywords,
       is_evaluation = excluded.is_evaluation,
       duration_minutes = excluded.duration_minutes,
       price = excluded.price,
       price_disclosure_allowed = excluded.price_disclosure_allowed,
       direct_booking_allowed = excluded.direct_booking_allowed,
       requires_evaluation = excluded.requires_evaluation,
       buffer_before_minutes = excluded.buffer_before_minutes,
       buffer_after_minutes = excluded.buffer_after_minutes,
       required_documents = excluded.required_documents
     returning id`,
    [
      tenantId,
      input.name,
      input.keywords,
      input.isEvaluation ?? false,
      input.durationMinutes,
      input.price,
      input.priceDisclosureAllowed ?? false,
      input.directBookingAllowed ?? false,
      input.requiresEvaluation ?? true,
      input.bufferBeforeMinutes ?? 10,
      input.bufferAfterMinutes ?? 10,
      input.requiredDocuments ?? [],
    ],
  );
  return row.id;
}

export async function seedScheduling(
  db: Pool,
  tenantId: string,
): Promise<SeedSchedulingResult> {
  const { rows: users } = await db.query<{ id: string; name: string }>(
    `select id, name from clinic_users where tenant_id = $1 and name in ('Chow', 'Caio')`,
    [tenantId],
  );
  const chowUser = users.find((user) => user.name === 'Chow');
  const caioUser = users.find((user) => user.name === 'Caio');
  if (!chowUser || !caioUser) {
    throw new Error('seedScheduling requires the Chow and Caio users');
  }

  const {
    rows: [location],
  } = await db.query<{ id: string }>(
    `insert into locations (tenant_id, name, address)
     values ($1, 'Vila Mariana', 'Rua Exemplo, 100')
     on conflict (tenant_id, name) do update set address = excluded.address
     returning id`,
    [tenantId],
  );

  const {
    rows: [resource],
  } = await db.query<{ id: string }>(
    `insert into resources (tenant_id, location_id, name, kind)
     values ($1, $2, 'Cadeira 1', 'chair')
     on conflict (tenant_id, location_id, name) do update set kind = excluded.kind
     returning id`,
    [tenantId, location.id],
  );

  const {
    rows: [chow],
  } = await db.query<{ id: string }>(
    `insert into professionals (tenant_id, clinic_user_id, location_id, name, specialty)
     values ($1, $2, $3, 'Chow', 'Implantodontia e cirurgia')
     on conflict (tenant_id, name) do update set
       clinic_user_id = excluded.clinic_user_id,
       location_id = excluded.location_id
     returning id`,
    [tenantId, chowUser.id, location.id],
  );

  const {
    rows: [caio],
  } = await db.query<{ id: string }>(
    `insert into professionals (tenant_id, clinic_user_id, location_id, name, specialty)
     values ($1, $2, $3, 'Caio', 'Ortodontia e clínica geral')
     on conflict (tenant_id, name) do update set
       clinic_user_id = excluded.clinic_user_id,
       location_id = excluded.location_id
     returning id`,
    [tenantId, caioUser.id, location.id],
  );

  const hours: Array<{ professionalId: string; weekday: number; start: string; end: string }> = [
    ...[1, 3, 5].flatMap((weekday) => [
      { professionalId: chow.id, weekday, start: '09:00', end: '12:00' },
      { professionalId: chow.id, weekday, start: '13:00', end: '18:00' },
    ]),
    ...[1, 2, 4].flatMap((weekday) => [
      { professionalId: caio.id, weekday, start: '09:00', end: '12:00' },
      { professionalId: caio.id, weekday, start: '13:00', end: '18:00' },
    ]),
  ];

  for (const hour of hours) {
    await db.query(
      `insert into professional_working_hours
         (tenant_id, professional_id, location_id, weekday, start_time, end_time)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (tenant_id, professional_id, location_id, weekday, start_time) do nothing`,
      [tenantId, hour.professionalId, location.id, hour.weekday, hour.start, hour.end],
    );
  }

  const evaluationServiceId = await upsertService(db, tenantId, {
    name: 'Avaliação inicial',
    keywords: ['avaliacao', 'avaliação', 'consulta', 'consultar'],
    isEvaluation: true,
    durationMinutes: 30,
    price: 250,
    priceDisclosureAllowed: true,
    directBookingAllowed: true,
    requiresEvaluation: false,
    requiredDocuments: ['RG/CPF'],
  });

  const cleaningServiceId = await upsertService(db, tenantId, {
    name: 'Limpeza',
    keywords: ['limpeza', 'profilaxia'],
    durationMinutes: 40,
    price: 240,
    priceDisclosureAllowed: true,
    directBookingAllowed: true,
    requiresEvaluation: false,
  });

  const extractionServiceId = await upsertService(db, tenantId, {
    name: 'Extração de siso',
    keywords: ['extracao', 'extração', 'siso', 'arrancar'],
    durationMinutes: 90,
    price: 1200,
    requiresEvaluation: true,
    requiredDocuments: ['Panorâmica'],
  });

  const implantServiceId = await upsertService(db, tenantId, {
    name: 'Implante unitário',
    keywords: ['implante'],
    durationMinutes: 120,
    price: 6000,
    requiresEvaluation: true,
    requiredDocuments: ['Tomografia'],
  });

  const jointServiceId = await upsertService(db, tenantId, {
    name: 'Extração + planejamento ortodôntico',
    keywords: ['extracao com ortodontia', 'conjunto', 'planejamento'],
    durationMinutes: 90,
    price: 1500,
    requiresEvaluation: true,
  });

  const habilitations: Array<{ professionalId: string; serviceId: string }> = [
    { professionalId: chow.id, serviceId: evaluationServiceId },
    { professionalId: chow.id, serviceId: extractionServiceId },
    { professionalId: chow.id, serviceId: implantServiceId },
    { professionalId: chow.id, serviceId: jointServiceId },
    { professionalId: caio.id, serviceId: evaluationServiceId },
    { professionalId: caio.id, serviceId: cleaningServiceId },
    { professionalId: caio.id, serviceId: jointServiceId },
  ];

  for (const habilitation of habilitations) {
    await db.query(
      `insert into professional_services (tenant_id, professional_id, service_id)
       values ($1, $2, $3)
       on conflict do nothing`,
      [tenantId, habilitation.professionalId, habilitation.serviceId],
    );
  }

  for (const professionalId of [chow.id, caio.id]) {
    await db.query(
      `insert into service_professional_requirements
         (tenant_id, service_id, professional_id, role, required)
       values ($1, $2, $3, 'required', true)
       on conflict do nothing`,
      [tenantId, jointServiceId, professionalId],
    );
  }

  return {
    locationId: location.id,
    resourceId: resource.id,
    chowId: chow.id,
    caioId: caio.id,
    evaluationServiceId,
    cleaningServiceId,
    extractionServiceId,
    implantServiceId,
    jointServiceId,
  };
}
