-- Aggregate provenance only: no identities, CVs, destinations or receipt tokens.
BEGIN READ ONLY;
SELECT count(*) FILTER (WHERE COALESCE(receipt->>'receiptId','')<>'') AS with_receipt,
  count(*) FILTER (WHERE receipt->>'receiptId' LIKE 'contractor-confirmed-%') AS contractor_reports,
  count(*) FILTER (WHERE receipt->>'receiptId' LIKE 'DRY-%' OR mode='dry_run') AS preview_only,
  count(*) FILTER (WHERE COALESCE(receipt->>'receiptId','')<>'' AND
    COALESCE(receipt->>'destination','')='') AS missing_destination
FROM public.application_packets;
ROLLBACK;
