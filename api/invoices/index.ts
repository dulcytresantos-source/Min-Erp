import { createClient } from "@libsql/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { method } = req;

  try {
    if (method === "POST") {
      const { company_id, supplier_id, invoice_number, doc_id, doc_ext, issue_date, due_date, tax_base, vat, total_amount, concept } = req.body;
      
      if (!company_id || !supplier_id || !total_amount) {
        return res.status(400).json({ error: "Faltan campos obligatorios" });
      }

      // Global duplicate check for internal DOC ID (doc_id)
      if (doc_id) {
        const existingDoc = await db.execute({
          sql: "SELECT id FROM invoices WHERE doc_id = ? AND company_id = ?",
          args: [doc_id ?? null, company_id ?? null],
        });
        if (existingDoc.rows.length > 0) {
          return res.status(400).json({ error: `El número DOC (Int) ${doc_id} ya existe en el sistema para esta compañía.` });
        }
      }

      // Duplicate check: same supplier and same external invoice number
      const existing = await db.execute({
        sql: "SELECT id FROM invoices WHERE supplier_id = ? AND company_id = ? AND (doc_ext = ? OR invoice_number = ?)",
        args: [supplier_id ?? null, company_id ?? null, (doc_ext || invoice_number) ?? null, (invoice_number || doc_ext) ?? null],
      });

      if (existing.rows.length > 0) {
        return res.status(400).json({ error: `Factura duplicada detectada para este proveedor (Nº: ${doc_ext || invoice_number})` });
      }

      const result = await db.execute({
        sql: "INSERT INTO invoices (company_id, supplier_id, invoice_number, doc_id, doc_ext, issue_date, due_date, tax_base, vat, total_amount, concept) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          company_id ?? null, 
          supplier_id ?? null, 
          invoice_number ?? null, 
          doc_id ?? null, 
          doc_ext ?? null, 
          issue_date ?? null, 
          due_date ?? null, 
          tax_base ?? 0, 
          vat ?? 0, 
          total_amount ?? null,
          concept ?? "Factura genérica"
        ],
      });
      return res.status(201).json({ id: Number(result.lastInsertRowid) });
    }

    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Método ${method} no permitido`);
  } catch (error) {
    console.error(`Error en /api/invoices [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
