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
      const { invoice_payments, payment_date, method: payMethod, bank_movement_id } = req.body;
      
      if (!invoice_payments || !Array.isArray(invoice_payments)) {
        return res.status(400).json({ error: "invoice_payments array is required" });
      }

      const statements = [];
      for (const p of invoice_payments) {
        statements.push({
          sql: "INSERT INTO payments (invoice_id, payment_date, amount_paid, method, bank_movement_id) VALUES (?, ?, ?, ?, ?)",
          args: [
            p.invoice_id, 
            payment_date ?? null, 
            p.amount_paid, 
            payMethod ?? 'Transfer', 
            bank_movement_id ?? null
          ]
        });
      }
      
      await db.batch(statements, "write");

      // Update statuses for all affected invoices
      for (const p of invoice_payments) {
        const invData = await db.execute({
          sql: `
            SELECT total_amount, 
            (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE invoice_id = ?) as total_paid
            FROM invoices WHERE id = ?
          `,
          args: [p.invoice_id, p.invoice_id],
        });

        if (invData.rows.length > 0) {
          const { total_amount, total_paid } = invData.rows[0] as any;
          let status = "Partial";
          if (total_paid >= total_amount - 0.01) status = "Paid";
          
          await db.execute({
            sql: "UPDATE invoices SET status = ? WHERE id = ?",
            args: [status, p.invoice_id],
          });
        }
      }
      
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Método ${method} no permitido`);
  } catch (error) {
    console.error(`Error en /api/payments/batch [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
