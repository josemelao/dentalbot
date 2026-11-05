-- Correlation ids come from the x-correlation-id header and are not
-- guaranteed to be UUIDs (clients/proxies may send arbitrary trace ids).
alter table audit_logs
  alter column correlation_id type text;
