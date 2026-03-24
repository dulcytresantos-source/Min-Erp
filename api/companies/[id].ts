import { createClient } from "@libsql/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { method } = req;
  const { id } = req.query;

  try {
    if (method === "DELETE") {
      if (!id) {
        return res.status(400).json({ error: "id is required" });
      }

      const companyId = Number(id);

      // Delete associated data
      await db.execute({
        sql: "DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id = ?)",
        args: [companyId]
      });
      await db.execute({
        sql: "DELETE FROM invoices WHERE company_id = ?",
        args: [companyId]
      });
      await db.execute({
        sql: "DELETE FROM suppliers WHERE company_id = ?",
        args: [companyId]
      });
      await db.execute({
        sql: "DELETE FROM companies WHERE id = ?",
        args: [companyId]
      });
      
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", ["DELETE"]);
    return res.status(405).end(`Método ${method} no permitido`);
  } catch (error) {
    console.error(`Error en /api/companies/${id} [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
