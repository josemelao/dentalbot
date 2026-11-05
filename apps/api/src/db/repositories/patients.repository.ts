import { Channel } from '../../contracts/channel';
import { Queryable } from '../pool';
import { PatientContact } from './rows';

export interface CreateProvisionalContactInput {
  tenantId: string;
  channel: Channel;
  externalUserId: string;
  displayName?: string | null;
}

export interface PatientIdentity {
  id: string;
  fullName: string;
  birthDate: string | null;
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

  async findPatientByContact(
    tenantId: string,
    contactId: string,
  ): Promise<PatientIdentity | null> {
    const { rows } = await this.db.query(
      `select p.id, p.full_name as "fullName", p.birth_date as "birthDate"
       from patient_contacts c
       join patients p on p.tenant_id = c.tenant_id and p.id = c.patient_id
       where c.tenant_id = $1 and c.id = $2`,
      [tenantId, contactId],
    );
    return (rows[0] as PatientIdentity | undefined) ?? null;
  }
}
