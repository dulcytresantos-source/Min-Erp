import React, { useState, useEffect, useCallback, useMemo } from "react";
import { 
  Plus, 
  FileUp, 
  Search, 
  Building2, 
  Euro, 
  History, 
  Check,
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
  Layers,
  Terminal,
  Copy,
  GripVertical,
  MoveHorizontal,
  FileText
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  defaultDropAnimationSideEffects
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";
import { parseInvoice } from "./lib/gemini";
import InvoiceDocument from "./components/InvoiceDocument";

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
  is_generic?: number;
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
  concept?: string;
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

const getGridTemplate = (columns: any[], fixedStart?: string, fixedEnd?: string) => {
  const widths = columns.map(col => col.width);
  return `${fixedStart ? `${fixedStart} ` : ''}${widths.join(' ')}${fixedEnd ? ` ${fixedEnd}` : ''}`;
};

const getSupplierGridTemplate = (columns: any[]) => getGridTemplate(columns, '40px');
const getMovementGridTemplate = (columns: any[]) => getGridTemplate(columns, undefined, '40px');
const getHistoryGridTemplate = (columns: any[]) => getGridTemplate(columns);
const getSupplierInvoicesGridTemplate = (columns: any[]) => getGridTemplate(columns, '40px');

function SortableHeader({ id, label, sortKey, sortConfig, onSort, isLast }: any) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={cn(
        "p-1.5 border-r border-[#0A0A0A]/5 text-left hover:bg-[#0A0A0A]/5 transition-colors flex items-center gap-1 cursor-move select-none group/header",
        isLast && "border-r-0"
      )}
      {...attributes}
      {...listeners}
    >
      <div className={cn(
        "flex-1 flex items-center gap-1 truncate",
        sortKey !== null && "cursor-pointer"
      )} onClick={(e) => {
        e.stopPropagation();
        if (onSort && sortKey !== null) onSort(sortKey || id);
      }}>
        <span className="truncate">{label}</span>
        {sortKey !== null && sortConfig && sortConfig.key === (sortKey || id) && (
          sortConfig.direction === 'asc' ? <ArrowUp size={8} className="shrink-0" /> : <ArrowDown size={8} className="shrink-0" />
        )}
      </div>
      <GripVertical size={10} className="opacity-0 group-hover/header:opacity-20 shrink-0" />
    </div>
  );
}

export default function App() {
  const formatSupplierId = (id: string) => {
    if (!id) return "";
    const parts = id.split('-');
    return parts.length > 1 ? parts[parts.length - 1] : id;
  };

  const [view, setView] = useState<'suppliers' | 'upload' | 'supplier-detail' | 'history' | 'movements' | 'invoice-document'>('suppliers');
  const [previousView, setPreviousView] = useState<'movements' | 'supplier-detail' | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<number | null>(null);
  const genericSupplier = useMemo(() => 
    suppliers.find(s => s.is_generic && s.company_id === activeCompanyId),
    [suppliers, activeCompanyId]
  );
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
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
  const [useGenericInProposal, setUseGenericInProposal] = useState(false);
  const [proposalConcept, setProposalConcept] = useState("");
  const [editingInvoiceConceptId, setEditingInvoiceConceptId] = useState<number | null>(null);
  const [editingConceptValue, setEditingConceptValue] = useState("");
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
  const [debugLogs, setDebugLogs] = useState<{time: string, type: 'info' | 'error' | 'api', message: string}[]>([]);

  const logDebug = (type: 'info' | 'error' | 'api', message: string) => {
    const time = format(new Date(), "HH:mm:ss");
    console.log(`[${time}][${type.toUpperCase()}] ${message}`);
    setDebugLogs(prev => [...prev, { time, type, message }].slice(-100)); // Keep last 100 logs
  };

  const [uploadLog, setUploadLog] = useState<LogEntry[]>([]);
  const [isAddingCompany, setIsAddingCompany] = useState(false);
  const [newCompany, setNewCompany] = useState({ name: '', address: '', cif: '' });
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'id', direction: 'asc' });
  const [isDeletingCompany, setIsDeletingCompany] = useState<Company | null>(null);
  const [deleteConfirmCode, setDeleteConfirmCode] = useState("");
  const [userDeleteCodeInput, setUserDeleteCodeInput] = useState("");
  const [isCreatingSupplier, setIsCreatingSupplier] = useState(false);
  const [isDeletingInvoice, setIsDeletingInvoice] = useState<Invoice | null>(null);
  const [isDeletingSupplier, setIsDeletingSupplier] = useState<Supplier | null>(null);
  const [dbStatus, setDbStatus] = useState<{
    database: string;
    url: string;
    db_initialized: boolean;
    companies_count: number;
    init_error: string | null;
  } | null>(null);
  const [envStatus, setEnvStatus] = useState<any>(null);
  const [isRefreshingDb, setIsRefreshingDb] = useState(false);

  const [supplierColumns, setSupplierColumns] = useState([
    { id: 'id', label: 'Nº Prov.', width: '100px', sortKey: 'id' },
    { id: 'name', label: 'Nombre / Alias', width: '1fr', sortKey: 'name' },
    { id: 'cif', label: 'CIF/NIF', width: '120px', sortKey: 'cif' },
    { id: 'city', label: 'Población', width: '140px', sortKey: 'city' },
    { id: 'pending_balance', label: 'Saldo (EUR)', width: '120px', sortKey: 'pending_balance' },
  ]);

  const [movementColumns, setMovementColumns] = useState([
    { id: 'date', label: 'Fecha', width: '100px', sortKey: 'date' },
    { id: 'doc_id', label: 'DOC (Int)', width: '100px', sortKey: 'doc_id' },
    { id: 'type', label: 'Tipo', width: '100px', sortKey: 'type' },
    { id: 'supplier_name', label: 'Proveedor / Referencia', width: '1fr', sortKey: 'supplier_name' },
    { id: 'amount', label: 'Imp. Inicial', width: '100px', sortKey: 'amount' },
    { id: 'pending', label: 'Imp. Pdte.', width: '100px', sortKey: 'pending' },
    { id: 'status', label: 'Estado', width: '100px', sortKey: 'status' },
    { id: 'payments', label: 'Liqs.', width: '60px', sortKey: 'payments' },
  ]);

  const [historyColumns, setHistoryColumns] = useState([
    { id: 'doc_id', label: 'DOC (Int)', width: '140px', sortKey: 'doc_id' },
    { id: 'doc_ext', label: 'DOCEXT (Ext)', width: '120px', sortKey: 'doc_ext' },
    { id: 'supplier_name', label: 'Proveedor', width: '1.5fr', sortKey: 'supplier_name' },
    { id: 'issue_date', label: 'Fecha', width: '100px', sortKey: 'issue_date' },
    { id: 'concept', label: 'Concepto', width: '1fr', sortKey: 'concept' },
    { id: 'total_amount', label: 'Total', width: '120px', sortKey: 'total_amount' },
    { id: 'status', label: 'Estado', width: '100px', sortKey: 'status' },
    { id: 'actions', label: 'Acciones', width: '60px', sortKey: null },
  ]);

  const [supplierInvoicesColumns, setSupplierInvoicesColumns] = useState([
    { id: 'date', label: 'Fecha', width: '100px', sortKey: 'date' },
    { id: 'reference', label: 'Referencia', width: '1fr', sortKey: 'reference' },
    { id: 'amount', label: 'Total', width: '100px', sortKey: 'amount' },
    { id: 'pending', label: 'Pendiente', width: '100px', sortKey: 'pending' },
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: any, setColumns: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setColumns((items: any) => {
        const oldIndex = items.findIndex((i: any) => i.id === active.id);
        const newIndex = items.findIndex((i: any) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

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
        inv.supplier_name?.toLowerCase().includes(q) ||
        inv.concept?.toLowerCase().includes(q)
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

  const handleUpdateInvoiceConcept = async (invoiceId: number, newConcept: string) => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concept: newConcept })
      });

      if (!res.ok) {
        alert("Error al actualizar el concepto");
        return;
      }

      setAllInvoices(prev => prev.map(inv => inv.id === invoiceId ? { ...inv, concept: newConcept } : inv));
      setEditingInvoiceConceptId(null);
    } catch (err) {
      console.error("Error updating invoice concept:", err);
    }
  };

  const handleInvoiceSort = (field: string) => {
    if (invoiceSortField === field) {
      setInvoiceSortDirection(invoiceSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setInvoiceSortField(field as keyof Invoice);
      setInvoiceSortDirection('asc');
    }
  };

  const SortIcon = ({ field, currentField, direction }: { field: any, currentField: any, direction: 'asc' | 'desc' }) => {
    if (currentField !== field) return null;
    return direction === 'asc' ? <ArrowUp size={10} className="inline ml-1" /> : <ArrowDown size={10} className="inline ml-1" />;
  };

  const fetchCompanies = async () => {
    logDebug("info", "Calling /api/companies");
    try {
      const response = await fetch("/api/companies");
      logDebug("info", `Response status: ${response.status}`);
      
      const text = await response.text();
      logDebug("api", "RAW RESPONSE: " + (text.length > 500 ? text.substring(0, 500) + "..." : text));

      if (!response.ok) {
        logDebug("error", `HTTP ${response.status}: ${text.substring(0, 100)}`);
      }

      try {
        const data = JSON.parse(text);
        logDebug("api", "PARSED JSON OK");
        if (Array.isArray(data)) {
          setCompanies(data);
          if (data.length > 0 && !activeCompanyId) {
            const defaultCompany = data.find((c: Company) => c.is_default === 1) || data[0];
            setActiveCompanyId(defaultCompany.id);
          }
        } else {
          logDebug("error", "Response is not an array");
          console.error("Error fetching companies: response is not an array", data);
        }
      } catch (e: any) {
        logDebug("error", "JSON PARSE FAILED: " + e.message);
      }
    } catch (error: any) {
      logDebug("error", "FETCH FAILED: " + error.message);
      console.error("Error fetching companies:", error);
    }
  };

  const fetchData = useCallback(async () => {
    if (!activeCompanyId) return;
    logDebug("info", `Fetching data for company ${activeCompanyId}`);
    try {
      const res = await fetch(`/api/suppliers?companyId=${activeCompanyId}`);
      const suppliersData = await res.json();
      if (Array.isArray(suppliersData)) {
        setSuppliers(suppliersData);
      }

      const invRes = await fetch(`/api/invoices/all?companyId=${activeCompanyId}`);
      const invData = await invRes.json();
      if (Array.isArray(invData)) {
        setAllInvoices(invData);
      }
    } catch (error: any) {
      logDebug("error", "fetchData FAILED: " + error.message);
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

  const fetchDbStatus = async () => {
    setIsRefreshingDb(true);
    logDebug("info", "Calling /api/debug-db");
    try {
      const res = await fetch("/api/debug-db");
      logDebug("info", `Response status: ${res.status}`);
      
      let data;
      const text = await res.text();
      logDebug("api", "RAW RESPONSE (debug-db): " + (text.length > 200 ? text.substring(0, 200) + "..." : text));

      if (res.ok) {
        try {
          data = JSON.parse(text);
          logDebug("api", "PARSED JSON OK");
        } catch (e: any) {
          logDebug("error", "JSON PARSE FAILED: " + e.message);
          data = { status: "error", message: `Invalid JSON: ${text.substring(0, 100)}` };
        }
      } else {
        logDebug("error", `HTTP ${res.status}: ${text.substring(0, 100)}`);
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = { status: "error", message: `HTTP ${res.status}: ${text.substring(0, 100)}` };
        }
      }
      setDbStatus(data);
      
      logDebug("info", "Calling /api/debug-env");
      const envRes = await fetch("/api/debug-env");
      if (envRes.ok) {
        const envData = await envRes.json();
        setEnvStatus(envData);
        logDebug("info", "Env status fetched OK");
      }
    } catch (err: any) {
      logDebug("error", "fetchDbStatus FAILED: " + err.message);
      console.error("Error fetching db status:", err);
      setDbStatus({ status: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsRefreshingDb(false);
    }
  };

  useEffect(() => {
    if (showSettings) {
      fetchDbStatus();
    }
  }, [showSettings]);

  useEffect(() => {
    if (view !== 'supplier-detail') {
      setIsCreatingSupplier(false);
    }
  }, [view]);

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

          await createInvoice(existingSupplier.id, { ...parsed, docId }, "Factura genérica");
          addLogEntry('SUCCESS', `${file.name}: Procesada correctamente para ${existingSupplier.name}`);
          if (selectedSupplier?.id === existingSupplier.id) {
            fetchSupplierDetails(existingSupplier.id);
          }
        } else {
          addLogEntry('INFO', `${file.name}: Proveedor nuevo detectado (${parsed.supplierName})`);
          setUseGenericInProposal(false);
          setProposalConcept("");
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

  const createInvoice = async (supplierId: string, data: any, concept?: string) => {
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
        total_amount: data.totalAmount || 0,
        concept: concept || "Factura genérica"
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
      let supplierId = "";
      let finalConcept = proposalConcept || "Factura genérica";

      if (useGenericInProposal) {
        // Use the generic supplier for this company
        if (!genericSupplier) {
          throw new Error("No existe un proveedor genérico configurado para esta empresa. Por favor, marca uno en la ficha de proveedor.");
        }
        supplierId = genericSupplier.id;
        if (!proposalConcept) finalConcept = "Gasto esporádico";
      } else {
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

        const data = await res.json();
        supplierId = data.id;
      }
      
      await createInvoice(supplierId, proposal.invoiceData, finalConcept);
      setProposal(null);
      setUseGenericInProposal(false);
      setProposalConcept("");
      await fetchData();
      
      if (!useGenericInProposal) {
        // Navigate to the new supplier detail view
        const sRes = await fetch(`/api/suppliers/${supplierId}?companyId=${activeCompanyId}`);
        const sData = await sRes.json();
        setSelectedSupplier(sData);
        setView('supplier-detail');
        fetchSupplierDetails(supplierId);
      }
    } catch (err) {
      console.error("Error in handleCreateSupplier:", err);
      setUploadError(err instanceof Error ? err.message : "Error al procesar la solicitud");
    } finally {
      setIsUploading(false);
    }
  };

  const handleNewSupplier = () => {
    // Find max ID like PRovXXX
    const provIds = suppliers
      .map(s => s.id)
      .filter(id => id.startsWith('PRov'))
      .map(id => {
        const num = parseInt(id.replace('PRov', ''));
        return isNaN(num) ? 0 : num;
      });
    
    const nextNum = provIds.length > 0 ? Math.max(...provIds) + 1 : 1;
    const nextId = `PRov${nextNum.toString().padStart(3, '0')}`;

    const newSupplier: Supplier = {
      id: nextId,
      company_id: activeCompanyId || 0,
      name: '',
      cif: '',
      email: '',
      address: '',
      city: '',
      province: '',
      zip_code: '',
      country_code: 'ES',
      alias: '',
      phone: '',
      name2: '',
      address2: '',
      main_contact: '',
      pending_balance: 0,
      is_generic: 0
    };

    setSelectedSupplier(newSupplier);
    setIsCreatingSupplier(true);
    setView('supplier-detail');
    setActiveTab('General');
  };

  const handleSaveNewSupplier = async () => {
    if (!selectedSupplier || !activeCompanyId) return;
    
    if (!selectedSupplier.name || !selectedSupplier.cif) {
      alert("El nombre y el CIF son obligatorios");
      return;
    }

    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...selectedSupplier,
          company_id: activeCompanyId
        })
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Error al guardar el proveedor");
        return;
      }

      // Refresh list
      await fetchData();
      setIsCreatingSupplier(false);
      setView('suppliers');
      setSelectedSupplier(null);
    } catch (err) {
      console.error("Error saving new supplier:", err);
      alert("Error al guardar el proveedor");
    }
  };

  const handleToggleGeneric = async (supplierId: string, currentValue: boolean) => {
    if (isCreatingSupplier && selectedSupplier) {
      setSelectedSupplier({ ...selectedSupplier, is_generic: !currentValue ? 1 : 0 });
      return;
    }
    if (!activeCompanyId) return;
    try {
      const res = await fetch(`/api/suppliers/${supplierId}?companyId=${activeCompanyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_generic: !currentValue ? 1 : 0
        })
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Error al actualizar el proveedor");
        return;
      }

      await fetchData();
      // Update selected supplier if we are in detail view
      if (selectedSupplier && selectedSupplier.id === supplierId) {
        setSelectedSupplier({ ...selectedSupplier, is_generic: !currentValue ? 1 : 0 });
      }
    } catch (err) {
      console.error("Error toggling generic status:", err);
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

  const handleDeleteInvoice = async (invoiceId: number) => {
    if (!invoiceId) return;
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: "DELETE"
      });
      
      if (!res.ok) {
        let errorMessage = "Error al eliminar la factura";
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

      setIsDeletingInvoice(null);
      await fetchData();
      await fetchAllMovements();
      if (selectedSupplier && activeCompanyId) {
        fetchSupplierDetails(selectedSupplier.id);
      }
    } catch (err) {
      console.error("Error deleting invoice:", err);
      alert(err instanceof Error ? err.message : "Error al eliminar la factura");
    }
  };

  const handleDeleteSupplier = async (supplierId: string) => {
    if (!supplierId) return;
    try {
      const res = await fetch(`/api/suppliers/${supplierId}?companyId=${activeCompanyId}`, {
        method: "DELETE"
      });
      
      if (!res.ok) {
        let errorMessage = "Error al eliminar el proveedor";
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

      setIsDeletingSupplier(null);
      setSelectedSupplier(null);
      setView('suppliers');
      await fetchData();
    } catch (err) {
      console.error("Error deleting supplier:", err);
      alert(err instanceof Error ? err.message : "Error al eliminar el proveedor");
    }
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
            <h1 className="text-sm font-bold tracking-tighter uppercase text-indigo-600">DocLedger <span className="opacity-30 font-medium">v6.5</span></h1>
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
            
            <div className="space-y-6 overflow-y-auto max-h-[calc(100vh-120px)] pr-2 -mr-2 scrollbar-hide">
              <div className="bg-violet-600 text-white p-3 rounded-sm mb-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[8px] uppercase tracking-widest opacity-80">Versión del Sistema</span>
                  <span className="text-[10px] font-bold tracking-tight">V6.28</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full animate-pulse",
                    (window.location.hostname.includes('-dev-') || window.location.hostname.includes('-pre-')) ? "bg-white" : "bg-green-400"
                  )} />
                  <span className="text-[9px] font-bold uppercase tracking-tight">
                    {(window.location.hostname.includes('-dev-') || window.location.hostname.includes('-pre-')) ? "Entorno de Pruebas" : "Entorno de Producción"}
                  </span>
                </div>
              </div>

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

              <div className="pt-6 border-t border-[#0A0A0A]/10">
                <div className="flex justify-between items-center mb-3">
                  <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Estado de la Base de Datos</label>
                  <button 
                    onClick={fetchDbStatus}
                    disabled={isRefreshingDb}
                    className="text-[8px] font-bold uppercase tracking-widest text-violet-600 hover:underline disabled:opacity-30"
                  >
                    {isRefreshingDb ? "Comprobando..." : "Reintentar"}
                  </button>
                </div>
                <div className="bg-[#F5F5F4] p-4 rounded-sm space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] uppercase tracking-widest opacity-60">Conexión</span>
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        dbStatus?.db_initialized ? "bg-green-500 animate-pulse" : "bg-red-500"
                      )} />
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        {dbStatus?.db_initialized ? "Conectado" : "Desconectado"}
                      </span>
                    </div>
                  </div>
                  
                  {dbStatus && (
                    <div className="pt-3 border-t border-[#0A0A0A]/5 space-y-2">
                      {dbStatus.status === "error" ? (
                        <div className="p-2 bg-red-50 rounded-sm">
                          <p className="text-[8px] text-red-600 font-bold uppercase leading-tight">Error de API: {dbStatus.message}</p>
                        </div>
                      ) : (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-[8px] uppercase tracking-widest opacity-40">Tipo</span>
                            <span className="text-[9px] font-bold uppercase tracking-tight">{dbStatus.database}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[8px] uppercase tracking-widest opacity-40">Registros</span>
                            <span className="text-[9px] font-bold uppercase tracking-tight">{dbStatus.companies_count} Empresas</span>
                          </div>
                        </>
                      )}
                      
                      {envStatus && (
                        <div className="pt-2 space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="text-[7px] uppercase tracking-widest opacity-40">URL Var</span>
                            <span className={cn(
                              "text-[7px] font-bold px-1 rounded-sm",
                              envStatus.TURSO_DATABASE_URL !== 'MISSING' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            )}>
                              {envStatus.TURSO_DATABASE_URL !== 'MISSING' ? "Configured" : "Missing"}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[7px] uppercase tracking-widest opacity-40">Token Var</span>
                            <span className={cn(
                              "text-[7px] font-bold px-1 rounded-sm",
                              envStatus.TURSO_AUTH_TOKEN !== 'MISSING' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            )}>
                              {envStatus.TURSO_AUTH_TOKEN !== 'MISSING' ? "Configured" : "Missing"}
                            </span>
                          </div>
                        </div>
                      )}

                      {dbStatus.init_error && (
                        <div className="p-2 bg-red-50 rounded-sm mt-2">
                          <p className="text-[8px] text-red-600 font-bold uppercase leading-tight">Error: {dbStatus.init_error}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-6 border-t border-[#0A0A0A]/10">
                <div className="bg-[#F5F5F4] p-4 rounded-sm space-y-3">
                  <div className="pt-1">
                    <button 
                      onClick={async () => {
                        if (confirm("¿Deseas verificar/crear la estructura de la base de datos? Esto NO borrará tus datos actuales, solo asegura que las tablas existan.")) {
                          try {
                            const res = await fetch('/api/admin/setup-db');
                            const data = await res.json();
                            alert(data.message || "Estructura verificada");
                            window.location.reload();
                          } catch (e) {
                            alert("Error al inicializar: " + (e as Error).message);
                          }
                        }
                      }}
                      className="w-full text-[10px] uppercase tracking-widest font-bold border border-[#0A0A0A] py-2 hover:bg-[#0A0A0A] hover:text-white transition-colors mb-2"
                    >
                      Verificar Estructura (Seguro)
                    </button>

                    <button 
                      onClick={async () => {
                        if (confirm("¿Deseas crear una empresa con datos de demostración para 2026? Esto añadirá nuevos registros pero no borrará los actuales.")) {
                          try {
                            const res = await fetch('/api/admin/seed-demo');
                            const data = await res.json();
                            alert(data.message || "Datos de demo creados");
                            window.location.reload();
                          } catch (e) {
                            alert("Error al crear demo: " + (e as Error).message);
                          }
                        }
                      }}
                      className="w-full text-[10px] uppercase tracking-widest font-bold border border-[#0A0A0A]/20 py-2 hover:bg-[#0A0A0A] hover:text-white transition-colors mb-3"
                    >
                      Crear Datos de Demo
                    </button>
                    <p className="text-[8px] opacity-40 leading-tight uppercase tracking-widest">
                      {window.location.hostname.includes('-dev-') || window.location.hostname.includes('-pre-')
                        ? "Estás viendo los cambios en desarrollo" 
                        : "Esta es la versión compartida/publicada"}
                    </p>
                  </div>
                </div>
                <p className="text-[8px] mt-3 opacity-30 italic leading-relaxed uppercase tracking-widest">
                  DocLedger V6.28 - [ESTABILIDAD] Optimización de arranque para Vercel Serverless.
                </p>
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
                  <h2 className="text-4xl font-bold tracking-tighter text-red-600">Maestro de Proveedores</h2>
                  <p className="text-xs font-bold uppercase tracking-widest opacity-40">Gestión de Cuentas a Pagar / Ledger de Entidades</p>
                </div>
                <div className="flex items-center gap-2">
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
                  <button 
                    onClick={handleNewSupplier}
                    className="p-2 bg-violet-600 text-white rounded-sm hover:bg-violet-700 transition-all shadow-lg shadow-violet-600/20 flex items-center justify-center shrink-0"
                    title="Nuevo Proveedor"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              <div className="flex justify-end mb-2 px-1">
                <div className="text-[11px] font-bold uppercase tracking-widest text-[#0A0A0A]/30">
                  {sortedSuppliers.length} proveedores encontrados
                </div>
              </div>

              <div className="bg-white border border-[#0A0A0A]/10 rounded-sm overflow-hidden shadow-sm">
                {/* Technical Header */}
                <DndContext 
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => handleDragEnd(event, setSupplierColumns)}
                >
                  <div 
                    className="grid border-b border-[#0A0A0A]/10 bg-[#F5F5F4] text-[9px] font-bold uppercase tracking-widest opacity-50"
                    style={{ gridTemplateColumns: getSupplierGridTemplate(supplierColumns) }}
                  >
                    <div className="p-1.5 border-r border-[#0A0A0A]/5"></div>
                    <SortableContext items={supplierColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                      {supplierColumns.map((col, idx) => (
                        <SortableHeader 
                          key={col.id}
                          id={col.id}
                          label={col.label}
                          sortKey={col.sortKey}
                          sortConfig={sortConfig}
                          onSort={handleSort}
                          isLast={idx === supplierColumns.length - 1}
                        />
                      ))}
                    </SortableContext>
                  </div>
                </DndContext>

                <div className="divide-y divide-[#0A0A0A]/5">
                  {sortedSuppliers.map(s => (
                    <button 
                      key={s.id}
                      onClick={() => {
                        setSelectedSupplier(s);
                        setIsCreatingSupplier(false);
                        fetchSupplierDetails(s.id);
                        setView('supplier-detail');
                        setActiveTab('General');
                      }}
                      className="grid w-full text-left hover:bg-[#0A0A0A] hover:text-white transition-colors group"
                      style={{ gridTemplateColumns: getSupplierGridTemplate(supplierColumns) }}
                    >
                      <div className="p-1.5 border-r border-[#0A0A0A]/5 flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <ChevronRight size={14} />
                      </div>
                      {supplierColumns.map((col) => {
                        if (col.id === 'id') return <div key={col.id} className="p-1.5 border-r border-[#0A0A0A]/5 font-mono text-[11px] flex items-center">{formatSupplierId(s.id)}</div>;
                        if (col.id === 'name') return (
                          <div key={col.id} className="p-1.5 border-r border-[#0A0A0A]/5 flex flex-col justify-center truncate">
                            <span className="font-bold text-xs truncate">{toTitleCase(s.name)}</span>
                            {s.alias && <span className="text-[9px] opacity-40 font-bold uppercase tracking-widest truncate group-hover:opacity-100">{s.alias}</span>}
                          </div>
                        );
                        if (col.id === 'cif') return <div key={col.id} className="p-1.5 border-r border-[#0A0A0A]/5 font-mono text-[11px] flex items-center">{s.cif}</div>;
                        if (col.id === 'city') return <div key={col.id} className="p-1.5 border-r border-[#0A0A0A]/5 text-[11px] flex items-center truncate opacity-60 group-hover:opacity-100 uppercase font-medium">{s.city || "---"}</div>;
                        if (col.id === 'pending_balance') return (
                          <div key={col.id} className={cn(
                            "p-1.5 text-right font-mono text-[11px] flex items-center justify-end font-bold",
                            s.pending_balance > 0 ? "text-red-600 group-hover:text-red-400" : "text-emerald-600 group-hover:text-emerald-400"
                          )}>
                            {formatCurrency(s.pending_balance ?? 0)}
                          </div>
                        );
                        return null;
                      })}
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
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => {
                      setView('suppliers');
                      setIsCreatingSupplier(false);
                    }}
                    className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm hover:bg-[#F5F5F4] transition-colors"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <div>
                    <h2 className="text-3xl font-bold tracking-tighter">
                      {isCreatingSupplier ? "Nuevo Proveedor" : selectedSupplier.name}
                    </h2>
                    <p className="text-xs font-bold uppercase tracking-widest opacity-40">
                      Ficha de Proveedor / {formatSupplierId(selectedSupplier.id)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isCreatingSupplier && (
                    <>
                      <button 
                        onClick={() => {
                          setIsCreatingSupplier(false);
                          setView('suppliers');
                          setSelectedSupplier(null);
                        }}
                        className="px-4 py-2 bg-[#F5F5F4] text-[#0A0A0A]/60 rounded-sm font-bold uppercase tracking-widest hover:bg-[#E4E3E0] transition-all flex items-center gap-2"
                      >
                        <X size={16} />
                        Cancelar
                      </button>
                      <button 
                        onClick={handleSaveNewSupplier}
                        className="px-6 py-2 bg-emerald-600 text-white rounded-sm font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2"
                      >
                        <Check size={16} />
                        Guardar Proveedor
                      </button>
                    </>
                  )}
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
                            <input 
                              readOnly={!isCreatingSupplier} 
                              value={formatSupplierId(selectedSupplier.id)} 
                              onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, id: e.target.value})}
                              className={cn(
                                "flex-1 px-2 py-1.5 rounded-sm border-none outline-none font-mono text-[11px]",
                                isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                              )}
                            />
                            {!isCreatingSupplier && (
                              <button 
                                onClick={() => setIsDeletingSupplier(selectedSupplier)}
                                className="p-1.5 bg-red-50 text-red-600 rounded-sm hover:bg-red-100 transition-all border border-red-100"
                                title="Eliminar Proveedor"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                            <button 
                              onClick={handleNewSupplier}
                              className="p-1.5 bg-[#F5F5F4] rounded-sm hover:bg-[#E4E3E0]"
                              title="Nuevo Proveedor"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Nombre. . . . . . . .</label>
                          <input 
                            readOnly={!isCreatingSupplier} 
                            value={isCreatingSupplier ? selectedSupplier.name : toTitleCase(selectedSupplier.name)} 
                            onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, name: e.target.value})}
                            className={cn(
                              "px-2 py-1.5 rounded-sm border-none outline-none font-bold text-[11px] uppercase",
                              isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                            )}
                          />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Nombre 2. . . . . . .</label>
                          <input 
                            readOnly={!isCreatingSupplier} 
                            value={selectedSupplier.name2 || ""} 
                            onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, name2: e.target.value})}
                            className={cn(
                              "px-2 py-1.5 rounded-sm border-none outline-none text-[11px]",
                              isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                            )}
                          />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Dirección . . . . . .</label>
                          <input 
                            readOnly={!isCreatingSupplier} 
                            value={selectedSupplier.address} 
                            onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, address: e.target.value})}
                            className={cn(
                              "px-2 py-1.5 rounded-sm border-none outline-none text-[11px]",
                              isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                            )}
                          />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Dirección 2 . . . . .</label>
                          <input 
                            readOnly={!isCreatingSupplier} 
                            value={selectedSupplier.address2 || ""} 
                            onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, address2: e.target.value})}
                            className={cn(
                              "px-2 py-1.5 rounded-sm border-none outline-none text-[11px]",
                              isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                            )}
                          />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">C.P. +Población . .</label>
                          <div className="flex gap-1">
                            <input 
                              readOnly={!isCreatingSupplier} 
                              value={selectedSupplier.zip_code || ""} 
                              onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, zip_code: e.target.value})}
                              className={cn(
                                "w-16 px-2 py-1.5 rounded-sm border-none outline-none text-[11px]",
                                isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                              )}
                            />
                            <input 
                              readOnly={!isCreatingSupplier} 
                              value={selectedSupplier.city || ""} 
                              onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, city: e.target.value})}
                              className={cn(
                                "flex-1 px-2 py-1.5 rounded-sm border-none outline-none text-[11px]",
                                isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                              )}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Provincia . . . . . . .</label>
                          <input 
                            readOnly={!isCreatingSupplier} 
                            value={selectedSupplier.province || ""} 
                            onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, province: e.target.value})}
                            className={cn(
                              "px-2 py-1.5 rounded-sm border-none outline-none text-[11px]",
                              isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                            )}
                          />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">País (ISO) . . . . . . .</label>
                          <input 
                            readOnly={!isCreatingSupplier} 
                            value={selectedSupplier.country_code || ""} 
                            onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, country_code: e.target.value})}
                            className={cn(
                              "px-2 py-1.5 rounded-sm border-none outline-none text-[11px]",
                              isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                            )}
                          />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">CIF/NIF. . . . . . . . .</label>
                          <input 
                            readOnly={!isCreatingSupplier} 
                            value={selectedSupplier.cif} 
                            onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, cif: e.target.value})}
                            className={cn(
                              "px-2 py-1.5 rounded-sm border-none outline-none font-mono text-[11px]",
                              isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                            )}
                          />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4 mt-2">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Prov. Genérico . . .</label>
                          <button 
                            onClick={() => handleToggleGeneric(selectedSupplier.id, !!selectedSupplier.is_generic)}
                            className={cn(
                              "w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all",
                              selectedSupplier.is_generic 
                                ? "bg-violet-600 border-violet-600 text-white" 
                                : "border-[#0A0A0A]/10 text-transparent hover:border-[#0A0A0A]/30"
                            )}
                          >
                            <Check size={18} />
                          </button>
                        </div>
                      </div>

                      {/* Right Column */}
                      <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Alias . . . . . . . . . .</label>
                          <input 
                            value={selectedSupplier.alias || ""} 
                            onChange={(e) => isCreatingSupplier 
                              ? setSelectedSupplier({...selectedSupplier, alias: e.target.value}) 
                              : handleUpdateAlias(selectedSupplier.id, e.target.value)
                            }
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

                  {activeTab === 'Comunicación' && (
                    <div className="grid grid-cols-2 gap-x-12 gap-y-6">
                      <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Teléfono . . . . . . . .</label>
                          <input 
                            readOnly={!isCreatingSupplier} 
                            value={selectedSupplier.phone || ""} 
                            onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, phone: e.target.value})}
                            className={cn(
                              "px-2 py-1.5 rounded-sm border-none outline-none text-[11px]",
                              isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                            )}
                          />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Email . . . . . . . . . .</label>
                          <input 
                            readOnly={!isCreatingSupplier} 
                            value={selectedSupplier.email || ""} 
                            onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, email: e.target.value})}
                            className={cn(
                              "px-2 py-1.5 rounded-sm border-none outline-none text-[11px]",
                              isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                            )}
                          />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                          <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">Contacto . . . . . . . .</label>
                          <input 
                            readOnly={!isCreatingSupplier} 
                            value={selectedSupplier.main_contact || ""} 
                            onChange={(e) => isCreatingSupplier && setSelectedSupplier({...selectedSupplier, main_contact: e.target.value})}
                            className={cn(
                              "px-2 py-1.5 rounded-sm border-none outline-none text-[11px]",
                              isCreatingSupplier ? "bg-white ring-1 ring-[#0A0A0A]/10 focus:ring-violet-600/20" : "bg-[#F5F5F4]"
                            )}
                          />
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
                        <DndContext 
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={(event) => handleDragEnd(event, setSupplierInvoicesColumns)}
                        >
                          <div 
                            className="grid border-b border-[#0A0A0A]/10 bg-[#F5F5F4] text-[9px] font-bold uppercase tracking-widest opacity-50"
                            style={{ gridTemplateColumns: getSupplierInvoicesGridTemplate(supplierInvoicesColumns) }}
                          >
                            <div className="p-1 border-r border-[#0A0A0A]/5 flex items-center justify-center">
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
                            </div>
                            <SortableContext items={supplierInvoicesColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                              {supplierInvoicesColumns.map((col, idx) => (
                                <SortableHeader 
                                  key={col.id}
                                  id={col.id}
                                  label={col.label}
                                  isLast={idx === supplierInvoicesColumns.length - 1}
                                />
                              ))}
                            </SortableContext>
                          </div>
                        </DndContext>

                        <div className="divide-y divide-[#0A0A0A]/5">
                          {groupedInvoices
                            .filter(inv => inv.supplier_id === selectedSupplier.id && inv.pending > 0)
                            .map(inv => (
                              <div 
                                key={inv.id} 
                                className="grid w-full hover:bg-[#F5F5F4]/50 transition-colors"
                                style={{ gridTemplateColumns: getSupplierInvoicesGridTemplate(supplierInvoicesColumns) }}
                              >
                                <div className="p-1 border-r border-[#0A0A0A]/5 flex items-center justify-center">
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
                                </div>
                                {supplierInvoicesColumns.map((col) => {
                                  if (col.id === 'date') return <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-[10px] flex items-center">{formatDate(inv.date)}</div>;
                                  if (col.id === 'reference') return <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-[10px] font-bold flex items-center">{inv.reference}</div>;
                                  if (col.id === 'amount') return <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-[10px] text-right font-mono flex items-center justify-end">{formatCurrency(inv.amount)}</div>;
                                  if (col.id === 'pending') return <div key={col.id} className="p-1 text-[10px] text-right font-mono text-red-600 font-bold flex items-center justify-end">{formatCurrency(inv.pending)}</div>;
                                  return null;
                                })}
                              </div>
                            ))}
                          {groupedInvoices.filter(inv => inv.supplier_id === selectedSupplier.id && inv.pending > 0).length === 0 && (
                            <div className="p-8 text-center text-[10px] opacity-40 italic">No hay facturas pendientes</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab !== 'General' && activeTab !== 'Comunicación' && activeTab !== 'Facturación' && (
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
                      ? `Filtrado por: [${formatSupplierId(movementsFilterSupplierId)}] ${suppliers.find(s => s.id === movementsFilterSupplierId)?.name}` 
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
                        <option key={s.id} value={s.id}>{formatSupplierId(s.id)} - {s.name.toUpperCase()}</option>
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

              <div className="flex justify-end mb-2 px-1">
                <div className="text-[11px] font-bold uppercase tracking-widest text-[#0A0A0A]/30">
                  {groupedInvoices.length} movimientos encontrados
                </div>
              </div>

              <div className="bg-white border border-[#0A0A0A]/10 rounded-sm overflow-hidden shadow-sm">
                <DndContext 
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => handleDragEnd(event, setMovementColumns)}
                >
                  <div 
                    className="grid border-b border-[#0A0A0A]/10 bg-[#F5F5F4] text-[9px] font-bold uppercase tracking-widest opacity-50"
                    style={{ gridTemplateColumns: getMovementGridTemplate(movementColumns) }}
                  >
                    <SortableContext items={movementColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                      {movementColumns.map((col, idx) => (
                        <SortableHeader 
                          key={col.id}
                          id={col.id}
                          label={col.label}
                          sortKey={col.sortKey}
                          sortConfig={{ key: movementSortField, direction: movementSortDirection }}
                          onSort={handleMovementSort}
                          isLast={idx === movementColumns.length - 1}
                        />
                      ))}
                    </SortableContext>
                    <div className="p-1 text-center">Acc.</div>
                  </div>
                </DndContext>

                <div className="divide-y divide-[#0A0A0A]/5">
                  {groupedInvoices.map(inv => {
                    const isExpanded = expandedInvoiceId === inv.doc_id;

                    return (
                      <React.Fragment key={`group-${inv.id}`}>
                          <div 
                            onClick={() => setExpandedInvoiceId(isExpanded ? null : (inv.doc_id || null))}
                            className={cn(
                              "grid w-full bg-white hover:bg-[#F5F5F4]/50 transition-colors text-left cursor-pointer",
                              isExpanded && "bg-[#F5F5F4]/30"
                            )}
                            style={{ gridTemplateColumns: getMovementGridTemplate(movementColumns) }}
                          >
                            {movementColumns.map((col) => {
                              if (col.id === 'date') return <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-[10px] flex items-center">{formatDate(inv.date)}</div>;
                              if (col.id === 'doc_id') return <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 font-mono text-[10px] flex items-center">{inv.doc_id}</div>;
                              if (col.id === 'type') return (
                                <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 flex items-center justify-center">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedInvoiceId(inv.id);
                                      setPreviousView('movements');
                                      setView('invoice-document');
                                    }}
                                    className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] font-bold uppercase tracking-widest rounded-full hover:bg-emerald-200 transition-colors"
                                  >
                                    Factura
                                  </button>
                                </div>
                              );
                              if (col.id === 'supplier_name') return (
                                <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-[10px] flex items-center truncate uppercase tracking-tight font-bold">
                                  {inv.supplier_alias || inv.supplier_name}
                                </div>
                              );
                              if (col.id === 'amount') return (
                                <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-right font-mono text-[10px] flex items-center justify-end">
                                  {formatCurrency(inv.amount)}
                                </div>
                              );
                              if (col.id === 'pending') return (
                                <div key={col.id} className={cn(
                                  "p-1 border-r border-[#0A0A0A]/5 text-right font-mono text-[10px] flex items-center justify-end",
                                  inv.pending > 0 ? "text-red-600 font-bold" : "text-emerald-600 opacity-40"
                                )}>
                                  {formatCurrency(inv.pending)}
                                </div>
                              );
                              if (col.id === 'status') return (
                                <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 flex items-center justify-center">
                                  <span className={cn(
                                    "px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded-full",
                                    inv.status === 'LIQUIDADA' ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                                  )}>
                                    {inv.status}
                                  </span>
                                </div>
                              );
                              if (col.id === 'payments') return (
                                <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-center text-[10px] font-bold opacity-40 flex items-center justify-center gap-1">
                                  {inv.payments.length > 0 ? (
                                    <>
                                      <CreditCard size={10} />
                                      {inv.payments.length}
                                    </>
                                  ) : "-"}
                                </div>
                              );
                              return null;
                            })}
                            <div className="p-1 flex items-center justify-center gap-2">
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
                                  <div 
                                    key={`pay-${p.id}`} 
                                    className="grid w-full text-[#0A0A0A]/60 italic border-b border-[#0A0A0A]/5 last:border-b-0"
                                    style={{ gridTemplateColumns: getMovementGridTemplate(movementColumns) }}
                                  >
                                    {movementColumns.map((col) => {
                                      if (col.id === 'date') return <div key={col.id} className="p-1 pl-6 border-r border-[#0A0A0A]/5 text-[9px] flex items-center">{formatDate(p.date)}</div>;
                                      if (col.id === 'doc_id') return <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 font-mono text-[9px] flex items-center opacity-40">{p.doc_id}</div>;
                                      if (col.id === 'type') return (
                                        <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 flex items-center justify-center">
                                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[8px] font-bold uppercase tracking-widest rounded-full">Liquidación</span>
                                        </div>
                                      );
                                      if (col.id === 'supplier_name') return (
                                        <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-[9px] flex items-center truncate uppercase tracking-widest">
                                          <ArrowRight size={10} className="mr-2 opacity-40" />
                                          LIQ: {p.bank_movement_id || p.reference}
                                        </div>
                                      );
                                      if (col.id === 'amount') return <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-right font-mono text-[9px] flex items-center justify-end opacity-20">---</div>;
                                      if (col.id === 'pending') return (
                                        <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-right font-mono text-[9px] flex items-center justify-end text-blue-600 font-bold">
                                          {formatCurrency(p.amount)}
                                        </div>
                                      );
                                      if (col.id === 'status') return <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-center text-[9px] opacity-20 flex items-center justify-center">---</div>;
                                      if (col.id === 'payments') return <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-center text-[9px] opacity-20 flex items-center justify-center">---</div>;
                                      return null;
                                    })}
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
                </div>
              </div>

              <div className="flex justify-end mb-2 px-1">
                <div className="text-[11px] font-bold uppercase tracking-widest text-[#0A0A0A]/30">
                  {filteredAndSortedInvoices.length} registros encontrados
                </div>
              </div>

              <div className="bg-white border border-[#0A0A0A]/10 rounded-sm overflow-hidden shadow-sm">
                <DndContext 
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => handleDragEnd(event, setHistoryColumns)}
                >
                  <div 
                    className="grid border-b border-[#0A0A0A]/10 bg-[#F5F5F4] text-[9px] font-bold uppercase tracking-widest opacity-50"
                    style={{ gridTemplateColumns: getHistoryGridTemplate(historyColumns) }}
                  >
                    <SortableContext items={historyColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                      {historyColumns.map((col, idx) => (
                        <SortableHeader 
                          key={col.id}
                          id={col.id}
                          label={col.label}
                          sortKey={col.sortKey}
                          sortConfig={{ key: invoiceSortField, direction: invoiceSortDirection }}
                          onSort={handleInvoiceSort}
                          isLast={idx === historyColumns.length - 1}
                        />
                      ))}
                    </SortableContext>
                  </div>
                </DndContext>
                <div className="divide-y divide-[#0A0A0A]/5">
                  {filteredAndSortedInvoices.map(inv => (
                    <div 
                      key={inv.id} 
                      className="grid w-full hover:bg-[#F5F5F4]/50 transition-colors group"
                      style={{ gridTemplateColumns: getHistoryGridTemplate(historyColumns) }}
                    >
                      {historyColumns.map((col) => {
                        if (col.id === 'doc_id') return (
                          <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 font-mono text-[10px] font-bold flex items-center">
                            <button 
                              onClick={() => {
                                setSelectedInvoiceId(inv.id);
                                setPreviousView('supplier-detail');
                                setView('invoice-document');
                              }}
                              className="hover:underline text-left"
                            >
                              {inv.doc_id || "-"}
                            </button>
                          </div>
                        );
                        if (col.id === 'doc_ext') return <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 font-mono text-[10px] flex items-center">{inv.doc_ext || "-"}</div>;
                        if (col.id === 'supplier_name') return (
                          <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 flex items-center">
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
                          </div>
                        );
                        if (col.id === 'issue_date') return <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-[10px] opacity-60 flex items-center">{formatDate(inv.issue_date)}</div>;
                        if (col.id === 'concept') return (
                          <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 text-[10px] flex items-center">
                            {editingInvoiceConceptId === inv.id ? (
                              <input 
                                autoFocus
                                value={editingConceptValue}
                                onChange={(e) => setEditingConceptValue(e.target.value)}
                                onBlur={() => handleUpdateInvoiceConcept(inv.id, editingConceptValue)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleUpdateInvoiceConcept(inv.id, editingConceptValue);
                                  if (e.key === 'Escape') setEditingInvoiceConceptId(null);
                                }}
                                className="w-full px-2 py-1 bg-[#F5F5F4] rounded-sm border-none outline-none font-medium"
                              />
                            ) : (
                              <div 
                                onClick={() => {
                                  setEditingInvoiceConceptId(inv.id);
                                  setEditingConceptValue(inv.concept || "");
                                }}
                                className="cursor-pointer hover:bg-[#0A0A0A]/5 px-1 py-0.5 rounded-sm transition-colors truncate max-w-[200px]"
                                title={inv.concept || "Sin concepto"}
                              >
                                {inv.concept || <span className="opacity-30 italic">Sin concepto</span>}
                              </div>
                            )}
                          </div>
                        );
                        if (col.id === 'total_amount') return (
                          <div key={col.id} className="p-1 border-r border-[#0A0A0A]/5 font-mono text-[11px] font-bold text-right flex items-center justify-end">
                            {formatCurrency(inv.total_amount ?? 0)}
                          </div>
                        );
                        if (col.id === 'status') return (
                          <div key={col.id} className="p-1 text-center flex items-center justify-center">
                            <span className={cn(
                              "text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm",
                              inv.status === 'Paid' ? "bg-emerald-50 text-emerald-600" : 
                              inv.status === 'Partial' ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"
                            )}>
                              {inv.status === 'Paid' ? 'LIQUIDADA' : 
                               inv.status === 'Partial' ? 'PARCIAL' : 'PENDIENTE'}
                            </span>
                          </div>
                        );
                        if (col.id === 'actions') return (
                          <div key={col.id} className="p-1 flex items-center justify-center gap-2">
                            {(inv.paid_amount || 0) === 0 && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIsDeletingInvoice(inv);
                                }}
                                className="p-1 text-red-500 hover:bg-red-50 rounded-sm transition-colors"
                                title="Eliminar Factura"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        );
                        return null;
                      })}
                    </div>
                  ))}
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

          {view === 'invoice-document' && selectedInvoiceId && (
            <InvoiceDocument 
              invoiceId={selectedInvoiceId} 
              onBack={() => {
                setView(previousView || 'movements');
                setSelectedInvoiceId(null);
                setPreviousView(null);
                fetchData(); // Refresh data in case of edits
              }} 
            />
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
                  {!useGenericInProposal ? (
                    <>
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
                    </>
                  ) : (
                    <div className="p-6 bg-violet-50 border border-violet-100 rounded-2xl flex flex-col gap-2">
                      <div className="flex items-center gap-3 text-violet-600">
                        <CheckCircle2 size={24} />
                        <h4 className="font-bold uppercase tracking-widest text-sm">Asociación Genérica</h4>
                      </div>
                      <p className="text-xs text-violet-600/70 font-medium">
                        Esta factura se asociará al proveedor genérico configurado en el sistema.
                      </p>
                      {genericSupplier && (
                        <div className="mt-2 pt-2 border-t border-violet-200">
                          <span className="text-[10px] text-violet-600/50 font-bold uppercase tracking-widest block mb-1">Proveedor Destino</span>
                          <span className="text-sm font-bold text-violet-900">{genericSupplier.name}</span>
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="pt-4 border-t border-black/5 flex flex-col gap-4">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div 
                        onClick={() => {
                          setUseGenericInProposal(!useGenericInProposal);
                          setUploadError(null);
                        }}
                        className={cn(
                          "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all",
                          useGenericInProposal ? "bg-[#0A0A0A] border-[#0A0A0A]" : "border-[#0A0A0A]/10 group-hover:border-[#0A0A0A]/30"
                        )}
                      >
                        {useGenericInProposal && <Check size={14} className="text-white" />}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold opacity-60 group-hover:opacity-100 transition-opacity">Asociar a Proveedor Genérico</span>
                    {useGenericInProposal && genericSupplier && (
                          <span className="text-[10px] text-violet-600 font-bold uppercase tracking-widest">
                            Listo para asociar
                          </span>
                        )}
                      </div>
                    </label>

                    {useGenericInProposal && !genericSupplier && (
                      <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600">
                        <AlertCircle size={20} />
                        <p className="text-xs font-bold uppercase tracking-widest">
                          No existe un proveedor genérico configurado.
                        </p>
                      </div>
                    )}

                    {useGenericInProposal && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-[#F5F5F4] p-4 rounded-2xl"
                      >
                        <label className="text-[10px] font-bold uppercase tracking-widest opacity-30 mb-1 block">Concepto del Gasto</label>
                        <input 
                          type="text" 
                          placeholder="Ej: Comida cliente X, Material oficina..."
                          value={proposalConcept}
                          onChange={(e) => setProposalConcept(e.target.value)}
                          className="w-full px-4 py-3 bg-white rounded-xl border-none outline-none font-medium shadow-sm"
                        />
                      </motion.div>
                    )}
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
                      useGenericInProposal ? "Asociar a Genérico" : "Dar de Alta y Asociar"
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

        {isDeletingSupplier && (
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
                    <h3 className="text-lg font-bold tracking-tight uppercase">Eliminar Proveedor</h3>
                    <p className="text-[10px] opacity-60 uppercase tracking-widest font-bold">Acción Irreversible</p>
                  </div>
                </div>
                <button onClick={() => setIsDeletingSupplier(null)} className="opacity-40 hover:opacity-100 transition-opacity"><X size={20} /></button>
              </div>
              <div className="p-8 flex flex-col gap-6 text-center">
                <div className="space-y-2">
                  <p className="text-sm font-bold text-[#0A0A0A]">¿Estás seguro de que deseas eliminar al proveedor <span className="underline">{isDeletingSupplier.name}</span>?</p>
                  <p className="text-[10px] opacity-50 font-medium leading-relaxed uppercase tracking-tight">Solo podrás eliminarlo si no tiene facturas asociadas. Esta acción no se puede deshacer.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setIsDeletingSupplier(null)}
                    className="py-3 bg-[#F5F5F4] text-[#0A0A0A] rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-[#E5E5E4] transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => handleDeleteSupplier(isDeletingSupplier.id)}
                    className="py-3 bg-red-600 text-white rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isDeletingInvoice && (
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
                    <h3 className="text-lg font-bold tracking-tight uppercase">Eliminar Factura</h3>
                    <p className="text-[10px] opacity-60 uppercase tracking-widest font-bold">Acción Irreversible</p>
                  </div>
                </div>
                <button onClick={() => setIsDeletingInvoice(null)} className="opacity-40 hover:opacity-100 transition-opacity"><X size={20} /></button>
              </div>
              <div className="p-8 flex flex-col gap-6 text-center">
                <div className="space-y-2">
                  <p className="text-sm font-bold text-[#0A0A0A]">¿Estás seguro de que deseas eliminar la factura <span className="underline">{isDeletingInvoice.invoice_number}</span>?</p>
                  <p className="text-[10px] opacity-50 font-medium leading-relaxed uppercase tracking-tight">Esta acción eliminará permanentemente la factura y no se puede deshacer.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setIsDeletingInvoice(null)}
                    className="py-3 bg-[#F5F5F4] text-[#0A0A0A] rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-[#E5E5E4] transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => handleDeleteInvoice(isDeletingInvoice.id)}
                    className="py-3 bg-red-600 text-white rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
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

        {/* DEBUG CONSOLE PANEL */}
        <div className="fixed bottom-4 right-4 w-[450px] h-[350px] bg-[#0A0A0A] border border-white/10 rounded-sm shadow-2xl flex flex-col z-[100] overflow-hidden">
          <div className="p-3 bg-white/5 border-b border-white/10 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-violet-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">Debug Console</span>
            </div>
            <button 
              onClick={() => setDebugLogs([])}
              className="text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors"
            >
              Clear Logs
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] leading-relaxed space-y-1">
            {debugLogs.length === 0 ? (
              <div className="text-white/20 italic">No logs yet...</div>
            ) : (
              debugLogs.map((log, i) => (
                <div key={i} className={cn(
                  "break-all",
                  log.type === 'error' ? "text-red-400" : 
                  log.type === 'api' ? "text-emerald-400" : 
                  "text-white/60"
                )}>
                  <span className="opacity-30 mr-2">[{log.time}]</span>
                  <span className="font-bold mr-2">[{log.type.toUpperCase()}]</span>
                  {log.message}
                </div>
              ))
            )}
          </div>
        </div>
      </AnimatePresence>
    </div>
  );
}
