# ⚡ FundWave Server — Backend REST API & Services

<div align="center">

**Scalable, Secure, and Event-Driven Crowdfunding Backend API.**

[![Live API](https://img.shields.io/badge/Live%20API-backend--one--chi--49.vercel.app-0070F3?style=for-the-badge&logo=vercel&logoColor=white)](https://backend-one-chi-49.vercel.app)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-5.x-black?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Stripe](https://img.shields.io/badge/Stripe-Payments-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://stripe.com/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?style=for-the-badge&logo=openai&logoColor=white)](https://openai.com/)

</div>

---

## 📌 Architecture Overview

**FundWave Server** provides robust, type-safe RESTful APIs, Stripe payment processing, asynchronous webhook handling, and an automated event-driven notification dispatch pipeline. It powers the FundWave crowdfunding platform with safe credit escrow, creator payout clearance, and AI-assisted chat functionality.

---

## 🚀 Live Production API

- **Base URL**: `https://backend-one-chi-49.vercel.app`
- **Health Check**: `GET https://backend-one-chi-49.vercel.app/health`

```json
{
  "success": true,
  "message": "Fund Wave API is running"
}
```

---

## 🛠️ Technology Stack

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | Node.js (v20+) | Execution environment |
| **Web Framework** | Express.js 5.x | High-throughput REST API routing |
| **Language** | TypeScript | Type safety & maintainability |
| **Database** | MongoDB Atlas (Native Driver 7.x) | Document storage & compound indexing |
| **Payment Gateway** | Stripe SDK | Checkout sessions & raw signature webhooks |
| **AI Assistant** | OpenAI SDK (`gpt-4o-mini`) | Contextual crowdfunding advisory engine |
| **Middleware** | CORS, Dotenv, Raw Body Parsers | Security and configuration |
| **Dev Tools** | `tsx` & `nodemon` | Hot reload and instant TypeScript compilation |
| **Deployment** | Vercel Serverless Functions | Production hosting & global edge routing |

---

## 🗄️ Database Collections

- `users`: User profiles, roles (`Supporter`, `Creator`, `Admin`), credits balance, and metadata.
- `campaigns`: Crowdfunding projects, stories, images, funding goals, amounts raised, and approval statuses.
- `contributions`: Backer pledges, credit amounts, status tracking (`pending`, `approved`, `rejected`), and escrow state.
- `withdrawal`: Creator payout requests, bank details, and admin clearance statuses.
- `payments`: Stripe transaction logs, session IDs, and duplicate fulfillment prevention records.
- `notifications`: Real-time system notifications with timestamps and target route redirection.
- `reports`: Flagged campaigns and user trust/safety compliance reports.

---

## 📡 Comprehensive API Reference

### 1. System & Health
| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Root server status |
| `GET` | `/health` | Server health check probe |

---

### 2. Notifications System
| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/notifications/:email` | Get user notifications sorted descending by `time: -1` |
| `DELETE` | `/notifications/:id` | Dismiss a single notification by MongoDB ObjectId |
| `DELETE` | `/notifications/clear/:email` | Clear all notifications for a specific user |

**Notification Document Schema:**
```json
{
  "_id": "67123456789abcdef0123456",
  "message": "Your Contribution of 50 credits to Clean Water Initiative was approved by Alex Rivers",
  "toEmail": "supporter@example.com",
  "actionRoute": "/dashboard/Supporter/Home",
  "time": "2026-10-24T20:00:00.000Z"
}
```

---

### 3. AI Assistant
| Method | Route | Payload | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/chat` | `{ "message": "string" }` | Returns conversational AI response with knowledge-base fallback |

---

### 4. Users & Profiles
| Method | Route | Payload / Description |
| :--- | :--- | :--- |
| `GET` | `/users` | Returns list of all registered users (Admin protected) |
| `GET` | `/users/:id` | Get single user by ID |
| `PATCH` | `/users/role/:id` | `{ "role": "Creator" \| "Supporter" \| "Admin" }` — Updates role |
| `GET` | `/users/credits/:email` | Returns user's live credit balance |
| `GET` | `/users/profile/:email` | Returns comprehensive profile + contributions & campaign counts |
| `PATCH` | `/users/profile/:email` | `{ "name", "image", "phone", "bio" }` — Updates user profile |
| `DELETE` | `/users/:id` | Deletes user record |

---

### 5. Campaigns
| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/campaignss` | Returns all **approved** campaigns (Public explore feed) |
| `GET` | `/campaigns` | Returns all campaigns across all statuses (Admin feed) |
| `GET` | `/campaignss/:id` | Retrieve single campaign details |
| `POST` | `/campaigns` | Create new campaign (Defaults status to `pending`) |
| `PATCH` | `/campaigns/:id` | Update campaign details or status (`approved` / `rejected`). *Triggers creator notification automatically.* |
| `DELETE` | `/campaigns/:id` | Delete campaign record |
| `GET` | `/campaigns/email/:email`| Retrieve campaigns launched by specific creator |

---

### 6. Contributions & Pledges (Safe Escrow)
| Method | Route | Description |
| :--- | :--- | :--- |
| `POST` | `/contributions` | Create new contribution with credits. *Deducts supporter credits into escrow & notifies Creator.* |
| `GET` | `/contributions/supporter/:email` | List all contributions made by a supporter |
| `GET` | `/contributions/creator/:email` | List all pending & reviewed contributions for creator campaigns |
| `PATCH` | `/contributions/approve/:id` | Approves pledge. *Increases campaign `amount_raised` & notifies Supporter.* |
| `PATCH` | `/contributions/reject/:id` | Rejects pledge. *Instantly refunds credits to Supporter & notifies Supporter.* |

---

### 7. Creator Withdrawals
| Method | Route | Description |
| :--- | :--- | :--- |
| `POST` | `/withdrawals` | Creator submits withdrawal request for raised credits |
| `GET` | `/withdrawals` | Admin queue of all pending withdrawal requests |
| `GET` | `/withdrawals/:email` | Creator's withdrawal request history |
| `PATCH` | `/withdrawals/approve/:id` | Admin marks payment success. *Decreases creator raised credits & notifies Creator.* |

---

### 8. Stripe Payments & Webhooks
| Method | Route | Description |
| :--- | :--- | :--- |
| `POST` | `/payments/create-checkout-session` | Initiates Stripe Checkout session for credit packages (50, 100, 250, 500) |
| `POST` | `/payments/webhook` | Raw body Stripe event webhook. *Fulfills credits upon `checkout.session.completed` with idempotency protection.* |
| `GET` | `/payments/history/:email` | Backer payment receipt and top-up history |

---

## ⚙️ Local Development Setup

### 1. Prerequisites
- **Node.js**: v18.18+ or v20+
- **MongoDB Atlas Connection URI**
- **Stripe Account** (Secret Key & Webhook Secret)

### 2. Clone Repository
```bash
git clone https://github.com/MDSOBUJMADBOR/Fund-Wave-Server.git
cd Fund-Wave-Server
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure Environment Variables
Create a `.env` file in the root directory:

```env
PORT=5000
DATABASE_URL=mongodb+srv://<username>:<password>@cluster0.mongodb.net/?retryWrites=true&w=majority
DATABASE_NAME=FundWave

# Client URL (for CORS and redirects)
CLIENT_URL=http://localhost:3000

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# AI Assistant (Optional)
OPENAI_API_KEY=sk-proj-...
```

### 5. Start Development Server
```bash
npm run dev
```
The server will boot on **http://localhost:5000**.

### 6. Build for Production
```bash
npm run build
npm start
```

---

## 🚀 Deployment to Vercel

The backend includes a pre-configured `vercel.json` file designed for `@vercel/node` serverless function execution:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "src/server.ts",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "src/server.ts",
      "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    }
  ]
}
```

Deploy instantly using Vercel CLI:
```bash
npx vercel deploy --prod
```

---

## 🔒 Security & Data Integrity
- **Raw Webhook Verification**: Stripe webhooks utilize raw cryptographic signatures to prevent man-in-the-middle attacks.
- **Atomic Operations**: Database modifications for balance updates and contribution refunds use atomic `$inc` operations.
- **Idempotency**: Completed payment sessions are indexed to eliminate double credit allocations.

---

## 📄 License
This project is licensed under the [ISC License](LICENSE).
