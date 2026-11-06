import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import { FakeCalendarAdapter } from '../calendar/fake-calendar.adapter';
import { ChannelAdapter } from '../channels/channel-adapter';
import { FakeChannelAdapter } from '../channels/fake/fake-channel.adapter';
import { TelegramAdapter } from '../channels/telegram/telegram.adapter';
import { loadEnv } from '../config/env';
import { createPool } from '../db/pool';
import { withAdvisoryLock } from './advisory-lock';
import { buildJobs, WorkerJob } from './jobs';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function runJobs(pool: Pool, jobs: WorkerJob[]): Promise<void> {
  for (const job of jobs) {
    try {
      const result = await withAdvisoryLock(pool, `worker:${job.name}`, () => job.run());
      console.log(
        JSON.stringify({ level: 'info', message: 'worker.job', job: job.name, ...result }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'worker.job_failed',
          job: job.name,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();

  const calendar = env.nodeEnv === 'production' ? null : new FakeCalendarAdapter();
  if (!calendar) {
    throw new Error(
      'Worker requires a configured calendar adapter in production; refusing the fake adapter',
    );
  }

  const channel: ChannelAdapter =
    env.channelTransport === 'fake' ? new FakeChannelAdapter() : new TelegramAdapter(env);
  const pool = createPool(env.databaseUrl);
  const jobs = buildJobs({ pool, env, channel, calendar });

  let running = true;
  const stop = (): void => {
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'worker.started',
      jobs: jobs.map((job) => job.name),
      intervalMs: env.workerIntervalMs,
    }),
  );

  await runJobs(pool, jobs);
  while (running) {
    await sleep(env.workerIntervalMs);
    if (!running) break;
    await runJobs(pool, jobs);
  }

  await pool.end();
  console.log(JSON.stringify({ level: 'info', message: 'worker.stopped' }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
