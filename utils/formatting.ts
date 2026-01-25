
// Centralized formatting utilities for consistent UI

export const formatDate = (dateStr: string | undefined | null): string => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  
  // Returns DD-MMM-YYYY (e.g. 25-Mar-2023)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
};

export const formatCurrency = (val: number | undefined | null): string => {
  if (val === undefined || val === null) return '₹0';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);
};

export const parseExcelDate = (dateVal: any): string => {
    if (!dateVal) return new Date().toISOString().split('T')[0];
    
    // Excel Serial Date handling (approximate 1900 epoch)
    if (typeof dateVal === 'number') {
        // 25569 is the offset for Unix epoch
        const dateObj = new Date((dateVal - 25569) * 86400 * 1000);
        if (!isNaN(dateObj.getTime())) {
             return dateObj.toISOString().split('T')[0];
        }
        return new Date().toISOString().split('T')[0]; // Fallback to today if invalid
    }
    
    const strVal = String(dateVal).trim();
    
    // Handle DD-MM-YYYY or DD/MM/YYYY (Numeric)
    // We assume DD-MM-YYYY if parts are ambiguous and > 12
    const dmyMatch = strVal.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmyMatch) {
        const day = dmyMatch[1].padStart(2, '0');
        const month = dmyMatch[2].padStart(2, '0');
        const year = dmyMatch[3];
        return `${year}-${month}-${day}`; // Return ISO for DB storage
    }

    // Handle DD-MMM-YYYY (Text) e.g. 01-Jan-2023
    const dMonYMatch = strVal.match(/^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{4})$/);
    if (dMonYMatch) {
         const d = new Date(strVal);
         if (!isNaN(d.getTime())) {
             // Adjust for timezone offset to prevent date shifting
             const offset = d.getTimezoneOffset();
             const adjustedDate = new Date(d.getTime() - (offset*60*1000));
             return adjustedDate.toISOString().split('T')[0];
         }
    }

    // Fallback to standard parser
    const d = new Date(strVal);
    if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
    }
    
    return new Date().toISOString().split('T')[0]; // Final fallback to today
};
