# EasyLegacy — Technical & Product Specification v3 (FINAL)
**May 2026 — Personal use (two people), server-stored encrypted vault, request-based trust transfer**
**Stack: Next.js 15 · TypeScript · shadcn/ui · Zod · Prisma · PostgreSQL · Web Crypto API · Argon2id**
**Deployment: Coolify on Hetzner VPS · arivederlestelle.org**

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER (owner or spouse — any device)                         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Next.js App (React, shadcn/ui)                         │    │
│  │                                                         │    │
│  │  ┌──────────────────┐   ┌──────────────────────────┐   │    │
│  │  │  Web Crypto API  │   │  React UI / Vault Forms  │   │    │
│  │  │  (AES-256-GCM)   │   │  (all data decrypted     │   │    │
│  │  │  Argon2id WASM   │   │   only here, in RAM)     │   │    │
│  │  └──────────────────┘   └──────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
│              │ HTTPS — encrypted blobs only (never plaintext)   │
└──────────────┼──────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  HETZNER VPS / COOLIFY                                          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Next.js API Routes                                     │    │
│  │  /api/vault/push   — receive encrypted blobs            │    │
│  │  /api/vault/pull   — serve encrypted blobs              │    │
│  │  /api/auth/*       — session management (owner only)    │    │
│  │  /api/trust/*      — trust transfer state machine       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  PostgreSQL (Prisma)                                    │    │
│  │  • vault_blobs      — encrypted entry ciphertext only   │    │
│  │  • trust_requests   — token hashes, state, timestamps   │    │
│  │  • auth_sessions    — owner session tokens              │    │
│  │  NO plaintext data ever stored here                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Email (Resend / SMTP)                                  │    │
│  │  • Trust request notification to owner                  │    │
│  │  • Access granted notification to spouse                │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**Core principle:** The server is a dumb encrypted blob store + email relay.
It never receives, processes, or stores any plaintext vault data.
All cryptographic operations happen exclusively in the browser via Web Crypto API.

---

## Section 1 — Threat Model & Privacy Architecture

### 1.1 Realistic Attack Vectors

| Threat Actor | Likelihood | Mitigation |
|---|---|---|
| Hetzner/VPS breach | Medium | Server stores only ciphertext — breach yields nothing usable |
| Your device stolen | Medium | Vault encrypted with AES-256-GCM; VEK never persisted to disk |
| Spouse premature access | Low | Requires: server shard + QR code (VST) + Spouse PIN — all three |
| Trust request intercepted | Low | Token is single-use, short-lived, hashed on server |
| Master password forgotten | High (usability) | Argon2id recovery shard stored in printed emergency card |
| Brute force on encrypted blobs | Negligible | Argon2id with m=65536 makes this infeasible |
| XSS on your domain | Low-Medium | Strict CSP; no third-party scripts; crypto in isolated module |
| MITM on HTTPS | Negligible | TLS + HSTS; Coolify handles cert via Let's Encrypt |

**What NEVER leaves the browser unencrypted:**
- Any vault entry field (passwords, IBANs, AVS numbers, medical directives)
- The master password or any derivative
- The VEK (Vault Encryption Key)
- The Spouse PIN
- The raw VST (Vault Share Token)

**What the server stores (and can see):**
- Encrypted vault blobs (ciphertext + IV — no key, no plaintext)
- SHA-256 hashes of email addresses (for routing notifications)
- SHA-256 hash of the access token (not the token itself)
- Trust request state (pending / blocked / granted / expired)
- Encrypted VEK shard for spouse (encrypted with SpousePIN ⊕ VST — server cannot decrypt)
- Session tokens for owner authentication (hashed)

### 1.2 Why Client-Side AES-256-GCM

The fundamental security guarantee of EasyLegacy is that **the server operator
(you, or anyone who clones and self-hosts) cannot read vault contents**,
even with full database access. This requires:

- Encryption before any data leaves the browser
- The encryption key (VEK) derived from a secret that never reaches the server
- The Web Crypto API provides AES-256-GCM natively — no third-party crypto library,
  no supply-chain risk, audited by browser vendors

Server-side encryption would mean the server holds the key → server breach = data breach.
Zero-knowledge SaaS shifts the trust problem to a vendor you don't control.
Client-side encryption on your own server is the only model where you trust nobody but yourself.

### 1.3 Key Derivation Strategy

```
Master Password  ← only ever in RAM, cleared after KDF
       │
       ▼
Argon2id (WASM in browser)
  ├─ memory: 65536 KB (64 MB)
  ├─ iterations: 3
  ├─ parallelism: 4
  └─ salt: 32 bytes, random per vault, stored in vault header (public, not secret)
       │
       ▼ 256-bit key material
       │
       ├─ HKDF(info="easylegal-vek-v1")  → VEK   — AES-256-GCM, encrypt/decrypt all entries
       ├─ HKDF(info="easylegal-mak-v1")  → MAK   — HMAC-SHA256, manifest tamper detection
       └─ HKDF(info="easylegal-kwk-v1")  → KWK   — AES-256-GCM, wraps VEK for spouse shard
```

All derived keys are imported as `CryptoKey` objects with `extractable: false`.
The raw key material is zeroed immediately after import.
Closing the browser tab destroys all keys.

### 1.4 Trust Transfer Cryptography

**At setup time (owner):**

```
1. Generate VST: 256 random bits  (crypto.getRandomValues)
2. Generate SpousePIN: 6 digits   (communicated verbally or in sealed envelope)
3. Compute wrap key: Argon2id(SpousePIN, salt2) XOR VST
4. Encrypted shard = AES-256-GCM(KWK, plaintext=VEK, aad="spouse-shard-v1")
   then wrap: AES-256-GCM(wrapKey, plaintext=encryptedShard)
5. Store encrypted shard on server
6. Print Emergency Card containing: VST as QR code
```

**When spouse accesses the vault:**

```
encrypted shard  (downloaded from server after access is granted)
       +
VST              (scanned from printed QR code)
       +
SpousePIN        (known verbally)
       │
       ▼
wrapKey = Argon2id(SpousePIN, salt2) XOR VST
       │
       ▼
Unwrap → encryptedShard → VEK
       │
       ▼
Decrypt all vault entries → read-only session
```

**Security of this scheme:**
- Server alone: has encryptedShard, cannot unwrap without wrapKey
- QR code alone: has VST, cannot compute wrapKey without SpousePIN
- SpousePIN alone: cannot compute wrapKey without VST
- Server + QR: has VST + shard, still needs SpousePIN
- QR + PIN: has wrapKey, but no encryptedShard until server grants access
- All three: full access — only possible after trust transfer flow completes

---

## Section 2 — Trust Transfer UX Flow (Request-Based)

### 2.1 Overview

```
SPOUSE                          SERVER                         OWNER
  │                               │                              │
  │── "Request Access" click ────▶│                              │
  │                               │── Email: "Access requested" ▶│
  │                               │   "Block within 7 days"      │
  │◀── "Request received" ────────│                              │
  │    "You will hear back                                       │
  │     within 7 days"            │                              │
  │                               │                    [reads email]
  │                               │                              │
  │                               │          [does nothing]  OR  │── "Block" click ──▶│
  │                               │                              │                    │
  │              [7 days pass]    │                              │   Request cancelled │
  │                               │                              │                    │
  │◀── Email: "Access granted" ───│                              │
  │    "Download vault +          │                              │
  │     your access key"          │                              │
  │                               │                              │
  │── Open Emergency Card ────────────────────────────────────────────────────────────
  │   Scan QR code                │                              │
  │   Enter Spouse PIN            │                              │
  │                               │                              │
  │── Download encrypted shard ──▶│                              │
  │◀── Encrypted shard ───────────│                              │
  │                               │                              │
  │   Reconstruct VEK in browser  │                              │
  │   Decrypt vault entries       │                              │
  │   Read-only vault session     │                              │
```

### 2.2 Setup Flow (Owner — one time, ~10 minutes)

```
Step 1 — Create master password
  └─ Argon2id KDF runs → VEK + MAK + KWK derived in memory

Step 2 — Configure trust transfer
  ├─ Enter your email address (owner)
  ├─ Enter spouse's email address
  ├─ Set waiting period: 3 / 7 / 14 / 30 days  (default: 7)
  └─ Set Spouse PIN: 4–8 digits

Step 3 — Generate Vault Share Token
  ├─ Browser generates 256-bit VST
  ├─ Browser computes wrap key and encrypts VEK shard
  └─ Encrypted shard uploaded to server  (server cannot decrypt it)

Step 4 — Print Emergency Card
  ├─ App generates a print-ready A5 card containing:
  │   ├─ QR code (encodes the VST)
  │   ├─ Instructions for spouse in plain language
  │   ├─ URL of the app (arivederlestelle.org)
  │   └─ "Spouse PIN: ask [owner name] — not written here"
  ├─ Print → place in sealed envelope
  └─ Store in known location (safe, notary, trusted person)

Step 5 — Confirm setup
  └─ Checklist: ✓ Vault created  ✓ Trust transfer configured  ✓ Emergency card printed
```

### 2.3 Request Flow (Spouse — when needed)

```
Step 1 — Spouse opens app  (arivederlestelle.org)
  └─ Sees: "Owner mode" / "Request access (spouse)"

Step 2 — Clicks "Request Access"
  ├─ Enters her name  (for the notification email)
  └─ Server: creates TrustRequest record, sends email to owner

Step 3 — Waiting period
  ├─ Spouse sees: "Request sent. You will receive an email within 7 days."
  ├─ Owner receives email immediately:
  │   Subject: "EasyLegacy — [SpouseName] has requested access to your vault"
  │   Body:    "If this is expected, do nothing. Access will be granted in 7 days.
  │             If this is unexpected, click BLOCK ACCESS immediately."
  │             [BLOCK ACCESS button — single click, no login required]
  ├─ Owner receives reminder at day 5: "Access will be granted in 2 days"
  └─ If owner clicks BLOCK: request cancelled, spouse notified, log retained

Step 4 — Access granted (day 7, if not blocked)
  └─ Server sends email to spouse:
      Subject: "EasyLegacy — Access granted"
      Body:    "You can now access the vault. You will need:
                1. The emergency card (printed QR code)
                2. The Spouse PIN
                Click here to access: [link — valid 14 days]"

Step 5 — Spouse decrypts vault
  ├─ Opens the link
  ├─ App page: "Emergency Access"
  ├─ Step A: Scan QR code from emergency card  (or upload photo)
  ├─ Step B: Enter Spouse PIN
  ├─ Browser downloads encrypted shard from server
  ├─ Browser reconstructs VEK  (Argon2id + XOR in-browser)
  ├─ Browser downloads all encrypted vault blobs
  ├─ Browser decrypts → vault opens in READ-ONLY mode
  └─ Session active until browser closes (VEK not persisted)
```

### 2.4 Security Properties of This Flow

| Scenario | Outcome |
|---|---|
| Spouse requests access, owner is alive and sees email | Owner clicks Block → no access, takes 2 seconds |
| Spouse requests access, owner is dead | No one blocks → access granted after 7 days |
| Attacker sends a fake request | Owner blocks immediately; attacker never gets the shard |
| Attacker intercepts the grant email | Has a link but no QR code and no Spouse PIN → useless |
| Attacker steals the QR code | Has VST but no Spouse PIN and no encrypted shard → useless |
| Attacker gets DB access | Has encrypted shard, no VST, no PIN → useless |
| Spouse forgets PIN | Owner must generate a new shard with a new PIN + reprint card |
| Link expires (14 days) | Owner can re-trigger from settings, or spouse can re-request |

---

## Section 3 — Swiss-Specific Vault Schema (TypeScript)

```typescript
// ================================================================
// BASE TYPES
// ================================================================

export type VaultEntryId = string;   // UUID v4
export type ISO8601     = string;
export type IBAN        = string;    // CH + 19 digits
export type AVSNumber   = string;    // 756.XXXX.XXXX.XX format

export type VaultCategory =
  | 'avs_ahv'
  | 'lpp_2nd_pillar'
  | 'pillar_3a'
  | 'banking'
  | 'real_estate'
  | 'investments'
  | 'insurance'
  | 'digital_accounts'
  | 'legal_documents'
  | 'employer_hr'
  | 'vehicles'
  | 'subscriptions'
  | 'emergency_contacts';

export interface VaultEntry<T> {
  id:          VaultEntryId;
  category:    VaultCategory;
  title:       string;           // human label, e.g. "UBS — Compte salaire"
  createdAt:   ISO8601;
  updatedAt:   ISO8601;
  notes?:      string;
  attachments?: VaultAttachment[];
  data:        T;
}

export interface VaultAttachment {
  id:          string;
  filename:    string;
  mimeType:    string;
  sizeBytes:   number;
  description?: string;
  // encrypted blob stored separately in vault file
}

export interface ContactPerson {
  fullName:      string;
  organization?: string;
  phone?:        string;
  email?:        string;
  address?:      string;
  notes?:        string;
}

// ================================================================
// 1. AVS / AHV — 1st Pillar
// ================================================================
export interface AVSEntry {
  avsNumber:                AVSNumber;   // NAVS13: 756.XXXX.XXXX.XX
  compensationOffice:       string;      // Caisse cantonale vaudoise de compensation
  compensationOfficePhone?: string;
  compensationOfficeUrl?:   string;
  lastStatementYear?:       number;
  estimatedWidowsPension?:  number;      // CHF/month — ~80% of owner's projected pension
  // AHV-Ausweis / Carte AVS location
  cardLocation?:            string;
  // Action for surviving spouse:
  // Must contact Ausgleichskasse within 3 months of death
  survivorDeadlineDays:     number;      // 90
  survivorInstructions:     string;
}

// ================================================================
// 2. LPP / BVG — 2nd Pillar
// ================================================================
export interface LPPEntry {
  pensionFundName:         string;
  pensionFundAddress?:     string;
  pensionFundPhone?:       string;
  pensionFundUrl?:         string;
  insuredNumber:           string;
  // Key figures from PK-Ausweis (uploaded annually)
  widowsPensionCHF?:       number;      // typically 60% of insured retirement pension
  orphansPensionCHF?:      number;      // typically 20% per child
  deathCapitalCHF?:        number;      // Todesfallkapital — often 1-2 annual salaries
  currentRegulationsUrl?:  string;
  // CRITICAL for unmarried partners — must be pre-registered
  cohabitingPartnerRegistered:  boolean;
  cohabitingPartnerRegDate?:    ISO8601;
  // Vested benefits (gaps between jobs)
  vestedBenefitsAccounts?: Array<{
    institution:    string;
    accountNumber:  string;
    balanceCHF?:    number;
    phone?:         string;
  }>;
  survivorInstructions: string;
}

// ================================================================
// 3. Pillar 3a
// ================================================================
export interface Pillar3aEntry {
  provider:         string;   // e.g. "VIAC", "finpension", "PostFinance"
  accountNumber:    string;
  accountType:      '3a_bank' | '3a_fund' | '3a_insurance';
  estimatedValueCHF?: number;
  // Beneficiary order (OPP3 Art. 2 — goes outside estate, BUT
  // value added back for forced-share / Pflichtteil computation)
  beneficiaryDesignation?: string;
  isOutsideEstate:         true;  // always true for pillar 3a
  providerPhone?:          string;
  providerUrl?:            string;
  // Documents the survivor must present
  documentsRequired: string[];  // e.g. ["Acte de décès", "Livret de famille", "ID"]
}

// ================================================================
// 4. Banking
// ================================================================
export interface BankingEntry {
  bankName:     string;
  bankBIC?:     string;
  accounts:     BankAccount[];
  creditCards?: CreditCard[];
  // Reference to password manager — NEVER store plaintext credentials
  eBankingHint?: string;  // e.g. "Credentials in Bitwarden entry 'UBS e-banking'"
  safeDepositBox?: {
    branch:        string;
    boxNumber?:    string;
    keyLocation:   string;
    contents?:     string;
  };
  survivorInstructions?: string;
}

export interface BankAccount {
  iban:          IBAN;
  accountType:   'checking' | 'savings' | 'investment' | 'custody' | 'other';
  currency:      string;
  label?:        string;
  balanceCHF?:   number;
  jointAccount:  boolean;
}

export interface CreditCard {
  issuer:          string;
  lastFourDigits:  string;
  expiryMonth:     number;
  expiryYear:      number;
  limitCHF?:       number;
  cancelPhone?:    string;
  survivorAction:  'cancel_immediately' | 'notify_and_cancel' | 'transfer_if_joint';
}

// ================================================================
// 5. Real Estate
// ================================================================
export interface RealEstateEntry {
  propertyAddress:    string;
  canton:             string;
  municipality:       string;
  propertyType:       'primary_residence' | 'secondary' | 'rental' | 'land' | 'other';
  ownershipType:      'sole' | 'joint' | 'co_ownership';
  ownershipSharePct?: number;
  // Registre foncier / Grundbuch
  landRegistryRef?:   string;
  landRegistryOffice?: string;
  cadastralNumber?:   string;
  // Mortgage
  mortgage?: {
    lender:           string;
    accountNumber:    string;
    outstandingCHF?:  number;
    monthlyPayCHF?:   number;
    fixedRateExpiry?: ISO8601;
    phone?:           string;
    survivorNote?:    string;
  };
  purchaseNotary?:     ContactPerson;
  propertyManager?:    ContactPerson;
  buildingInsurancePolicy?: string;
  buildingInsuranceProvider?: string;
  estimatedValueCHF?: number;
  lastValuationDate?: ISO8601;
}

// ================================================================
// 6. Investments
// ================================================================
export interface InvestmentsEntry {
  broker:            string;   // e.g. "DEGIRO", "Interactive Brokers", "Swissquote"
  accountNumber?:    string;
  loginHint?:        string;   // reference to password manager only
  estimatedValueCHF?: number;
  currency?:         string;
  lastStatementDate?: ISO8601;
  majorHoldings?:    string;   // e.g. "VWCE, Gold ETC, Tesla"
  taxDocumentNote?:  string;
  bereavementPhone?: string;
  survivorInstructions?: string;
}

// ================================================================
// 7. Insurance
// ================================================================
export type InsuranceType =
  | 'lamal_basic'         // KVG/LAMal — obligatory health
  | 'lca_supplementary'   // LCA/VVG — supplementary health
  | 'life'                // life / Pillar 3b
  | 'accident'            // UVG/LAA
  | 'household_contents'  // Hausrat / ménage
  | 'liability'           // RC privée / Haftpflicht
  | 'building'
  | 'vehicle'
  | 'travel'
  | 'other';

export interface InsuranceEntry {
  insuranceType:    InsuranceType;
  provider:         string;
  policyNumber:     string;
  coverageSummary?: string;
  annualPremiumCHF?: number;
  nextRenewal?:     ISO8601;
  phone?:           string;
  claimsPhone?:     string;
  // LAMal specifics
  lamal?: {
    franchise:   300 | 500 | 1000 | 1500 | 2000 | 2500;
    model:       'standard' | 'HMO' | 'telemed' | 'family_doctor' | 'other';
    premiumsPrepaid: boolean;
    refundPhone?:   string;  // to reclaim prepaid premiums
  };
  // Life insurance / 3b specifics
  life?: {
    beneficiary:      string;
    sumInsuredCHF?:   number;
    expiryDate?:      ISO8601;
    surrenderValueCHF?: number;
    linkedTo3b:       boolean;
  };
  survivorInstructions?: string;
}

// ================================================================
// 8. Digital Accounts
// ================================================================
export type PostDeathWish =
  | 'delete'
  | 'memorialise'
  | 'transfer_to_spouse'
  | 'download_data_then_delete'
  | 'leave_as_is'
  | 'other';

export interface DigitalAccountEntry {
  serviceName:      string;
  serviceUrl?:      string;
  accountEmail?:    string;
  loginHint?:       string;   // reference to password manager only
  accountType:      'email' | 'social_media' | 'cloud_storage' | 'streaming'
                  | 'professional' | 'financial' | 'other';
  postDeathWish:    PostDeathWish;
  postDeathNote?:   string;
  // Built-in legacy features
  legacyFeatureConfigured?: boolean;
  legacyFeatureNotes?:      string;
  // Deletion / memorialisation contact
  deletionUrl?:      string;
  deletionPhone?:    string;
}

// ================================================================
// 9. Legal Documents
// ================================================================
export type LegalDocType =
  | 'testament'            // holographic will — Art. 505 CC
  | 'notarised_will'       // public deed will — Art. 499 CC
  | 'erbvertrag'           // inheritance contract — Art. 512 CC
  | 'patientenverfuegung'  // advance medical directive — Art. 370-373 CC
  | 'vorsorgeauftrag'      // lasting power of attorney — Art. 360 CC
  | 'vollmacht'            // general power of attorney
  | 'ehevertrag'           // marriage contract
  | 'familienausweis'      // family record book (livret de famille)
  | 'marriage_certificate'
  | 'birth_certificate'
  | 'other';

export interface LegalDocumentsEntry {
  documentType:     LegalDocType;
  originalLocation: string;   // physical location of the signed original
  lastUpdated?:     ISO8601;
  notary?:          ContactPerson;
  // Swiss wills register
  registeredInNationalRegistry?: boolean;
  registryReference?:            string;
  // Scan attached (for reference — NOT legally binding substitute)
  hasScanAttached:  boolean;
  // Type-specific fields
  will?: {
    formType:             'holographic' | 'notarised';
    isEntirelyHandwritten: boolean;   // must be true for holographic
    dateSigned:           ISO8601;
    // App always shows a warning: EasyLegacy CANNOT replace a handwritten will
  };
  patientenverfuegung?: {
    // Art. 370-373 CC — federal, applies in all cantons incl. Vaud
    dateSignedByHand:       ISO8601;
    therapeuticRepresentative?: ContactPerson;
    depositedWith:          string[];   // e.g. ["family doctor", "hospital"]
    lastReviewedDate?:      ISO8601;    // FMH recommends review every ~2 years
    formModel?:             string;     // e.g. "FMH model Oct 2022"
    walletCardLocation?:    string;
  };
  vorsorgeauftrag?: {
    // Art. 360 CC — must be entirely handwritten or notarised
    formType:  'holographic' | 'notarised';
    mandatary: ContactPerson;
    scope:     ('personal_care' | 'financial_affairs' | 'legal_representation')[];
  };
}

// ================================================================
// 10. Employer / HR
// ================================================================
export interface EmployerHREntry {
  employerName:             string;
  hrContactName?:           string;
  hrContactEmail?:          string;
  hrContactPhone?:          string;
  employeeNumber?:          string;
  startDate?:               ISO8601;
  salaryContinuationMonths?: number;   // CH: typically 1-3 months
  deathBenefitCHF?:         number;    // employer lump-sum (separate from LPP)
  groupLifePolicyNumber?:   string;
  collectiveLaborAgreement?: string;
  unusedVacationDays?:      number;
  expensesToClaim?:         string;
  survivorInstructions:     string;
}

// ================================================================
// 11. Vehicles
// ================================================================
export interface VehicleEntry {
  vehicleType:   'car' | 'motorcycle' | 'bicycle' | 'boat' | 'other';
  make:          string;
  model:         string;
  year:          number;
  licensePlate?: string;   // e.g. "VD 123456"
  vin?:          string;
  ownership:     'owned' | 'leased' | 'company_car';
  leasing?: {
    company:         string;
    contractEnd:     ISO8601;
    monthlyPayCHF:   number;
    remainingCHF?:   number;
    phone?:          string;
  };
  registrationDocLocation?: string;   // "Permis de circulation"
  insurancePolicyNumber?:   string;
  insuranceProvider?:       string;
  survivorInstructions?:    string;
}

// ================================================================
// 12. Subscriptions
// ================================================================
export interface SubscriptionEntry {
  serviceName:      string;
  billingEmail?:    string;
  amountCHF?:       number;
  period?:          'monthly' | 'annual' | 'other';
  nextBillingDate?: ISO8601;
  paymentMethod?:   string;   // e.g. "Visa ending 4242" — no full PAN
  cancellationUrl?: string;
  cancellationPhone?: string;
  priority:         'cancel_immediately' | 'cancel_after_1_month' | 'review' | 'transfer';
}

// ================================================================
// 13. Emergency Contacts
// ================================================================
export type EmergencyContactRole =
  | 'trusted_person'     // the spouse / legacy contact
  | 'notary'
  | 'lawyer'
  | 'family_doctor'
  | 'specialist_doctor'
  | 'accountant'
  | 'financial_advisor'
  | 'executor_of_will'
  | 'close_family'
  | 'close_friend'
  | 'employer_hr'
  | 'other';

export interface EmergencyContactEntry {
  role:            EmergencyContactRole;
  fullName:        string;
  relationship?:   string;
  phone?:          string;
  mobile?:         string;
  email?:          string;
  address?:        string;
  firmName?:       string;
  fileReference?:  string;
  availability?:   string;
  notes?:          string;
}

// ================================================================
// VAULT ROOT
// ================================================================
export interface VaultManifest {
  version:         '1';
  vaultId:         string;
  ownerName:       string;
  spouseName:      string;
  createdAt:       ISO8601;
  lastModifiedAt:  ISO8601;
  kdf: {
    algorithm:  'argon2id';
    m:          number;
    t:          number;
    p:          number;
    saltBase64: string;   // public salt for owner KDF
  };
  entriesCount:    number;
}

export type Vault = {
  manifest: VaultManifest;
  entries: {
    avs_ahv:            VaultEntry<AVSEntry>[];
    lpp_2nd_pillar:     VaultEntry<LPPEntry>[];
    pillar_3a:          VaultEntry<Pillar3aEntry>[];
    banking:            VaultEntry<BankingEntry>[];
    real_estate:        VaultEntry<RealEstateEntry>[];
    investments:        VaultEntry<InvestmentsEntry>[];
    insurance:          VaultEntry<InsuranceEntry>[];
    digital_accounts:   VaultEntry<DigitalAccountEntry>[];
    legal_documents:    VaultEntry<LegalDocumentsEntry>[];
    employer_hr:        VaultEntry<EmployerHREntry>[];
    vehicles:           VaultEntry<VehicleEntry>[];
    subscriptions:      VaultEntry<SubscriptionEntry>[];
    emergency_contacts: VaultEntry<EmergencyContactEntry>[];
  };
};
```

---

## Section 4 — Next.js Application Architecture

### 4.1 File & Folder Structure

```
easylegal/
├── app/
│   ├── (owner)/                         # Owner-only routes — requires session cookie
│   │   ├── layout.tsx                   # Checks server session + prompts VEK unlock
│   │   ├── vault/
│   │   │   ├── page.tsx                 # Dashboard — category grid
│   │   │   └── [category]/
│   │   │       ├── page.tsx             # Entry list for category
│   │   │       └── [entryId]/
│   │   │           └── page.tsx         # Entry detail / edit
│   │   ├── settings/
│   │   │   ├── page.tsx                 # General settings
│   │   │   ├── trust-transfer/
│   │   │   │   └── page.tsx             # Configure DMS, generate QR, print card
│   │   │   └── security/
│   │   │       └── page.tsx             # Change master password, re-key vault
│   │   └── export/
│   │       └── page.tsx                 # Download encrypted vault backup
│   │
│   ├── (public)/                        # No auth required
│   │   ├── page.tsx                     # Login page (owner) / Request Access (spouse)
│   │   ├── setup/
│   │   │   └── page.tsx                 # First-time setup wizard
│   │   └── emergency-access/
│   │       └── [token]/
│   │           └── page.tsx             # Spouse decryption page
│   │
│   └── api/
│       ├── auth/
│       │   ├── login/route.ts           # POST — owner credentials → session cookie
│       │   └── logout/route.ts
│       ├── vault/
│       │   ├── push/route.ts            # POST — receive encrypted blobs (owner only)
│       │   ├── pull/route.ts            # GET  — serve encrypted blobs (owner or granted spouse)
│       │   └── manifest/route.ts        # GET/PUT encrypted manifest
│       └── trust/
│           ├── configure/route.ts       # POST — save encrypted shard + hashed emails
│           ├── request/route.ts         # POST — spouse initiates request (public)
│           ├── block/route.ts           # POST — owner blocks (token from email, no login)
│           ├── status/route.ts          # GET  — current trust request state
│           └── grant/route.ts           # POST — internal: called after waiting period
│
├── components/
│   ├── ui/                              # shadcn/ui primitives
│   ├── vault/
│   │   ├── VaultDashboard.tsx           # Category overview cards
│   │   ├── EntryList.tsx                # List of entries for a category
│   │   ├── EntryCard.tsx                # Single entry (fields masked by default)
│   │   ├── SensitiveField.tsx           # Reveal-on-click masked field
│   │   ├── AttachmentViewer.tsx         # Decrypt + preview attached PDF/image
│   │   └── forms/
│   │       ├── AVSForm.tsx
│   │       ├── BankingForm.tsx
│   │       ├── InsuranceForm.tsx
│   │       ├── LegalDocumentsForm.tsx
│   │       └── ...                      # One per category
│   ├── trust/
│   │   ├── TrustSetupWizard.tsx         # Step-by-step trust transfer config
│   │   ├── QRCodeDisplay.tsx            # VST as QR code
│   │   ├── EmergencyCardPrint.tsx       # Print-ready A5 emergency card
│   │   ├── RequestAccessForm.tsx        # Spouse-facing request form
│   │   └── EmergencyDecrypt.tsx         # Spouse QR scan + PIN → VEK reconstruct
│   ├── auth/
│   │   ├── LoginForm.tsx                # Owner server auth
│   │   └── UnlockVault.tsx              # Master password → VEK derivation
│   └── layout/
│       ├── Sidebar.tsx
│       ├── ReadOnlyBanner.tsx           # Shown in spouse session
│       └── SyncStatus.tsx               # Synced / Syncing / Error indicator
│
├── lib/
│   ├── crypto/
│   │   ├── argon2.ts                    # Argon2id WASM wrapper (argon2-browser)
│   │   ├── kdf.ts                       # Full key derivation: password → VEK/MAK/KWK
│   │   ├── aes-gcm.ts                   # encrypt(key, plaintext, aad) / decrypt(...)
│   │   ├── vek-session.ts               # In-memory VEK with auto-expiry (8h)
│   │   ├── shard.ts                     # VST generation, shard encrypt/decrypt
│   │   └── hmac.ts                      # Manifest signing with MAK
│   ├── vault/
│   │   ├── vault-client.ts              # High-level: load, save, add/edit/delete entry
│   │   ├── sync.ts                      # Push encrypted blobs to server / pull from server
│   │   └── attachment.ts                # Encrypt/decrypt file attachments
│   ├── trust/
│   │   ├── trust-client.ts              # Client calls to /api/trust/*
│   │   └── trust-server.ts              # Server-side: waiting period scheduler
│   ├── email/
│   │   └── templates.ts                 # Email HTML for request + grant notifications
│   └── validation/
│       └── schemas.ts                   # Zod schemas for all 13 entry types
│
├── hooks/
│   ├── useVaultSession.ts               # VEK state, session active/expired
│   ├── useVaultEntry.ts                 # CRUD operations for entries
│   └── useSyncStatus.ts                 # Real-time sync state
│
├── types/
│   ├── vault.ts                         # Full vault schema (all types above)
│   └── trust.ts                         # Trust transfer types
│
├── prisma/
│   └── schema.prisma
│
└── docker-compose.yml                   # Local dev: Next.js + PostgreSQL
```

### 4.2 Database Schema (Prisma)

```prisma
// prisma/schema.prisma

// Encrypted vault entries — server never sees plaintext
model VaultBlob {
  id          String   @id @default(uuid())
  entryId     String   @unique
  category    String   // unencrypted category label (for indexing only)
  ciphertext  Bytes    // AES-256-GCM encrypted entry JSON
  iv          String   // base64 — 12 bytes
  aad         String   // base64 — authenticated additional data
  updatedAt   DateTime @updatedAt
}

// Encrypted vault manifest
model VaultManifest {
  id          String   @id @default(cuid())
  ciphertext  Bytes
  iv          String
  hmac        String   // HMAC-SHA256(MAK, ciphertext) — tamper detection
  updatedAt   DateTime @updatedAt
}

// Encrypted file attachments
model AttachmentBlob {
  id          String   @id @default(uuid())
  entryId     String
  filename    String   // unencrypted original filename
  mimeType    String
  sizeBytes   Int
  ciphertext  Bytes
  iv          String
  createdAt   DateTime @default(now())
}

// Trust transfer — no plaintext personal data
model TrustConfig {
  id                   String  @id @default(cuid())
  ownerEmailHash       String  // SHA-256(owner email)
  spouseEmailHash      String  // SHA-256(spouse email)
  // Encrypted with a server-side key (for sending emails — not vault data)
  encryptedOwnerEmail  String
  encryptedSpouseEmail String
  waitingPeriodDays    Int     @default(7)
  encryptedVekShard    String  // spouse's VEK shard — server cannot decrypt
  vstHash              String  // SHA-256(VST) — for lookup only
  salt2Base64          String  // public salt for Argon2id(SpousePIN)
  configured           Boolean @default(false)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}

model TrustRequest {
  id                String        @id @default(cuid())
  status            TrustStatus   @default(PENDING)
  spouseNameDisplay String        // display only, not verified
  requestedAt       DateTime      @default(now())
  waitingUntil      DateTime
  blockTokenHash    String        @unique  // SHA-256 of one-time block token (in owner email)
  accessTokenHash   String?       @unique  // SHA-256 of access token (sent to spouse on grant)
  accessTokenExpiry DateTime?
  blockedAt         DateTime?
  grantedAt         DateTime?
}

enum TrustStatus {
  PENDING    // waiting period running
  BLOCKED    // owner blocked
  GRANTED    // access email sent to spouse
  EXPIRED    // access link expired
  COMPLETED  // spouse accessed vault
}

// Owner authentication — no user table, single owner
model AuthSession {
  id          String   @id @default(cuid())
  tokenHash   String   @unique  // SHA-256 of session token
  createdAt   DateTime @default(now())
  expiresAt   DateTime
}
```

### 4.3 Key Module: VEK Session

```typescript
// lib/crypto/vek-session.ts
// The VEK lives ONLY in memory — never written to disk or localStorage

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

class VEKSession {
  private _vek:       CryptoKey | null = null;
  private _mak:       CryptoKey | null = null;
  private _expiresAt: number    | null = null;
  private _readOnly:  boolean          = false;

  async init(
    masterPassword: string,
    saltBase64: string,
    readOnly = false
  ): Promise<void> {
    const salt = base64ToBytes(saltBase64);
    const { vek, mak } = await deriveKeys(masterPassword, salt); // from kdf.ts
    this._vek       = vek;       // extractable: false
    this._mak       = mak;       // extractable: false
    this._expiresAt = Date.now() + SESSION_DURATION_MS;
    this._readOnly  = readOnly;
  }

  get vek(): CryptoKey {
    this._assertActive();
    return this._vek!;
  }

  get mak(): CryptoKey {
    this._assertActive();
    return this._mak!;
  }

  get isReadOnly(): boolean { return this._readOnly; }
  get isActive():   boolean {
    return this._vek !== null && Date.now() < (this._expiresAt ?? 0);
  }

  destroy(): void {
    this._vek = null;
    this._mak = null;
    this._expiresAt = null;
  }

  private _assertActive(): void {
    if (!this.isActive) throw new Error('VEK session expired — please unlock vault again');
  }
}

export const vekSession = new VEKSession();
```

### 4.4 Key Module: Entry Encryption/Decryption

```typescript
// lib/crypto/aes-gcm.ts

export async function encryptEntry<T>(
  key: CryptoKey,
  entry: VaultEntry<T>
): Promise<EncryptedBlob> {
  const iv        = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(entry.data));
  const aad       = new TextEncoder().encode(`${entry.id}:${entry.category}:1`);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    plaintext
  );

  return {
    entryId:    entry.id,
    category:   entry.category,
    iv:         bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    aad:        bytesToBase64(aad),
  };
}

export async function decryptEntry<T>(
  key: CryptoKey,
  blob: EncryptedBlob
): Promise<T> {
  const iv         = base64ToBytes(blob.iv);
  const ciphertext = base64ToBytes(blob.ciphertext);
  const aad        = base64ToBytes(blob.aad);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    ciphertext
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
```

### 4.5 Trust Transfer — Server-Side Scheduler

The server needs to check if waiting periods have elapsed and send grant emails.
With Coolify, use a **scheduled job** (cron) hitting an internal API endpoint:

```typescript
// app/api/trust/grant/route.ts
// Called by Coolify cron every hour: GET /api/trust/grant?secret=...

export async function GET(request: Request) {
  // Verify internal secret to prevent public calls
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const expiredRequests = await prisma.trustRequest.findMany({
    where: { status: 'PENDING', waitingUntil: { lte: now } }
  });

  for (const req of expiredRequests) {
    const accessToken = crypto.randomUUID();
    const accessTokenHash = await sha256(accessToken);
    const expiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    await prisma.trustRequest.update({
      where: { id: req.id },
      data: {
        status: 'GRANTED',
        grantedAt: now,
        accessTokenHash,
        accessTokenExpiry: expiry,
      }
    });

    const config = await prisma.trustConfig.findFirst();
    const spouseEmail = decrypt(config!.encryptedSpouseEmail); // server-side key

    await sendEmail({
      to: spouseEmail,
      subject: 'EasyLegacy — Access granted',
      html: grantEmailTemplate(accessToken, expiry),
    });
  }

  return Response.json({ processed: expiredRequests.length });
}
```

### 4.6 Authentication Strategy

**Two independent layers:**

| Layer | Purpose | Mechanism |
|---|---|---|
| Server auth | Prevent strangers from reading your encrypted blobs | Username + password → HTTP-only session cookie (7 days) |
| Vault decryption | Prevent anyone with blob access from reading plaintext | Master password → Argon2id → VEK in memory |

These are separate credentials. Even if someone steals your session cookie, they cannot decrypt the vault without the master password. Even with full database access, blobs are useless without the master password.

Owner credentials are set via environment variables in Coolify — no user registration flow.

---

## Section 5 — MVP Scope & 12-Week Build Plan

| Week | Phase | Focus | Deliverables |
|---|---|---|---|
| **1** | 1 | Scaffold | Next.js 15 App Router, Prisma + PostgreSQL, Coolify deployment pipeline, env config, owner auth (session cookie), basic layout |
| **2** | 1 | Crypto core | `argon2.ts`, `kdf.ts`, `aes-gcm.ts`, `vek-session.ts`, `hmac.ts` — full test suite |
| **3** | 1 | Vault sync | `sync.ts`, `/api/vault/push`, `/api/vault/pull`, `/api/vault/manifest` — push/pull encrypted blobs |
| **4** | 1 | Unlock + 3 categories | `UnlockVault.tsx`, vault dashboard, emergency contacts + banking + legal documents forms with Zod validation |
| **5** | 2 | All 13 categories | Remaining 10 category forms, `SensitiveField.tsx`, `EntryCard.tsx` |
| **6** | 2 | Attachments | File encrypt/decrypt, `AttachmentBlob` DB model, `AttachmentViewer.tsx`, PDF/image preview |
| **7** | 2 | Trust setup | `TrustSetupWizard.tsx`, `shard.ts`, VST generation, `QRCodeDisplay.tsx`, `TrustConfig` DB model, `/api/trust/configure` |
| **8** | 2 | Trust flow + email | `/api/trust/request` (public), `/api/trust/block` (email link), grant cron job, Resend email templates, `RequestAccessForm.tsx` |
| **9** | 3 | Emergency access | `/emergency-access/[token]`, `EmergencyDecrypt.tsx` (QR scan + PIN → VEK), read-only vault mode, `ReadOnlyBanner.tsx` |
| **10** | 3 | Emergency card | `EmergencyCardPrint.tsx` (print-ready A5), survivor checklist per category (Swiss-specific actions), export page |
| **11** | 3 | Security hardening | CSP headers, rate limiting on public endpoints, block token replay protection, Argon2id on Spouse PIN, session expiry UI |
| **12** | 3 | Open-source prep | `README.md`, `SELF_HOSTING.md`, `SECURITY.md`, `docker-compose.yml` for self-hosters, license (AGPL-3.0) |

### Phase Goals

**Week 4 milestone:** You can log in, add vault entries in 3 categories, data is encrypted and synced to VPS. No trust transfer yet.

**Week 8 milestone:** All 13 categories populated. Your spouse can request access and you receive a blocking email. The waiting period and grant flow work end-to-end.

**Week 12 milestone:** Your spouse can open the app, request access, wait 7 days, receive the grant email, scan the QR code from the printed emergency card, enter her PIN, and read your entire vault — on any device, without you. The repo is ready to open-source.

---

## Section 6 — Legal & Compliance

### nDSG Applicability

Art. 2 al. 2 lit. a nDSG explicitly exempts personal data processing carried out
**for exclusively personal or family-related activities**. A vault for two spouses
falls entirely within this exemption. No record of processing, DPIA, or breach
notification obligations apply.

Publishing open-source code does not trigger nDSG — only actual data processing does.
Each self-hosting couple is responsible for their own instance.

### Legal Document Warnings (displayed in-app)

These must appear as persistent UI elements, not buried in a privacy policy:

1. **"EasyLegacy cannot replace your handwritten will."**
   Swiss law (Art. 505 CC) requires a valid holographic will to be entirely handwritten
   in ink, dated and signed. This app stores the location of your will — not the will itself.

2. **"The Patientenverfügung must be signed by hand."**
   Art. 370 CC requires a handwritten date and signature. The copy stored here is
   for reference only. The signed original must be with your family doctor and hospital.

3. **"The Vorsorgeauftrag must be entirely handwritten or notarised."**
   Art. 360 CC. This app stores its location and your mandatary's contact details.

4. **"No vault data is readable by the server."**
   All encryption and decryption happens in your browser. The server stores only
   ciphertext — even we (or any self-hoster) cannot read your vault contents.

5. **"This software is provided as-is for personal use. It is not a legal service."**

---

## Section 7 — Open Source

### License: AGPL-3.0

Ensures that anyone who modifies and deploys EasyLegacy as a service must also
open-source their changes. Protects the "self-host only" intent while allowing
free personal forks.

### What self-hosters need

1. A VPS (Hetzner, Fly.io, Render, any Docker host)
2. Docker + Docker Compose (or a Coolify instance)
3. 5 environment variables (see `.env.example`)
4. A Resend account (free tier: 3,000 emails/month — far more than needed)
5. ~30 minutes setup time for a developer

### `.env.example`

```bash
# Owner credentials (set once — no registration flow)
OWNER_USERNAME=maurizio
OWNER_PASSWORD_HASH=          # bcrypt hash of your password

# Session
JWT_SECRET=                   # 64 random hex chars

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/easylegal

# Email (Resend recommended)
RESEND_API_KEY=
EMAIL_FROM=noreply@yourdomain.com

# Trust transfer
CRON_SECRET=                  # random secret for internal cron endpoint
SERVER_ENCRYPTION_KEY=        # 32 random hex chars — encrypts email addresses at rest

# App URL (used in email links)
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

---

## Section 8 — 10 Critical Open Questions

| # | Question | Recommended Decision |
|---|---|---|
| **1** | Should SQLite be supported as an alternative to PostgreSQL for simpler self-hosting? | Yes — Prisma supports both. Default to SQLite in `docker-compose.yml`; Postgres optional via `DATABASE_URL`. |
| **2** | Should the owner be able to trigger voluntary access grant without waiting (e.g. in hospice)? | Yes — add a "Grant access now" button in Settings → Trust Transfer. Bypasses waiting period immediately. |
| **3** | What if the Spouse PIN is forgotten before an emergency? | Owner must re-configure trust transfer (new PIN + new shard + reprint QR card). Add a "Last card printed" date reminder in dashboard. |
| **4** | Can the spouse see which categories exist without decrypting (e.g. "there are 3 banking entries")? | Yes — category + entry count is in the unencrypted manifest header. Titles remain encrypted. |
| **5** | Should the app support multiple "trusted persons" (e.g. spouse + adult child)? | Phase 1: no. Phase 2+: generate a separate shard per trusted person, each with their own PIN and QR card. |
| **6** | How should entry versioning / undo work? | Phase 1: none. Phase 2: keep last 5 encrypted versions of each entry in the DB. |
| **7** | What happens if the owner clicks "Block" in error? | Immediate unblock available via Settings → Trust Transfer → "Cancel block". Spouse is notified the request was cancelled. |
| **8** | Should the block token in the email be password-less (click to block, no login)? | Yes — owner may be on a mobile device, in a meeting. Single-click block with a signed URL. Login required for unblocking. |
| **9** | Should a PWA service worker cache the app shell for offline access? | Yes — the vault read/write should work offline (against locally cached blobs). Sync when reconnected. Add to Phase 3. |
| **10** | What email provider if Resend is unacceptable to a self-hoster? | Abstract behind `EMAIL_PROVIDER` env var. Support Resend, SMTP (Nodemailer), and Postmark out of the box. |

---

*EasyLegacy v3 Specification — May 2026*
*arivederlestelle.org*
