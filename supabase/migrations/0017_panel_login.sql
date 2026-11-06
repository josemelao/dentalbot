-- Panel login. A null hash means the user cannot sign in yet.
alter table clinic_users add column password_hash text;
