# Fund Wave Server

A secure and scalable backend API for **Fund Wave**, a crowdfunding and support-credit platform.
The server is built with **Node.js, Express.js, TypeScript, MongoDB, and Stripe**.

It provides APIs for user management, campaign management, withdrawals, credit purchases, payment history, and Stripe webhook processing.

---

## 🚀 Live Server

**Production API:**
Add your deployed Vercel URL here.

Example:

```text
https://your-fund-wave-server.vercel.app
```

### Health Check

```http
GET /
```

Response:

```text
Fund Wave Server Running...
```

or:

```http
GET /health
```

Response:

```json
{
  "success": true,
  "message": "Fund Wave API is running"
}
```

---

# 📌 Features

* User management
* User role management
* Campaign CRUD operations
* Approved campaign filtering
* Campaign search by creator email
* Campaign details API
* Withdrawal request system
* Withdrawal history
* User credit balance
* Stripe Checkout integration
* Stripe webhook verification
* Credit package purchase
* Payment history
* Duplicate payment protection
* MongoDB database integration
* CORS support
* Environment variable configuration
* TypeScript-based backend
* RESTful API architecture
* Health check endpoint

---

# 🛠️ Technologies Used

| Technology | Purpose                         |
| ---------- | ------------------------------- |
| Node.js    | JavaScript runtime              |
| Express.js | Backend framework               |
| TypeScript | Type-safe development           |
| MongoDB    | Database                        |
| Stripe     | Payment processing              |
| CORS       | Cross-origin request handling   |
| dotenv     | Environment variable management |
| tsx        | Development server              |
| Vercel     | Deployment                      |

---

# 📂 Project Structure

```text
fund-wave-server/
│
├── src/
│   └── server.ts
│
├── dist/
│   └── server.js
│
├── .env
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

# ⚙️ Installation

Clone the repository:

```bash
git clone https://github.com/MDSOBUJMADBOR/Fund-Wave-Server.git
```

Go to the project directory:

```bash
cd Fund-Wave-Server
```

Install dependencies:

```bash
npm install
```

---

# 🔐 Environment Variables

Create a `.env` file in the root directory.

```env
PORT=5000

DATABASE_URL=your_mongodb_connection_string

DATABASE_NAME=FundWave

STRIPE_SECRET_KEY=your_stripe_secret_key

STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

CLIENT_URL=http://localhost:3000
```

### Environment Variable Description

| Variable                | Description                   |
| ----------------------- | ----------------------------- |
| `PORT`                  | Backend server port           |
| `DATABASE_URL`          | MongoDB connection URI        |
| `DATABASE_NAME`         | MongoDB database name         |
| `STRIPE_SECRET_KEY`     | Stripe secret API key         |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `CLIENT_URL`            | Frontend application URL      |

> Never commit your `.env` file to GitHub.

---

# ▶️ Run the Project

## Development

```bash
npm run dev
```

The development server will run on:

```text
http://localhost:5000
```

---

## Production Build

First build the TypeScript project:

```bash
npm run build
```

Then start the compiled server:

```bash
npm start
```

---

# 💳 Stripe Credit Packages

Fund Wave provides the following credit packages:

| Credits | Price |
| ------: | ----: |
|     100 |   $10 |
|     300 |   $25 |
|     800 |   $60 |
|    1500 |  $110 |

### Credit Conversion

For withdrawals:

```text
20 credits = $1
```

Minimum withdrawal:

```text
200 credits
```

---

# 🔗 API Documentation

## 1. Root

### GET `/`

Checks whether the server is running.

```http
GET /
```

Response:

```text
Fund Wave Server Running...
```

---

# ❤️ Campaign APIs

## Get All Campaigns

```http
GET /campaigns
```

Returns all campaigns.

---

## Get Approved Campaigns

```http
GET /campaignss
```

Returns campaigns where:

```json
{
  "status": "approved"
}
```

---

## Get Single Campaign

```http
GET /campaignss/:id
```

Example:

```http
GET /campaignss/68d123456789abcdef123456
```

---

## Create Campaign

```http
POST /campaigns
```

Example request:

```json
{
  "title": "Help Build a School",
  "description": "Support our community education project.",
  "targetAmount": 5000,
  "status": "pending",
  "creatorEmail": "user@example.com"
}
```

---

## Get Campaigns by Email

```http
GET /campaigns/email/:email
```

Example:

```http
GET /campaigns/email/user@example.com
```

Returns campaigns created by a specific user.

---

## Update Campaign

```http
PATCH /campaigns/:id
```

Example:

```json
{
  "title": "Updated Campaign Title",
  "status": "approved"
}
```

---

## Delete Campaign

```http
DELETE /campaigns/:id
```

Deletes a campaign by MongoDB ObjectId.

---

# 👤 User APIs

## Get All Users

```http
GET /user
```

Returns all registered users.

---

## Delete User

```http
DELETE /user/:id
```

Deletes a user using MongoDB ObjectId.

---

## Update User Role

```http
PATCH /user/:id
```

Example:

```json
{
  "role": "admin"
}
```

---

# 💰 Credit APIs

## Get User Credits

```http
GET /users/credits/:email
```

Example:

```http
GET /users/credits/user@example.com
```

Response:

```json
{
  "success": true,
  "email": "user@example.com",
  "name": "John Doe",
  "credits": 500
}
```

---

# 💸 Withdrawal APIs

## Create Withdrawal Request

```http
POST /withdrawals
```

Example:

```json
{
  "creator_email": "user@example.com",
  "creator_name": "John Doe",
  "withdrawal_credit": 200,
  "payment_system": "bkash",
  "account_number": "01XXXXXXXXX"
}
```

The server converts credits using:

```text
20 credits = $1
```

For example:

```text
200 credits = $10
```

Withdrawal status is initially:

```text
pending
```

---

## Get Withdrawal History

```http
GET /withdrawals/email/:email
```

Returns withdrawal requests for a specific user.

The newest withdrawal is returned first.

---

# 💳 Stripe Payment APIs

## Create Checkout Session

```http
POST /payments/create-checkout-session
```

Request:

```json
{
  "email": "user@example.com",
  "credits": 300
}
```

The backend validates the credit package and creates a Stripe Checkout Session.

Response:

```json
{
  "success": true,
  "url": "https://checkout.stripe.com/...",
  "sessionId": "cs_test_..."
}
```

The frontend can redirect the user to the returned `url`.

---

# 🔔 Stripe Webhook

```http
POST /payments/webhook
```

This endpoint receives Stripe webhook events.

The server verifies the Stripe signature before processing the event.

Currently handled event:

```text
checkout.session.completed
```

The webhook checks:

1. Stripe signature
2. Payment status
3. User email
4. Purchased credits
5. Allowed credit package
6. Duplicate payment
7. User existence
8. Payment history
9. User credit update

---

# 🔒 Duplicate Payment Protection

The backend creates a unique MongoDB index:

```text
stripeSessionId
```

This prevents the same Stripe Checkout Session from being processed multiple times.

Allowed credit packages:

```text
100
300
800
1500
```

---

# 🧾 Payment History

## Get Payment History

```http
GET /payments/:email
```

Example:

```http
GET /payments/user@example.com
```

Response:

```json
{
  "success": true,
  "data": [
    {
      "stripeSessionId": "cs_test_...",
      "paymentIntentId": "pi_...",
      "email": "user@example.com",
      "credits": 300,
      "amountTotal": 2500,
      "currency": "usd",
      "paymentStatus": "paid",
      "paymentType": "credit_purchase"
    }
  ]
}
```

---

# 🔎 Get Stripe Payment Session

```http
GET /payments/session/:sessionId
```

This endpoint retrieves payment information directly from Stripe.

It returns:

* Session ID
* Payment status
* Checkout status
* Customer email
* Amount
* Currency
* Metadata
* Payment Intent
* Created timestamp

---

# 🗃️ Database Collections

The project uses MongoDB with the following collections:

```text
user
campaigns
withdrawal
payments
```

### User

Stores user information and credit balance.

Important field:

```text
credits
```

### Campaigns

Stores crowdfunding campaign information.

### Withdrawal

Stores withdrawal requests.

### Payments

Stores Stripe payment history.

Important field:

```text
stripeSessionId
```

A unique index is created for this field.

---

# 🔄 Payment Flow

```text
User
  │
  ▼
Select Credit Package
  │
  ▼
Frontend
  │
  ▼
POST /payments/create-checkout-session
  │
  ▼
Express Server
  │
  ▼
Stripe Checkout
  │
  ▼
User Completes Payment
  │
  ▼
Stripe Webhook
  │
  ▼
POST /payments/webhook
  │
  ├── Verify Stripe Signature
  │
  ├── Check Payment Status
  │
  ├── Validate Credits
  │
  ├── Check Duplicate Payment
  │
  ├── Save Payment History
  │
  └── Add Credits to User
  │
  ▼
MongoDB
```

---

# 🛡️ Security Considerations

The backend includes several security-related measures:

* Stripe webhook signature verification
* Stripe secret key stored in environment variables
* MongoDB credentials stored in environment variables
* Duplicate payment protection
* MongoDB ObjectId validation
* Credit package validation
* Payment status validation
* CORS support
* Environment-based configuration

---

# 📡 Stripe Webhook Setup

For local development, Stripe CLI can be used to forward webhook events.

Example:

```bash
stripe listen --forward-to localhost:5000/payments/webhook
```

Stripe CLI will provide a webhook signing secret.

Add it to `.env`:

```env
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxx
```

For production, configure the Stripe Dashboard webhook endpoint:

```text
https://your-domain.com/payments/webhook
```

---

# 🚀 Deployment

The backend can be deployed to platforms such as Vercel or other Node.js hosting services.

Before deployment:

```bash
npm run build
```

Make sure the production environment variables are configured:

```env
DATABASE_URL=...
DATABASE_NAME=FundWave
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
CLIENT_URL=...
```

After deployment, verify:

```http
GET /health
```

Expected response:

```json
{
  "success": true,
  "message": "Fund Wave API is running"
}
```

---

# 🧪 Testing

You can test the API using:

* Postman
* Thunder Client
* Insomnia
* Browser for GET endpoints
* Stripe CLI for webhook testing

Example:

```text
GET http://localhost:5000/health
```

---

# 📦 Available Scripts

### Development

```bash
npm run dev
```

Runs the server using `tsx watch`.

### Build

```bash
npm run build
```

Compiles TypeScript into JavaScript.

### Production

```bash
npm start
```

Runs:

```text
dist/server.js
```

---

# 👨‍💻 Author

**MD. SOBUJ MADBOR**

MERN Stack Developer / Junior Full Stack Developer

### Skills

* HTML
* CSS
* Tailwind CSS
* JavaScript
* TypeScript
* React.js
* Next.js
* Node.js
* Express.js
* MongoDB
* Stripe API

---

# 📄 License

This project is developed for educational and portfolio purposes.

```text
© 2026 MD. SOBUJ MADBOR
```

