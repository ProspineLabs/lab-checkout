require("dotenv").config();

const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();

// =========================
// ✅ BASIC SAFETY CHECK
// =========================
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY is missing!");
  process.exit(1);
}

// =========================
// ✅ CORS (OPEN FOR TESTING)
// =========================
app.use(cors());
app.options("*", cors());

// =========================
// ✅ BODY PARSER
// =========================
app.use(express.json());

// =========================
// ✅ TEST ROUTE
// =========================
app.get("/", (req, res) => {
  res.send("✅ Server is running");
});

// =========================
// 💳 CREATE CHECKOUT SESSION
// =========================
app.post("/create-checkout-session", async (req, res) => {
  try {
    console.log("🔥 Request received at /create-checkout-session");
    console.log("📦 Body:", req.body);

    const { items } = req.body;

    // Validate input
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    // Build Stripe line items
    const line_items = items.map((item) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.name || "Lab Test",
        },
        unit_amount: Math.round((item.price || 0) * 100),
      },
      quantity: 1,
    }));

    // Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: line_items,
      mode: "payment",

      success_url: "https://www.prospineorlando.com/success/index.html",
      cancel_url: "https://www.prospineorlando.com/exams/exams.html",
    });

    console.log("✅ Stripe session created:", session.id);

    // Send URL back to frontend
    res.json({ url: session.url });

  } catch (error) {
    console.error("❌ ERROR creating checkout session:", error);
    res.status(500).json({ error: error.message });
  }
});

// =========================
// 🚀 START SERVER
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
