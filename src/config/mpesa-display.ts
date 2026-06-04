/** Lipa na M-Pesa details shown when passengers choose Paybill or Till (not STK). */
export type MpesaDisplayConfig = {
  businessName: string;
  paybill: string | null;
  till: string | null;
};

export function getMpesaDisplayConfig(): MpesaDisplayConfig {
  const paybill = process.env.SONGA_MPESA_PAYBILL?.trim() || process.env.MPESA_SHORTCODE?.trim() || null;
  const till = process.env.SONGA_MPESA_TILL?.trim() || null;
  return {
    businessName: process.env.SONGA_MPESA_BUSINESS_NAME?.trim() || "Songa",
    paybill: paybill && paybill.length > 0 ? paybill : null,
    till: till && till.length > 0 ? till : null,
  };
}
