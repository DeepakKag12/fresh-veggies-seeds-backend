# Fresh Veggies — Backend API

Enterprise-grade REST API backend for the **Fresh Veggies** e-commerce platform built with Node.js, Express, MongoDB Atlas, and Mongoose ODM.

---

## 1. Quick Start

### Installation
```bash
cd backend
npm install
```

### Environment Configuration
```bash
cp .env.example .env
```
Populate `.env` with your MongoDB URI, JWT secret, and integration credentials (Razorpay, Cloudinary, MSG91, Brevo).

### Available Scripts
```bash
npm run dev         # Starts server with nodemon auto-reload on port 5000
npm run dev:memory  # Starts development server with in-memory MongoDB fallback
npm run seed        # Seeds database with catalogue products, combos, categories, and settings
npm start           # Starts production server
```

---

## 2. Architecture & File Structure

```text
backend/
├── .env.example
├── package.json
├── scripts/
│   ├── dev-server.js           # Development server bootstrap with memory Mongo fallback
│   └── seedCatalogue.js        # Production catalogue seeder (vegetable seeds, combos, categories, settings)
└── src/
    ├── server.js               # Application bootstrap, CORS, limiters & DB readiness gate
    ├── config/                 # Cloudinary, Multer, and Order configuration
    ├── controllers/            # 12 business logic controllers (auth, order, product, payment...)
    ├── middleware/             # Auth (JWT/RBAC), caching, error handling, objectId validators
    ├── models/                 # Mongoose schemas with compound indexes & atomic $inc guards
    ├── routes/                 # Express route modules (*.routes.js)
    ├── services/               # Authoritative pricing, stock reservation, Razorpay, DTDC, MSG91, Brevo
    ├── utils/                  # In-memory TTL cache, API error wrappers, response helpers
    └── validators/             # Indian PIN code and payload schema validators
```

---

## 3. Core API Endpoints

Base URL: `http://localhost:5000/api`

### Public Catalogue & Discovery
- `GET /api/settings` — Store settings & dynamic delivery thresholds
- `GET /api/categories` — Pre-sorted agricultural category listings
- `GET /api/products` — Paginated catalogue with filters (`?category=`, `?season=`, `?sort=`, `?lowstock=true`, `?outofstock=true`)
- `GET /api/products/featured` — Featured products
- `GET /api/products/:id` — Single product details with variant packages
- `GET /api/combos` — Curated gardening kit combo bundles
- `GET /api/banners/active` — Active storefront banners
- `GET /api/orders/check-pincode/:pincode` — Indian Postal PIN code delivery viability

### Authentication & Profile
- `POST /api/auth/register` — Customer account creation
- `POST /api/auth/login` — Dual-identifier (email or phone) login
- `POST /api/auth/logout` — Revokes session via `tokenVersion`
- `POST /api/auth/msg91/verify-token` — Instant Guest mobile OTP verification
- `GET /api/auth/me` — Authenticated profile (Protected)
- `GET /api/auth/cart` & `PUT /api/auth/cart` — Remote cart persistence

### Orders & Payments
- `POST /api/orders` — Places COD order with server-side price check and atomic stock reservation
- `GET /api/orders/myorders` — Customer order history
- `POST /api/payments/create-order` — Razorpay online order creation (in paise)
- `POST /api/payments/verify-payment` — HMAC-SHA256 signature verification & order confirmation
- `POST /api/payments/webhook` — Asynchronous raw webhook listener
- `POST /api/coupons/validate` — Server-authoritative discount validation (`orderAmount` / `itemsPrice`)

### Admin Management (`role: admin`)
- `GET /api/admin/stats` — Revenue, order counts, and inventory KPIs
- `GET /api/admin/lowstock` — Low-stock products list
- `GET /api/admin/deleted-items` — Soft-delete recovery ledger
- `POST /api/admin/deleted-items/:id/restore` — Restores soft-deleted items
- `GET /api/admin/purge-data/preview` — Danger Zone purge preview (Super Admin)
- `POST /api/admin/purge-data` — Danger Zone data purge with password gate (Super Admin)

---

## 4. Key Security & Resilience Features
- **Server-Authoritative Pricing:** Cart prices sent by client are never trusted.
- **Two-Phase Atomic Stock Reservation:** Inventory decrements atomically with automatic rollback cascades on failure.
- **Session Revocation:** Passwords and logout operations increment `tokenVersion`, instantly invalidating older JWTs.
- **Timing-Safe Crypto:** Verification routines use `crypto.timingSafeEqual`.
- **Zero Exposed Secrets:** Production credentials reside exclusively in environment variables.
