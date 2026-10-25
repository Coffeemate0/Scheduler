// Supabase Edge Function. Deploy: Dashboard > Edge Functions > New function "send-reminders" > paste this file, turn OFF "Verify JWT".
// (CLI users: save as supabase/functions/send-reminders/index.ts and run: npx supabase functions deploy send-reminders --no-verify-jwt)
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 403 });
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC')!, Deno.env.get('VAPID_PRIVATE')!);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const day = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // YYYY-MM-DD
  const today = day(Date.now()), tomorrow = day(Date.now() + 864e5);
  const { data: dates } = await sb.from('dates').select('*').in('date_on', [today, tomorrow]);

  let sent = 0;
  for (const d of dates ?? []) {
    const kind = d.date_on === today ? 'morning_of' : 'day_before';
    const { error } = await sb.from('reminder_log').insert({ date_id: d.id, kind });
    if (error) continue; // already sent
    const { data: subs } = await sb.from('push_subscriptions').select('*').eq('couple_id', d.couple_id);
    const when = d.time_at ? ` at ${d.time_at.slice(0, 5)}` : '';
    const payload = JSON.stringify({
      title: kind === 'morning_of' ? 'Today 💙' : 'Tomorrow 💙',
      body: `${d.title}${when}${d.place ? ' - ' + d.place : ''}`,
      url: '/',
    });
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await sb.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
  }
  return new Response(JSON.stringify({ sent }), { headers: { 'content-type': 'application/json' } });
});
