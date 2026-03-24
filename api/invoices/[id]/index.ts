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
    if (method === "GET") {
      if (!id) {
        return res.status(400).json({ error: "id is required" });
      }
      
      const result = await db.execute({
        sql: `
          SELECT i.*, s.name as supplier_name, s.cif as supplier_cif, s.address as supplier_address, 
                 s.city as supplier_city, s.province as supplier_province, s.zip_code as supplier_zip_code,
                 s.country_code as supplier_country_code
          FROM invoices i
          JOIN suppliers s ON i.supplier_id = s.id
          WHERE i.id = ?
        `,
        args: [Number(id)]
      });

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Factura no encontrada" });
      }

      return res.status(200).json(result.rows[0]);
    }

    if (method === "PATCH") {
      const { concept, doc_ext, issue_date, due_date } = req.body;
      if (!id) {
        return res.status(400).json({ error: "id is required" });
      }

      const updates: string[] = [];
      const args: any[] = [];

      if (concept !== undefined) {
        updates.push("concept = ?");
        args.push(concept);
      }
      if (doc_ext !== undefined) {
        updates.push("doc_ext = ?");
        args.push(doc_ext);
      }
      if (issue_date !== undefined) {
        updates.push("issue_date = ?");
        args.push(issue_date);
      }
      if (due_date !== undefined) {
        updates.push("due_date = ?");
        args.push(due_date);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: "No se proporcionaron campos para actualizar" });
      }

      args.push(Number(id));

      await db.execute({
        sql: `UPDATE invoices SET ${updates.join(", ")} WHERE id = ?`,
        args,
      });
      return res.status(200).json({ success: true });
    }

    if (method === "DELETE") {
      if (!id) {
        return res.status(400).json({ error: "id is required" });
      }

      await db.execute({
        sql: "DELETE FROM invoices WHERE id = ?",
        args: [Number(id)],
      });

      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", ["GET", "PATCH", "DELETE"]);
    return res.status(405).end(`Método ${method} no permitido`);
  } catch (error) {
    console.error(`Error en /api/invoices/${id} [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
