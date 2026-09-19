// @ts-nocheck — Vercel builds api/ functions independently of the Vite app
// (tsconfig only includes src/), so this file intentionally uses the
// web-standard Request/Response signature supported by the Vercel Node runtime.
//
// Fires the odoo-sync GitHub Actions workflow on demand (workflow_dispatch).
// Triggered every 30 minutes by an external cron (cron-job.org) calling this
// endpoint with Authorization: Bearer <CRON_SECRET>.
//
// Required environment variables (Vercel project settings):
//   CRON_SECRET    — any strong random string.
//   GH_SYNC_TOKEN  — GitHub Personal Access Token (classic) with `repo` scope.

const REPO = "MohanadFalih/pulsestock";
const WORKFLOW = "odoo-sync.yml";

export default async function handler(request: Request): Promise<Response> {
  // Fail closed: without both secrets configured this endpoint does nothing.
  if (!process.env.CRON_SECRET || !process.env.GH_SYNC_TOKEN) {
    return Response.json(
      { ok: false, error: "server not configured" },
      { status: 503 }
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
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

  // GitHub returns 204 No Content on a successful dispatch.
  if (res.status === 204) {
    return Response.json({ ok: true, dispatchedAt: new Date().toISOString() });
  }
  return Response.json({ ok: false, status: res.status }, { status: 502 });
}
