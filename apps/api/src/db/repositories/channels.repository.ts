import { Channel } from '../../contracts/channel';
import { Queryable } from '../pool';
import { ClinicChannel, ClinicUser } from './rows';

export class ChannelsRepository {
  constructor(private readonly db: Queryable) {}

  async findByExternalId(
    channel: Channel,
    externalChannelId: string,
  ): Promise<ClinicChannel | null> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", channel,
              external_channel_id as "externalChannelId", display_name as "displayName", status
       from clinic_channels
       where channel = $1 and external_channel_id = $2`,
      [channel, externalChannelId],
    );
    return (rows[0] as ClinicChannel | undefined) ?? null;
  }

  async listOwners(tenantId: string): Promise<ClinicUser[]> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", name, email, phone_e164 as "phoneE164", role, status
       from clinic_users
       where tenant_id = $1 and role in ('owner', 'dentist') and status = 'active'
       order by name`,
      [tenantId],
    );
    return rows as ClinicUser[];
  }
}
