-- Poll every minute, but let sale-radar's randomized next_due_at enforce the 1-4 minute request cadence.
-- This avoids up to five minutes of scheduler delay without increasing upstream request frequency.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='sale-radar-distributed-tick';
SELECT cron.schedule('sale-radar-distributed-tick','* * * * *',
 $$SELECT net.http_get('https://whkxkdxpndajqkkqmrcu.supabase.co/functions/v1/sale-radar?action=scheduled');$$);