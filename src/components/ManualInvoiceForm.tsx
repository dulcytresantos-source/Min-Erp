import React, { useState } from "react";
import { 
  ArrowLeft, 
  Loader2, 
  Check, 
  X,
  AlertCircle,
  Save
} from "lucide-react";
import { motion } from "motion/react";
import { cn } from "../lib/utils";

interface Supplier {
  id: string;
  name: string;
  address: string;
  city: string;
  province: string;
  zip_code: string;
  country_code: string;
  cif: string;
}

interface ManualInvoiceFormProps {
  supplier: Supplier;
  companyId: string | number;
  systemDate: string;
  onSave: (invoiceId: number) => void;
  onCancel: () => void;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + " €";
};

export default function ManualInvoiceForm({ supplier, companyId, systemDate, onSave, onCancel }: ManualInvoiceFormProps) {
  const [docId, setDocId] = useState("");
  const [docExt, setDocExt] = useState("");
  
  // Initialize with system date in DD/MM/YYYY format
  const initialDate = (() => {
    const [y, m, d] = systemDate.split('-');
    return `${d}/${m}/${y}`;
  })();

  const [issueDate, setIssueDate] = useState(initialDate);
  const [dueDate, setDueDate] = useState("");
  const [issueDateInvalid, setIssueDateInvalid] = useState(false);
  const [dueDateInvalid, setDueDateInvalid] = useState(false);
  const [concept, setConcept] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateAndFormatDate = (value: string, setDate: (v: string) => void, setInvalid: (v: boolean) => void) => {
    const v = value.trim().toUpperCase();
    if (!v) {
      setInvalid(false);
      return;
    }

    let normalized = "";
    const [sysYear, sysMonth, sysDay] = systemDate.split('-').map(Number);
    
    if (v === 'T') {
      normalized = systemDate;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      normalized = v;
    } else {
      const parts = v.split(/[\/\-]/);
      
      if (parts.length === 1 && parts[0].length > 0 && parts[0].length <= 2) {
        const d = parts[0].padStart(2, '0');
        normalized = `${sysYear}-${String(sysMonth).padStart(2, '0')}-${d}`;
      } else if (parts.length === 2) {
        const d = parts[0].padStart(2, '0');
        const m = parts[1].padStart(2, '0');
        normalized = `${sysYear}-${m}-${d}`;
      } else if (parts.length === 3) {
        const d = parts[0].padStart(2, '0');
        const m = parts[1].padStart(2, '0');
        let y = parts[2];
        if (y.length === 2) y = `20${y}`;
        normalized = `${y}-${m}-${d}`;
      } else {
        setInvalid(true);
        return;
      }
    }

    const [y, m, d] = normalized.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const isValid = dateObj.getFullYear() === y && 
                    dateObj.getMonth() === m - 1 && 
                    dateObj.getDate() === d;

    if (isValid) {
      setDate(`${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`);
      setInvalid(false);
    } else {
      setInvalid(true);
    }
  };

  const toISODate = (displayDate: string): string => {
    if (!displayDate) return "";
    const parts = displayDate.split('/');
    if (parts.length !== 3) return displayDate;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  };

  const handleSave = async () => {
    if (issueDateInvalid || dueDateInvalid) {
      setError("Por favor, corrige las fechas antes de guardar");
      return;
    }

    const isoIssueDate = toISODate(issueDate);
    const isoDueDate = toISODate(dueDate);

    if (!docId || !isoIssueDate || !concept || !amount) {
      setError("Por favor, rellena todos los campos obligatorios (DOC, Fecha, Concepto, Importe)");
      return;
    }

    const totalAmount = parseFloat(amount.replace(',', '.'));
    if (isNaN(totalAmount)) {
      setError("El importe no es válido");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          supplier_id: supplier.id,
          doc_id: docId,
          doc_ext: docExt || docId, // Use docId as external if not provided
          issue_date: isoIssueDate,
          due_date: isoDueDate || isoIssueDate,
          total_amount: totalAmount,
          concept: concept
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al guardar la factura");
      }

      const data = await res.json();
      onSave(data.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const container = (e.target as HTMLElement).closest('.p-12');
      if (!container) return;
      
      const focusableElements = Array.from(container.querySelectorAll('input, textarea')) as HTMLElement[];
      const index = focusableElements.indexOf(e.target as HTMLElement);
      
      if (index > -1 && index < focusableElements.length - 1) {
        focusableElements[index + 1].focus();
      } else if (index === focusableElements.length - 1) {
        handleSave();
      }
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-3xl mx-auto bg-white shadow-2xl border border-black/5 overflow-hidden font-sans"
    >
      {/* Header Actions */}
      <div className="bg-[#F5F5F4] p-4 flex justify-between items-center border-b border-black/10">
        <button 
          onClick={onCancel}
          className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity"
        >
          <ArrowLeft size={14} />
          Cancelar Alta
        </button>
        <div className="flex items-center gap-4">
            {error && (
              <div className="flex items-center gap-2 text-red-600 text-[10px] font-bold uppercase">
                <AlertCircle size={14} />
                {error}
              </div>
            )}
            <button 
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-emerald-600 text-white rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-colors flex items-center gap-2 shadow-lg shadow-emerald-600/20"
            >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? "Guardando..." : "Guardar Factura"}
            </button>
        </div>
      </div>

      {/* Document Content */}
      <div className="p-12 flex flex-col gap-12 min-h-[800px]">
        {/* Top Section */}
        <div className="flex border border-black">
          {/* Supplier Info */}
          <div className="flex-1 p-6 border-r border-black flex flex-col gap-1 bg-black/5">
            <p className="text-[12px] font-bold">{supplier.id.split('-').pop()}</p>
            <p className="text-[14px] font-black uppercase tracking-tight">{supplier.name}</p>
            <p className="text-[11px] opacity-60">{supplier.address}</p>
            <p className="text-[11px] opacity-60 uppercase">{supplier.zip_code} {supplier.city}</p>
            <p className="text-[11px] opacity-60 uppercase">{supplier.province}, {supplier.country_code}</p>
            <p className="text-[11px] font-bold mt-2">CIF-{supplier.cif}</p>
          </div>

          {/* Document Header */}
          <div className="w-72 flex flex-col">
            <div className="bg-black/5 p-4 text-center border-b border-black">
              <h1 className="text-2xl font-black tracking-[0.2em] uppercase">Factura</h1>
            </div>
            <div className="flex flex-col">
              {/* DOC (Internal ID) */}
              <div className="flex border-b border-black/10">
                <div className="w-24 p-2 bg-black/5 text-[9px] font-bold uppercase tracking-widest text-zinc-700 border-r border-black/10 flex items-center">DOC*</div>
                <div className="flex-1 p-1">
                  <input 
                    type="text"
                    value={docId}
                    onChange={(e) => setDocId(e.target.value.toUpperCase())}
                    onKeyDown={handleKeyDown}
                    placeholder="Ej: 03-FC99"
                    className="w-full px-2 py-1 text-[11px] font-bold border-none outline-none focus:bg-violet-50 transition-colors"
                  />
                </div>
              </div>
              
              {/* DOCEXT */}
              <div className="flex border-b border-black/10">
                <div className="w-24 p-2 bg-black/5 text-[9px] font-bold uppercase tracking-widest text-zinc-700 border-r border-black/10 flex items-center">DOCEXT</div>
                <div className="flex-1 p-1">
                  <input 
                    type="text"
                    value={docExt}
                    onChange={(e) => setDocExt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Opcional"
                    className="w-full px-2 py-1 text-[11px] font-medium border-none outline-none focus:bg-violet-50 transition-colors"
                  />
                </div>
              </div>
              
              {/* FECHA */}
              <div className="flex border-b border-black/10">
                <div className="w-24 p-2 bg-black/5 text-[9px] font-bold uppercase tracking-widest text-zinc-700 border-r border-black/10 flex items-center">FECHA*</div>
                <div className="flex-1 p-1">
                  <input 
                    type="text"
                    value={issueDate}
                    onChange={(e) => {
                      setIssueDate(e.target.value);
                      setIssueDateInvalid(false);
                    }}
                    onBlur={(e) => validateAndFormatDate(e.target.value, setIssueDate, setIssueDateInvalid)}
                    onKeyDown={handleKeyDown}
                    placeholder="DD/MM/AAAA o DD"
                    className={cn(
                      "w-full px-2 py-1 text-[11px] font-medium border-none outline-none focus:bg-violet-50 transition-colors",
                      issueDateInvalid && "bg-red-50 text-red-600 focus:bg-red-50"
                    )}
                  />
                </div>
              </div>
              
              {/* FECHA VTO */}
              <div className="flex border-b border-black/10">
                <div className="w-24 p-2 bg-black/5 text-[9px] font-bold uppercase tracking-widest text-zinc-700 border-r border-black/10 flex items-center">FECHA VTO</div>
                <div className="flex-1 p-1">
                  <input 
                    type="text"
                    value={dueDate}
                    onChange={(e) => {
                      setDueDate(e.target.value);
                      setDueDateInvalid(false);
                    }}
                    onBlur={(e) => validateAndFormatDate(e.target.value, setDueDate, setDueDateInvalid)}
                    onKeyDown={handleKeyDown}
                    placeholder="DD/MM/AAAA o DD"
                    className={cn(
                      "w-full px-2 py-1 text-[11px] font-medium border-none outline-none focus:bg-violet-50 transition-colors",
                      dueDateInvalid && "bg-red-50 text-red-600 focus:bg-red-50"
                    )}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Middle Section - Concept */}
        <div className="flex-1 border border-black flex flex-col">
          <div className="flex bg-black/5 border-b border-black text-[9px] font-bold uppercase tracking-widest text-zinc-700">
            <div className="flex-1 p-3 border-r border-black">Concepto*</div>
            <div className="w-24 p-3 border-r border-black text-center">Cant.</div>
            <div className="w-32 p-3 text-right">Importe*</div>
          </div>
          <div className="flex flex-1 min-h-[300px]">
            <div className="flex-1 p-6 text-[12px] font-medium leading-relaxed">
              <textarea 
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe el concepto de la factura..."
                className="w-full h-full bg-transparent border-none outline-none resize-none focus:bg-violet-50 transition-colors p-2"
              />
            </div>
            <div className="w-24 p-6 border-l border-black text-center text-[12px] font-bold flex items-start justify-center pt-8">1</div>
            <div className="w-32 p-4 border-l border-black text-right text-[12px] font-bold font-mono">
              <input 
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="0,00"
                className="w-full text-right bg-transparent border-none outline-none focus:bg-violet-50 transition-colors p-2 text-lg"
              />
              <span className="text-[10px] opacity-40">€</span>
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
              <p className="text-3xl font-black font-mono tracking-tighter">
                {amount ? formatCurrency(parseFloat(amount.replace(',', '.')) || 0) : "0,00 €"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
