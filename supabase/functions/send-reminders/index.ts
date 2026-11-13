// Supabase Edge Function: send-reminders
// Runs hourly (pg_cron, see supabase/reminders.sql). For every episode whose picks lock within
// the next 24 hours, emails each player who has an email, wants reminders, hasn't picked yet,
// and hasn't already been reminded for that episode. Sends through Resend.
//
// POST {}            normal run
// POST {"test":true} send a sample reminder to the commissioner only (commissioner login required)
//
// Secrets: RESEND_API_KEY (set in Supabase). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are built in.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE = "https://tribalfantasyleague.com";
const FROM = "Tribal Fantasy <picks@tribalfantasyleague.com>";

// The Commissioner page calls this from the browser (test button), so answer CORS checks.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function lockTimes(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
  const t = (tz: string) => d.toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${day} at ${t("America/New_York")} ET / ${t("America/Chicago")} CT / ${t("America/Denver")} MT / ${t("America/Los_Angeles")} PT`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function message(name: string, ep: { number: number; title: string | null; lock_at: string }, test = false) {
  const epName = ep.title || `Episode ${ep.number}`;
  const when = lockTimes(ep.lock_at);
  const subject = `${test ? "[Test] " : ""}🔥 Picks for ${epName} lock tomorrow`;
  const text = [
    `Hey ${name},`, "",
    `You haven't made your picks for ${epName} yet. Picks lock ${when}.`, "",
    `Make your picks: ${SITE}`, "",
    `Don't want these emails? Sign in at ${SITE} and remove your email on the "This week" tab.`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#2a2118;max-width:520px">
  <p>Hey ${esc(name)},</p>
  <p>You haven't made your picks for <strong>${esc(epName)}</strong> yet.<br>Picks lock <strong>${esc(when)}</strong>.</p>
  <p><a href="${SITE}" style="display:inline-block;background:#c2541b;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Make your picks</a></p>
  <p style="font-size:13px;color:#7a6a58">Don't want these emails? Sign in at <a href="${SITE}" style="color:#1f6f78">tribalfantasyleague.com</a> and remove your email on the "This week" tab.</p>
</div>`;
  return { subject, text, html };
}

async function send(key: string, to: string, msg: { subject: string; text: string; html: string }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ error: "RESEND_API_KEY secret is not set" }, 500);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const now = new Date();

  const { data: league } = await sb.from("league").select("admin_uid").eq("id", 1).single();

  // ---- test: sample reminder to the commissioner only
  if (body?.test) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const { data: who } = await sb.auth.getUser(token);
    if (!who?.user || who.user.id !== league?.admin_uid) return json({ error: "Commissioner only" }, 403);
    const { data: next } = await sb.from("episodes").select("number,title,lock_at")
      .gt("lock_at", now.toISOString()).order("lock_at").limit(1);
    const ep = next?.[0] || { number: 0, title: "Next episode", lock_at: new Date(now.getTime() + 864e5).toISOString() };
    await send(key, who.user.email!, message("Commissioner", ep, true));
    return json({ test: true, sentTo: who.user.email });
  }

  // ---- normal run
  const soon = new Date(now.getTime() + 24 * 36e5).toISOString();
  const { data: eps, error } = await sb.from("episodes").select("number,title,lock_at")
    .gt("lock_at", now.toISOString()).lte("lock_at", soon);
  if (error) return json({ error: error.message }, 500);

  const report: Record<string, unknown>[] = [];
  for (const ep of eps || []) {
    const [{ data: mgrs }, { data: picked }, { data: sent }] = await Promise.all([
      sb.from("managers").select("id,name,email").not("email", "is", null).eq("email_reminders", true),
      sb.from("picks").select("manager_id").eq("episode", ep.number),
      sb.from("reminders_sent").select("manager_id").eq("episode", ep.number),
    ]);
    const skip = new Set([...(picked || []), ...(sent || [])].map((r) => r.manager_id));
    const targets = (mgrs || []).filter((m) => !skip.has(m.id));
    let ok = 0;
    const failed: string[] = [];
    for (const m of targets) {
      try {
        await send(key, m.email!, message(m.name, ep));
        await sb.from("reminders_sent").insert({ episode: ep.number, manager_id: m.id });
        ok++;
      } catch (e) {
        failed.push(`${m.name}: ${(e as Error).message}`);
      }
      await pause(600); // stay under Resend's rate limit
    }
    report.push({ episode: ep.number, sent: ok, failed });
  }
  return json({ ranAt: now.toISOString(), episodes: report });
});
