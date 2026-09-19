// @ts-nocheck
// Fires the odoo-sync GitHub Actions workflow via workflow_dispatch.
// Called every 30 minutes by cron-job.org with Authorization: Bearer <CRON_SECRET>.
// Env vars (Vercel project settings): CRON_SECRET, GH_SYNC_TOKEN (classic PAT, repo scope).

export default async function handler(req: any, res: any) {
  try {
    if (!process.env.CRON_SECRET || !process.env.GH_SYNC_TOKEN) {
      return res
        .status(503)
        .json({ ok: false, error: "server not configured — missing env vars" });
    }
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const gh = await fetch(
      "https://api.github.com/repos/MohanadFalih/pulsestock/actions/workflows/odoo-sync.yml/dispatches",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GH_SYNC_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "pulsestock-cron",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );

    if (gh.status === 204) {
      return res
        .status(200)
        .json({ ok: true, dispatchedAt: new Date().toISOString() });
    }
    const detail = (await gh.text()).slice(0, 300);
    return res.status(502).json({ ok: false, githubStatus: gh.status, detail });
  } catch (e: any) {
    return res
      .status(500)
      .json({ ok: false, error: String((e && e.message) || e) });
  }
}
