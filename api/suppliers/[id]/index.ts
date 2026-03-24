import { createClient } from "@libsql/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { method } = req;
  const { id } = req.query;
  const companyId = (req.query.companyId as string) || (req.body?.company_id as string) || null;

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

    if (method === "PATCH") {
      const { alias, is_generic } = req.body;
      if (!id || !companyId) {
        return res.status(400).json({ error: "id and companyId are required" });
      }

      if (is_generic === 1) {
        // Check if another generic supplier exists for this company
        const existingGeneric = await db.execute({
          sql: "SELECT name FROM suppliers WHERE is_generic = 1 AND company_id = ? AND id != ?",
          args: [companyId, id as string],
        });
        if (existingGeneric.rows.length > 0) {
          return res.status(400).json({ error: `Ya existe un proveedor genérico para esta compañía: ${existingGeneric.rows[0].name}` });
        }
      }

      const updates = [];
      const args = [];
      if (alias !== undefined) {
        updates.push("alias = ?");
        args.push(alias);
      }
      if (is_generic !== undefined) {
        updates.push("is_generic = ?");
        args.push(is_generic);
      }
      
      if (updates.length > 0) {
        args.push(id as string, companyId);
        await db.execute({
          sql: `UPDATE suppliers SET ${updates.join(", ")} WHERE id = ? AND company_id = ?`,
          args,
        });
      }
      return res.status(200).json({ success: true });
    }

    if (method === "DELETE") {
      if (!id || !companyId) {
        return res.status(400).json({ error: "id and companyId are required" });
      }

      // Check for associated invoices
      const invoices = await db.execute({
        sql: "SELECT id FROM invoices WHERE supplier_id = ? AND company_id = ?",
        args: [id as string, companyId],
      });

      if (invoices.rows.length > 0) {
        return res.status(400).json({ 
          error: "No se puede eliminar el proveedor porque tiene facturas asociadas." 
        });
      }

      await db.execute({
        sql: "DELETE FROM suppliers WHERE id = ? AND company_id = ?",
        args: [id as string, companyId],
      });

      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", ["GET", "PATCH", "DELETE"]);
    return res.status(405).end(`Método ${method} no permitido`);
  } catch (error) {
    console.error(`Error en /api/suppliers/${id} [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
