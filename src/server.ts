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
import OpenAI from "openai";

dotenv.config();

const app = express();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

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
let contributionsCollection: Collection;
let reportsCollection: Collection;
let notificationsCollection: Collection;

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

    contributionsCollection =
      database.collection(
        "contributions"
      );

    reportsCollection =
      database.collection(
        "reports"
      );

    notificationsCollection =
      database.collection(
        "notifications"
      );

    await notificationsCollection.createIndex(
      {
        toEmail: 1,
        time: -1,
      }
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
                amount_raised:
                  Number(campaign.amount_raised) || 0,
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
              .sort({
                deadline: -1,
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

          const updateData = req.body || {};

          if (
            !ObjectId.isValid(id)
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Invalid campaign ID",
            });
          }

          const existingCampaign = await campaignsCollection.findOne({
            _id: new ObjectId(id),
          });

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

          // Notify Creator when campaign status is updated by admin
          if (existingCampaign && updateData.status) {
            const creatorEmail = existingCampaign.creatorEmail || existingCampaign.creator_email;
            const campaignTitle = existingCampaign.campaign_title || existingCampaign.title || "Campaign";

            if (creatorEmail) {
              if (updateData.status === "approved") {
                await notificationsCollection.insertOne({
                  message: `Your campaign '${campaignTitle}' has been approved by admin and is now live.`,
                  toEmail: creatorEmail,
                  actionRoute: "/dashboard/Creator/Mycampaigns",
                  time: new Date(),
                });
              } else if (updateData.status === "rejected") {
                await notificationsCollection.insertOne({
                  message: `Your campaign '${campaignTitle}' was rejected by admin.`,
                  toEmail: creatorEmail,
                  actionRoute: "/dashboard/Creator/Mycampaigns",
                  time: new Date(),
                });
              }
            }
          }

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

          // Refund all approved supporters of this campaign
          const approvedContributions =
            await contributionsCollection
              .find({
                campaignId: id,
                status: "approved",
              })
              .toArray();

          for (const contribution of approvedContributions) {
            if (
              contribution.supporterEmail &&
              contribution.amount
            ) {
              await usersCollection.updateOne(
                {
                  email:
                    contribution.supporterEmail,
                },
                {
                  $inc: {
                    credits: Number(
                      contribution.amount
                    ),
                  },
                }
              );
            }
          }

          // Mark contributions as refunded
          await contributionsCollection.updateMany(
            {
              campaignId: id,
            },
            {
              $set: {
                status: "refunded",
                updatedAt: new Date(),
              },
            }
          );

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
    // GET USER PROFILE
    // ==================================================

    app.get(
      "/users/profile/:email",
      async (req: Request, res: Response) => {
        try {
          const email = decodeURIComponent(String(req.params.email));
          if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
          }

          const user = await usersCollection.findOne({ email });
          if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
          }

          // Count user's contributions or campaigns
          const contributionsCount = await contributionsCollection?.countDocuments({
            Supporter_email: email,
          }) || 0;

          const campaignsCount = await campaignsCollection?.countDocuments({
            $or: [{ creatorEmail: email }, { creator_email: email }],
          }) || 0;

          return res.status(200).json({
            success: true,
            user: {
              id: user._id,
              name: user.name,
              email: user.email,
              image: user.image || user.photo_url || null,
              role: user.role || "Supporter",
              credits: Number(user.credits ?? 0),
              phone: user.phone || "",
              bio: user.bio || "",
              createdAt: user.createdAt,
              status: user.status || "active",
              contributionsCount,
              campaignsCount,
            },
          });
        } catch (error) {
          console.error("Get user profile error:", error);
          return res.status(500).json({ success: false, message: "Failed to get user profile" });
        }
      }
    );

    // ==================================================
    // UPDATE USER PROFILE
    // ==================================================

    app.patch(
      "/users/profile/:email",
      async (req: Request, res: Response) => {
        try {
          const email = decodeURIComponent(String(req.params.email));
          const { name, image, phone, bio } = req.body;
          if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
          }

          const updateFields: Record<string, unknown> = { updatedAt: new Date() };
          if (typeof name === "string" && name.trim()) updateFields.name = name.trim();
          if (typeof image === "string") updateFields.image = image.trim();
          if (typeof phone === "string") updateFields.phone = phone.trim();
          if (typeof bio === "string") updateFields.bio = bio.trim();

          const result = await usersCollection.updateOne({ email }, { $set: updateFields });
          return res.status(200).json({
            success: true,
            message: "Profile updated successfully",
            result,
          });
        } catch (error) {
          console.error("Update profile error:", error);
          return res.status(500).json({ success: false, message: "Failed to update profile" });
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


    // ==================================================
    // CREATE CONTRIBUTION
    // ==================================================

    app.post(
      "/contributions",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const body = req.body || {};
          const campaignId = body.campaign_id || body.campaignId;
          const campaign_title = body.campaign_title || body.title || "Campaign";
          const creatorEmail = body.creator_email || body.creatorEmail || "";
          const creatorName = body.creator_name || body.creatorName || "Creator";
          const supporterEmail = body.Supporter_email || body.supporterEmail || "";
          const supporterName = body.Supporter_name || body.supporterName || "Supporter";
          const amount = body.Contribution_amount || body.amount;
          const message = body.message || "";

          if (
            !campaignId ||
            !supporterEmail ||
            !amount
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Missing required contribution fields",
            });
          }

          const contributionAmount = Number(amount);

          if (
            !Number.isFinite(contributionAmount) ||
            contributionAmount <= 0
          ) {
            return res.status(400).json({
              success: false,
              message: "Invalid contribution amount",
            });
          }

          // Check supporter balance
          const supporter = await usersCollection.findOne({
            email: supporterEmail,
          });

          if (!supporter) {
            return res.status(404).json({
              success: false,
              message: "Supporter user account not found",
            });
          }

          const availableCredits = Number(supporter.credits ?? 0);

          if (availableCredits < contributionAmount) {
            return res.status(400).json({
              success: false,
              message: "You do not have enough credits",
            });
          }

          // Deduct credits from supporter
          await usersCollection.updateOne(
            { email: supporterEmail },
            {
              $inc: { credits: -contributionAmount },
              $set: { updatedAt: new Date() },
            }
          );

          const contributionData = {
            campaign_id: String(campaignId),
            campaignId: String(campaignId),
            campaign_title: String(campaign_title),
            creator_email: String(creatorEmail),
            creatorEmail: String(creatorEmail),
            creator_name: String(creatorName),
            creatorName: String(creatorName),
            Supporter_email: String(supporterEmail),
            supporterEmail: String(supporterEmail),
            Supporter_name: String(supporterName || supporter.name || "Anonymous"),
            supporterName: String(supporterName || supporter.name || "Anonymous"),
            Contribution_amount: contributionAmount,
            amount: contributionAmount,
            message: String(message || ""),
            status: "pending",
            current_date: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const insertResult = await contributionsCollection.insertOne(contributionData);

          // Notify Creator about the new contribution
          if (creatorEmail) {
            const sName = supporterName || (supporter ? supporter.name : "A Supporter");
            await notificationsCollection.insertOne({
              message: `${sName} contributed ${contributionAmount} credits to your campaign '${campaign_title}'.`,
              toEmail: String(creatorEmail),
              actionRoute: "/dashboard/Creator/Home",
              time: new Date(),
            });
          }

          return res.status(201).json({
            success: true,
            message: "Contribution submitted successfully! It is pending approval.",
            data: {
              ...contributionData,
              _id: insertResult.insertedId,
            },
          });
        } catch (error) {
          console.error("Create contribution error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to submit contribution",
          });
        }
      }
    );

    // ==================================================
    // GET CONTRIBUTIONS FOR CREATOR
    // ==================================================

    app.get(
      "/contributions/creator/:email",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const email = decodeURIComponent(String(req.params.email));
          const status = req.query.status ? String(req.query.status) : null;

          const query: Record<string, any> = {
            creatorEmail: email,
          };

          if (status) {
            query.status = status;
          }

          const results = await contributionsCollection
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

          return res.status(200).json({
            success: true,
            data: results,
          });
        } catch (error) {
          console.error("Get creator contributions error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to fetch contributions",
          });
        }
      }
    );

    // ==================================================
    // GET CONTRIBUTIONS FOR SUPPORTER
    // ==================================================

    app.get(
      "/contributions/supporter/:email",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const email = decodeURIComponent(String(req.params.email));
          const status = req.query.status ? String(req.query.status) : null;

          const query: Record<string, any> = {
            $or: [
              { supporterEmail: email },
              { Supporter_email: email },
            ],
          };

          if (status) {
            query.status = status;
          }

          const results = await contributionsCollection
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

          return res.status(200).json({
            success: true,
            data: results,
          });
        } catch (error) {
          console.error("Get supporter contributions error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to fetch supporter contributions",
          });
        }
      }
    );

    // ==================================================
    // GET SUPPORTER STATS
    // ==================================================

    app.get(
      "/supporters/stats/:email",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const email = decodeURIComponent(String(req.params.email));

          const user = await usersCollection.findOne({ email });
          const contributions = await contributionsCollection
            .find({
              $or: [
                { supporterEmail: email },
                { Supporter_email: email },
              ],
            })
            .toArray();

          const totalContributionsCount = contributions.length;

          const totalPendingContributionsCount = contributions.filter(
            (c) => c.status === "pending"
          ).length;

          const approvedContributions = contributions.filter(
            (c) => c.status === "approved"
          );

          const totalAmountContributed = approvedContributions.reduce(
            (sum, c) => sum + (Number(c.Contribution_amount || c.amount) || 0),
            0
          );

          return res.status(200).json({
            success: true,
            data: {
              availableCredits: Number(user?.credits ?? 0),
              totalContributionsCount,
              totalPendingContributionsCount,
              totalAmountContributed,
            },
          });
        } catch (error) {
          console.error("Supporter stats error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to calculate supporter stats",
          });
        }
      }
    );

    // ==================================================
    // APPROVE CONTRIBUTION
    // ==================================================

    app.patch(
      "/contributions/approve/:id",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const id = String(req.params.id);

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              success: false,
              message: "Invalid contribution ID",
            });
          }

          const contribution = await contributionsCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!contribution) {
            return res.status(404).json({
              success: false,
              message: "Contribution not found",
            });
          }

          if (contribution.status !== "pending") {
            return res.status(400).json({
              success: false,
              message: `Contribution is already ${contribution.status}`,
            });
          }

          // 1. Mark contribution as approved
          await contributionsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status: "approved",
                approvedAt: new Date(),
                updatedAt: new Date(),
              },
            }
          );

          // 2. Add contribution amount to campaign's raised amount
          if (ObjectId.isValid(contribution.campaignId)) {
            await campaignsCollection.updateOne(
              { _id: new ObjectId(contribution.campaignId) },
              {
                $inc: {
                  amount_raised: Number(contribution.amount),
                },
                $set: {
                  updatedAt: new Date(),
                },
              }
            );
          }

          // 3. Notify Supporter
          const sEmail = contribution.Supporter_email || contribution.supporterEmail;
          const cAmount = contribution.Contribution_amount || contribution.amount || 0;
          const campTitle = contribution.campaign_title || contribution.campaignTitle || "Campaign";
          const crName = contribution.creator_name || contribution.creatorName || "Creator";

          if (sEmail) {
            await notificationsCollection.insertOne({
              message: `Your Contribution of ${cAmount} credits to ${campTitle} was approved by ${crName}`,
              toEmail: sEmail,
              actionRoute: "/dashboard/Supporter/Home",
              time: new Date(),
            });
          }

          return res.status(200).json({
            success: true,
            message: "Contribution approved successfully!",
          });
        } catch (error) {
          console.error("Approve contribution error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to approve contribution",
          });
        }
      }
    );

    // ==================================================
    // REJECT CONTRIBUTION (REFUND SUPPORTER)
    // ==================================================

    app.patch(
      "/contributions/reject/:id",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const id = String(req.params.id);

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              success: false,
              message: "Invalid contribution ID",
            });
          }

          const contribution = await contributionsCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!contribution) {
            return res.status(404).json({
              success: false,
              message: "Contribution not found",
            });
          }

          if (contribution.status !== "pending") {
            return res.status(400).json({
              success: false,
              message: `Contribution is already ${contribution.status}`,
            });
          }

          // 1. Mark contribution as rejected
          await contributionsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status: "rejected",
                rejectedAt: new Date(),
                updatedAt: new Date(),
              },
            }
          );

          // 2. Refund credits back to supporter
          if (contribution.supporterEmail && contribution.amount) {
            await usersCollection.updateOne(
              { email: contribution.supporterEmail },
              {
                $inc: { credits: Number(contribution.amount) },
                $set: { updatedAt: new Date() },
              }
            );
          }

          // 3. Notify Supporter
          const sEmail = contribution.Supporter_email || contribution.supporterEmail;
          const cAmount = contribution.Contribution_amount || contribution.amount || 0;
          const campTitle = contribution.campaign_title || contribution.campaignTitle || "Campaign";
          const crName = contribution.creator_name || contribution.creatorName || "Creator";

          if (sEmail) {
            await notificationsCollection.insertOne({
              message: `Your Contribution of ${cAmount} credits to ${campTitle} was rejected by ${crName}`,
              toEmail: sEmail,
              actionRoute: "/dashboard/Supporter/Mycontributions",
              time: new Date(),
            });
          }

          return res.status(200).json({
            success: true,
            message: "Contribution rejected and credits refunded to supporter.",
          });
        } catch (error) {
          console.error("Reject contribution error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to reject contribution",
          });
        }
      }
    );

    // ==================================================
    // CREATOR STATS & EARNINGS
    // ==================================================

    app.get(
      "/creators/stats/:email",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const email = decodeURIComponent(String(req.params.email));

          // 1. Fetch campaigns for this creator
          const campaigns = await campaignsCollection
            .find({ creatorEmail: email })
            .toArray();

          const totalCampaigns = campaigns.length;
          const now = new Date();

          const activeCampaigns = campaigns.filter((c) => {
            if (!c.deadline) return true;
            return new Date(c.deadline) >= now;
          }).length;

          const totalAmountRaised = campaigns.reduce(
            (sum, c) => sum + (Number(c.amount_raised) || 0),
            0
          );

          // 2. Fetch withdrawals for this creator
          const withdrawals = await withdrawalsCollection
            .find({ creator_email: email })
            .toArray();

          const totalWithdrawnCredits = withdrawals.reduce(
            (sum, w) => sum + (Number(w.withdrawal_credit) || 0),
            0
          );

          const availableCredits = Math.max(
            0,
            totalAmountRaised - totalWithdrawnCredits
          );

          return res.status(200).json({
            success: true,
            data: {
              totalCampaigns,
              activeCampaigns,
              totalAmountRaised,
              totalWithdrawnCredits,
              availableCredits,
              withdrawableDollars: availableCredits / 20,
            },
          });
        } catch (error) {
          console.error("Creator stats error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to calculate creator stats",
          });
        }
      }
    );














    // ==================================================
    // ADMIN STATS
    // ==================================================

    app.get(
      "/admin/stats",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const totalSupporters = await usersCollection.countDocuments({
            role: { $regex: /^supporter$/i },
          });

          const totalCreators = await usersCollection.countDocuments({
            role: { $regex: /^creator$/i },
          });

          // Sum of all users' credits
          const users = await usersCollection
            .find({}, { projection: { credits: 1 } })
            .toArray();

          const totalAvailableCredits = users.reduce(
            (sum, u) => sum + (Number(u.credits) || 0),
            0
          );

          // Payments processed
          const payments = await paymentsCollection.find({}).toArray();
          const totalPaymentsCount = payments.length;
          const totalPaymentsAmount = payments.reduce(
            (sum, p) => sum + (Number(p.amountTotal) || 0),
            0
          ) / 100;

          // Pending counts
          const pendingCampaignsCount = await campaignsCollection.countDocuments({
            status: "pending",
          });

          const pendingWithdrawalsCount = await withdrawalsCollection.countDocuments({
            status: "pending",
          });

          const totalCampaignsCount = await campaignsCollection.countDocuments({});

          return res.status(200).json({
            success: true,
            data: {
              totalSupporters,
              totalCreators,
              totalAvailableCredits,
              totalPaymentsCount,
              totalPaymentsAmount,
              pendingCampaignsCount,
              pendingWithdrawalsCount,
              totalCampaignsCount,
            },
          });
        } catch (error) {
          console.error("Admin stats error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to fetch admin stats",
          });
        }
      }
    );

    // ==================================================
    // GET ALL WITHDRAWALS (ADMIN)
    // ==================================================

    app.get(
      "/withdrawals",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const status = req.query.status ? String(req.query.status) : null;
          const query: Record<string, any> = {};

          if (status) {
            query.status = status;
          }

          const results = await withdrawalsCollection
            .find(query)
            .sort({ withdraw_date: -1 })
            .toArray();

          return res.status(200).json({
            success: true,
            data: results,
          });
        } catch (error) {
          console.error("Admin get withdrawals error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to fetch withdrawals",
          });
        }
      }
    );

    // ==================================================
    // APPROVE WITHDRAWAL (PAYMENT SUCCESS)
    // ==================================================

    app.patch(
      "/withdrawals/approve/:id",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const id = String(req.params.id);

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              success: false,
              message: "Invalid withdrawal ID",
            });
          }

          const withdrawal = await withdrawalsCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!withdrawal) {
            return res.status(404).json({
              success: false,
              message: "Withdrawal request not found",
            });
          }

          if (withdrawal.status === "approved") {
            return res.status(400).json({
              success: false,
              message: "Withdrawal is already approved",
            });
          }

          // 1. Change withdrawal request status to "approved"
          await withdrawalsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status: "approved",
                approvedAt: new Date(),
                updatedAt: new Date(),
              },
            }
          );

          // 2. Decrease the creator's raised credits by withdrawal amount
          const creatorEmail = withdrawal.creator_email;
          const creditsToDeduct = Number(withdrawal.withdrawal_credit || 0);

          const creatorCampaigns = await campaignsCollection
            .find({ creatorEmail })
            .sort({ amount_raised: -1 })
            .toArray();

          let remaining = creditsToDeduct;
          for (const camp of creatorCampaigns) {
            if (remaining <= 0) break;
            const currentRaised = Number(camp.amount_raised || 0);
            const deduct = Math.min(currentRaised, remaining);
            if (deduct > 0) {
              await campaignsCollection.updateOne(
                { _id: camp._id },
                {
                  $inc: { amount_raised: -deduct },
                  $set: { updatedAt: new Date() },
                }
              );
              remaining -= deduct;
            }
          }

          // Also deduct from user's credit record if present
          await usersCollection.updateOne(
            { email: creatorEmail },
            {
              $inc: { credits: -creditsToDeduct },
              $set: { updatedAt: new Date() },
            }
          );

          // 3. Notify Creator
          if (creatorEmail) {
            await notificationsCollection.insertOne({
              message: `Your withdrawal request of ${withdrawal.withdrawal_credit} credits ($${withdrawal.withdrawal_amount}) was approved by admin.`,
              toEmail: creatorEmail,
              actionRoute: "/dashboard/Creator/Withdrawals",
              time: new Date(),
            });
          }

          return res.status(200).json({
            success: true,
            message: "Withdrawal request approved and creator credits deducted successfully.",
          });
        } catch (error) {
          console.error("Approve withdrawal error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to approve withdrawal request",
          });
        }
      }
    );

    // ==================================================
    // REJECT WITHDRAWAL
    // ==================================================

    app.patch(
      "/withdrawals/reject/:id",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const id = String(req.params.id);

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              success: false,
              message: "Invalid withdrawal ID",
            });
          }

          await withdrawalsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status: "rejected",
                rejectedAt: new Date(),
                updatedAt: new Date(),
              },
            }
          );

          return res.status(200).json({
            success: true,
            message: "Withdrawal request rejected.",
          });
        } catch (error) {
          console.error("Reject withdrawal error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to reject withdrawal",
          });
        }
      }
    );

    // ==================================================
    // GET ALL REPORTS (ADMIN)
    // ==================================================

    app.get(
      "/reports",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          // If empty, seed initial realistic sample reports for demonstration
          const count = await reportsCollection.countDocuments();
          if (count === 0) {
            await reportsCollection.insertMany([
              {
                campaign_id: "seed_camp_1",
                campaign_title: "High-Yield Quantum Crypto Farm",
                reporter_name: "Alice Johnson",
                reporter_email: "alice@example.com",
                reason: "Suspected Ponzi scheme with unrealistic guaranteed 300% returns.",
                status: "pending",
                date: new Date(Date.now() - 86400000 * 2),
                createdAt: new Date(Date.now() - 86400000 * 2),
              },
              {
                campaign_id: "seed_camp_2",
                campaign_title: "Perpetual Motion Clean Energy Generator",
                reporter_name: "Marcus Aurelius",
                reporter_email: "marcus@example.com",
                reason: "Violates fundamental laws of physics; copied photos from patent sketches.",
                status: "pending",
                date: new Date(Date.now() - 86400000),
                createdAt: new Date(Date.now() - 86400000),
              },
              {
                campaign_id: "seed_camp_3",
                campaign_title: "Community Dog Shelter Winter Heating",
                reporter_name: "David Smith",
                reporter_email: "david@example.com",
                reason: "Creator using stolen stock photos of a shelter in another country.",
                status: "pending",
                date: new Date(),
                createdAt: new Date(),
              },
            ]);
          }

          const reports = await reportsCollection
            .find({})
            .sort({ date: -1 })
            .toArray();

          return res.status(200).json({
            success: true,
            data: reports,
          });
        } catch (error) {
          console.error("Get reports error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to fetch reports",
          });
        }
      }
    );

    // ==================================================
    // SUBMIT REPORT (SUPPORTERS)
    // ==================================================

    app.post(
      "/reports",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const {
            campaign_id,
            campaign_title,
            reporter_name,
            reporter_email,
            reason,
          } = req.body;

          if (!campaign_title || !reason) {
            return res.status(400).json({
              success: false,
              message: "Campaign title and reason are required",
            });
          }

          const reportDoc = {
            campaign_id: String(campaign_id || ""),
            campaign_title: String(campaign_title),
            reporter_name: String(reporter_name || "Anonymous Supporter"),
            reporter_email: String(reporter_email || ""),
            reason: String(reason),
            status: "pending",
            date: new Date(),
            createdAt: new Date(),
          };

          const result = await reportsCollection.insertOne(reportDoc);

          return res.status(201).json({
            success: true,
            message: "Report submitted successfully",
            data: {
              ...reportDoc,
              _id: result.insertedId,
            },
          });
        } catch (error) {
          console.error("Create report error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to submit report",
          });
        }
      }
    );

    // ==================================================
    // SUSPEND CAMPAIGN (ADMIN)
    // ==================================================

    app.patch(
      "/campaigns/suspend/:id",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const id = String(req.params.id);

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              success: false,
              message: "Invalid campaign ID",
            });
          }

          await campaignsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status: "suspended",
                suspendedAt: new Date(),
                updatedAt: new Date(),
              },
            }
          );

          await reportsCollection.updateMany(
            { campaign_id: id },
            {
              $set: {
                status: "resolved",
                resolvedAction: "suspended",
                updatedAt: new Date(),
              },
            }
          );

          return res.status(200).json({
            success: true,
            message: "Campaign suspended successfully",
          });
        } catch (error) {
          console.error("Suspend campaign error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to suspend campaign",
          });
        }
      }
    );

    // ==================================================
    // DELETE REPORT (ADMIN)
    // ==================================================

    app.delete(
      "/reports/:id",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const id = String(req.params.id);

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              success: false,
              message: "Invalid report ID",
            });
          }

          await reportsCollection.deleteOne({ _id: new ObjectId(id) });

          return res.status(200).json({
            success: true,
            message: "Report dismissed and removed",
          });
        } catch (error) {
          console.error("Delete report error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to delete report",
          });
        }
      }
    );

    // ==================================================
    // GET NOTIFICATIONS FOR USER
    // ==================================================

    app.get(
      "/notifications/:email",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const email = decodeURIComponent(String(req.params.email));

          if (!email) {
            return res.status(400).json({
              success: false,
              message: "Email is required",
            });
          }

          // Case-insensitive match on toEmail, sorted descending by time
          const notifications = await notificationsCollection
            .find({
              toEmail: { $regex: new RegExp(`^${email.trim()}$`, "i") },
            })
            .sort({ time: -1 })
            .toArray();

          return res.status(200).json({
            success: true,
            data: notifications,
          });
        } catch (error) {
          console.error("Get notifications error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to fetch notifications",
          });
        }
      }
    );

    // ==================================================
    // DELETE NOTIFICATION
    // ==================================================

    app.delete(
      "/notifications/:id",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const id = String(req.params.id);

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              success: false,
              message: "Invalid notification ID",
            });
          }

          await notificationsCollection.deleteOne({ _id: new ObjectId(id) });

          return res.status(200).json({
            success: true,
            message: "Notification removed",
          });
        } catch (error) {
          console.error("Delete notification error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to delete notification",
          });
        }
      }
    );

    // ==================================================
    // CLEAR ALL NOTIFICATIONS FOR USER
    // ==================================================

    app.delete(
      "/notifications/clear/:email",
      async (
        req: Request,
        res: Response
      ) => {
        try {
          const email = decodeURIComponent(String(req.params.email));

          await notificationsCollection.deleteMany({
            toEmail: { $regex: new RegExp(`^${email.trim()}$`, "i") },
          });

          return res.status(200).json({
            success: true,
            message: "All notifications cleared",
          });
        } catch (error) {
          console.error("Clear notifications error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to clear notifications",
          });
        }
      }
    );

    // ==================================================
    // AI CHATBOT ROUTE
    // ==================================================

    app.post("/api/chat", async (req: Request, res: Response) => {
      try {
        const { message } = req.body;
        if (!message || typeof message !== "string") {
          return res.status(400).json({ error: "Message is required" });
        }

        // Try OpenAI if API key is provided
        if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith("sk-")) {
          try {
            const completion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content:
                    "You are FundWave AI Assistant, a friendly and helpful guide for the FundWave crowdfunding platform. FundWave allows Supporters to pledge credits (1 Credit = $1 USD) to creative and community campaigns. Creators can launch campaigns, submit milestone withdrawal requests, and approve backer contributions. If a contribution is rejected, credits are refunded instantly. Keep answers concise, polite, and helpful.",
                },
                { role: "user", content: message },
              ],
              max_tokens: 300,
            });

            const reply = completion.choices[0]?.message?.content;
            if (reply) {
              return res.json({ success: true, reply });
            }
          } catch (aiErr) {
            console.warn("OpenAI API call encountered an error, falling back to knowledge base:", aiErr);
          }
        }

        // Knowledge-base fallback for instant, accurate platform guidance
        const lower = message.toLowerCase();
        let reply =
          "Hello! 👋 I am your FundWave AI Assistant. You can ask me how to contribute credits, launch campaigns, withdraw funds, or track project milestones!";

        if (
          lower.includes("credit") ||
          lower.includes("buy") ||
          lower.includes("purchase") ||
          lower.includes("token")
        ) {
          reply =
            "On FundWave, 1 platform credit equals $1.00 USD. You can top up your balance securely via Stripe under Dashboard > Purchase Credit. You can then use credits to pledge to any approved campaign!";
        } else if (
          lower.includes("withdraw") ||
          lower.includes("payout") ||
          lower.includes("bank")
        ) {
          reply =
            "Creators can request withdrawals under Dashboard > Withdrawals once contributions are approved. Our administrative team reviews and approves payouts within 24–48 hours.";
        } else if (
          lower.includes("refund") ||
          lower.includes("reject") ||
          lower.includes("cancel")
        ) {
          reply =
            "Your funds are 100% safe! If a Creator rejects your contribution, the pledged credits are immediately refunded back to your available balance.";
        } else if (
          lower.includes("campaign") ||
          lower.includes("create") ||
          lower.includes("launch")
        ) {
          reply =
            "To start a campaign, register as a Creator and head over to Dashboard > Add New Campaign. Fill in your funding goal, story, category, and deadline. Once submitted, our admins verify it before it goes live!";
        } else if (
          lower.includes("contact") ||
          lower.includes("support") ||
          lower.includes("help") ||
          lower.includes("email")
        ) {
          reply =
            "You can reach our dedicated support desk at support@fundwave.com or via our Contact Page. We typically respond within a few business hours.";
        } else if (
          lower.includes("hello") ||
          lower.includes("hi") ||
          lower.includes("hey")
        ) {
          reply =
            "Hello! 👋 Welcome to FundWave. How can I assist you with your crowdfunding journey today?";
        }

        return res.json({ success: true, reply });
      } catch (error) {
        console.error("Chat route error:", error);
        return res.status(500).json({ error: "Failed to generate AI response" });
      }
    });

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