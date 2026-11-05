import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '../config/env';
import { createPool } from '../db/pool';

const SEED_ENTRIES = [
  {
    category: 'logistica',
    question: 'Qual o horário de funcionamento?',
    answer: 'Atendemos de segunda a sexta, das 9h às 18h.',
    keywords: ['horario de funcionamento', 'que horas abre', 'horario'],
    status: 'approved',
  },
  {
    category: 'pagamento',
    question: 'Quais as formas de pagamento?',
    answer: 'Aceitamos Pix, cartão de crédito e débito.',
    keywords: ['formas de pagamento', 'pagamento', 'pix', 'cartao'],
    status: 'approved',
  },
  {
    category: 'preco',
    question: 'Quanto custa a limpeza?',
    answer: 'A limpeza custa R$ 250.',
    keywords: ['quanto custa a limpeza', 'preco da limpeza'],
    status: 'draft',
  },
] as const;

async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const pool = createPool(env.databaseUrl);
  const channelExternalId = process.env.SEED_TELEGRAM_CHANNEL_ID ?? 'bot-pilot';

  try {
    const existing = await pool.query(`select id from clinics where name = 'Clínica Piloto' limit 1`);
    let tenantId: string;

    if (existing.rows[0]) {
      tenantId = (existing.rows[0] as { id: string }).id;
    } else {
      const { rows } = await pool.query(
        `insert into clinics (name, timezone, locale)
         values ('Clínica Piloto', 'America/Sao_Paulo', 'pt-BR') returning id`,
      );
      tenantId = (rows[0] as { id: string }).id;
    }

    await pool.query(
      `insert into clinic_channels (tenant_id, channel, provider, external_channel_id, display_name)
       values ($1, 'telegram', 'telegram', $2, 'Bot da clínica')
       on conflict (channel, external_channel_id) do nothing`,
      [tenantId, channelExternalId],
    );

    await pool.query(
      `insert into clinic_users (tenant_id, name, email, role)
       values ($1, 'Chow', 'chow@example.com', 'owner')
       on conflict (tenant_id, email) do nothing`,
      [tenantId],
    );

    await pool.query(
      `insert into clinic_users (tenant_id, name, email, role)
       values ($1, 'Caio', 'caio@example.com', 'dentist')
       on conflict (tenant_id, email) do nothing`,
      [tenantId],
    );

    for (const entry of SEED_ENTRIES) {
      await pool.query(
        `insert into knowledge_entries
           (tenant_id, category, question, answer, keywords, status)
         select $1, $2, $3, $4, $5, $6
         where not exists (
           select 1 from knowledge_entries where tenant_id = $1 and question = $3
         )`,
        [tenantId, entry.category, entry.question, entry.answer, entry.keywords, entry.status],
      );
    }

    console.log(`Seed complete for tenant ${tenantId} (channel ${channelExternalId})`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
