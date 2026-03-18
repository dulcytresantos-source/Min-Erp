import { createClient } from "@libsql/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const result = await db.execute("SELECT 1 as connected");
    return res.status(200).json({ 
      status: "ok", 
      message: "Conexión con Turso exitosa",
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Error en test de conexión:", error);
    return res.status(500).json({ 
      status: "error", 
      message: "Error al conectar con la base de datos",
      error: (error as Error).message 
    });
  }
}
