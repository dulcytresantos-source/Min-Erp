import { createClient } from "@libsql/client";

export default async function handler(req: any, res: any) {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) {
    return res.status(500).json({ ok: false, error: "Missing credentials" });
  }

  try {
    const db = createClient({ url, authToken: token });
    const start = Date.now();
    
    // El anzuelo de oro: una query que no hace nada pero confirma conexión
    const result = await db.execute("SELECT 1 as connected");
    
    const end = Date.now();

    return res.status(200).json({
      ok: true,
      phase: "db-raw-check",
      message: "¡CONEXIÓN EXITOSA CON TURSO!",
      latency: `${end - start}ms`,
      data: result.rows[0]
    });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      phase: "db-raw-catch",
      error: e?.message || String(e),
      stack: e?.stack
    });
  }
}
