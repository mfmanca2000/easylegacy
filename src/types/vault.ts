// EasyLegacy — Vault TypeScript types (Section 3)
// All fields represent plaintext data that is encrypted before leaving the browser.

export type VaultEntryId = string; // UUID v4
export type ISO8601 = string;
export type IBAN = string; // CH + 19 digits
export type AVSNumber = string; // 756.XXXX.XXXX.XX format

export type VaultCategory =
  | "avs_ahv"
  | "lpp_2nd_pillar"
  | "pillar_3a"
  | "banking"
  | "real_estate"
  | "investments"
  | "insurance"
  | "digital_accounts"
  | "legal_documents"
  | "employer_hr"
  | "vehicles"
  | "subscriptions"
  | "emergency_contacts";

export interface VaultEntry<T> {
  id: VaultEntryId;
  category: VaultCategory;
  title: string;
  createdAt: ISO8601;
  updatedAt: ISO8601;
  notes?: string;
  attachments?: VaultAttachment[];
  data: T;
}

export interface VaultAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description?: string;
}

export interface ContactPerson {
  fullName: string;
  organization?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

// ================================================================
// 1. AVS / AHV — 1st Pillar
// ================================================================
export interface AVSEntry {
  avsNumber: AVSNumber;
  compensationOffice: string;
  compensationOfficePhone?: string;
  compensationOfficeUrl?: string;
  lastStatementYear?: number;
  estimatedWidowsPension?: number;
  cardLocation?: string;
  survivorDeadlineDays: number; // 90
  survivorInstructions: string;
}

// ================================================================
// 2. LPP / BVG — 2nd Pillar
// ================================================================
export interface LPPEntry {
  pensionFundName: string;
  pensionFundAddress?: string;
  pensionFundPhone?: string;
  pensionFundUrl?: string;
  insuredNumber: string;
  widowsPensionCHF?: number;
  orphansPensionCHF?: number;
  deathCapitalCHF?: number;
  currentRegulationsUrl?: string;
  cohabitingPartnerRegistered: boolean;
  cohabitingPartnerRegDate?: ISO8601;
  vestedBenefitsAccounts?: Array<{
    institution: string;
    accountNumber: string;
    balanceCHF?: number;
    phone?: string;
  }>;
  survivorInstructions: string;
}

// ================================================================
// 3. Pillar 3a
// ================================================================
export interface Pillar3aEntry {
  provider: string;
  accountNumber: string;
  accountType: "3a_bank" | "3a_fund" | "3a_insurance";
  estimatedValueCHF?: number;
  beneficiaryDesignation?: string;
  isOutsideEstate: true;
  providerPhone?: string;
  providerUrl?: string;
  documentsRequired: string[];
}

// ================================================================
// 4. Banking
// ================================================================
export interface BankingEntry {
  bankName: string;
  bankBIC?: string;
  accounts: BankAccount[];
  creditCards?: CreditCard[];
  eBankingHint?: string;
  safeDepositBox?: {
    branch: string;
    boxNumber?: string;
    keyLocation: string;
    contents?: string;
  };
  survivorInstructions?: string;
}

export interface BankAccount {
  iban: IBAN;
  accountType: "checking" | "savings" | "investment" | "custody" | "other";
  currency: string;
  label?: string;
  balanceCHF?: number;
  jointAccount: boolean;
}

export interface CreditCard {
  issuer: string;
  lastFourDigits: string;
  expiryMonth: number;
  expiryYear: number;
  limitCHF?: number;
  cancelPhone?: string;
  survivorAction: "cancel_immediately" | "notify_and_cancel" | "transfer_if_joint";
}

// ================================================================
// 5. Real Estate
// ================================================================
export interface RealEstateEntry {
  propertyAddress: string;
  canton: string;
  municipality: string;
  propertyType: "primary_residence" | "secondary" | "rental" | "land" | "other";
  ownershipType: "sole" | "joint" | "co_ownership";
  ownershipSharePct?: number;
  landRegistryRef?: string;
  landRegistryOffice?: string;
  cadastralNumber?: string;
  mortgage?: {
    lender: string;
    accountNumber: string;
    outstandingCHF?: number;
    monthlyPayCHF?: number;
    fixedRateExpiry?: ISO8601;
    phone?: string;
    survivorNote?: string;
  };
  purchaseNotary?: ContactPerson;
  propertyManager?: ContactPerson;
  buildingInsurancePolicy?: string;
  buildingInsuranceProvider?: string;
  estimatedValueCHF?: number;
  lastValuationDate?: ISO8601;
}

// ================================================================
// 6. Investments
// ================================================================
export interface InvestmentsEntry {
  broker: string;
  accountNumber?: string;
  loginHint?: string;
  estimatedValueCHF?: number;
  currency?: string;
  lastStatementDate?: ISO8601;
  majorHoldings?: string;
  taxDocumentNote?: string;
  bereavementPhone?: string;
  survivorInstructions?: string;
}

// ================================================================
// 7. Insurance
// ================================================================
export type InsuranceType =
  | "lamal_basic"
  | "lca_supplementary"
  | "life"
  | "accident"
  | "household_contents"
  | "liability"
  | "building"
  | "vehicle"
  | "travel"
  | "other";

export interface InsuranceEntry {
  insuranceType: InsuranceType;
  provider: string;
  policyNumber: string;
  coverageSummary?: string;
  annualPremiumCHF?: number;
  nextRenewal?: ISO8601;
  phone?: string;
  claimsPhone?: string;
  lamal?: {
    franchise: 300 | 500 | 1000 | 1500 | 2000 | 2500;
    model: "standard" | "HMO" | "telemed" | "family_doctor" | "other";
    premiumsPrepaid: boolean;
    refundPhone?: string;
  };
  life?: {
    beneficiary: string;
    sumInsuredCHF?: number;
    expiryDate?: ISO8601;
    surrenderValueCHF?: number;
    linkedTo3b: boolean;
  };
  survivorInstructions?: string;
}

// ================================================================
// 8. Digital Accounts
// ================================================================
export type PostDeathWish =
  | "delete"
  | "memorialise"
  | "transfer_to_spouse"
  | "download_data_then_delete"
  | "leave_as_is"
  | "other";

export interface DigitalAccountEntry {
  serviceName: string;
  serviceUrl?: string;
  accountEmail?: string;
  loginHint?: string;
  accountType:
    | "email"
    | "social_media"
    | "cloud_storage"
    | "streaming"
    | "professional"
    | "financial"
    | "other";
  postDeathWish: PostDeathWish;
  postDeathNote?: string;
  legacyFeatureConfigured?: boolean;
  legacyFeatureNotes?: string;
  deletionUrl?: string;
  deletionPhone?: string;
}

// ================================================================
// 9. Legal Documents
// ================================================================
export type LegalDocType =
  | "testament"
  | "notarised_will"
  | "erbvertrag"
  | "patientenverfuegung"
  | "vorsorgeauftrag"
  | "vollmacht"
  | "ehevertrag"
  | "familienausweis"
  | "marriage_certificate"
  | "birth_certificate"
  | "other";

export interface LegalDocumentsEntry {
  documentType: LegalDocType;
  originalLocation: string;
  lastUpdated?: ISO8601;
  notary?: ContactPerson;
  registeredInNationalRegistry?: boolean;
  registryReference?: string;
  hasScanAttached: boolean;
  will?: {
    formType: "holographic" | "notarised";
    isEntirelyHandwritten: boolean;
    dateSigned: ISO8601;
  };
  patientenverfuegung?: {
    dateSignedByHand: ISO8601;
    therapeuticRepresentative?: ContactPerson;
    depositedWith: string[];
    lastReviewedDate?: ISO8601;
    formModel?: string;
    walletCardLocation?: string;
  };
  vorsorgeauftrag?: {
    formType: "holographic" | "notarised";
    mandatary: ContactPerson;
    scope: ("personal_care" | "financial_affairs" | "legal_representation")[];
  };
}

// ================================================================
// 10. Employer / HR
// ================================================================
export interface EmployerHREntry {
  employerName: string;
  hrContactName?: string;
  hrContactEmail?: string;
  hrContactPhone?: string;
  employeeNumber?: string;
  startDate?: ISO8601;
  salaryContinuationMonths?: number;
  deathBenefitCHF?: number;
  groupLifePolicyNumber?: string;
  collectiveLaborAgreement?: string;
  unusedVacationDays?: number;
  expensesToClaim?: string;
  survivorInstructions: string;
}

// ================================================================
// 11. Vehicles
// ================================================================
export interface VehicleEntry {
  vehicleType: "car" | "motorcycle" | "bicycle" | "boat" | "other";
  make: string;
  model: string;
  year: number;
  licensePlate?: string;
  vin?: string;
  ownership: "owned" | "leased" | "company_car";
  leasing?: {
    company: string;
    contractEnd: ISO8601;
    monthlyPayCHF: number;
    remainingCHF?: number;
    phone?: string;
  };
  registrationDocLocation?: string;
  insurancePolicyNumber?: string;
  insuranceProvider?: string;
  survivorInstructions?: string;
}

// ================================================================
// 12. Subscriptions
// ================================================================
export interface SubscriptionEntry {
  serviceName: string;
  billingEmail?: string;
  amountCHF?: number;
  period?: "monthly" | "annual" | "other";
  nextBillingDate?: ISO8601;
  paymentMethod?: string;
  cancellationUrl?: string;
  cancellationPhone?: string;
  priority: "cancel_immediately" | "cancel_after_1_month" | "review" | "transfer";
}

// ================================================================
// 13. Emergency Contacts
// ================================================================
export type EmergencyContactRole =
  | "trusted_person"
  | "notary"
  | "lawyer"
  | "family_doctor"
  | "specialist_doctor"
  | "accountant"
  | "financial_advisor"
  | "executor_of_will"
  | "close_family"
  | "close_friend"
  | "employer_hr"
  | "other";

export interface EmergencyContactEntry {
  role: EmergencyContactRole;
  fullName: string;
  relationship?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  address?: string;
  firmName?: string;
  fileReference?: string;
  availability?: string;
  notes?: string;
}

// ================================================================
// VAULT ROOT
// ================================================================
export interface VaultManifest {
  version: "1";
  vaultId: string;
  ownerName: string;
  spouseName: string;
  createdAt: ISO8601;
  lastModifiedAt: ISO8601;
  kdf: {
    algorithm: "argon2id";
    m: number;
    t: number;
    p: number;
    saltBase64: string;
  };
  entriesCount: number;
}

export type Vault = {
  manifest: VaultManifest;
  entries: {
    avs_ahv: VaultEntry<AVSEntry>[];
    lpp_2nd_pillar: VaultEntry<LPPEntry>[];
    pillar_3a: VaultEntry<Pillar3aEntry>[];
    banking: VaultEntry<BankingEntry>[];
    real_estate: VaultEntry<RealEstateEntry>[];
    investments: VaultEntry<InvestmentsEntry>[];
    insurance: VaultEntry<InsuranceEntry>[];
    digital_accounts: VaultEntry<DigitalAccountEntry>[];
    legal_documents: VaultEntry<LegalDocumentsEntry>[];
    employer_hr: VaultEntry<EmployerHREntry>[];
    vehicles: VaultEntry<VehicleEntry>[];
    subscriptions: VaultEntry<SubscriptionEntry>[];
    emergency_contacts: VaultEntry<EmergencyContactEntry>[];
  };
};

// Encrypted blob shape returned by the server
export interface EncryptedBlob {
  entryId: string;
  category: string;
  iv: string;
  ciphertext: string;
  aad: string;
}
