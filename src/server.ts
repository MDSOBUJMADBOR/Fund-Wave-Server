import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";

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





// Admin Route 

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


app.get("/campaigns/email/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const result = await campaignsCollection
      .find({ creatorEmail: email })
      .toArray();

    res.status(200).json(result);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});
// http://localhost:5000/campaigns/email/jothi@gmail.com 



app.patch("/campaigns/:id",async (req,res) => {
  const {id} = req.params
  const updateData = req.body

  const result = await campaignsCollection.updateOne(
    {_id: new ObjectId(id)},
    {$set: updateData}
  )
res.json(result)
})


app.delete("/campaigns/:id", async (req, res) => {
  const id = req.params.id;
 
  const result = await campaignsCollection.deleteOne({
    _id: new ObjectId(id),
  });

  res.json(result);
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