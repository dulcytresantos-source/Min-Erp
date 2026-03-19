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
      
      const invoices = await db.execute({
        sql: `
          SELECT i.id, i.doc_id, i.doc_ext, i.invoice_number as reference, i.issue_date as date, i.total_amount as amount, 'Alta Factura' as type, 
                 s.name as supplier_name, s.alias as supplier_alias, i.supplier_id
          FROM invoices i
          JOIN suppliers s ON i.supplier_id = s.id
          WHERE i.supplier_id = ? AND i.company_id = ?
        `,
        args: [id as string, companyId],
      });
      
      const payments = await db.execute({
        sql: `
          SELECT p.id, i.doc_id, i.doc_ext, i.invoice_number as reference, p.payment_date as date, p.amount_paid as amount, 'Liq Factura' as type, 
                 p.bank_movement_id, s.name as supplier_name, s.alias as supplier_alias, i.supplier_id
          FROM payments p
          JOIN invoices i ON p.invoice_id = i.id
          JOIN suppliers s ON i.supplier_id = s.id
          WHERE i.supplier_id = ? AND i.company_id = ?
        `,
        args: [id as string, companyId],
      });
      
      const movements = [...invoices.rows, ...payments.rows].sort((a: any, b: any) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      
      return res.status(200).json(movements);
    }

    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Método ${method} no permitido`);
  } catch (error) {
    console.error(`Error en /api/suppliers/${id}/movements [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
