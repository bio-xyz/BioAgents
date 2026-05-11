-- Remove x402 payment tables and related objects
DROP VIEW IF EXISTS user_payment_stats;
DROP TABLE IF EXISTS x402_external CASCADE;
DROP TABLE IF EXISTS x402_payments CASCADE;
DROP INDEX IF EXISTS idx_users_wallet_address;
ALTER TABLE users DROP COLUMN IF EXISTS wallet_address;
