import { createClient } from "@libsql/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { method } = req;
  const { id } = req.query;
  const companyId = (req.query.companyId as string) ?? null;

  try {
    if (method === "GET") {
      if (!id || !companyId) {
        return res.status(400).json({ error: "id and companyId are required" });
      }
      
      const supplier = await db.execute({
        sql: "SELECT * FROM suppliers WHERE id = ? AND company_id = ?",
        args: [id as string, companyId],
      });
      
      if (supplier.rows.length === 0) {
        return res.status(404).json({ error: "Proveedor no encontrado" });
      }

      const invoices = await db.execute({
        sql: `
          SELECT i.*, 
          (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE invoice_id = i.id) as paid_amount
          FROM invoices i 
          WHERE i.supplier_id = ? AND i.company_id = ?
        `,
        args: [id as string, companyId],
      });
      
      return res.status(200).json({ ...supplier.rows[0], invoices: invoices.rows });
    }

    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Método ${method} no permitido`);
  } catch (error) {
    console.error(`Error en /api/suppliers/${id} [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
