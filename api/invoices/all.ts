import { createClient } from "@libsql/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { method } = req;
  const companyId = (req.query.companyId as string) ?? null;

  try {
    if (method === "GET") {
      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }
      
      const result = await db.execute({
        sql: `
          SELECT i.*, s.name as supplier_name, s.alias as supplier_alias
          FROM invoices i
          JOIN suppliers s ON i.supplier_id = s.id
          WHERE i.company_id = ?
          ORDER BY i.issue_date DESC
        `,
        args: [companyId]
      });
      return res.status(200).json(result.rows);
    }

    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Método ${method} no permitido`);
  } catch (error) {
    console.error(`Error en /api/invoices/all [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
