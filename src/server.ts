import express, {
  Request,
  Response,
} from "express";

import cors from "cors";
import dotenv from "dotenv";

import {
  MongoClient,
  ObjectId,
  ServerApiVersion,
  Collection,
} from "mongodb";

import Stripe from "stripe";

dotenv.config();

const app = express();

const port =
  Number(process.env.PORT) || 5000;

// ======================================================
// ENV
// ======================================================

const uri = process.env.DATABASE_URL;

if (!uri) {
  throw new Error(
    "DATABASE_URL is missing in .env"
  );
}

const stripeSecretKey =
  process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error(
    "STRIPE_SECRET_KEY is missing in .env"
  );
}

const webhookSecret =
  process.env.STRIPE_WEBHOOK_SECRET;

if (!webhookSecret) {
  throw new Error(
    "STRIPE_WEBHOOK_SECRET is missing in .env"
  );
}

const clientUrl =
  process.env.CLIENT_URL;

if (!clientUrl) {
  throw new Error(
    "CLIENT_URL is missing in .env"
  );
}

// ======================================================
// MONGODB
// ======================================================

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ======================================================
// STRIPE
// ======================================================

const stripe = new Stripe(
  stripeSecretKey
);

// ======================================================
// CORS
// ======================================================

app.use(cors());

// ======================================================
// COLLECTION VARIABLES
// ======================================================

let usersCollection: Collection;
let campaignsCollection: Collection;
let withdrawalsCollection: Collection;
let paymentsCollection: Collection;

// ======================================================
// STRIPE WEBHOOK
//
// IMPORTANT:
// express.raw() MUST be BEFORE express.json()
// ======================================================

app.post(
  "/payments/webhook",
  express.raw({
    type: "application/json",
  }),
  async (
    req: Request,
    res: Response
  ) => {
    const signature =
      req.headers[
        "stripe-signature"
      ];

    // --------------------------------------------------
    // CHECK STRIPE SIGNATURE
    // --------------------------------------------------

    if (!signature) {
      return res.status(400).send(
        "Missing Stripe signature"
      );
    }

    let event: Stripe.Event;

    // --------------------------------------------------
    // VERIFY STRIPE WEBHOOK
    // --------------------------------------------------

    try {
      event =
        stripe.webhooks.constructEvent(
          req.body,
          signature,
          webhookSecret
        );
    } catch (error) {
      console.error(
        "❌ Stripe webhook verification failed:",
        error
      );

      return res
        .status(400)
        .send(
          "Webhook signature verification failed"
        );
    }

    // --------------------------------------------------
    // PROCESS EVENT
    // --------------------------------------------------

    try {
      // =================================================
      // CHECKOUT SESSION COMPLETED
      // =================================================

      if (
        event.type ===
        "checkout.session.completed"
      ) {
        const session =
          event.data.object as Stripe.Checkout.Session;

        console.log(
          "========================================"
        );

        console.log(
          "💳 STRIPE CHECKOUT SESSION"
        );

        console.log(
          "Session ID:",
          session.id
        );

        console.log(
          "Payment Status:",
          session.payment_status
        );

        console.log(
          "Customer Email:",
          session.customer_email
        );

        console.log(
          "Amount:",
          session.amount_total
        );

        console.log(
          "Currency:",
          session.currency
        );

        console.log(
          "Metadata:",
          session.metadata
        );

        console.log(
          "========================================"
        );

        // ------------------------------------------------
        // PAYMENT MUST BE PAID
        // ------------------------------------------------

        if (
          session.payment_status !==
          "paid"
        ) {
          console.log(
            "⚠️ Payment is not paid:",
            session.payment_status
          );

          return res.json({
            received: true,
            message:
              "Payment is not completed",
          });
        }

        // ------------------------------------------------
        // GET EMAIL
        // ------------------------------------------------

        const email =
          session.metadata?.email;

        // ------------------------------------------------
        // GET CREDITS
        // ------------------------------------------------

        const creditsString =
          session.metadata?.credits;

        if (
          !email ||
          !creditsString
        ) {
          console.error(
            "❌ Payment metadata missing:",
            session.id
          );

          return res.status(400).json({
            success: false,
            message:
              "Payment metadata is missing",
          });
        }

        // ------------------------------------------------
        // CONVERT CREDITS
        // ------------------------------------------------

        const credits =
          Number(creditsString);

        if (
          !Number.isInteger(
            credits
          ) ||
          credits <= 0
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid credits",
          });
        }

        // ------------------------------------------------
        // ALLOWED CREDIT PACKAGES
        // ------------------------------------------------

        const allowedCredits = [
          100,
          300,
          800,
          1500,
        ];

        if (
          !allowedCredits.includes(
            credits
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid credit package",
          });
        }

        // =================================================
        // DUPLICATE PAYMENT CHECK
        // =================================================

        const alreadyProcessed =
          await paymentsCollection.findOne(
            {
              stripeSessionId:
                session.id,
            }
          );

        if (alreadyProcessed) {
          console.log(
            "⚠️ Payment already processed:",
            session.id
          );

          return res.json({
            received: true,
            message:
              "Payment already processed",
          });
        }

        // =================================================
        // FIND USER
        // =================================================

        const user =
          await usersCollection.findOne(
            {
              email,
            }
          );

        if (!user) {
          console.error(
            "❌ User not found:",
            email
          );

          return res.status(404).json({
            success: false,
            message:
              "User not found",
          });
        }

        // =================================================
        // CURRENT CREDITS
        // =================================================

        const currentCredits =
          Number(
            user.credits ?? 0
          );

        // =================================================
        // NEW CREDITS
        // =================================================

        const newCredits =
          currentCredits +
          credits;

        // =================================================
        // PAYMENT DATA
        // =================================================

        const paymentData = {
          stripeSessionId:
            session.id,

          paymentIntentId:
            session.payment_intent
              ? String(
                  session.payment_intent
                )
              : null,

          email,

          credits,

          previousCredits:
            currentCredits,

          newCredits,

          amountTotal:
            session.amount_total ??
            0,

          currency:
            session.currency ??
            "usd",

          paymentStatus:
            session.payment_status,

          paymentType:
            "credit_purchase",

          metadata:
            session.metadata ?? {},

          stripeCreated:
            session.created,

          createdAt:
            new Date(),

          updatedAt:
            new Date(),
        };

        // =================================================
        // SAVE PAYMENT FIRST
        //
        // If payment already exists, unique index
        // protects against duplicate webhook.
        // =================================================

        try {
          console.log(
            "💾 Saving payment history:",
            paymentData
          );

          const paymentResult =
            await paymentsCollection.insertOne(
              paymentData
            );

          console.log(
            "✅ Payment history saved:",
            paymentResult.insertedId
          );
        } catch (paymentInsertError) {
          console.error(
            "❌ Payment history insert error:",
            paymentInsertError
          );

          /*
           * If duplicate payment was inserted by
           * another webhook request, do not add
           * credits again.
           */
          const duplicatePayment =
            await paymentsCollection.findOne(
              {
                stripeSessionId:
                  session.id,
              }
            );

          if (duplicatePayment) {
            console.log(
              "⚠️ Duplicate webhook detected:",
              session.id
            );

            return res.json({
              received: true,
              message:
                "Payment already processed",
            });
          }

          return res.status(500).json({
            success: false,
            message:
              "Failed to save payment history",
          });
        }

        // =================================================
        // ADD CREDITS
        // =================================================

        const updateResult =
          await usersCollection.updateOne(
            {
              _id: user._id,
            },
            {
              $inc: {
                credits,
              },

              $set: {
                updatedAt:
                  new Date(),
              },
            }
          );

        if (
          updateResult.matchedCount ===
          0
        ) {
          console.error(
            "❌ User update failed:",
            email
          );

          /*
           * Payment history exists but user
           * was not updated.
           *
           * Remove payment record so Stripe
           * can retry the webhook.
           */
          await paymentsCollection.deleteOne(
            {
              stripeSessionId:
                session.id,
            }
          );

          return res.status(404).json({
            success: false,
            message:
              "User update failed",
          });
        }

        // =================================================
        // SUCCESS LOG
        // =================================================

        console.log(
          "========================================"
        );

        console.log(
          "✅ PAYMENT SUCCESS"
        );

        console.log(
          "========================================"
        );

        console.log(
          "Stripe Session:",
          session.id
        );

        console.log(
          "Payment Intent:",
          session.payment_intent
        );

        console.log(
          "Email:",
          email
        );

        console.log(
          "Previous Credits:",
          currentCredits
        );

        console.log(
          "Purchased Credits:",
          credits
        );

        console.log(
          "New Credits:",
          newCredits
        );

        console.log(
          "Amount:",
          session.amount_total
            ? `$${(
                session.amount_total /
                100
              ).toFixed(2)}`
            : "$0.00"
        );

        console.log(
          "Currency:",
          session.currency
        );

        console.log(
          "Payment Status:",
          session.payment_status
        );

        console.log(
          "Metadata:",
          session.metadata
        );

        console.log(
          "========================================"
        );
      }

      // =================================================
      // STRIPE RESPONSE
      // =================================================

      return res.json({
        received: true,
      });
    } catch (error) {
      console.error(
        "❌ Webhook processing error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Webhook processing failed",
      });
    }
  }
);

// ======================================================
// JSON MIDDLEWARE
//
// IMPORTANT:
// MUST BE AFTER STRIPE WEBHOOK
// ======================================================

app.use(express.json());

// ======================================================
// DATABASE
// ======================================================

async function run() {
  try {
    // ==================================================
    // CONNECT MONGODB
    // ==================================================

    await client.connect();

    // ==================================================
    // DATABASE
    // ==================================================

    const database =
      client.db(
        process.env.DATABASE_NAME ||
          "test"
      );

    // ==================================================
    // COLLECTIONS
    // ==================================================

    usersCollection =
      database.collection("user");

    campaignsCollection =
      database.collection(
        "campaigns"
      );

    withdrawalsCollection =
      database.collection(
        "withdrawal"
      );

    paymentsCollection =
      database.collection(
        "payments"
      );

    // ==================================================
    // PAYMENT UNIQUE INDEX
    // ==================================================

    await paymentsCollection.createIndex(
      {
        stripeSessionId: 1,
      },
      {
        unique: true,
      }
    );

    // ==================================================
    // USER EMAIL INDEX
    // ==================================================

    await usersCollection.createIndex(
      {
        email: 1,
      }
    );

    console.log(
      "✅ MongoDB Connected"
    );

    console.log(
      "Database:",
      process.env.DATABASE_NAME ||
        "test"
    );

    // ==================================================
    // GET ALL CAMPAIGNS
    // ==================================================

    app.get(
      "/campaigns",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const result =
            await campaignsCollection
              .find()
              .toArray();

          return res.json(result);
        } catch (error) {
          console.error(error);

          return res.status(500).json({
            success: false,
            message:
              "Failed to fetch campaigns",
          });
        }
      }
    );

    // ==================================================
    // GET ALL USERS
    // ==================================================

    app.get(
      "/user",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const result =
            await usersCollection
              .find()
              .toArray();

          return res.json(result);
        } catch (error) {
          console.error(error);

          return res.status(500).json({
            success: false,
            message:
              "Failed to fetch users",
          });
        }
      }
    );

    // ==================================================
    // DELETE USER
    // ==================================================

    app.delete(
      "/user/:id",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const id =
            String(req.params.id);

          if (
            !ObjectId.isValid(id)
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Invalid user ID",
            });
          }

          const result =
            await usersCollection.deleteOne(
              {
                _id: new ObjectId(id),
              }
            );

          return res.json(result);
        } catch (error) {
          console.error(error);

          return res.status(500).json({
            success: false,
            message:
              "Failed to delete user",
          });
        }
      }
    );

    // ==================================================
    // UPDATE USER ROLE
    // ==================================================

    app.patch(
      "/user/:id",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const id =
            String(req.params.id);

          const { role } =
            req.body;

          if (
            !ObjectId.isValid(id)
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Invalid user ID",
            });
          }

          if (!role) {
            return res.status(400).json({
              success: false,
              message:
                "Role is required",
            });
          }

          const result =
            await usersCollection.updateOne(
              {
                _id: new ObjectId(id),
              },
              {
                $set: {
                  role,
                  updatedAt:
                    new Date(),
                },
              }
            );

          return res.json(result);
        } catch (error) {
          console.error(error);

          return res.status(500).json({
            success: false,
            message:
              "Failed to update user",
          });
        }
      }
    );

    // ==================================================
    // APPROVED CAMPAIGNS
    // ==================================================

    app.get(
      "/campaignss",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const result =
            await campaignsCollection
              .find({
                status:
                  "approved",
              })
              .toArray();

          return res.json(result);
        } catch (error) {
          console.error(error);

          return res.status(500).json({
            success: false,
            message:
              "Failed to fetch campaigns",
          });
        }
      }
    );

    // ==================================================
    // SINGLE CAMPAIGN
    // ==================================================

    app.get(
      "/campaignss/:id",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const id =
            String(req.params.id);

          if (
            !ObjectId.isValid(id)
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Invalid campaign ID",
            });
          }

          const campaign =
            await campaignsCollection.findOne(
              {
                _id: new ObjectId(id),
              }
            );

          if (!campaign) {
            return res
              .status(404)
              .json({
                success: false,
                message:
                  "Campaign not found",
              });
          }

          return res.json({
            success: true,
            data: campaign,
          });
        } catch (error) {
          console.error(error);

          return res.status(500).json({
            success: false,
            message:
              "Failed to get campaign",
          });
        }
      }
    );

    // ==================================================
    // CREATE CAMPAIGN
    // ==================================================

    app.post(
      "/campaigns",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const campaign =
            req.body;

          if (
            !campaign ||
            typeof campaign !==
              "object"
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Campaign data is required",
            });
          }

          const result =
            await campaignsCollection.insertOne(
              {
                ...campaign,
                createdAt:
                  new Date(),
              }
            );

          return res.status(201).json(
            result
          );
        } catch (error) {
          console.error(error);

          return res.status(500).json({
            success: false,
            message:
              "Failed to create campaign",
          });
        }
      }
    );

    // ==================================================
    // GET CAMPAIGNS BY EMAIL
    // ==================================================

    app.get(
      "/campaigns/email/:email",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const email =
            decodeURIComponent(
              String(
                req.params.email
              )
            );

          const result =
            await campaignsCollection
              .find({
                creatorEmail:
                  email,
              })
              .toArray();

          return res.status(200).json(
            result
          );
        } catch (error) {
          console.error(error);

          return res.status(500).json({
            success: false,
            message:
              "Internal Server Error",
          });
        }
      }
    );

    // ==================================================
    // UPDATE CAMPAIGN
    // ==================================================

    app.patch(
      "/campaigns/:id",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const id =
            String(req.params.id);

          if (
            !ObjectId.isValid(id)
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Invalid campaign ID",
            });
          }

          const updateData =
            req.body;

          const result =
            await campaignsCollection.updateOne(
              {
                _id: new ObjectId(id),
              },
              {
                $set: {
                  ...updateData,
                  updatedAt:
                    new Date(),
                },
              }
            );

          return res.json(result);
        } catch (error) {
          console.error(error);

          return res.status(500).json({
            success: false,
            message:
              "Failed to update campaign",
          });
        }
      }
    );

    // ==================================================
    // DELETE CAMPAIGN
    // ==================================================

    app.delete(
      "/campaigns/:id",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const id =
            String(req.params.id);

          if (
            !ObjectId.isValid(id)
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Invalid campaign ID",
            });
          }

          const result =
            await campaignsCollection.deleteOne(
              {
                _id: new ObjectId(id),
              }
            );

          return res.json(result);
        } catch (error) {
          console.error(error);

          return res.status(500).json({
            success: false,
            message:
              "Failed to delete campaign",
          });
        }
      }
    );

    // ==================================================
    // WITHDRAWAL
    // ==================================================

    app.post(
      "/withdrawals",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const {
            creator_email,
            creator_name,
            withdrawal_credit,
            payment_system,
            account_number,
          } = req.body;

          if (
            !creator_email ||
            !creator_name ||
            !withdrawal_credit ||
            !payment_system ||
            !account_number
          ) {
            return res.status(400).json({
              success: false,
              message:
                "All required fields are required",
            });
          }

          const withdrawalCredits =
            Number(
              withdrawal_credit
            );

          if (
            !Number.isFinite(
              withdrawalCredits
            )
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Invalid withdrawal credits",
            });
          }

          if (
            withdrawalCredits < 200
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Minimum withdrawal is 200 credits",
            });
          }

          // 20 credits = $1

          const amount =
            withdrawalCredits / 20;

          const withdrawalData = {
            creator_email,
            creator_name,

            withdrawal_credit:
              withdrawalCredits,

            withdrawal_amount:
              amount,

            payment_system,
            account_number,

            withdraw_date:
              new Date(),

            status:
              "pending",
          };

          const result =
            await withdrawalsCollection.insertOne(
              withdrawalData
            );

          return res.status(201).json({
            success: true,
            message:
              "Withdrawal request submitted successfully",
            data: result,
          });
        } catch (error) {
          console.error(
            "Withdrawal POST error:",
            error
          );

          return res.status(500).json({
            success: false,
            message:
              "Failed to create withdrawal request",
          });
        }
      }
    );

    // ==================================================
    // GET WITHDRAWALS BY EMAIL
    // ==================================================

    app.get(
      "/withdrawals/email/:email",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const email =
            decodeURIComponent(
              String(
                req.params.email
              )
            );

          const result =
            await withdrawalsCollection
              .find({
                creator_email:
                  email,
              })
              .sort({
                withdraw_date:
                  -1,
              })
              .toArray();

          return res.status(200).json(
            result
          );
        } catch (error) {
          console.error(error);

          return res.status(500).json({
            success: false,
            message:
              "Internal Server Error",
          });
        }
      }
    );

    // ==================================================
    // GET USER CREDITS
    // ==================================================

    app.get(
      "/users/credits/:email",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const email =
            decodeURIComponent(
              String(
                req.params.email
              )
            );

          if (!email) {
            return res.status(400).json({
              success: false,
              message:
                "Email is required",
              credits: 0,
            });
          }

          const user =
            await usersCollection.findOne(
              {
                email,
              }
            );

          if (!user) {
            return res.status(404).json({
              success: false,
              message:
                "User not found",
              credits: 0,
            });
          }

          return res.status(200).json({
            success: true,
            email: user.email,
            name: user.name,
            credits: Number(
              user.credits ?? 0
            ),
          });
        } catch (error) {
          console.error(
            "Get credits error:",
            error
          );

          return res.status(500).json({
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to get credits",
            credits: 0,
          });
        }
      }
    );

    // ==================================================
    // CREATE STRIPE CHECKOUT SESSION
    // ==================================================

    app.post(
      "/payments/create-checkout-session",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const {
            email,
            credits,
          } = req.body;

          // ----------------------------------------------
          // VALIDATE EMAIL
          // ----------------------------------------------

          if (
            !email ||
            typeof email !==
              "string"
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Valid email is required",
            });
          }

          // ----------------------------------------------
          // VALIDATE CREDITS
          // ----------------------------------------------

          const requestedCredits =
            Number(credits);

          if (
            !Number.isInteger(
              requestedCredits
            )
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Credits must be a valid integer",
            });
          }

          // ----------------------------------------------
          // CREDIT PACKAGES
          // ----------------------------------------------

          const creditPackages: Record<
            number,
            number
          > = {
            100: 10,
            300: 25,
            800: 60,
            1500: 110,
          };

          const price =
            creditPackages[
              requestedCredits
            ];

          if (
            price === undefined
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Invalid credit package",
            });
          }

          // ----------------------------------------------
          // CHECK USER
          // ----------------------------------------------

          const user =
            await usersCollection.findOne(
              {
                email,
              }
            );

          if (!user) {
            return res.status(404).json({
              success: false,
              message:
                "User not found",
            });
          }

          // ----------------------------------------------
          // CREATE STRIPE CHECKOUT
          // ----------------------------------------------

          const checkoutSession =
            await stripe.checkout.sessions.create(
              {
                mode: "payment",

                payment_method_types: [
                  "card",
                ],

                customer_email:
                  email,

                line_items: [
                  {
                    price_data: {
                      currency:
                        "usd",

                      product_data: {
                        name: `${requestedCredits} Support Credits`,
                      },

                      unit_amount:
                        price * 100,
                    },

                    quantity: 1,
                  },
                ],

                metadata: {
                  email,

                  credits:
                    String(
                      requestedCredits
                    ),
                },

                success_url:
                  `${clientUrl}/dashboard/Supporter/Purchasecredit` +
                  `?success=true&session_id={CHECKOUT_SESSION_ID}`,

                cancel_url:
                  `${clientUrl}/dashboard/Supporter/Purchasecredit` +
                  `?canceled=true`,
              }
            );

          // ----------------------------------------------
          // CONSOLE CHECKOUT DATA
          // ----------------------------------------------

          console.log(
            "========================================"
          );

          console.log(
            "🛒 CHECKOUT SESSION CREATED"
          );

          console.log(
            "User Email:",
            email
          );

          console.log(
            "Credits:",
            requestedCredits
          );

          console.log(
            "Price:",
            `$${price}`
          );

          console.log(
            "Stripe Session ID:",
            checkoutSession.id
          );

          console.log(
            "========================================"
          );

          // ----------------------------------------------
          // RESPONSE
          // ----------------------------------------------

          return res.status(200).json({
            success: true,

            url:
              checkoutSession.url,

            sessionId:
              checkoutSession.id,
          });
        } catch (error) {
          console.error(
            "❌ Stripe Checkout Error:",
            error
          );

          return res.status(500).json({
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Payment failed",
          });
        }
      }
    );

    // ==================================================
    // GET STRIPE PAYMENT SESSION
    // ==================================================

    app.get(
      "/payments/session/:sessionId",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const sessionId =
            String(
              req.params.sessionId
            );

          if (!sessionId) {
            return res.status(400).json({
              success: false,
              message:
                "Stripe session ID is required",
            });
          }

          // ----------------------------------------------
          // GET SESSION FROM STRIPE
          // ----------------------------------------------

          const session =
            await stripe.checkout.sessions.retrieve(
              sessionId
            );

          // ----------------------------------------------
          // CONSOLE PAYMENT DATA
          // ----------------------------------------------

          console.log(
            "========================================"
          );

          console.log(
            "💳 PAYMENT SESSION FETCHED"
          );

          console.log(
            "Stripe Session ID:",
            session.id
          );

          console.log(
            "Payment Status:",
            session.payment_status
          );

          console.log(
            "Checkout Status:",
            session.status
          );

          console.log(
            "Customer Email:",
            session.customer_email
          );

          console.log(
            "Amount:",
            session.amount_total
          );

          console.log(
            "Currency:",
            session.currency
          );

          console.log(
            "Payment Intent:",
            session.payment_intent
          );

          console.log(
            "Metadata:",
            session.metadata
          );

          console.log(
            "Created:",
            session.created
          );

          console.log(
            "Complete Stripe Session:",
            session
          );

          console.log(
            "========================================"
          );

          // ----------------------------------------------
          // RESPONSE
          // ----------------------------------------------

          return res.status(200).json({
            success: true,

            data: {
              id:
                session.id,

              payment_status:
                session.payment_status,

              status:
                session.status,

              customer_email:
                session.customer_email,

              amount_total:
                session.amount_total,

              currency:
                session.currency,

              metadata:
                session.metadata,

              payment_intent:
                session.payment_intent
                  ? String(
                      session.payment_intent
                    )
                  : null,

              created:
                session.created,
            },
          });
        } catch (error) {
          console.error(
            "❌ Stripe session fetch error:",
            error
          );

          return res.status(500).json({
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to fetch payment session",
          });
        }
      }
    );

    // ==================================================
    // POST PAYMENT
    //
    // Frontend can POST payment data here.
    //
    // Duplicate-safe.
    // ==================================================

    app.post(
      "/payments",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const payment =
            req.body;

          console.log(
            "========================================"
          );

          console.log(
            "📥 POST /payments"
          );

          console.log(
            "Payment received:",
            payment
          );

          console.log(
            "========================================"
          );

          // ----------------------------------------------
          // VALIDATION
          // ----------------------------------------------

          if (
            !payment ||
            typeof payment !==
              "object"
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Payment data is required",
            });
          }

          if (
            !payment.stripeSessionId
          ) {
            return res.status(400).json({
              success: false,
              message:
                "stripeSessionId is required",
            });
          }

          if (!payment.email) {
            return res.status(400).json({
              success: false,
              message:
                "Email is required",
            });
          }

          // ----------------------------------------------
          // PAYMENT STATUS
          // ----------------------------------------------

          if (
            payment.paymentStatus !==
            "paid"
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Payment is not completed",
            });
          }

          // ----------------------------------------------
          // CHECK EXISTING PAYMENT
          // ----------------------------------------------

          const existingPayment =
            await paymentsCollection.findOne(
              {
                stripeSessionId:
                  payment.stripeSessionId,
              }
            );

          // ----------------------------------------------
          // ALREADY EXISTS
          // ----------------------------------------------

          if (existingPayment) {
            console.log(
              "⚠️ Payment already exists:",
              payment.stripeSessionId
            );

            return res.status(200).json({
              success: true,
              message:
                "Payment already exists",
              data: existingPayment,
            });
          }

          // ----------------------------------------------
          // SAVE NEW PAYMENT
          // ----------------------------------------------

          const paymentData = {
            stripeSessionId:
              payment.stripeSessionId,

            paymentIntentId:
              payment.paymentIntentId ||
              null,

            email:
              payment.email,

            credits:
              Number(
                payment.credits || 0
              ),

            amountTotal:
              Number(
                payment.amountTotal || 0
              ),

            currency:
              payment.currency ||
              "usd",

            paymentStatus:
              payment.paymentStatus,

            checkoutStatus:
              payment.checkoutStatus ||
              "complete",

            metadata:
              payment.metadata ||
              {},

            stripeCreated:
              payment.created ||
              null,

            paymentType:
              "credit_purchase",

            createdAt:
              new Date(),

            updatedAt:
              new Date(),
          };

          const result =
            await paymentsCollection.insertOne(
              paymentData
            );

          console.log(
            "✅ Payment saved:",
            result.insertedId
          );

          return res.status(201).json({
            success: true,
            message:
              "Payment saved successfully",
            data: {
              insertedId:
                result.insertedId,
            },
          });
        } catch (error) {
          console.error(
            "❌ POST /payments ERROR:",
            error
          );

          return res.status(500).json({
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to save payment",
          });
        }
      }
    );

    // ==================================================
    // PAYMENT HISTORY
    // ==================================================

    app.get(
      "/payments/:email",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const email =
            decodeURIComponent(
              String(
                req.params.email
              )
            );

          const payments =
            await paymentsCollection
              .find({
                email,
              })
              .sort({
                createdAt: -1,
              })
              .toArray();

          return res.status(200).json({
            success: true,
            data: payments,
          });
        } catch (error) {
          console.error(
            "Payment history error:",
            error
          );

          return res.status(500).json({
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to fetch payment history",
          });
        }
      }
    );


app.get("payment")














    // ==================================================
    // HEALTH CHECK
    // ==================================================

    app.get(
      "/health",
      (
        req: Request,
        res: Response
      ) => {
        return res.json({
          success: true,
          message:
            "Fund Wave API is running",
        });
      }
    );

    // ==================================================
    // ALL ROUTES INITIALIZED
    // ==================================================

    console.log(
      "✅ All routes initialized"
    );
  } catch (error) {
    console.error(
      "❌ MongoDB connection error:",
      error
    );

    process.exit(1);
  }
}

// ======================================================
// ROOT
// ======================================================

app.get(
  "/",
  (
    req: Request,
    res: Response
  ) => {
    res.send(
      "Fund Wave Server Running..."
    );
  }
);

// ======================================================
// START SERVER
// ======================================================

async function startServer() {
  await run();

  app.listen(
    port,
    () => {
      console.log(
        `🚀 Server running on http://localhost:${port}`
      );
    }
  );
}

startServer();