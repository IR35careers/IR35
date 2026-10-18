-- Disposable test database ONLY. These published local-CI passwords must never
-- be used on Supabase or Railway. No real records or application credentials.
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE ir35_queue LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD 'ci-only-queue-owner';
CREATE ROLE ir35_queue_producer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD 'ci-only-queue-producer';
CREATE SCHEMA pgboss AUTHORIZATION ir35_queue;
REVOKE ALL ON SCHEMA pgboss FROM PUBLIC;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE TABLE public.ir35_ci_private(id integer);
CREATE TABLE auth.ir35_ci_private(id integer);
CREATE TABLE storage.ir35_ci_private(id integer);
COMMIT;
