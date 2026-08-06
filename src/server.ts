import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ServerApiVersion } from "mongodb";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = process.env.DATABASE_URL!;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect MongoDB
    await client.connect();

    // Database
    const database = client.db(process.env.DATABASE_NAME);

    // Collection
    const usersCollection = database.collection("user");
const campaignsCollection = database.collection("campaigns");

    // Test Route
    app.get("/user", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });


// Creator Route

app.post("/campaigns", async (req, res) => {
  const campaign = req.body;
  const result = await campaignsCollection.insertOne(campaign);
  res.send(result);
});


















    
    console.log("✅ MongoDB Connected");
  } catch (error) {
    console.error(error);
  }
}

run();

app.get("/", (req, res) => {
  res.send("Server Running...");
});

app.listen(port, () => {
  console.log(`Server running  port :${port}`);
});