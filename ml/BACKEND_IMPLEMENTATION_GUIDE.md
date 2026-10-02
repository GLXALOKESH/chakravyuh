# Backend Implementation Guide: Reading ML Data from MongoDB

This guide explains how to implement the backend (Express + TypeScript + Mongoose) to read the ML pipeline's output directly from MongoDB Atlas, completely bypassing the old JSON files. 

The ML Python pipeline now pushes all generated data (accounts, transactions, rings, alerts, etc.) directly into MongoDB Atlas. As the backend developer, all you need to do is connect to Atlas and query the collections using Mongoose.

## 1. Connection Setup

Make sure your backend server connects to the shared MongoDB Atlas cluster using the provided connection string in your `.env`:

```env
MONGO_URL="mongodb+srv://shovan:cXIcpgLvKwRn0ymk@hackathon.gqtv7yg.mongodb.net/chakravyuh"
```

In your `server/src/index.ts` (or database connection file):

```typescript
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const connectDB = async () => {
  try {
    const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/chakravyuh';
    await mongoose.connect(mongoUrl);
    console.log('✅ Connected to MongoDB Atlas successfully!');
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  }
};
```

## 2. Using Existing Mongoose Models

The ML script populates the collections matching your existing schemas in `server/src/models/`. You simply import these models to fetch the data. The relevant models/collections are:
- `Account` (Collection: `accounts`)
- `Transaction` (Collection: `transactions`)
- `Ring` (Collection: `rings`)
- `Alert` (Collection: `alerts`)
- `Recruit` (Collection: `recruits`)

## 3. Implementation Example: Fetching Data in Routes

Here is how you should implement your Express routes or repository layers to fetch the data pushed by the ML pipeline.

### A. Fetching Transactions (Real-time Simulation)
Since the frontend requested not to get all data at once, you can implement pagination or time-based filtering for transactions:

```typescript
import { Request, Response } from 'express';
import { Transaction } from '../models/Transaction'; // Adjust path as needed

export const getTransactions = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    // Fetch transactions sorted by timestamp (simulating real-time flow)
    const transactions = await Transaction.find({})
      .sort({ ts: 1 }) // Sort by oldest to newest
      .skip(skip)
      .limit(limit)
      .lean(); // Use lean() for faster read-only queries

    const total = await Transaction.countDocuments();

    res.json({
      success: true,
      data: transactions,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};
```

### B. Fetching Rings and Alerts
The ML model pre-computes fraud rings and alerts. You can fetch them directly without any processing overhead on the backend:

```typescript
import { Ring } from '../models/Ring';
import { Alert } from '../models/Alert';

// Fetch all fraud rings
export const getRings = async (req: Request, res: Response) => {
  try {
    const rings = await Ring.find({}).lean();
    res.json({ success: true, data: rings });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch rings' });
  }
};

// Fetch alerts sorted by most recent
export const getAlerts = async (req: Request, res: Response) => {
  try {
    const alerts = await Alert.find({})
      .sort({ fired_at: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, data: alerts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch alerts' });
  }
};
```

## 4. Key Takeaways for the Backend Developer

1. **No JSON Files**: You DO NOT need to read `seed.json`, `data.json`, or any local files anymore. All ML output is securely residing in MongoDB Atlas.
2. **Independent Execution**: You do not need to run the Python server. As long as you are connected to the `MONGO_URL`, you can pull the data.
3. **Transaction `amount` Fixed**: The `amount_paise` mismatch is fixed. The ML now outputs `amount` in integer rupees, which perfectly aligns with the backend expectations.
4. **Data Sync**: If the ML team generates a new dataset, it will simply overwrite the old collections in Atlas, and your backend will instantly serve the new data without any code changes or server restarts.
