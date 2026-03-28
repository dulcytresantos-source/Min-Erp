import { createClient } from "@libsql/client";

export default async function handler(req: any, res: any) {
  try {
    const url = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;

    const mask = (val: string | undefined) => 
      val ? `${val.substring(0, 8)}...${val.substring(val.length - 4)}` : "MISSING";

    return res.status(200).json({
      ok: true,
      phase: "env-check",
      import_status: "LibSQL Client imported successfully",
      database_url: mask(url),
      auth_token: mask(token),
      node_env: process.env.NODE_ENV,
      vercel: process.env.VERCEL
    });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      phase: "env-catch",
      error: e?.message || String(e)
    });
  }
}
