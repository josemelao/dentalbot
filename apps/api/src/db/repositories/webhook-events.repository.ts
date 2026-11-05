import { Channel } from '../../contracts/channel';
import { Queryable } from '../pool';

export interface InsertWebhookEventInput {
  tenantId: string;
  channel: Channel;
  externalEventId: string;
  externalMessageId?: string | null;
  eventType: string;
  payload: unknown;
}

export class WebhookEventsRepository {
  constructor(private readonly db: Queryable) {}

  async insertOnce(input: InsertWebhookEventInput): Promise<{ inserted: boolean; id: string }> {
    const { rows } = await this.db.query(
      `insert into webhook_events
         (tenant_id, channel, external_event_id, external_message_id, event_type, payload)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (tenant_id, channel, external_event_id) do nothing
       returning id`,
      [
        input.tenantId,
        input.channel,
        input.externalEventId,
        input.externalMessageId ?? null,
        input.eventType,
        input.payload,
      ],
    );

    if (rows[0]) {
      return { inserted: true, id: (rows[0] as { id: string }).id };
    }

    const { rows: existing } = await this.db.query(
      `select id from webhook_events
       where tenant_id = $1 and channel = $2 and external_event_id = $3`,
      [input.tenantId, input.channel, input.externalEventId],
    );
    return { inserted: false, id: (existing[0] as { id: string }).id };
  }

  async markProcessed(
    tenantId: string,
    id: string,
    status: 'processed' | 'failed' | 'skipped',
    errorCode?: string,
  ): Promise<void> {
    await this.db.query(
      `update webhook_events
       set status = $3, error_code = $4, processed_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, id, status, errorCode ?? null],
    );
  }
}
