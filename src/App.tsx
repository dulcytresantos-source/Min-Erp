import React, { useState, useEffect, useCallback, useMemo } from "react";
import { 
  Plus, 
  FileUp, 
  Search, 
  Building2, 
  Euro, 
  History, 
  CheckCircle2, 
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  X,
  Loader2,
  Table as TableIcon,
  ChevronRight,
  CreditCard,
  Calendar,
  UserPlus,
  Users,
  Upload,
  ArrowUp,
  ArrowDown,
  Filter,
  Settings,
  Trash2,
  Download,
  Layers
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";
import { parseInvoice } from "./lib/gemini";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + " €";
};

const toTitleCase = (str: string) => {
  if (!str) return "";
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

interface Supplier {
  id: string;
  company_id: number;
  name: string;
  alias?: string;
  name2?: string;
  address: string;
  address2?: string;
  zip_code?: string;
  city?: string;
  province?: string;
  country_code?: string;
  phone?: string;
  email: string;
  cif: string;
  main_contact?: string;
  pending_balance: number;
}

interface Company {
  id: number;
  name: string;
  address: string;
  cif: string;
  is_default: number;
}

interface Invoice {
  id: number;
  supplier_id: string;
  doc_id?: string;
  doc_ext?: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  tax_base: number;
  vat: number;
  total_amount: number;
  status: 'Pending' | 'Partial' | 'Paid';
  paid_amount: number;
  supplier_name?: string;
  supplier_alias?: string;
}

interface Movement {
  id: number;
  doc_id?: string;
  doc_ext?: string;
  reference: string;
  date: string;
  amount: number;
  type: 'Alta Factura' | 'Liq Factura';
  bank_movement_id?: string;
  supplier_name?: string;
  supplier_alias?: string;
  supplier_id?: string;
}

interface NewSupplierProposal {
  name: string;
  alias?: string;
  cif: string;
  address: string;
  city?: string;
  zip_code?: string;
  province?: string;
  phone?: string;
  email: string;
  invoiceData: any;
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    return format(date, "dd/MM/yyyy");
  } catch (e) {
    return dateStr;
  }
};

const parseSmartDate = (input: string, baseDateStr: string = format(new Date(), "yyyy-MM-dd")) => {
  if (!input) return null;
  
  const baseDate = new Date(baseDateStr);
  const currentYear = baseDate.getFullYear();
  const currentMonth = baseDate.getMonth() + 1;

  const getDaysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

  const parsePart = (part: string) => {
    part = part.trim().toUpperCase().replace(/\//g, '-');
    if (!part) return null;
    
    // Year shortcut
    if (part === 'A') {
      return { start: `${currentYear}-01-01`, end: `${currentYear}-12-31` };
    }

    // Today shortcut
    if (part === 'T') {
      return { start: baseDateStr, end: baseDateStr };
    }
    
    // Month shortcut
    if (part.startsWith('M')) {
      const monthStr = part.slice(1);
      const month = monthStr ? parseInt(monthStr) : currentMonth;
      if (!isNaN(month) && month >= 1 && month <= 12) {
        const lastDay = getDaysInMonth(currentYear, month);
        return { 
          start: `${currentYear}-${String(month).padStart(2, '0')}-01`, 
          end: `${currentYear}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` 
        };
      }
    }
    
    // Date formats: D, D-M, D-M-Y
    const segments = part.split('-');
    if (segments.length === 1 && /^\d+$/.test(segments[0])) {
      const day = String(parseInt(segments[0])).padStart(2, '0');
      const month = String(currentMonth).padStart(2, '0');
      const date = `${currentYear}-${month}-${day}`;
      return { start: date, end: date };
    }
    
    if (segments.length === 2) {
      const day = String(parseInt(segments[0])).padStart(2, '0');
      const month = String(parseInt(segments[1])).padStart(2, '0');
      const date = `${currentYear}-${month}-${day}`;
      return { start: date, end: date };
    }
    
    if (segments.length === 3) {
      let day, month, year;
      if (segments[0].length === 4) {
        // YYYY-MM-DD
        year = parseInt(segments[0]);
        month = parseInt(segments[1]);
        day = parseInt(segments[2]);
      } else {
        // DD-MM-YYYY
        day = parseInt(segments[0]);
        month = parseInt(segments[1]);
        year = parseInt(segments[2]);
        if (year < 100) year += 2000;
      }
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { start: date, end: date };
    }
    
    return null;
  };

  if (input.includes('..')) {
    const [startPart, endPart] = input.split('..');
    const startRes = startPart ? parsePart(startPart) : null;
    const endRes = endPart ? parsePart(endPart) : null;
    
    return {
      start: startRes ? startRes.start : null,
      end: endRes ? endRes.end : null
    };
  } else {
    return parsePart(input);
  }
};

interface LogEntry {
  timestamp: string;
  type: 'SUCCESS' | 'ERROR' | 'DUPLICATE' | 'INFO';
  message: string;
}

const exportToTSV = (data: any[], filename: string) => {
  if (data.length === 0) return;
  
  const headers = Object.keys(data[0]).join("\t");
  const rows = data.map(row => 
    Object.values(row).map(value => {
      const strValue = String(value);
      // For TSV, we only need to escape tabs and newlines if they exist
      // Usually, we just replace them or wrap in quotes if needed, 
      // but for Excel TSV, simple tab separation is often enough.
      // We'll replace tabs with spaces to avoid breaking the format.
      return strValue.replace(/\t/g, ' ').replace(/\n/g, ' ');
    }).join("\t")
  );
  
  const tsvContent = "\uFEFF" + [headers, ...rows].join("\n");
  const blob = new Blob([tsvContent], { type: "text/tab-separated-values;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}.tsv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export default function App() {
  const [view, setView] = useState<'suppliers' | 'upload' | 'supplier-detail' | 'history' | 'movements'>('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<number | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [movementsFilterSupplierId, setMovementsFilterSupplierId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'General' | 'Comunicación' | 'Facturación' | 'Pagos' | 'Envíos' | 'Internacional' | 'Precios'>('General');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLiquidating, setIsLiquidating] = useState<{
    id: number;
    invoice_number: string;
    doc_id: string;
    supplier_id: string;
    total_amount: number;
    paid_amount: number;
  } | null>(null);
  const [isMultipleLiquidation, setIsMultipleLiquidation] = useState(false);
  const [selectedInvoicesForBatch, setSelectedInvoicesForBatch] = useState<number[]>([]);
  const [isBatchLiquidating, setIsBatchLiquidating] = useState<boolean>(false);
  const [isDeletingPayment, setIsDeletingPayment] = useState<number | null>(null);
  const [proposal, setProposal] = useState<NewSupplierProposal | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState<string>(format(new Date(), "dd/MM/yyyy"));
  const [paymentMethod, setPaymentMethod] = useState<string>("Bank Transfer");
  const [bankId, setBankId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [liquidationError, setLiquidationError] = useState<string | null>(null);
  const [systemDate, setSystemDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [showSettings, setShowSettings] = useState(false);
  const [uploadLog, setUploadLog] = useState<LogEntry[]>([]);
  const [isAddingCompany, setIsAddingCompany] = useState(false);
  const [newCompany, setNewCompany] = useState({ name: '', address: '', cif: '' });
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'id', direction: 'asc' });
  const [isDeletingCompany, setIsDeletingCompany] = useState<Company | null>(null);
  const [deleteConfirmCode, setDeleteConfirmCode] = useState("");
  const [userDeleteCodeInput, setUserDeleteCodeInput] = useState("");

  const [movementSortField, setMovementSortField] = useState<string | null>('date');
  const [movementSortDirection, setMovementSortDirection] = useState<'asc' | 'desc'>('desc');
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>("All");

  const [invoiceSortField, setInvoiceSortField] = useState<keyof Invoice | null>('issue_date');
  const [invoiceSortDirection, setInvoiceSortDirection] = useState<'asc' | 'desc'>('desc');
  const [historySupplierFilter, setHistorySupplierFilter] = useState<string>("All");
  const [historyDateFilter, setHistoryDateFilter] = useState<string>("");
  const [movementDateFilter, setMovementDateFilter] = useState<string>("");

  const filteredAndSortedInvoices = useMemo(() => {
    let result = [...allInvoices];

    // Supplier filter
    if (historySupplierFilter !== "All") {
      result = result.filter(inv => inv.supplier_id === historySupplierFilter);
    }

    // Date filter logic: date1..date2, date1.., ..date2, or exact date
    if (historyDateFilter) {
      const smartRange = parseSmartDate(historyDateFilter, systemDate);
      if (smartRange) {
        if (smartRange.start && smartRange.end) {
          result = result.filter(inv => inv.issue_date >= smartRange.start! && inv.issue_date <= smartRange.end!);
        } else if (smartRange.start) {
          result = result.filter(inv => inv.issue_date >= smartRange.start!);
        } else if (smartRange.end) {
          result = result.filter(inv => inv.issue_date <= smartRange.end!);
        }
      }
    }

    // Search filter (Cumulative)
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(inv => 
        inv.invoice_number.toLowerCase().includes(q) ||
        inv.doc_id?.toLowerCase().includes(q) ||
        inv.doc_ext?.toLowerCase().includes(q) ||
        inv.supplier_name?.toLowerCase().includes(q)
      );
    }

    // Sort
    if (invoiceSortField) {
      result.sort((a, b) => {
        const valA = a[invoiceSortField];
        const valB = b[invoiceSortField];

        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;

        if (valA < valB) return invoiceSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return invoiceSortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [allInvoices, invoiceSortField, invoiceSortDirection, searchQuery, historySupplierFilter, historyDateFilter, systemDate]);

  const groupedInvoices = useMemo(() => {
    const invoices = movements.filter(m => m.type === 'Alta Factura');
    const allPayments = movements.filter(m => m.type === 'Liq Factura');

    let result = invoices.map(inv => {
      const invPayments = allPayments.filter(p => p.doc_id === inv.doc_id);
      const totalPaid = invPayments.reduce((sum, p) => sum + p.amount, 0);
      const pending = Math.round((inv.amount - totalPaid) * 100) / 100;
      const status = pending <= 0 ? 'LIQUIDADA' : 'PENDIENTE';
      return {
        ...inv,
        pending,
        status,
        payments: invPayments
      };
    });

    // Filter by Supplier
    if (movementsFilterSupplierId) {
      result = result.filter(inv => inv.supplier_id === movementsFilterSupplierId);
    }

    // Filter by Date
    if (movementDateFilter) {
      const smartRange = parseSmartDate(movementDateFilter, systemDate);
      if (smartRange) {
        if (smartRange.start && smartRange.end) {
          result = result.filter(m => m.date >= smartRange.start! && m.date <= smartRange.end!);
        } else if (smartRange.start) {
          result = result.filter(m => m.date >= smartRange.start!);
        } else if (smartRange.end) {
          result = result.filter(m => m.date <= smartRange.end!);
        }
      }
    }

    // Search Filter (includes status and supplier code)
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(inv => 
        inv.doc_id?.toLowerCase().includes(q) ||
        inv.doc_ext?.toLowerCase().includes(q) ||
        inv.supplier_id?.toLowerCase().includes(q) ||
        inv.supplier_name?.toLowerCase().includes(q) ||
        inv.supplier_alias?.toLowerCase().includes(q) ||
        inv.status.toLowerCase().includes(q)
      );
    }

    // Sort
    if (movementSortField) {
      result.sort((a, b) => {
        // @ts-ignore
        const valA = a[movementSortField];
        // @ts-ignore
        const valB = b[movementSortField];

        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;

        if (valA < valB) return movementSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return movementSortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [movements, movementsFilterSupplierId, movementDateFilter, systemDate, searchQuery, movementSortField, movementSortDirection]);

  const handleMovementSort = (field: string) => {
    if (movementSortField === field) {
      setMovementSortDirection(movementSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setMovementSortField(field);
      setMovementSortDirection('asc');
    }
  };

  const handleInvoiceSort = (field: keyof Invoice) => {
    if (invoiceSortField === field) {
      setInvoiceSortDirection(invoiceSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setInvoiceSortField(field);
      setInvoiceSortDirection('asc');
    }
  };

  const SortIcon = ({ field, currentField, direction }: { field: any, currentField: any, direction: 'asc' | 'desc' }) => {
    if (currentField !== field) return null;
    return direction === 'asc' ? <ArrowUp size={10} className="inline ml-1" /> : <ArrowDown size={10} className="inline ml-1" />;
  };

  const fetchCompanies = async () => {
    try {
      const response = await fetch("/api/companies");
      const data = await response.json();
      if (Array.isArray(data)) {
        setCompanies(data);
        if (data.length > 0 && !activeCompanyId) {
          const defaultCompany = data.find((c: Company) => c.is_default === 1) || data[0];
          setActiveCompanyId(defaultCompany.id);
        }
      } else {
        console.error("Error fetching companies: response is not an array", data);
      }
    } catch (error) {
      console.error("Error fetching companies:", error);
    }
  };

  const fetchData = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const res = await fetch(`/api/suppliers?companyId=${activeCompanyId}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setSuppliers(data);
      } else {
        console.error("Error fetching suppliers: response is not an array", data);
      }

      const invRes = await fetch(`/api/invoices/all?companyId=${activeCompanyId}`);
      const invData = await invRes.json();
      if (Array.isArray(invData)) {
        setAllInvoices(invData);
      } else {
        console.error("Error fetching invoices: response is not an array", invData);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchCompanies();
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (activeCompanyId) {
      fetchData();
      if (view === 'movements' && !movementsFilterSupplierId) {
        fetchAllMovements();
      }
    }
  }, [activeCompanyId, fetchData, view, movementsFilterSupplierId]);

  const fetchSupplierDetails = async (id: string) => {
    if (!activeCompanyId) return;
    try {
      const res = await fetch(`/api/suppliers/${id}?companyId=${activeCompanyId}`);
      const data = await res.json();
      if (data && !data.error) {
        setInvoices(data.invoices || []);
      }
      
      const mRes = await fetch(`/api/suppliers/${id}/movements?companyId=${activeCompanyId}`);
      const mData = await mRes.json();
      if (Array.isArray(mData)) {
        setMovements(mData);
      }
    } catch (error) {
      console.error("Error fetching supplier details:", error);
    }
  };

  const handleUpdateAlias = async (id: string, newAlias: string) => {
    if (!activeCompanyId) return;
    try {
      const res = await fetch(`/api/suppliers/${id}?companyId=${activeCompanyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: newAlias })
      });
      if (res.ok) {
        setSelectedSupplier(prev => prev ? { ...prev, alias: newAlias } : null);
        setSuppliers(prev => prev.map(s => s.id === id ? { ...s, alias: newAlias } : s));
      }
    } catch (error) {
      console.error("Error updating supplier alias:", error);
    }
  };

  const fetchAllMovements = async () => {
    if (!activeCompanyId) return;
    try {
      const res = await fetch(`/api/movements/all?companyId=${activeCompanyId}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setMovements(data);
      }
    } catch (error) {
      console.error("Error fetching all movements:", error);
    }
  };

  const addLogEntry = (type: LogEntry['type'], message: string) => {
    setUploadLog(prev => [{
      timestamp: format(new Date(), "HH:mm:ss"),
      type,
      message
    }, ...prev].slice(0, 50));
  };

  const handleAddCompany = async () => {
    if (!newCompany.name) return;
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCompany)
      });
      if (res.ok) {
        await fetchCompanies();
        setIsAddingCompany(false);
        setNewCompany({ name: '', address: '', cif: '' });
      }
    } catch (error) {
      console.error("Error adding company:", error);
    }
  };

  const handleDeleteCompany = async () => {
    if (!isDeletingCompany) return;
    if (userDeleteCodeInput !== deleteConfirmCode) {
      alert("El código introducido no es correcto.");
      return;
    }

    try {
      const res = await fetch(`/api/companies?id=${isDeletingCompany.id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        if (activeCompanyId === isDeletingCompany.id) {
          const otherCompany = companies.find(c => c.id !== isDeletingCompany.id);
          if (otherCompany) {
            setActiveCompanyId(otherCompany.id);
          } else {
            setActiveCompanyId(null);
          }
        }
        setIsDeletingCompany(null);
        setUserDeleteCodeInput("");
        setDeleteConfirmCode("");
        fetchCompanies();
      }
    } catch (error) {
      console.error("Error deleting company:", error);
    }
  };

  const initiateDeleteCompany = (company: Company) => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    setDeleteConfirmCode(code);
    setIsDeletingCompany(company);
    setUserDeleteCodeInput("");
  };

  const processFiles = async (files: FileList | File[], targetSupplier?: Supplier) => {
    setIsUploading(true);
    setUploadError(null);
    setUploadLog([]); // Clear previous log
    const sessionInvoices = new Set<string>();

    addLogEntry('INFO', `Iniciando procesamiento de ${files.length} archivos...`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        addLogEntry('INFO', `Procesando: ${file.name}`);
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(file);
        });

        const parsed = await parseInvoice(base64, file.type);
        
        // Extract DOC from filename if possible (e.g., "02-FC21 IBM 233,44€")
        const docMatch = file.name.match(/^([A-Z0-9-]+)\s/i);
        const docId = docMatch ? docMatch[1] : undefined;
        if (docId) {
          addLogEntry('INFO', `${file.name}: DOC ID extraído del nombre: ${docId}`);
        }

        // Validation for specific supplier dropzone
        if (targetSupplier && parsed.cif !== targetSupplier.cif) {
          const msg = `Error: La factura pertenece al CIF ${parsed.cif}, pero estás en la ficha de ${targetSupplier.name} (${targetSupplier.cif}).`;
          setUploadError(msg);
          addLogEntry('ERROR', `${file.name}: ${msg}`);
          continue;
        }

        // Session duplicate check
        const sessionKey = `${parsed.cif}-${parsed.invoiceNumber}`;
        if (sessionInvoices.has(sessionKey) || (docId && sessionInvoices.has(`DOC-${docId}`))) {
          const msg = `Factura repetida en la selección: ${docId || parsed.invoiceNumber}`;
          setUploadError(msg);
          addLogEntry('DUPLICATE', `${file.name}: ${msg}`);
          continue;
        }
        sessionInvoices.add(sessionKey);
        if (docId) sessionInvoices.add(`DOC-${docId}`);

        // Lookup CIF
        const cifRes = await fetch(`/api/suppliers/cif/${parsed.cif}?companyId=${activeCompanyId}`);
        const existingSupplier = await cifRes.json();

        if (existingSupplier) {
          // Client-side duplicate check against DB
          const isDuplicate = allInvoices.some(inv => 
            (inv.supplier_id === existingSupplier.id && (inv.doc_ext === parsed.invoiceNumber || inv.invoice_number === parsed.invoiceNumber)) ||
            (docId && inv.doc_id === docId)
          );

          if (isDuplicate) {
            const duplicateType = allInvoices.some(inv => docId && inv.doc_id === docId) ? `DOC (Int): ${docId}` : `Nº: ${parsed.invoiceNumber}`;
            const msg = `Factura duplicada detectada (${duplicateType})`;
            setUploadError(msg);
            addLogEntry('DUPLICATE', `${file.name}: ${msg}`);
            continue;
          }

          await createInvoice(existingSupplier.id, { ...parsed, docId });
          addLogEntry('SUCCESS', `${file.name}: Procesada correctamente para ${existingSupplier.name}`);
          if (selectedSupplier?.id === existingSupplier.id) {
            fetchSupplierDetails(existingSupplier.id);
          }
        } else {
          addLogEntry('INFO', `${file.name}: Proveedor nuevo detectado (${parsed.supplierName})`);
          setProposal({
            name: parsed.supplierName,
            alias: parsed.alias,
            cif: parsed.cif,
            address: parsed.address,
            city: parsed.city,
            zip_code: parsed.zipCode,
            province: parsed.province,
            phone: parsed.phone,
            email: parsed.email,
            invoiceData: { ...parsed, docId }
          });
        }
      } catch (err) {
        console.error(err);
        const msg = err instanceof Error ? err.message : "Error al procesar una de las facturas.";
        setUploadError(msg);
        addLogEntry('ERROR', `${file.name}: ${msg}`);
      }
    }

    await fetchData();
    setIsUploading(false);
    addLogEntry('INFO', "Procesamiento finalizado.");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, targetSupplier?: Supplier) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processFiles(files, targetSupplier);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent, targetSupplier?: Supplier) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await processFiles(files, targetSupplier);
    }
  };

  const createInvoice = async (supplierId: string, data: any) => {
    if (!activeCompanyId) return;
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: activeCompanyId,
        supplier_id: supplierId,
        doc_id: data.docId,
        doc_ext: data.invoiceNumber,
        invoice_number: data.invoiceNumber || "S/N",
        issue_date: data.issueDate || format(new Date(), "yyyy-MM-dd"),
        due_date: data.dueDate,
        tax_base: data.taxBase || 0,
        vat: data.vat || 0,
        total_amount: data.totalAmount || 0
      })
    });
    
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || "Error al crear la factura");
    }
  };

  const handleCreateSupplier = async () => {
    if (!proposal || !activeCompanyId) return;
    setIsUploading(true);
    setUploadError(null);

    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: activeCompanyId,
          name: proposal.name,
          alias: proposal.alias,
          cif: proposal.cif,
          address: proposal.address,
          city: proposal.city,
          zip_code: proposal.zip_code,
          province: proposal.province,
          phone: proposal.phone,
          email: proposal.email
        })
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Error al crear el proveedor");
      }

      const { id } = await res.json();
      
      await createInvoice(id, proposal.invoiceData);
      setProposal(null);
      await fetchData();
      
      // Navigate to the new supplier detail view
      const sRes = await fetch(`/api/suppliers/${id}?companyId=${activeCompanyId}`);
      const sData = await sRes.json();
      setSelectedSupplier(sData);
      setView('supplier-detail');
      fetchSupplierDetails(id);
    } catch (err) {
      console.error("Error in handleCreateSupplier:", err);
      setUploadError(err instanceof Error ? err.message : "Error al crear el proveedor");
    } finally {
      setIsUploading(false);
    }
  };

  const smartFormatDate = (value: string): string => {
    const v = value.trim().toUpperCase();
    let normalized = "";
    
    if (v === 'T') {
      normalized = systemDate;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      normalized = v;
    } else {
      const [sysYear, sysMonth, sysDay] = systemDate.split('-');
      const parts = v.split(/[\/\-]/);
      
      if (parts.length === 1 && parts[0].length > 0 && parts[0].length <= 2) {
        const d = parts[0].padStart(2, '0');
        normalized = `${sysYear}-${sysMonth}-${d}`;
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
        return value;
      }
    }
    
    try {
      const date = new Date(normalized);
      if (!isNaN(date.getTime())) {
        return format(date, "dd/MM/yyyy");
      }
    } catch (e) {}
    
    return value;
  };

  const handleDateInput = (value: string, setter: (val: string) => void) => {
    if (value.toUpperCase() === 'T') {
      setter(format(new Date(systemDate), "dd/MM/yyyy"));
      return;
    }
    setter(value);
  };

  const handleLiquidate = async () => {
    if (!isLiquidating) return;

    const displayDate = smartFormatDate(paymentDate);
    // Convert DD/MM/YYYY to YYYY-MM-DD for API
    let formattedDate = "";
    if (displayDate.includes('/')) {
      const parts = displayDate.split('/');
      if (parts.length === 3) {
        formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) {
      formattedDate = displayDate;
    }
    
    if (!formattedDate || !/^\d{4}-\d{2}-\d{2}$/.test(formattedDate)) {
      setLiquidationError("Fecha de pago no válida (Use DD/MM/YYYY o T)");
      return;
    }
    
    if (!bankId.trim()) {
      setLiquidationError("El Nº de Movimiento de Liquidación es obligatorio");
      return;
    }
    
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      setLiquidationError("El importe a pagar debe ser mayor que cero");
      return;
    }

    const pending = Math.round(((isLiquidating.total_amount ?? 0) - (isLiquidating.paid_amount ?? 0)) * 100) / 100;
    if (parseFloat(paymentAmount) > pending + 0.01) {
      setLiquidationError(`El importe no puede superar el pendiente (${formatCurrency(pending)})`);
      return;
    }

    setLiquidationError(null);

    const invoicePayments = isMultipleLiquidation 
      ? groupedInvoices
          .filter(inv => selectedInvoicesForBatch.includes(inv.id))
          .map(inv => ({
            invoice_id: inv.id,
            amount_paid: inv.pending
          }))
      : [{
          invoice_id: isLiquidating.id,
          amount_paid: parseFloat(paymentAmount)
        }];

    try {
      const endpoint = isMultipleLiquidation ? "/api/payments/batch" : "/api/payments";
      const body = isMultipleLiquidation 
        ? {
            invoice_payments: invoicePayments,
            payment_date: formattedDate,
            method: paymentMethod,
            bank_movement_id: bankId
          }
        : {
            invoice_id: isLiquidating.id,
            payment_date: formattedDate,
            amount_paid: parseFloat(paymentAmount),
            method: paymentMethod,
            bank_movement_id: bankId
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errorData = await res.json();
        setLiquidationError(errorData.error || "Error al procesar la liquidación");
        return;
      }

      setIsLiquidating(null);
      setIsMultipleLiquidation(false);
      setSelectedInvoicesForBatch([]);
      setPaymentAmount("");
      setBankId("");
      setLiquidationError(null);
      await fetchData();
      await fetchAllMovements();
      if (selectedSupplier && activeCompanyId) {
        try {
          const sRes = await fetch(`/api/suppliers?companyId=${activeCompanyId}`);
          const sData = await sRes.json();
          if (Array.isArray(sData)) {
            const updated = sData.find((s: Supplier) => s.id === selectedSupplier.id);
            if (updated) {
              setSelectedSupplier(updated);
            }
          }
          fetchSupplierDetails(selectedSupplier.id);
        } catch (error) {
          console.error("Error updating selected supplier:", error);
        }
      }
    } catch (err) {
      setLiquidationError("Error de conexión al servidor");
    }
  };

  const handleBatchLiquidate = async () => {
    if (selectedInvoicesForBatch.length === 0) return;

    const displayDate = smartFormatDate(paymentDate);
    let formattedDate = "";
    if (displayDate.includes('/')) {
      const parts = displayDate.split('/');
      if (parts.length === 3) {
        formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) {
      formattedDate = displayDate;
    }
    
    if (!formattedDate || !/^\d{4}-\d{2}-\d{2}$/.test(formattedDate)) {
      setLiquidationError("Fecha de pago no válida (Use DD/MM/YYYY o T)");
      return;
    }
    
    if (!bankId.trim()) {
      setLiquidationError("El Nº de Movimiento de Liquidación es obligatorio");
      return;
    }

    const invoicePayments = groupedInvoices
      .filter(inv => selectedInvoicesForBatch.includes(inv.id))
      .map(inv => ({
        invoice_id: inv.id,
        amount_paid: inv.pending
      }));

    setLiquidationError(null);

    try {
      const res = await fetch("/api/payments/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_payments: invoicePayments,
          payment_date: formattedDate,
          method: paymentMethod,
          bank_movement_id: bankId
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        setLiquidationError(errorData.error || "Error en la liquidación por lotes");
        return;
      }

      setIsBatchLiquidating(false);
      setSelectedInvoicesForBatch([]);
      setPaymentAmount("");
      setBankId("");
      setLiquidationError(null);
      await fetchData();
      await fetchAllMovements();
      if (selectedSupplier && activeCompanyId) {
        fetchSupplierDetails(selectedSupplier.id);
      }
    } catch (err) {
      setLiquidationError("Error de conexión al servidor");
    }
  };

  const handleDeletePayment = async (paymentId: number) => {
    if (!paymentId) return;
    console.log(`Attempting to delete payment with ID: ${paymentId}`);
    try {
      const res = await fetch(`/api/payments/${paymentId}`, {
        method: "DELETE"
      });
      
      if (!res.ok) {
        let errorMessage = "Error al eliminar la liquidación";
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
        } else {
          const textError = await res.text();
          console.error("Server returned non-JSON error:", textError);
          errorMessage = `Error del servidor (${res.status})`;
        }
        throw new Error(errorMessage);
      }

      setIsDeletingPayment(null);
      
      // Refresh all data
      await fetchData();
      await fetchAllMovements();
      
      if (selectedSupplier && activeCompanyId) {
        const sRes = await fetch(`/api/suppliers?companyId=${activeCompanyId}`);
        if (sRes.ok) {
          const sData = await sRes.json();
          if (Array.isArray(sData)) {
            const updated = sData.find((s: Supplier) => s.id === selectedSupplier.id);
            if (updated) {
              setSelectedSupplier(updated);
              fetchSupplierDetails(updated.id);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error deleting payment:", error);
      alert(error instanceof Error ? error.message : "Error al eliminar la liquidación");
    }
  };

  const handleExportHistory = () => {
    const dataToExport = filteredAndSortedInvoices.map(inv => ({
      "DOC (Int)": inv.doc_id || "",
      "DOCEXT (Ext)": inv.doc_ext || "",
      "Proveedor": inv.supplier_name || "",
      "CIF": inv.supplier_cif || "",
      "Fecha": formatDate(inv.issue_date),
      "Total": inv.total_amount || 0,
      "Estado": inv.status === 'Paid' ? 'LIQUIDADA' : inv.status === 'Partial' ? 'PARCIAL' : 'PENDIENTE'
    }));
    
    exportToTSV(dataToExport, `historico_facturas_${format(new Date(), "yyyyMMdd")}`);
  };

  const sortedSuppliers = useMemo(() => {
    const filtered = suppliers.filter(s => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      s.cif.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.id.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return [...filtered].sort((a, b) => {
      const key = sortConfig.key as keyof Supplier;
      const aValue = a[key] ?? "";
      const bValue = b[key] ?? "";

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [suppliers, searchQuery, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#0A0A0A] font-sans flex">
      {/* Sidebar Menu */}
      <aside className="w-64 bg-white border-r border-[#0A0A0A]/10 flex flex-col sticky top-0 h-screen z-40">
        <div className="p-8 border-b border-[#0A0A0A]/10">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 bg-indigo-600 rounded-sm flex items-center justify-center text-white font-bold text-xs">DL</div>
            <h1 className="text-sm font-bold tracking-tighter uppercase text-indigo-600">DocLedger <span className="opacity-30 font-medium">v5.8</span></h1>
          </div>
          <p className="text-[9px] uppercase tracking-[0.2em] opacity-30 font-bold">Accounting System</p>
          
          {/* Company Selector */}
          <div className="mt-6">
            <label className="text-[8px] font-bold uppercase tracking-[0.3em] opacity-20 block mb-2">Compañía Activa</label>
            <select 
              value={activeCompanyId || ""}
              onChange={(e) => setActiveCompanyId(Number(e.target.value))}
              className="w-full bg-[#F5F5F4] border-none rounded-sm px-3 py-2 text-[10px] font-bold uppercase tracking-widest outline-none focus:ring-1 focus:ring-[#0A0A0A]/10"
            >
              {companies.map(company => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <nav className="flex-1 p-4 flex flex-col gap-1">
          <p className="px-4 mb-2 text-[8px] font-bold uppercase tracking-[0.3em] opacity-20">Navegación</p>
          <button 
            onClick={() => setView('suppliers')}
            className={cn(
              "flex items-center gap-3 px-4 py-2 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-all",
              view === 'suppliers' || view === 'supplier-detail' ? "bg-[#0A0A0A] text-white" : "hover:bg-[#F5F5F4] text-[#0A0A0A]/50 hover:text-[#0A0A0A]"
            )}
          >
            <Users size={14} />
            Proveedores
          </button>
          <button 
            onClick={() => setView('upload')}
            className={cn(
              "flex items-center gap-3 px-4 py-2 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-all",
              view === 'upload' ? "bg-violet-600 text-white" : "hover:bg-[#F5F5F4] text-[#0A0A0A]/50 hover:text-[#0A0A0A]"
            )}
          >
            <Upload size={14} />
            Subir Factura
          </button>
          <button 
            onClick={() => {
              setMovementsFilterSupplierId(null);
              setView('movements');
            }}
            className={cn(
              "flex items-center gap-3 px-4 py-2 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-all",
              view === 'movements' ? "bg-[#0A0A0A] text-white" : "hover:bg-[#F5F5F4] text-[#0A0A0A]/50 hover:text-[#0A0A0A]"
            )}
          >
            <History size={14} />
            Movimientos Proveedor
          </button>
          <button 
            onClick={() => setView('history')}
            className={cn(
              "flex items-center gap-3 px-4 py-2 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-all",
              view === 'history' ? "bg-[#0A0A0A] text-white" : "hover:bg-[#F5F5F4] text-[#0A0A0A]/50 hover:text-[#0A0A0A]"
            )}
          >
            <TableIcon size={14} />
            Histórico Facturas
          </button>
        </nav>

        <div className="p-8 border-t border-[#0A0A0A]/10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-[9px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-2">
              <Calendar size={10} />
              Fecha Sistema
            </label>
            <input 
              type="text" 
              value={systemDate}
              onChange={(e) => {
                const val = e.target.value;
                if (val.toLowerCase() === 't') {
                  setSystemDate(format(new Date(), "yyyy-MM-dd"));
                } else {
                  setSystemDate(val);
                }
              }}
              placeholder="YYYY-MM-DD"
              className="w-full bg-transparent border-none p-0 text-sm font-bold tracking-tight outline-none focus:text-blue-600 transition-colors"
            />
          </div>

          <div className="flex flex-col gap-4">
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                "flex items-center gap-3 px-4 py-2 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-all w-full",
                showSettings ? "bg-[#F5F5F4] text-[#0A0A0A]" : "text-[#0A0A0A]/50 hover:text-[#0A0A0A]"
              )}
            >
              <Settings size={14} />
              Configuración
            </button>
            
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[#F5F5F4] rounded-sm flex items-center justify-center text-[10px] font-bold border border-[#0A0A0A]/5">EA</div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-tight">Enrique Asín</p>
                <p className="text-[9px] opacity-40 uppercase tracking-widest">Administrador</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="fixed left-64 top-0 bottom-0 w-80 bg-white border-r border-[#0A0A0A]/10 z-30 shadow-2xl p-8"
          >
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-bold tracking-tighter uppercase">Configuración</h2>
              <button onClick={() => setShowSettings(false)} className="opacity-40 hover:opacity-100"><X size={18} /></button>
            </div>
            
            <div className="space-y-6">
              <div>
                <label className="text-[9px] font-bold uppercase tracking-widest opacity-40 block mb-2">Fecha del Sistema</label>
                <input 
                  type="date" 
                  value={systemDate}
                  onChange={(e) => setSystemDate(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F5F5F4] border-none rounded-sm text-[11px] font-bold outline-none focus:ring-1 focus:ring-[#0A0A0A]/10"
                />
                <p className="text-[9px] mt-2 opacity-40 italic">Esta fecha se usará como referencia para los filtros inteligentes (M, A, etc.)</p>
              </div>

              <div className="pt-6 border-t border-[#0A0A0A]/10">
                <div className="flex justify-between items-center mb-4">
                  <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Gestión de Compañías</label>
                  <button 
                    onClick={() => setIsAddingCompany(!isAddingCompany)}
                    className="text-[9px] font-bold uppercase tracking-widest bg-violet-600 text-white px-2 py-1 rounded-sm hover:opacity-80 transition-opacity"
                  >
                    {isAddingCompany ? "Cancelar" : "Nueva"}
                  </button>
                </div>

                {isAddingCompany && (
                  <div className="bg-[#F5F5F4] p-4 rounded-sm space-y-3 mb-4">
                    <input 
                      type="text" 
                      placeholder="Nombre de la Compañía"
                      value={newCompany.name}
                      onChange={(e) => setNewCompany({...newCompany, name: e.target.value})}
                      className="w-full bg-white border-none px-3 py-2 text-[10px] font-bold outline-none rounded-sm"
                    />
                    <input 
                      type="text" 
                      placeholder="CIF"
                      value={newCompany.cif}
                      onChange={(e) => setNewCompany({...newCompany, cif: e.target.value})}
                      className="w-full bg-white border-none px-3 py-2 text-[10px] font-bold outline-none rounded-sm"
                    />
                    <input 
                      type="text" 
                      placeholder="Dirección"
                      value={newCompany.address}
                      onChange={(e) => setNewCompany({...newCompany, address: e.target.value})}
                      className="w-full bg-white border-none px-3 py-2 text-[10px] font-bold outline-none rounded-sm"
                    />
                    <button 
                      onClick={handleAddCompany}
                      className="w-full bg-[#0A0A0A] text-white py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm hover:opacity-90 transition-opacity"
                    >
                      Guardar Compañía
                    </button>
                  </div>
                )}

                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                  {companies.map(company => (
                    <div key={company.id} className="p-3 bg-[#F5F5F4] rounded-sm border border-[#0A0A0A]/5 group relative">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-tight">{company.name}</p>
                          <p className="text-[9px] opacity-40 uppercase tracking-widest">{company.cif}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {company.is_default === 1 && (
                            <span className="text-[7px] font-bold uppercase tracking-widest bg-[#0A0A0A]/10 px-1 rounded-sm">Default</span>
                          )}
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              initiateDeleteCompany(company);
                            }}
                            className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-all"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        <AnimatePresence mode="wait">
          {view === 'suppliers' && (
            <motion.div 
              key="suppliers"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="max-w-5xl mx-auto"
            >
              <div className="flex justify-between items-end mb-8">
                <div>
                  <h2 className="text-4xl font-bold tracking-tighter">Maestro de Proveedores</h2>
                  <p className="text-xs font-bold uppercase tracking-widest opacity-40">Gestión de Cuentas a Pagar / Ledger de Entidades</p>
                </div>
                <div className="relative w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30" size={14} />
                  <input 
                    type="text" 
                    placeholder="FILTRAR POR NOMBRE, CIF O ID..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white rounded-sm border border-[#0A0A0A]/10 outline-none text-[10px] font-bold uppercase tracking-widest focus:border-[#0A0A0A] transition-all placeholder:opacity-30"
                  />
                </div>
              </div>

              <div className="bg-white border border-[#0A0A0A]/10 rounded-sm overflow-hidden shadow-sm">
                {/* Technical Header */}
                <div className="grid grid-cols-[40px_100px_120px_1fr_120px_140px_120px] border-b border-[#0A0A0A]/10 bg-[#F5F5F4] text-[9px] font-bold uppercase tracking-widest opacity-50">
                  <div className="p-1.5 border-r border-[#0A0A0A]/5"></div>
                  <button onClick={() => handleSort('id')} className="p-1.5 border-r border-[#0A0A0A]/5 text-left hover:bg-[#0A0A0A]/5 transition-colors flex items-center gap-1">
                    Nº Prov. {sortConfig.key === 'id' && (sortConfig.direction === 'asc' ? <ArrowUp size={8} /> : <ArrowDown size={8} />)}
                  </button>
                  <button onClick={() => handleSort('alias')} className="p-1.5 border-r border-[#0A0A0A]/5 text-left hover:bg-[#0A0A0A]/5 transition-colors flex items-center gap-1">
                    Alias {sortConfig.key === 'alias' && (sortConfig.direction === 'asc' ? <ArrowUp size={8} /> : <ArrowDown size={8} />)}
                  </button>
                  <button onClick={() => handleSort('name')} className="p-1.5 border-r border-[#0A0A0A]/5 text-left hover:bg-[#0A0A0A]/5 transition-colors flex items-center gap-1">
                    Nombre Fiscal {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? <ArrowUp size={8} /> : <ArrowDown size={8} />)}
                  </button>
                  <button onClick={() => handleSort('cif')} className="p-1.5 border-r border-[#0A0A0A]/5 text-left hover:bg-[#0A0A0A]/5 transition-colors flex items-center gap-1">
                    CIF/NIF {sortConfig.key === 'cif' && (sortConfig.direction === 'asc' ? <ArrowUp size={8} /> : <ArrowDown size={8} />)}
                  </button>
                  <button onClick={() => handleSort('city')} className="p-1.5 border-r border-[#0A0A0A]/5 text-left hover:bg-[#0A0A0A]/5 transition-colors flex items-center gap-1">
                    Población {sortConfig.key === 'city' && (sortConfig.direction === 'asc' ? <ArrowUp size={8} /> : <ArrowDown size={8} />)}
                  </button>
                  <button onClick={() => handleSort('pending_balance')} className="p-1.5 text-right hover:bg-[#0A0A0A]/5 transition-colors flex items-center justify-end gap-1">
                    Saldo (EUR) {sortConfig.key === 'pending_balance' && (sortConfig.direction === 'asc' ? <ArrowUp size={8} /> : <ArrowDown size={8} />)}
                  </button>
                </div>

                <div className="divide-y divide-[#0A0A0A]/5">
                  {sortedSuppliers.map(s => (
                    <button 
                      key={s.id}
                      onClick={() => {
                        setSelectedSupplier(s);
                        fetchSupplierDetails(s.id);
                        setView('supplier-detail');
                      }}
                      className="grid grid-cols-[40px_100px_120px_1fr_120px_140px_120px] w-full text-left hover:bg-[#0A0A0A] hover:text-white transition-colors group"
                    >
                      <div className="p-1.5 border-r border-[#0A0A0A]/5 flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <ChevronRight size={14} />
                      </div>
                      <div className="p-1.5 border-r border-[#0A0A0A]/5 font-mono text-[11px] flex items-center">{s.id}</div>
                      <div className="p-1.5 border-r border-[#0A0A0A]/5 font-bold text-[10px] flex items-center truncate uppercase tracking-tight">{s.alias || "---"}</div>
                      <div className="p-1.5 border-r border-[#0A0A0A]/5 font-bold text-xs flex items-center truncate">{toTitleCase(s.name)}</div>
                      <div className="p-1.5 border-r border-[#0A0A0A]/5 font-mono text-[11px] flex items-center">{s.cif}</div>
                      <div className="p-1.5 border-r border-[#0A0A0A]/5 text-[11px] flex items-center truncate opacity-60 group-hover:opacity-100 uppercase font-medium">{s.city || "---"}</div>
                      <div className={cn(
                        "p-1.5 text-right font-mono text-[11px] flex items-center justify-end font-bold",
                        s.pending_balance > 0 ? "text-red-600 group-hover:text-red-400" : "text-emerald-600 group-hover:text-emerald-400"
                      )}>
                        {formatCurrency(s.pending_balance ?? 0)}
                      </div>
                    </button>
                  ))}
                </div>
                
                {sortedSuppliers.length === 0 && (
                  <div className="p-20 text-center opacity-20 flex flex-col items-center">
                    <Search size={48} strokeWidth={1} className="mb-4" />
                    <p className="text-xs font-bold uppercase tracking-widest">No se han encontrado registros coincidentes</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'supplier-detail' && selectedSupplier && (
            <motion.div 
              key="detail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-6xl mx-auto"
            >
              <div className="flex items-center gap-4 mb-8">
                <button 
                  onClick={() => setView('suppliers')}
                  className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm hover:bg-[#F5F5F4] transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
                <div>
                  <h2 className="text-3xl font-bold tracking-tighter">{selectedSupplier.name}</h2>
                  <p className="text-xs font-bold uppercase tracking-widest opacity-40">Ficha de Proveedor / {selectedSupplier.id}</p>
                </div>
              </div>

              <div className="bg-white border border-[#0A0A0A]/10 rounded-sm overflow-hidden shadow-sm mb-8">
                {/* ERP Style Tabs */}
                <div className="flex bg-[#F5F5F4] border-b border-[#0A0A0A]/10 px-1 pt-1">
                  {['General', 'Comunicación', 'Facturación', 'Pagos', 'Envíos', 'Internacional', 'Precios'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab as any)}
                      className={cn(
                        "px-4 py-2 text-[9px] font-bold uppercase tracking-widest transition-all border-t border-x rounded-t-sm",
                        activeTab === tab 
                          ? "bg-white border-[#0A0A0A]/10 text-[#0A0A0A] -mb-[1px]" 
                          : "bg-transparent border-transparent text-[#0A0A0A]/30 hover:text-[#0A0A0A]/60"
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="p-8">
                  {activeTab === 'General' && (
                    <div className="grid grid-cols-2 gap-x-12 gap-y-6">
                      {/* Left Column */}
                      <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Nº . . . . . . . . . . .</label>
                          <div className="flex gap-1">
                            <input readOnly value={selectedSupplier.id} className="flex-1 px-2 py-1.5 bg-[#F5F5F4] rounded-sm border-none outline-none font-mono text-[11px]" />
                            <button className="p-1.5 bg-[#F5F5F4] rounded-sm hover:bg-[#E4E3E0]"><Search size={12} /></button>
                          </div>
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Nombre. . . . . . . .</label>
                          <input readOnly value={toTitleCase(selectedSupplier.name)} className="px-2 py-1.5 bg-[#F5F5F4] rounded-sm border-none outline-none font-bold text-[11px] uppercase" />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Nombre 2. . . . . . .</label>
                          <input readOnly value={selectedSupplier.name2 || ""} className="px-2 py-1.5 bg-[#F5F5F4] rounded-sm border-none outline-none text-[11px]" />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Dirección . . . . . .</label>
                          <input readOnly value={selectedSupplier.address} className="px-2 py-1.5 bg-[#F5F5F4] rounded-sm border-none outline-none text-[11px]" />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Dirección 2 . . . . .</label>
                          <input readOnly value={selectedSupplier.address2 || ""} className="px-2 py-1.5 bg-[#F5F5F4] rounded-sm border-none outline-none text-[11px]" />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">C.P. +Población . .</label>
                          <div className="flex gap-1">
                            <input readOnly value={selectedSupplier.zip_code || ""} className="w-16 px-2 py-1.5 bg-[#F5F5F4] rounded-sm border-none outline-none text-[11px]" />
                            <input readOnly value={selectedSupplier.city || ""} className="flex-1 px-2 py-1.5 bg-[#F5F5F4] rounded-sm border-none outline-none text-[11px]" />
                          </div>
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">CIF/NIF. . . . . . . . .</label>
                          <input readOnly value={selectedSupplier.cif} className="px-2 py-1.5 bg-[#F5F5F4] rounded-sm border-none outline-none font-mono text-[11px]" />
                        </div>
                      </div>

                      {/* Right Column */}
                      <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Alias . . . . . . . . . .</label>
                          <input 
                            value={selectedSupplier.alias || ""} 
                            onChange={(e) => handleUpdateAlias(selectedSupplier.id, e.target.value)}
                            className="px-2 py-1.5 bg-white border border-[#0A0A0A]/10 rounded-sm outline-none font-bold text-[11px] uppercase tracking-tight focus:ring-1 focus:ring-violet-600/20" 
                          />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Saldo (DL) . . . . . .</label>
                          <button 
                            onClick={() => {
                              setMovementsFilterSupplierId(selectedSupplier.id);
                              setSearchQuery(""); // Clear search when navigating to specific supplier
                              fetchSupplierDetails(selectedSupplier.id);
                              setView('movements');
                            }}
                            className="px-2 py-1.5 bg-[#F5F5F4] rounded-sm text-right font-mono font-bold text-[11px] hover:bg-[#E4E3E0] transition-colors border-none outline-none text-red-600"
                          >
                            {formatCurrency(selectedSupplier.pending_balance ?? 0)}
                          </button>
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Bloqueado . . . . . .</label>
                          <div className="px-2 py-1.5 bg-[#F5F5F4] rounded-sm text-[10px] opacity-40 italic">No bloqueado</div>
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Últ. modif. . . . . . .</label>
                          <input readOnly value={formatDate(new Date().toISOString())} className="px-2 py-1.5 bg-[#F5F5F4] rounded-sm border-none outline-none text-[11px] opacity-40" />
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'Facturación' && (
                    <div className="flex flex-col gap-6">
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-bold uppercase tracking-widest opacity-60">Facturas Pendientes</h3>
                        {selectedInvoicesForBatch.length > 0 && (
                          <button 
                            onClick={() => {
                              const total = groupedInvoices
                                .filter(inv => selectedInvoicesForBatch.includes(inv.id))
                                .reduce((sum, inv) => sum + inv.pending, 0);
                              setPaymentAmount(total.toFixed(2));
                              setIsBatchLiquidating(true);
                            }}
                            className="px-4 py-2 bg-[#0A0A0A] text-white rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-[#1A1A1A] transition-colors flex items-center gap-2"
                          >
                            <Euro size={14} />
                            Liquidar Seleccionadas ({selectedInvoicesForBatch.length})
                          </button>
                        )}
                      </div>

                      <div className="border border-[#0A0A0A]/10 rounded-sm overflow-hidden">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-[#F5F5F4] text-[9px] font-bold uppercase tracking-widest opacity-50">
                            <tr>
                              <th className="p-1 border-r border-[#0A0A0A]/5 w-10">
                                <input 
                                  type="checkbox"
                                  checked={selectedInvoicesForBatch.length === groupedInvoices.filter(inv => inv.supplier_id === selectedSupplier.id && inv.pending > 0).length && groupedInvoices.filter(inv => inv.supplier_id === selectedSupplier.id && inv.pending > 0).length > 0}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedInvoicesForBatch(groupedInvoices.filter(inv => inv.supplier_id === selectedSupplier.id && inv.pending > 0).map(inv => inv.id));
                                    } else {
                                      setSelectedInvoicesForBatch([]);
                                    }
                                  }}
                                />
                              </th>
                              <th className="p-1 border-r border-[#0A0A0A]/5">Fecha</th>
                              <th className="p-1 border-r border-[#0A0A0A]/5">Referencia</th>
                              <th className="p-1 border-r border-[#0A0A0A]/5 text-right">Total</th>
                              <th className="p-1 text-right">Pendiente</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#0A0A0A]/5">
                            {groupedInvoices
                              .filter(inv => inv.supplier_id === selectedSupplier.id && inv.pending > 0)
                              .map(inv => (
                                <tr key={inv.id} className="hover:bg-[#F5F5F4]/50 transition-colors">
                                  <td className="p-1 border-r border-[#0A0A0A]/5">
                                    <input 
                                      type="checkbox"
                                      checked={selectedInvoicesForBatch.includes(inv.id)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedInvoicesForBatch(prev => [...prev, inv.id]);
                                        } else {
                                          setSelectedInvoicesForBatch(prev => prev.filter(id => id !== inv.id));
                                        }
                                      }}
                                    />
                                  </td>
                                  <td className="p-1 border-r border-[#0A0A0A]/5 text-[10px]">{formatDate(inv.date)}</td>
                                  <td className="p-1 border-r border-[#0A0A0A]/5 text-[10px] font-bold">{inv.reference}</td>
                                  <td className="p-1 border-r border-[#0A0A0A]/5 text-[10px] text-right font-mono">{formatCurrency(inv.amount)}</td>
                                  <td className="p-1 text-[10px] text-right font-mono text-red-600 font-bold">{formatCurrency(inv.pending)}</td>
                                </tr>
                              ))}
                            {groupedInvoices.filter(inv => inv.supplier_id === selectedSupplier.id && inv.pending > 0).length === 0 && (
                              <tr>
                                <td colSpan={5} className="p-8 text-center text-[10px] opacity-40 italic">No hay facturas pendientes</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {activeTab !== 'General' && activeTab !== 'Facturación' && (
                    <div className="p-12 text-center border border-dashed border-[#0A0A0A]/10 rounded-sm">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-30">Sección en desarrollo: {activeTab}</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {view === 'movements' && (
            <motion.div 
              key="movements"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-6xl mx-auto"
            >
              <div className="flex justify-between items-end mb-8">
                <div>
                  <h2 className="text-4xl font-bold tracking-tighter">Movimientos Proveedor</h2>
                  <p className="text-xs font-bold uppercase tracking-widest opacity-40">
                    {movementsFilterSupplierId 
                      ? `Filtrado por: [${movementsFilterSupplierId}] ${suppliers.find(s => s.id === movementsFilterSupplierId)?.name}` 
                      : "Todos los movimientos registrados"}
                  </p>
                </div>
                <div className="flex gap-3 items-end">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Proveedor</label>
                    <select 
                      value={movementsFilterSupplierId || "All"}
                      onChange={(e) => {
                        const val = e.target.value === "All" ? null : e.target.value;
                        setMovementsFilterSupplierId(val);
                        setSearchQuery(""); // Clear search when changing supplier
                        if (val) fetchSupplierDetails(val);
                        else fetchAllMovements();
                      }}
                      className="px-3 py-2 bg-white border border-[#0A0A0A]/10 rounded-sm text-[10px] font-bold uppercase tracking-widest outline-none focus:border-[#0A0A0A] transition-all w-48"
                    >
                      <option value="All">TODOS LOS PROVEEDORES</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.id} - {s.name.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Filtro Fecha (D, M, A, T, D-M..)</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30" size={14} />
                      <input 
                        type="text" 
                        placeholder="Ej: T, M, 15..M4"
                        value={movementDateFilter}
                        onChange={(e) => setMovementDateFilter(e.target.value)}
                        className="pl-10 pr-4 py-2 bg-white border border-[#0A0A0A]/10 rounded-sm text-[10px] font-bold outline-none focus:border-[#0A0A0A] transition-all w-48"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30" size={14} />
                      <input 
                        type="text" 
                        placeholder="BUSCAR (DOC, PROV, ESTADO...)" 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-white rounded-sm border border-[#0A0A0A]/10 outline-none text-[10px] font-bold uppercase tracking-widest focus:border-[#0A0A0A] transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-[#0A0A0A]/10 rounded-sm overflow-hidden shadow-sm">
                <div className="grid grid-cols-[100px_100px_100px_1fr_100px_100px_100px_60px_40px] border-b border-[#0A0A0A]/10 bg-[#F5F5F4] text-[9px] font-bold uppercase tracking-widest opacity-50">
                  <div 
                    onClick={() => handleMovementSort('date')}
                    className="p-1 border-r border-[#0A0A0A]/5 cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                  >
                    Fecha <SortIcon field="date" currentField={movementSortField} direction={movementSortDirection} />
                  </div>
                  <div 
                    onClick={() => handleMovementSort('doc_id')}
                    className="p-1 border-r border-[#0A0A0A]/5 cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                  >
                    DOC (Int) <SortIcon field="doc_id" currentField={movementSortField} direction={movementSortDirection} />
                  </div>
                  <div 
                    onClick={() => handleMovementSort('type')}
                    className="p-1 border-r border-[#0A0A0A]/5 cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                  >
                    Tipo <SortIcon field="type" currentField={movementSortField} direction={movementSortDirection} />
                  </div>
                  <div 
                    onClick={() => handleMovementSort('supplier_name')}
                    className="p-1 border-r border-[#0A0A0A]/5 cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                  >
                    Proveedor / Referencia <SortIcon field="supplier_name" currentField={movementSortField} direction={movementSortDirection} />
                  </div>
                  <div 
                    onClick={() => handleMovementSort('amount')}
                    className="p-1 border-r border-[#0A0A0A]/5 text-right cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                  >
                    Imp. Inicial <SortIcon field="amount" currentField={movementSortField} direction={movementSortDirection} />
                  </div>
                  <div 
                    onClick={() => handleMovementSort('pending')}
                    className="p-1 border-r border-[#0A0A0A]/5 text-right cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                  >
                    Imp. Pdte. <SortIcon field="pending" currentField={movementSortField} direction={movementSortDirection} />
                  </div>
                  <div 
                    onClick={() => handleMovementSort('status')}
                    className="p-1 border-r border-[#0A0A0A]/5 text-center cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                  >
                    Estado <SortIcon field="status" currentField={movementSortField} direction={movementSortDirection} />
                  </div>
                  <div className="p-1 border-r border-[#0A0A0A]/5 text-center">Liqs.</div>
                  <div className="p-1 text-center">Acc.</div>
                </div>

                <div className="divide-y divide-[#0A0A0A]/5">
                  {groupedInvoices.map(inv => {
                    const isExpanded = expandedInvoiceId === inv.doc_id;

                    return (
                      <React.Fragment key={`group-${inv.id}`}>
                          <div 
                            onClick={() => setExpandedInvoiceId(isExpanded ? null : (inv.doc_id || null))}
                            className={cn(
                              "grid grid-cols-[100px_100px_100px_1fr_100px_100px_100px_60px_40px] w-full bg-white hover:bg-[#F5F5F4]/50 transition-colors text-left cursor-pointer",
                              isExpanded && "bg-[#F5F5F4]/30"
                            )}
                          >
                            <div className="p-1 border-r border-[#0A0A0A]/5 text-[10px] flex items-center">{formatDate(inv.date)}</div>
                            <div className="p-1 border-r border-[#0A0A0A]/5 font-mono text-[10px] flex items-center">{inv.doc_id}</div>
                            <div className="p-1 border-r border-[#0A0A0A]/5 flex items-center justify-center">
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] font-bold uppercase tracking-widest rounded-full">Factura</span>
                            </div>
                            <div className="p-1 border-r border-[#0A0A0A]/5 text-[10px] flex items-center truncate uppercase tracking-tight font-bold">
                              {inv.supplier_alias || inv.supplier_name}
                            </div>
                            <div className="p-1 border-r border-[#0A0A0A]/5 text-right font-mono text-[10px] flex items-center justify-end">
                              {formatCurrency(inv.amount)}
                            </div>
                            <div className={cn(
                              "p-1 border-r border-[#0A0A0A]/5 text-right font-mono text-[10px] flex items-center justify-end",
                              inv.pending > 0 ? "text-red-600 font-bold" : "text-emerald-600 opacity-40"
                            )}>
                              {formatCurrency(inv.pending)}
                            </div>
                            <div className="p-1 border-r border-[#0A0A0A]/5 flex items-center justify-center">
                              <span className={cn(
                                "px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded-full",
                                inv.status === 'LIQUIDADA' ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                              )}>
                                {inv.status}
                              </span>
                            </div>
                            <div className="p-1 text-center text-[10px] font-bold opacity-40 flex items-center justify-center gap-1">
                              {inv.payments.length > 0 ? (
                                <>
                                  <CreditCard size={10} />
                                  {inv.payments.length}
                                </>
                              ) : "-"}
                            </div>
                            <div className="p-1 flex items-center justify-center">
                              {inv.pending > 0 && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setIsLiquidating({
                                      id: inv.id,
                                      invoice_number: inv.reference,
                                      doc_id: inv.doc_id || "",
                                      supplier_id: inv.supplier_id || "",
                                      total_amount: inv.amount,
                                      paid_amount: inv.amount - inv.pending
                                    });
                                    setIsMultipleLiquidation(false);
                                    setSelectedInvoicesForBatch([inv.id]);
                                    setPaymentAmount(inv.pending.toFixed(2));
                                  }}
                                  className="p-1 bg-[#0A0A0A] text-white rounded-sm hover:bg-[#1A1A1A] transition-colors"
                                  title="Liquidar Factura"
                                >
                                  <Euro size={12} />
                                </button>
                              )}
                            </div>
                          </div>

                          <AnimatePresence>
                            {isExpanded && inv.payments.length > 0 && (
                              <motion.div 
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden bg-[#F5F5F4]/20"
                              >
                                {inv.payments.map(p => (
                                  <div key={`pay-${p.id}`} className="grid grid-cols-[100px_100px_100px_1fr_100px_100px_100px_60px_40px] w-full text-[#0A0A0A]/60 italic border-b border-[#0A0A0A]/5 last:border-b-0">
                                    <div className="p-1 pl-6 border-r border-[#0A0A0A]/5 text-[9px] flex items-center">{formatDate(p.date)}</div>
                                    <div className="p-1 border-r border-[#0A0A0A]/5 font-mono text-[9px] flex items-center opacity-40">{p.doc_id}</div>
                                    <div className="p-1 border-r border-[#0A0A0A]/5 flex items-center justify-center">
                                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[8px] font-bold uppercase tracking-widest rounded-full">Liquidación</span>
                                    </div>
                                    <div className="p-1 border-r border-[#0A0A0A]/5 text-[9px] flex items-center truncate uppercase tracking-widest">
                                      <ArrowRight size={10} className="mr-2 opacity-40" />
                                      LIQ: {p.bank_movement_id || p.reference}
                                    </div>
                                    <div className="p-1 border-r border-[#0A0A0A]/5 text-right font-mono text-[9px] flex items-center justify-end opacity-20">---</div>
                                    <div className="p-1 border-r border-[#0A0A0A]/5 text-right font-mono text-[9px] flex items-center justify-end text-blue-600 font-bold">
                                      {formatCurrency(p.amount)}
                                    </div>
                                    <div className="p-1 border-r border-[#0A0A0A]/5 text-center text-[9px] opacity-20">---</div>
                                    <div className="p-1 border-r border-[#0A0A0A]/5 text-center text-[9px] opacity-20">---</div>
                                    <div className="p-1 text-center text-[9px] flex items-center justify-center">
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setIsDeletingPayment(p.id);
                                        }}
                                        className="text-red-600 hover:text-red-800 transition-colors"
                                        title="Eliminar Liquidación"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </React.Fragment>
                      );
                  })}
                </div>
              </div>
            </motion.div>
          )}

          {view === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-6xl mx-auto"
            >
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-4xl font-bold tracking-tighter">Histórico de Facturas</h2>
                  <p className="text-xs font-bold uppercase tracking-widest opacity-40">Registro global de todas las facturas procesadas.</p>
                </div>
                <div className="flex gap-3 items-end">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Proveedor</label>
                    <select 
                      value={historySupplierFilter}
                      onChange={(e) => setHistorySupplierFilter(e.target.value)}
                      className="px-3 py-2 bg-white border border-[#0A0A0A]/10 rounded-sm text-[10px] font-bold uppercase tracking-widest outline-none focus:border-[#0A0A0A] transition-all"
                    >
                      <option value="All">Todos los proveedores</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Filtro Fecha (D, D-M, D-M-Y, A, M, M1..M3)</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30" size={14} />
                      <input 
                        type="text" 
                        placeholder="Ej: 5, 3-2, A, M1..M3"
                        value={historyDateFilter}
                        onChange={(e) => setHistoryDateFilter(e.target.value)}
                        className="pl-10 pr-4 py-2 bg-white border border-[#0A0A0A]/10 rounded-sm text-[10px] font-bold outline-none focus:border-[#0A0A0A] transition-all w-64"
                      />
                    </div>
                  </div>
                  <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30" size={14} />
                    <input 
                      type="text" 
                      placeholder="BUSCAR EN HISTÓRICO..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-white rounded-sm border border-[#0A0A0A]/10 outline-none text-[10px] font-bold uppercase tracking-widest focus:border-[#0A0A0A] transition-all"
                    />
                  </div>
                  <button 
                    onClick={() => fetchData()} 
                    className="px-6 py-2 bg-[#0A0A0A] text-white rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-[#1A1A1A] transition-all flex items-center gap-2"
                  >
                    <Filter size={14} />
                    Filtrar
                  </button>
                  <button 
                    onClick={handleExportHistory} 
                    className="px-6 py-2 bg-emerald-600 text-white rounded-sm text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all flex items-center gap-2"
                  >
                    <Download size={14} />
                    Exportar TSV
                  </button>
                </div>
              </div>

              <div className="bg-white border border-[#0A0A0A]/10 rounded-sm overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#F5F5F4] border-b border-[#0A0A0A]/10">
                        <th 
                          onClick={() => handleInvoiceSort('doc_id')}
                          className="p-1 text-[9px] font-bold uppercase tracking-widest opacity-40 border-r border-[#0A0A0A]/5 cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                        >
                          DOC (Int) <SortIcon field="doc_id" currentField={invoiceSortField} direction={invoiceSortDirection} />
                        </th>
                        <th 
                          onClick={() => handleInvoiceSort('doc_ext')}
                          className="p-1 text-[9px] font-bold uppercase tracking-widest opacity-40 border-r border-[#0A0A0A]/5 cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                        >
                          DOCEXT (Ext) <SortIcon field="doc_ext" currentField={invoiceSortField} direction={invoiceSortDirection} />
                        </th>
                        <th 
                          onClick={() => handleInvoiceSort('supplier_name')}
                          className="p-1 text-[9px] font-bold uppercase tracking-widest opacity-40 border-r border-[#0A0A0A]/5 cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                        >
                          Proveedor <SortIcon field="supplier_name" currentField={invoiceSortField} direction={invoiceSortDirection} />
                        </th>
                        <th 
                          onClick={() => handleInvoiceSort('issue_date')}
                          className="p-1 text-[9px] font-bold uppercase tracking-widest opacity-40 border-r border-[#0A0A0A]/5 cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                        >
                          Fecha <SortIcon field="issue_date" currentField={invoiceSortField} direction={invoiceSortDirection} />
                        </th>
                        <th 
                          onClick={() => handleInvoiceSort('total_amount')}
                          className="p-1 text-[9px] font-bold uppercase tracking-widest opacity-40 border-r border-[#0A0A0A]/5 text-right cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                        >
                          Total <SortIcon field="total_amount" currentField={invoiceSortField} direction={invoiceSortDirection} />
                        </th>
                        <th 
                          onClick={() => handleInvoiceSort('status')}
                          className="p-1 text-[9px] font-bold uppercase tracking-widest opacity-40 text-center cursor-pointer hover:bg-[#0A0A0A]/5 transition-colors"
                        >
                          Estado <SortIcon field="status" currentField={invoiceSortField} direction={invoiceSortDirection} />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#0A0A0A]/5">
                      {filteredAndSortedInvoices.map(inv => (
                        <tr key={inv.id} className="hover:bg-[#F5F5F4]/50 transition-colors group">
                          <td className="p-1 border-r border-[#0A0A0A]/5 font-mono text-[10px] font-bold">{inv.doc_id || "-"}</td>
                          <td className="p-1 border-r border-[#0A0A0A]/5 font-mono text-[10px]">{inv.doc_ext || "-"}</td>
                          <td className="p-1 border-r border-[#0A0A0A]/5">
                            <button 
                              onClick={() => {
                                const supplier = suppliers.find(s => s.id === inv.supplier_id);
                                if (supplier) {
                                  setSelectedSupplier(supplier);
                                  fetchSupplierDetails(supplier.id);
                                  setView('supplier-detail');
                                }
                              }}
                              className="flex flex-col text-left hover:underline"
                            >
                              <span className="font-bold text-[11px] tracking-tight">{toTitleCase(inv.supplier_name || "")}</span>
                              <span className="text-[9px] opacity-40 font-bold uppercase tracking-widest">{inv.supplier_alias}</span>
                            </button>
                          </td>
                          <td className="p-1 border-r border-[#0A0A0A]/5 text-[10px] opacity-60">{formatDate(inv.issue_date)}</td>
                          <td className="p-1 border-r border-[#0A0A0A]/5 font-mono text-[11px] font-bold text-right">{formatCurrency(inv.total_amount ?? 0)}</td>
                          <td className="p-1 text-center">
                            <span className={cn(
                              "text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm",
                              inv.status === 'Paid' ? "bg-emerald-50 text-emerald-600" : 
                              inv.status === 'Partial' ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"
                            )}>
                              {inv.status === 'Paid' ? 'LIQUIDADA' : 
                               inv.status === 'Partial' ? 'PARCIAL' : 'PENDIENTE'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'upload' && (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto"
            >
              <div className="mb-12">
                <h2 className="text-4xl font-bold tracking-tighter">Alta de Facturas</h2>
                <p className="text-sm opacity-40 font-medium">Sube múltiples facturas. El sistema las clasificará automáticamente.</p>
              </div>

              <div className="bg-white p-12 rounded-[40px] border border-[#0A0A0A]/5 shadow-sm flex flex-col items-center gap-8">
                <label 
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e)}
                  className={cn(
                    "flex flex-col items-center justify-center w-full h-80 border-2 border-dashed rounded-[32px] cursor-pointer transition-all group",
                    isDragging ? "border-[#0A0A0A] bg-[#F5F5F4] scale-[1.01]" : "border-[#0A0A0A]/10 hover:bg-[#F5F5F4] hover:border-[#0A0A0A]/20"
                  )}
                >
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    {isUploading ? (
                      <Loader2 size={64} className="animate-spin mb-6 text-[#0A0A0A]" />
                    ) : (
                      <div className="w-20 h-20 bg-[#0A0A0A] rounded-3xl flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform">
                        <FileUp size={32} />
                      </div>
                    )}
                    <p className="mb-2 text-xl font-bold tracking-tight">
                      {isUploading ? "Procesando facturas..." : "Arrastra tus facturas aquí"}
                    </p>
                    <p className="text-sm opacity-40 font-medium">Puedes subir hasta 15 facturas a la vez</p>
                  </div>
                  <input 
                    type="file" 
                    className="hidden" 
                    multiple 
                    onChange={(e) => handleFileUpload(e)} 
                    accept="image/*,application/pdf" 
                  />
                </label>

                <div className="grid grid-cols-3 gap-6 w-full">
                  <div className="p-6 bg-[#F5F5F4] rounded-2xl flex flex-col gap-2">
                    <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                      <Search size={16} className="opacity-40" />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-widest opacity-40">Escaneo OCR</p>
                    <p className="text-sm font-medium leading-tight">Extracción automática de CIF, importes y fechas.</p>
                  </div>
                  <div className="p-6 bg-[#F5F5F4] rounded-2xl flex flex-col gap-2">
                    <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                      <Building2 size={16} className="opacity-40" />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-widest opacity-40">Clasificación</p>
                    <p className="text-sm font-medium leading-tight">Asignación inteligente al proveedor correspondiente.</p>
                  </div>
                  <div className="p-6 bg-[#F5F5F4] rounded-2xl flex flex-col gap-2">
                    <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                      <UserPlus size={16} className="opacity-40" />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-widest opacity-40">Nuevos Proveedores</p>
                    <p className="text-sm font-medium leading-tight">Propuesta de alta si el CIF no existe en el sistema.</p>
                  </div>
                </div>

                {uploadLog.length > 0 && (
                  <div className="w-full mt-4 bg-[#0A0A0A] rounded-2xl p-6 font-mono text-[10px] leading-relaxed overflow-hidden border border-white/10 shadow-2xl">
                    <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <p className="text-green-500 font-bold tracking-widest uppercase">System Log // Matrix Protocol</p>
                    </div>
                    <div className="max-h-64 overflow-y-auto custom-scrollbar flex flex-col gap-1">
                      {uploadLog.map((log, idx) => (
                        <div key={idx} className="flex gap-3">
                          <span className="text-white/30 shrink-0">[{log.timestamp}]</span>
                          <span className={cn(
                            "font-bold shrink-0 w-20",
                            log.type === 'SUCCESS' ? "text-green-400" :
                            log.type === 'ERROR' ? "text-red-400" :
                            log.type === 'DUPLICATE' ? "text-yellow-400" :
                            "text-blue-400"
                          )}>
                            {log.type}
                          </span>
                          <span className="text-white/80">{log.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals (Proposal & Liquidation) */}
      <AnimatePresence>
        {proposal && (
          <div className="fixed inset-0 bg-[#0A0A0A]/60 backdrop-blur-md flex items-center justify-center p-6 z-50">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden"
            >
              <div className="p-8 bg-[#0A0A0A] text-white flex items-center gap-4">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                  <UserPlus size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-bold tracking-tight">Nuevo Proveedor Detectado</h3>
                  <p className="text-xs opacity-60 uppercase tracking-widest font-semibold">CIF {proposal.cif} no registrado</p>
                </div>
              </div>
              <div className="p-8 flex flex-col gap-6">
                {uploadError && (
                  <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600">
                    <AlertCircle size={20} />
                    <p className="text-sm font-medium">{uploadError}</p>
                  </div>
                )}
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-30 mb-1 block">Nombre Fiscal</label>
                    <input 
                      type="text" 
                      value={proposal.name}
                      onChange={(e) => setProposal({...proposal, name: e.target.value})}
                      className="w-full px-4 py-3 bg-[#F5F5F4] rounded-xl border-none outline-none font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-30 mb-1 block">CIF/NIF</label>
                    <input 
                      type="text" 
                      value={proposal.cif}
                      readOnly
                      className="w-full px-4 py-3 bg-[#F5F5F4] rounded-xl border-none outline-none opacity-50 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-30 mb-1 block">Email</label>
                    <input 
                      type="text" 
                      value={proposal.email}
                      onChange={(e) => setProposal({...proposal, email: e.target.value})}
                      className="w-full px-4 py-3 bg-[#F5F5F4] rounded-xl border-none outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button 
                    onClick={() => setProposal(null)}
                    className="flex-1 py-4 bg-[#F5F5F4] rounded-2xl font-bold text-sm hover:bg-[#E4E3E0] transition-colors"
                  >
                    Descartar
                  </button>
                  <button 
                    onClick={handleCreateSupplier}
                    disabled={isUploading}
                    className="flex-2 py-4 bg-[#0A0A0A] text-white rounded-2xl font-bold text-sm hover:scale-[1.02] transition-transform shadow-lg shadow-black/10 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Procesando...
                      </>
                    ) : (
                      "Dar de Alta y Asociar"
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isLiquidating && (
          <div className="fixed inset-0 bg-[#0A0A0A]/60 backdrop-blur-md flex items-center justify-center p-6 z-50">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-sm w-full max-w-lg shadow-2xl overflow-hidden border border-[#0A0A0A]/10"
            >
              <div className="p-6 bg-[#0A0A0A] text-white flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white/10 rounded-sm flex items-center justify-center">
                    <CreditCard size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold tracking-tight uppercase">Liquidar Factura</h3>
                    <div className="flex gap-2 items-center">
                      <p className="text-[10px] opacity-60 uppercase tracking-widest font-bold">DOC: {isLiquidating.doc_id}</p>
                      <span className="w-1 h-1 bg-white/20 rounded-full" />
                      <p className="text-[10px] opacity-60 uppercase tracking-widest font-bold">REF: {isLiquidating.invoice_number}</p>
                    </div>
                  </div>
                </div>
                <button onClick={() => setIsLiquidating(null)} className="opacity-40 hover:opacity-100 transition-opacity"><X size={20} /></button>
              </div>
              <div className="p-6 flex flex-col gap-6">
                {/* Type Selection */}
                <div className="flex gap-4 p-1 bg-[#F5F5F4] rounded-sm">
                  <button 
                    onClick={() => {
                      setIsMultipleLiquidation(false);
                      setSelectedInvoicesForBatch([isLiquidating.id]);
                      setPaymentAmount((isLiquidating.total_amount - isLiquidating.paid_amount).toFixed(2));
                    }}
                    className={cn(
                      "flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all flex items-center justify-center gap-2",
                      !isMultipleLiquidation ? "bg-white shadow-sm text-[#0A0A0A]" : "text-[#0A0A0A]/40 hover:text-[#0A0A0A]/60"
                    )}
                  >
                    <div className={cn("w-2 h-2 rounded-full", !isMultipleLiquidation ? "bg-violet-600" : "bg-transparent border border-[#0A0A0A]/20")} />
                    Liquidación Simple
                  </button>
                  <button 
                    onClick={() => {
                      setIsMultipleLiquidation(true);
                      // Ensure paymentAmount is correct for the current selection
                      const total = groupedInvoices.filter(i => selectedInvoicesForBatch.includes(i.id)).reduce((sum, i) => sum + i.pending, 0);
                      setPaymentAmount(total.toFixed(2));
                    }}
                    className={cn(
                      "flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all flex items-center justify-center gap-2",
                      isMultipleLiquidation ? "bg-white shadow-sm text-[#0A0A0A]" : "text-[#0A0A0A]/40 hover:text-[#0A0A0A]/60"
                    )}
                  >
                    <div className={cn("w-2 h-2 rounded-full", isMultipleLiquidation ? "bg-violet-600" : "bg-transparent border border-[#0A0A0A]/20")} />
                    Liquidación Múltiple
                  </button>
                </div>

                {isMultipleLiquidation && (
                  <div className="flex flex-col gap-3">
                    <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Seleccionar Facturas Pendientes</label>
                    <div className="max-h-[200px] overflow-y-auto border border-[#0A0A0A]/5 rounded-sm divide-y divide-[#0A0A0A]/5">
                      {groupedInvoices
                        .filter(inv => inv.supplier_id === isLiquidating.supplier_id && inv.pending > 0)
                        .map(inv => (
                          <div 
                            key={inv.id} 
                            className={cn(
                              "p-3 flex items-center justify-between cursor-pointer transition-colors",
                              selectedInvoicesForBatch.includes(inv.id) ? "bg-violet-50/50" : "hover:bg-[#F5F5F4]"
                            )}
                            onClick={() => {
                              if (selectedInvoicesForBatch.includes(inv.id)) {
                                if (inv.id === isLiquidating.id) return; // Cannot deselect the main one
                                const next = selectedInvoicesForBatch.filter(id => id !== inv.id);
                                setSelectedInvoicesForBatch(next);
                                const total = groupedInvoices.filter(i => next.includes(i.id)).reduce((sum, i) => sum + i.pending, 0);
                                setPaymentAmount(total.toFixed(2));
                              } else {
                                const next = [...selectedInvoicesForBatch, inv.id];
                                setSelectedInvoicesForBatch(next);
                                const total = groupedInvoices.filter(i => next.includes(i.id)).reduce((sum, i) => sum + i.pending, 0);
                                setPaymentAmount(total.toFixed(2));
                              }
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-4 h-4 rounded-sm border flex items-center justify-center transition-colors",
                                selectedInvoicesForBatch.includes(inv.id) ? "bg-violet-600 border-violet-600 text-white" : "border-[#0A0A0A]/10 bg-white"
                              )}>
                                {selectedInvoicesForBatch.includes(inv.id) && <Plus size={10} />}
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-tight">{inv.reference}</p>
                                <p className="text-[9px] opacity-40 uppercase tracking-widest font-bold">DOC: {inv.doc_id}</p>
                              </div>
                            </div>
                            <p className="text-[10px] font-mono font-bold text-red-600">{formatCurrency(inv.pending)}</p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {liquidationError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-sm flex items-center gap-2 text-red-600 text-[10px] font-bold uppercase tracking-widest">
                    <AlertCircle size={14} />
                    {liquidationError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest opacity-40 mb-1 block">Importe a Pagar</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-30 text-sm">€</span>
                      <input 
                        type="number" 
                        value={paymentAmount}
                        readOnly={isMultipleLiquidation}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        className={cn(
                          "w-full pl-8 pr-4 py-3 bg-[#F5F5F4] rounded-sm border border-[#0A0A0A]/5 outline-none font-mono font-bold text-xl focus:border-[#0A0A0A]/20 transition-all",
                          isMultipleLiquidation && "opacity-60 cursor-not-allowed"
                        )}
                      />
                    </div>
                    {!isMultipleLiquidation && (
                      <p className="text-[9px] mt-2 opacity-40 font-bold uppercase tracking-widest">Pendiente: {formatCurrency((isLiquidating.total_amount ?? 0) - (isLiquidating.paid_amount ?? 0))}</p>
                    )}
                    {isMultipleLiquidation && (
                      <p className="text-[9px] mt-2 opacity-40 font-bold uppercase tracking-widest">Total Seleccionado: {formatCurrency(parseFloat(paymentAmount || "0"))}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-widest opacity-40 mb-1 block">Fecha de Pago (T para hoy) *</label>
                    <input 
                      type="text" 
                      placeholder="DD/MM/YYYY o T"
                      value={paymentDate}
                      onChange={(e) => handleDateInput(e.target.value, setPaymentDate)}
                      onBlur={() => setPaymentDate(smartFormatDate(paymentDate))}
                      className="w-full px-3 py-2 bg-[#F5F5F4] rounded-sm border border-[#0A0A0A]/5 outline-none font-bold text-[11px] uppercase focus:border-[#0A0A0A]/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-widest opacity-40 mb-1 block">Nº Movimiento de Liquidación *</label>
                    <input 
                      type="text" 
                      value={bankId}
                      onChange={(e) => setBankId(e.target.value)}
                      placeholder="Nº MOVIMIENTO..."
                      className="w-full px-3 py-2 bg-[#F5F5F4] rounded-sm border border-[#0A0A0A]/5 outline-none font-bold text-[11px] uppercase focus:border-[#0A0A0A]/20 transition-all placeholder:opacity-20"
                    />
                  </div>
                </div>
                <button 
                  onClick={handleLiquidate}
                  className="w-full py-4 bg-[#0A0A0A] text-white rounded-sm font-bold text-xs uppercase tracking-widest hover:bg-[#1A1A1A] transition-colors mt-2"
                >
                  Confirmar Liquidación {isMultipleLiquidation ? "Múltiple" : "Simple"}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isBatchLiquidating && (
          <div className="fixed inset-0 bg-[#0A0A0A]/60 backdrop-blur-md flex items-center justify-center p-6 z-50">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-sm w-full max-w-lg shadow-2xl overflow-hidden border border-[#0A0A0A]/10"
            >
              <div className="p-6 bg-[#0A0A0A] text-white flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white/10 rounded-sm flex items-center justify-center">
                    <Layers size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold tracking-tight uppercase">Liquidación por Lotes</h3>
                    <p className="text-[10px] opacity-60 uppercase tracking-widest font-bold">{selectedInvoicesForBatch.length} FACTURAS SELECCIONADAS</p>
                  </div>
                </div>
                <button onClick={() => setIsBatchLiquidating(false)} className="opacity-40 hover:opacity-100 transition-opacity"><X size={20} /></button>
              </div>
              <div className="p-6 flex flex-col gap-6">
                {liquidationError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-sm flex items-center gap-2 text-red-600 text-[10px] font-bold uppercase tracking-widest">
                    <AlertCircle size={14} />
                    {liquidationError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest opacity-40 mb-1 block">Total a Liquidar</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-30 text-sm">€</span>
                      <input 
                        type="text" 
                        readOnly
                        value={paymentAmount}
                        className="w-full pl-8 pr-4 py-3 bg-[#F5F5F4] rounded-sm border border-[#0A0A0A]/5 outline-none font-mono font-bold text-xl opacity-60 cursor-not-allowed"
                      />
                    </div>
                    <p className="text-[9px] mt-2 opacity-40 font-bold uppercase tracking-widest">Se liquidará el importe pendiente de cada factura seleccionada.</p>
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-widest opacity-40 mb-1 block">Fecha de Pago (T para hoy) *</label>
                    <input 
                      type="text" 
                      placeholder="DD/MM/YYYY o T"
                      value={paymentDate}
                      onChange={(e) => handleDateInput(e.target.value, setPaymentDate)}
                      onBlur={() => setPaymentDate(smartFormatDate(paymentDate))}
                      className="w-full px-3 py-2 bg-[#F5F5F4] rounded-sm border border-[#0A0A0A]/5 outline-none font-bold text-[11px] uppercase focus:border-[#0A0A0A]/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-widest opacity-40 mb-1 block">Nº Movimiento de Liquidación *</label>
                    <input 
                      type="text" 
                      value={bankId}
                      onChange={(e) => setBankId(e.target.value)}
                      placeholder="Nº MOVIMIENTO..."
                      className="w-full px-3 py-2 bg-[#F5F5F4] rounded-sm border border-[#0A0A0A]/5 outline-none font-bold text-[11px] uppercase focus:border-[#0A0A0A]/20 transition-all placeholder:opacity-20"
                    />
                  </div>
                </div>
                <button 
                  onClick={handleBatchLiquidate}
                  className="w-full py-4 bg-[#0A0A0A] text-white rounded-sm font-bold text-xs uppercase tracking-widest hover:bg-[#1A1A1A] transition-colors mt-2"
                >
                  Confirmar Liquidación por Lotes
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isDeletingPayment && (
          <div className="fixed inset-0 bg-[#0A0A0A]/60 backdrop-blur-md flex items-center justify-center p-6 z-[60]">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-sm w-full max-w-md shadow-2xl overflow-hidden border border-red-500/20"
            >
              <div className="p-6 bg-red-600 text-white flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white/10 rounded-sm flex items-center justify-center">
                    <Trash2 size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold tracking-tight uppercase">Eliminar Liquidación</h3>
                    <p className="text-[10px] opacity-60 uppercase tracking-widest font-bold">Esta acción no se puede deshacer</p>
                  </div>
                </div>
                <button onClick={() => setIsDeletingPayment(null)} className="opacity-40 hover:opacity-100 transition-opacity"><X size={20} /></button>
              </div>
              <div className="p-8 flex flex-col items-center text-center gap-6">
                <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-600">
                  <AlertCircle size={40} />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#0A0A0A]">¿Estás seguro de que deseas eliminar esta liquidación?</p>
                  <p className="text-xs opacity-40 mt-2">El importe se restará del total pagado de la factura.</p>
                </div>
                <div className="flex gap-3 w-full">
                  <button 
                    onClick={() => setIsDeletingPayment(null)}
                    className="flex-1 py-4 bg-[#F5F5F4] rounded-sm font-bold text-xs uppercase tracking-widest hover:bg-[#E4E3E0] transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => handleDeletePayment(isDeletingPayment)}
                    className="flex-1 py-4 bg-red-600 text-white rounded-sm font-bold text-xs uppercase tracking-widest hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isDeletingCompany && (
          <div className="fixed inset-0 bg-[#0A0A0A]/60 backdrop-blur-md flex items-center justify-center p-6 z-[60]">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-sm w-full max-w-md shadow-2xl overflow-hidden border border-red-500/20"
            >
              <div className="p-6 bg-red-600 text-white flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white/10 rounded-sm flex items-center justify-center">
                    <Trash2 size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold tracking-tight uppercase">Eliminar Compañía</h3>
                    <p className="text-[10px] opacity-60 uppercase tracking-widest font-bold">Acción Irreversible</p>
                  </div>
                </div>
                <button onClick={() => setIsDeletingCompany(null)} className="opacity-40 hover:opacity-100 transition-opacity"><X size={20} /></button>
              </div>
              <div className="p-8 flex flex-col gap-6 text-center">
                <div className="space-y-2">
                  <p className="text-sm font-bold text-[#0A0A0A]">¿Estás seguro de que deseas eliminar <span className="underline">{isDeletingCompany.name}</span>?</p>
                  <p className="text-[10px] opacity-50 font-medium leading-relaxed uppercase tracking-tight">Esta acción eliminará permanentemente la compañía y todos sus datos asociados (proveedores, facturas y pagos).</p>
                </div>

                <div className="bg-[#F5F5F4] p-6 rounded-sm border border-[#0A0A0A]/5 space-y-4">
                  <p className="text-[9px] font-bold uppercase tracking-widest opacity-40">Introduce el código de seguridad para confirmar:</p>
                  <div className="text-3xl font-mono font-black tracking-[0.5em] text-[#0A0A0A] select-none">
                    {deleteConfirmCode}
                  </div>
                  <input 
                    type="text" 
                    maxLength={4}
                    value={userDeleteCodeInput}
                    onChange={(e) => setUserDeleteCodeInput(e.target.value)}
                    placeholder="0000"
                    className="w-full text-center py-3 bg-white rounded-sm border border-[#0A0A0A]/10 outline-none font-mono font-bold text-2xl tracking-[0.5em] focus:border-red-500 transition-all placeholder:opacity-10"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setIsDeletingCompany(null)}
                    className="py-3 bg-[#F5F5F4] text-[#0A0A0A] rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-[#E5E5E4] transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleDeleteCompany}
                    disabled={userDeleteCodeInput !== deleteConfirmCode}
                    className="py-3 bg-red-600 text-white rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-red-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Eliminar Permanentemente
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
