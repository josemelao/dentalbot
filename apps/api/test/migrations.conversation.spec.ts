import { getTestPool, seedClinic } from './helpers/db';

describe('conversation schema', () => {
  it('enforces one contact per tenant/channel/external user', async () => {
    const pool = getTestPool();
    const { tenantId } = await seedClinic(pool);
    const insert = () =>
      pool.query(
        `insert into patient_contacts (tenant_id, channel, external_user_id)
         values ($1, 'telegram', '42')`,
        [tenantId],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });

  it('enforces one message per tenant/channel/external message id', async () => {
    const pool = getTestPool();
    const { tenantId, conversationId } = await seedClinic(pool, { withConversation: true });
    const insert = () =>
      pool.query(
        `insert into messages
           (tenant_id, conversation_id, channel, direction, external_message_id, message_type, content)
         values ($1, $2, 'telegram', 'in', 'm-1', 'text', 'oi')`,
        [tenantId, conversationId],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });

  it('rejects unknown conversation state', async () => {
    const pool = getTestPool();
    const { tenantId, conversationId } = await seedClinic(pool, { withConversation: true });
    await expect(
      pool.query(`update conversations set state = 'WHATEVER' where id = $1 and tenant_id = $2`, [
        conversationId,
        tenantId,
      ]),
    ).rejects.toThrow(/check constraint/);
  });
});
