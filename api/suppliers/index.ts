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
          SELECT s.*, 
          (SELECT COALESCE(SUM(total_amount), 0) FROM invoices WHERE supplier_id = s.id AND company_id = ?) - 
          (SELECT COALESCE(SUM(p.amount_paid), 0) FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE i.supplier_id = s.id AND i.company_id = ?) as pending_balance
          FROM suppliers s
          WHERE s.company_id = ?
        `,
        args: [companyId, companyId, companyId]
      });
      return res.status(200).json(result.rows);
    }

    if (method === "POST") {
      const { company_id, name, cif, email, address, city, province, zip_code, country_code, alias, phone, name2, address2, main_contact, is_generic } = req.body;
      
      if (!name || !cif) {
        return res.status(400).json({ error: "Nombre y CIF son obligatorios" });
      }

      if (is_generic === 1) {
        // Check if another generic supplier exists for this company
        const existingGeneric = await db.execute({
          sql: "SELECT name FROM suppliers WHERE is_generic = 1 AND company_id = ?",
          args: [company_id],
        });
        if (existingGeneric.rows.length > 0) {
          return res.status(400).json({ error: `Ya existe un proveedor genérico para esta compañía: ${existingGeneric.rows[0].name}` });
        }
      }

      // Generate PRovXXX ID based on max current ID FOR THIS COMPANY
      const maxIdResult = await db.execute({
        sql: "SELECT id FROM suppliers WHERE company_id = ? AND id LIKE '%PRov%' ORDER BY id DESC LIMIT 1",
        args: [company_id]
      });
      
      let nextNum = 1;
      if (maxIdResult.rows.length > 0) {
        const lastId = maxIdResult.rows[0].id as string;
        const lastNumPart = lastId.split('PRov').pop();
        const lastNum = lastNumPart ? parseInt(lastNumPart) : NaN;
        if (!isNaN(lastNum)) {
          nextNum = lastNum + 1;
        }
      }
      const id = `${company_id}-PRov${nextNum.toString().padStart(3, '0')}`;
      
      await db.execute({
        sql: "INSERT INTO suppliers (id, company_id, name, cif, email, address, city, province, zip_code, country_code, alias, phone, name2, address2, main_contact, is_generic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          id, 
          company_id ?? null, 
          name ?? null, 
          cif ?? null, 
          email ?? null, 
          address ?? null, 
          city ?? null, 
          province ?? null, 
          zip_code ?? null, 
          country_code ?? 'ES', 
          alias ?? null, 
          phone ?? null, 
          name2 ?? null, 
          address2 ?? null, 
          main_contact ?? null,
          is_generic ?? 0
        ],
      });
      return res.status(201).json({ id });
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Método ${method} no permitido`);
  } catch (error) {
    console.error(`Error en /api/suppliers [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
