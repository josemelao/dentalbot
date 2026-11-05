import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { DEFAULT_AI_RULES } from '../../src/ai/default-rules';
import { FakeAiGateway } from '../../src/ai/fake-ai.gateway';
import { createApp } from '../../src/app';
import { FakeChannelAdapter } from '../../src/channels/fake/fake-channel.adapter';
import { RecordingOwnerNotifier } from '../../src/channels/owner-notifier';
import { EscalationService } from '../../src/pipeline/escalation.service';
import { getTestPool } from './db';

export interface TestApp {
  app: INestApplication;
  pool: Pool;
  fakeChannel: FakeChannelAdapter;
  fakeAi: FakeAiGateway;
  notifier: RecordingOwnerNotifier;
  escalation: EscalationService;
}

export async function buildTestApp(options: { pool?: Pool } = {}): Promise<TestApp> {
  const pool = options.pool ?? getTestPool();
  const fakeChannel = new FakeChannelAdapter();
  const fakeAi = new FakeAiGateway(DEFAULT_AI_RULES);
  const notifier = new RecordingOwnerNotifier();

  const app = await createApp({
    pool,
    channelAdapter: fakeChannel,
    aiGateway: fakeAi,
    notifier,
  });
  await app.init();

  return {
    app,
    pool,
    fakeChannel,
    fakeAi,
    notifier,
    escalation: app.get(EscalationService),
  };
}
