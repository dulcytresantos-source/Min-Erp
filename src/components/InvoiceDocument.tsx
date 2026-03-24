import React, { useState, useEffect } from "react";
import { 
  ArrowLeft, 
  Loader2, 
  Check, 
  X,
  AlertCircle
} from "lucide-react";
import { motion } from "motion/react";
import { format, isAfter, parseISO } from "date-fns";

interface InvoiceData {
  id: number;
  doc_id: string;
  doc_ext: string;
  issue_date: string;
  due_date: string;
  total_amount: number;
  concept: string;
  supplier_id: string;
  supplier_name: string;
  supplier_cif: string;
  supplier_address: string;
  supplier_city: string;
  supplier_province: string;
  supplier_zip_code: string;
  supplier_country_code: string;
}

interface InvoiceDocumentProps {
  invoiceId: number;
  onBack: () => void;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + " €";
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    return format(date, "dd/MM/yyyy");
  } catch (e) {
    return dateStr;
  }
};

export default function InvoiceDocument({ invoiceId, onBack }: InvoiceDocumentProps) {
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchInvoice();
  }, [invoiceId]);

  const fetchInvoice = async () => {
    if (!invoiceId) {
      setError("ID de factura no válido");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`);
      const contentType = res.headers.get("content-type");
      
      if (!res.ok) {
        if (contentType && contentType.includes("application/json")) {
          const errorData = await res.json();
          throw new Error(errorData.error || `Error ${res.status}`);
        } else {
          const text = await res.text();
          console.error("Error response (not JSON):", text);
          throw new Error(`Error ${res.status}: El servidor no devolvió JSON. Revisa la consola.`);
        }
      }

      if (contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setInvoice(data);
      } else {
        const text = await res.text();
        console.error("Success response (not JSON):", text);
        throw new Error("El servidor devolvió un formato inesperado (no JSON)");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDoubleClick = (field: string, value: string) => {
    const editableFields = ["doc_ext", "issue_date", "due_date", "concept"];
    if (editableFields.includes(field)) {
      setEditingField(field);
      setEditValue(value || "");
    }
  };

  const handleSave = async () => {
    if (!invoice || !editingField) return;
    
    // Validation for due_date
    if (editingField === "due_date") {
      const issueDate = parseISO(invoice.issue_date);
      const dueDate = parseISO(editValue);
      if (!isAfter(dueDate, issueDate) && editValue !== invoice.issue_date) {
        alert("La fecha de vencimiento debe ser posterior a la fecha de emisión");
        return;
      }
    }
    
    if (editingField === "issue_date") {
        const issueDate = parseISO(editValue);
        const dueDate = parseISO(invoice.due_date);
        if (isAfter(issueDate, dueDate)) {
            alert("La fecha de emisión no puede ser posterior a la fecha de vencimiento");
            return;
        }
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [editingField]: editValue }),
      });

      if (!res.ok) throw new Error("Error al guardar los cambios");
      
      setInvoice({ ...invoice, [editingField]: editValue });
      setEditingField(null);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="animate-spin opacity-20" size={48} />
        <p className="text-xs font-bold uppercase tracking-widest opacity-40">Cargando Documento...</p>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4 text-red-500">
        <AlertCircle size={48} />
        <p className="text-xs font-bold uppercase tracking-widest">{error || "No se pudo cargar la factura"}</p>
        <button onClick={onBack} className="mt-4 px-6 py-2 bg-[#0A0A0A] text-white rounded-sm text-[10px] font-bold uppercase tracking-widest">Volver</button>
      </div>
    );
  }

  const renderField = (field: keyof InvoiceData, label: string, value: any, type: string = "text") => {
    const isEditing = editingField === field;
    const displayValue = field.includes("date") ? formatDate(value as string) : value;

    return (
      <div 
        className="flex border-b border-black/10 last:border-0"
        onDoubleClick={() => handleDoubleClick(field, value as string)}
      >
        <div className="w-24 p-2 bg-black/5 text-[10px] font-bold uppercase tracking-tight border-r border-black/10 flex items-center">
          {label}
        </div>
        <div className="flex-1 p-2 text-[11px] font-medium flex items-center min-h-[32px]">
          {isEditing ? (
            <div className="flex items-center gap-2 w-full">
              <input 
                type={type}
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") setEditingField(null);
                }}
                className="flex-1 bg-white border border-black/20 px-2 py-1 outline-none focus:border-black transition-all"
              />
              <button onClick={handleSave} disabled={saving} className="text-green-600 hover:scale-110 transition-transform">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
              <button onClick={() => setEditingField(null)} className="text-red-600 hover:scale-110 transition-transform">
                <X size={14} />
              </button>
            </div>
          ) : (
            <span className="cursor-default select-none">{displayValue || "-"}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-3xl mx-auto bg-white shadow-2xl border border-black/5 overflow-hidden font-sans"
    >
      {/* Header Actions */}
      <div className="bg-[#F5F5F4] p-4 flex justify-between items-center border-b border-black/10 print:hidden">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity"
        >
          <ArrowLeft size={14} />
          Volver a Movimientos
        </button>
        <div className="flex items-center gap-4">
            <p className="text-[9px] font-bold uppercase tracking-widest opacity-30 italic">Doble click para editar campos permitidos</p>
            <button 
                onClick={() => window.print()}
                className="px-4 py-1.5 bg-[#0A0A0A] text-white rounded-sm text-[9px] font-bold uppercase tracking-widest hover:bg-[#1A1A1A] transition-colors"
            >
                Imprimir
            </button>
        </div>
      </div>

      {/* Document Content */}
      <div className="p-12 flex flex-col gap-12 min-h-[800px]">
        {/* Top Section */}
        <div className="flex border border-black">
          {/* Supplier Info */}
          <div className="flex-1 p-6 border-r border-black flex flex-col gap-1">
            <p className="text-[12px] font-bold">{invoice.supplier_id.split('-').pop()}</p>
            <p className="text-[14px] font-black uppercase tracking-tight">{invoice.supplier_name}</p>
            <p className="text-[11px] opacity-60">{invoice.supplier_address}</p>
            <p className="text-[11px] opacity-60 uppercase">{invoice.supplier_zip_code} {invoice.supplier_city}</p>
            <p className="text-[11px] opacity-60 uppercase">{invoice.supplier_province}, {invoice.supplier_country_code}</p>
            <p className="text-[11px] font-bold mt-2">CIF-{invoice.supplier_cif}</p>
          </div>

          {/* Document Header */}
          <div className="w-72 flex flex-col">
            <div className="bg-black/5 p-4 text-center border-b border-black">
              <h1 className="text-2xl font-black tracking-[0.2em] uppercase">Factura</h1>
            </div>
            <div className="flex flex-col">
              {/* Doc (Internal ID) - Not Editable */}
              <div className="flex border-b border-black/10">
                <div className="w-24 p-2 bg-black/5 text-[10px] font-bold uppercase tracking-tight border-r border-black/10 flex items-center">Doc</div>
                <div className="flex-1 p-2 text-[11px] font-medium flex items-center">{invoice.doc_id || "-"}</div>
              </div>
              
              {/* DocExt - Editable */}
              {renderField("doc_ext", "DocExt", invoice.doc_ext)}
              
              {/* Fecha - Editable */}
              {renderField("issue_date", "Fecha", invoice.issue_date, "date")}
              
              {/* Fecha Vto - Editable */}
              {renderField("due_date", "Fecha Vto", invoice.due_date, "date")}
            </div>
          </div>
        </div>

        {/* Middle Section - Concept */}
        <div className="flex-1 border border-black flex flex-col">
          <div className="flex bg-black/5 border-b border-black text-[10px] font-bold uppercase tracking-widest">
            <div className="flex-1 p-3 border-r border-black">Concepto</div>
            <div className="w-24 p-3 border-r border-black text-center">Cant.</div>
            <div className="w-32 p-3 text-right">Importe</div>
          </div>
          <div className="flex flex-1 min-h-[300px]">
            <div className="flex-1 p-6 text-[12px] font-medium leading-relaxed">
              {editingField === "concept" ? (
                <div className="flex flex-col gap-2">
                  <textarea 
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="w-full bg-white border border-black/20 p-3 outline-none focus:border-black transition-all min-h-[100px]"
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingField(null)} className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest opacity-40">Cancelar</button>
                    <button onClick={handleSave} disabled={saving} className="px-3 py-1 bg-black text-white text-[10px] font-bold uppercase tracking-widest">
                        {saving ? "Guardando..." : "Guardar"}
                    </button>
                  </div>
                </div>
              ) : (
                <div 
                  className="cursor-default select-none h-full"
                  onDoubleClick={() => handleDoubleClick("concept", invoice.concept)}
                >
                  {invoice.concept || "Sin concepto"}
                </div>
              )}
            </div>
            <div className="w-24 p-6 border-l border-black text-center text-[12px] font-bold">1</div>
            <div className="w-32 p-6 border-l border-black text-right text-[12px] font-bold font-mono">
              {formatCurrency(invoice.total_amount)}
            </div>
          </div>
        </div>

        {/* Bottom Section - Total */}
        <div className="flex border border-black mt-auto">
          <div className="flex-1 bg-black/5"></div>
          <div className="w-96 flex flex-col">
            <div className="flex bg-black/5 border-b border-black">
              <div className="flex-1 p-4 text-right text-xl font-black uppercase tracking-widest">Total</div>
            </div>
            <div className="p-6 text-right">
              <p className="text-3xl font-black font-mono tracking-tighter">{formatCurrency(invoice.total_amount)}</p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
