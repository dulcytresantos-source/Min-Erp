import { createClient } from "@libsql/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { method } = req;
  const { cif } = req.query;
  const companyId = (req.query.companyId as string) ?? null;

  try {
    if (method === "GET") {
      if (!cif || !companyId) {
        return res.status(400).json({ error: "cif and companyId are required" });
      }
      
      const result = await db.execute({
        sql: "SELECT * FROM suppliers WHERE cif = ? AND company_id = ?",
        args: [cif as string, companyId],
      });
      return res.status(200).json(result.rows[0] || null);
    }

    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Método ${method} no permitido`);
  } catch (error) {
    console.error(`Error en /api/suppliers/cif/${cif} [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
