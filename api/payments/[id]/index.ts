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

      // Get invoice_id before deleting
      const payment = await db.execute({
        sql: "SELECT invoice_id FROM payments WHERE id = ?",
        args: [Number(id)],
      });

      if (payment.rows.length === 0) {
        return res.status(404).json({ error: "Pago no encontrado" });
      }

      const invoice_id = payment.rows[0].invoice_id;

      await db.execute({
        sql: "DELETE FROM payments WHERE id = ?",
        args: [Number(id)],
      });

      // Update invoice status
      const invData = await db.execute({
        sql: `
          SELECT total_amount, 
          (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE invoice_id = ?) as total_paid
          FROM invoices WHERE id = ?
        `,
        args: [invoice_id, invoice_id],
      });

      if (invData.rows.length > 0) {
        const { total_amount, total_paid } = invData.rows[0] as any;
        let status = "Pending";
        if (total_paid >= total_amount - 0.01) status = "Paid";
        else if (total_paid > 0) status = "Partial";
        
        await db.execute({
          sql: "UPDATE invoices SET status = ? WHERE id = ?",
          args: [status, invoice_id],
        });
      }

      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", ["DELETE"]);
    return res.status(405).end(`Método ${method} no permitido`);
  } catch (error) {
    console.error(`Error en /api/payments/${id} [${method}]:`, error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: (error as Error).message 
    });
  }
}
