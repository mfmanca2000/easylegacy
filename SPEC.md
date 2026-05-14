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
  l
