import { Channel } from '../../contracts/channel';
import { Queryable } from '../pool';
import { PatientContact } from './rows';

export interface CreateProvisionalContactInput {
  tenantId: string;
  channel: Channel;
  externalUserId: string;
  displayName?: string | null;
}

export class PatientsRepository {
  constructor(private readonly db: Queryable) {}

  async findContact(
    tenantId: string,
    channel: Channel,
    externalUserId: string,
  ): Promise<PatientContact | null> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", patient_id as "patientId", channel,
              external_user_id as "externalUserId", display_name as "displayName",
              opt_in_status as "optInStatus"
       from patient_contacts
       where tenant_id = $1 and channel = $2 and external_user_id = $3`,
      [tenantId, channel, externalUserId],
    );
    return (rows[0] as PatientContact | undefined) ?? null;
  }

  async createProvisionalContact(input: CreateProvisionalContactInput): Promise<PatientContact> {
    const { rows } = await this.db.query(
      `insert into patient_contacts (tenant_id, channel, external_user_id, display_name)
       values ($1, $2, $3, $4)
       returning id, tenant_id as "tenantId", patient_id as "patientId", channel,
                 external_user_id as "externalUserId", display_name as "displayName",
                 opt_in_status as "optInStatus"`,
      [input.tenantId, input.channel, input.externalUserId, input.displayName ?? null],
    );
    return rows[0] as PatientContact;
  }
}
