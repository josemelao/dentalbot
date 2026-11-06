import { Pool } from 'pg';

/**
 * Demo helpers.
 *
 * These exist only to make a local/pilot demo repeatable. They are destructive
 * by design and every CLI that calls them refuses to run with NODE_ENV=production.
 */

export interface DemoResetResult {
  contactId: string;
  conversationIds: string[];
  cancelledTickets: number;
  openAppointments: number;
}

export interface DemoLinkResult {
  contactId: string;
  patientId: string;
  fullName: string;
  birthDate: string;
}

async function findContactId(pool: Pool, externalUserId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from patient_contacts where external_user_id = $1 order by created_at desc limit 1`,
    [externalUserId],
  );
  const contact = rows[0];
  if (!contact) {
    throw new Error(
      `No contact with external_user_id=${externalUserId}. Send a message to the bot first.`,
    );
  }
  return contact.id;
}

/**
 * Puts a contact back to a fresh conversation: open tickets are cancelled and
 * the conversation returns to ACTIVE with an empty scheduling context.
 */
export async function resetDemoConversation(
  pool: Pool,
  externalUserId: string,
): Promise<DemoResetResult> {
  const contactId = await findContactId(pool, externalUserId);

  const conversations = await pool.query<{ id: string; tenantId: string }>(
    `select id, tenant_id as "tenantId" from conversations
     where patient_contact_id = $1 and state <> 'CLOSED'`,
    [contactId],
  );

  let cancelledTickets = 0;
  for (const conversation of conversations.rows) {
    const tickets = await pool.query(
      `update human_tickets set status = 'cancelled', updated_at = now()
       where tenant_id = $1 and conversation_id = $2
         and status in ('open', 'notified', 'answered')`,
      [conversation.tenantId, conversation.id],
    );
    cancelledTickets += tickets.rowCount ?? 0;

    await pool.query(
      `update conversations
       set state = 'ACTIVE', context = '{}', human_ticket_id = null, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [conversation.tenantId, conversation.id],
    );
  }

  const appointments = await pool.query<{ n: number }>(
    `select count(*)::int as n from appointments
     where patient_contact_id = $1 and status in ('BOOKED', 'RESCHEDULE_PENDING')`,
    [contactId],
  );

  return {
    contactId,
    conversationIds: conversations.rows.map((conversation) => conversation.id),
    cancelledTickets,
    openAppointments: appointments.rows[0]?.n ?? 0,
  };
}

/**
 * Links the demo contact to a patient so reschedule/cancel can pass the identity
 * check. Without this the bot correctly escalates every reschedule request.
 */
export async function linkDemoPatient(
  pool: Pool,
  externalUserId: string,
  fullName: string,
  birthDate: string,
): Promise<DemoLinkResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    throw new Error('birthDate must be YYYY-MM-DD');
  }

  const contactId = await findContactId(pool, externalUserId);
  const contact = await pool.query<{ tenantId: string }>(
    `select tenant_id as "tenantId" from patient_contacts where id = $1`,
    [contactId],
  );
  const tenantId = contact.rows[0]?.tenantId;
  if (!tenantId) throw new Error('Contact has no tenant');

  const { rows } = await pool.query<{ id: string }>(
    `insert into patients (tenant_id, full_name, birth_date)
     values ($1, $2, $3) returning id`,
    [tenantId, fullName, birthDate],
  );
  const patientId = rows[0].id;

  await pool.query(
    `update patient_contacts set patient_id = $1, updated_at = now() where id = $2`,
    [patientId, contactId],
  );

  return { contactId, patientId, fullName, birthDate };
}
