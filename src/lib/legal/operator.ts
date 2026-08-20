export interface LegalOperator {
  legalName: string;
  legalAddress: string;
  privacyEmail: string;
  companyNumber?: string;
  vatNumber?: string;
  icoNumber?: string;
}

export function legalOperatorConfig(): LegalOperator | null {
  const legalName = process.env.NEXT_PUBLIC_LEGAL_NAME?.trim() || "";
  const legalAddress = process.env.NEXT_PUBLIC_LEGAL_ADDRESS?.trim() || "";
  const privacyEmail = process.env.NEXT_PUBLIC_PRIVACY_EMAIL?.trim() || "";
  if (legalName.length < 2 || legalAddress.length < 12 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacyEmail)) return null;
  return {
    legalName,
    legalAddress,
    privacyEmail,
    companyNumber: process.env.NEXT_PUBLIC_COMPANY_NUMBER?.trim() || undefined,
    vatNumber: process.env.NEXT_PUBLIC_VAT_NUMBER?.trim() || undefined,
    icoNumber: process.env.NEXT_PUBLIC_ICO_NUMBER?.trim() || undefined,
  };
}
