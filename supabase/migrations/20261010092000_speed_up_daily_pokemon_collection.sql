-- The normal cycle scans five pages per run; tick every five minutes and honor a 1-4 minute randomized slot.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='sale-radar-distributed-tick';
SELECT cron.schedule('sale-radar-distributed-tick','*/5 * * * *',
 $$SELECT net.http_get('https://whkxkdxpndajqkkqmrcu.supabase.co/functions/v1/sale-radar?action=scheduled');$$);