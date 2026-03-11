-- Phase 4B-4D: Add training_domain tracking columns
-- Allows adaptive weighting to track which domain each training session targets
-- Enables schedule awareness integration and vehicle data pipeline

ALTER TABLE conversation_sessions
ADD COLUMN IF NOT EXISTS training_domain TEXT;

ALTER TABLE training_results
ADD COLUMN IF NOT EXISTS training_domain TEXT;
