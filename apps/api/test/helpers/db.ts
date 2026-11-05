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
