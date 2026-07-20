-- Maintenance 006 — expire non-professional / permanent roles that slipped in
-- before the strengthened gate (admin-support, teaching/receptionist, low
-- salaries). Expired = hidden from the board, not deleted. Run once.

UPDATE jobs
SET expired_at = NOW()
WHERE expired_at IS NULL
  AND (
    title ~* '\m(colleague|shop assistant|store assistant|retail assistant|sales assistant|checkout|shelf stacker|warehouse (operative|assistant|worker)|delivery driver|courier|van driver|hgv|forklift|cleaner|cleaning operative|housekeep(er|ing)|janitor|barista|waiter|waitress|bartender|kitchen (porter|assistant|staff)|chef|catering assistant|care (assistant|worker)|support worker|healthcare assistant|nursery (nurse|assistant)|teaching assistant|classroom assistant|labourer|picker|packer|production operative|assembly operative|security (officer|guard)|door supervisor|steward|crew member|receptionist|data entry|office junior|apprentice)\M'
    OR title ~* 'admin(istration|istrative)? (support )?(assistant|officer|clerk|apprentice)'
    OR title ~* 'recruitment (administration|admin|resourcing|support)'
    OR (rate_type = 'hourly' AND rate_max IS NOT NULL AND rate_max < 18)
    OR (rate_type = 'daily' AND rate_max IS NOT NULL AND rate_max < 120)
    OR (rate_type = 'annual' AND rate_max IS NOT NULL AND rate_max < 45000)
  );

SELECT COUNT(*) AS live_jobs FROM jobs WHERE expired_at IS NULL;
