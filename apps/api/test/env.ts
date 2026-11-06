process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/dental_assistant_test';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
process.env.AI_PROVIDER = 'fake';
process.env.LOG_LEVEL = 'error';
process.env.PANEL_TOKEN = 'test-panel';
process.env.SESSION_SECRET = 'test-session-secret-0123456789';
