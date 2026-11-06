import { Channel } from '../../contracts/channel';
import { Queryable } from '../pool';
import { ClinicChannel, ClinicUser, OwnerRecipient } from './rows';

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

  /** Active owners/dentists that can actually be reached on this channel. */
  async listOwnerRecipients(tenantId: string, channel: Channel): Promise<OwnerRecipient[]> {
    const { rows } = await this.db.query(
      `select u.id as "userId", u.name, c.external_user_id as "externalUserId"
       from clinic_users u
       join clinic_user_channels c
         on c.tenant_id = u.tenant_id and c.user_id = u.id
       where u.tenant_id = $1 and u.role in ('owner', 'dentist')
         and u.status = 'active' and c.channel = $2
       order by u.name`,
      [tenantId, channel],
    );
    return rows as OwnerRecipient[];
  }

  /** Staff lookup for inbound routing: a linked id is never treated as a patient. */
  async findOwnerByExternalId(
    channel: Channel,
    externalUserId: string,
  ): Promise<{ tenantId: string; userId: string; name: string } | null> {
    const { rows } = await this.db.query(
      `select u.tenant_id as "tenantId", u.id as "userId", u.name
       from clinic_user_channels c
       join clinic_users u on u.tenant_id = c.tenant_id and u.id = c.user_id
       where c.channel = $1 and c.external_user_id = $2 and u.status = 'active'`,
      [channel, externalUserId],
    );
    return (rows[0] as { tenantId: string; userId: string; name: string } | undefined) ?? null;
  }

  async linkOwner(
    tenantId: string,
    userId: string,
    channel: Channel,
    externalUserId: string,
  ): Promise<void> {
    await this.db.query(
      `insert into clinic_user_channels (tenant_id, user_id, channel, external_user_id)
       values ($1, $2, $3, $4)
       on conflict (tenant_id, channel, external_user_id)
       do update set user_id = excluded.user_id`,
      [tenantId, userId, channel, externalUserId],
    );
  }
}
