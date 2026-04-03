require("dotenv").config();

const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");

const app = express();

// =========================
// ✅ CORS FIX (VERY IMPORTANT)
// =========================
app.use(cors({
  origin: "https://www.prospineorlando.com",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

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
// ✅ STRIPE CHECKOUT SESSION
// =========================
app.post("/create-checkout-session", async (req, res) => {
  try {
    console.log("🔥 POST /create-checkout-session HIT");
    console.log("📦 Body:", req.body);

    const { items, patient } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    // =========================
    // 🧾 BUILD LINE ITEMS
    // =========================
    const line_items = items.map(item => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.name
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: 1,
    }));

    // =========================
    // 💳 CREATE SESSION
    // =========================
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",

      success_url: "https://www.prospineorlando.com/success/index.html",
      cancel_url: "https://www.prospineorlando.com/exams/exams.html",

      metadata: {
        patient_name: patient?.name || "",
        patient_email: patient?.email || "",
        patient_phone: patient?.phone || "",
        patient_dob: patient?.dob || ""
      }
    });

    console.log("✅ Stripe session created:", session.id);

    res.json({ url: session.url });

  } catch (error) {
    console.error("❌ ERROR creating session:", error);
    res.status(500).json({ error: error.message });
  }
});

// =========================
// 📧 EMAIL (SMTP2GO READY)
// =========================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 2525,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// =========================
// 🔔 STRIPE WEBHOOK
// =========================
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // =========================
  // 🎯 HANDLE SUCCESS PAYMENT
  // =========================
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    console.log("💰 Payment completed:", session.id);

    const patientEmail = session.metadata.patient_email;

    // =========================
    // 📧 SEND EMAIL
    // =========================
    try {
      await transporter.sendMail({
        from: `"ProSpine Orlando" <${process.env.SMTP_USER}>`,
        to: patientEmail,
        subject: "Your Lab Order Confirmation",
        html: `
          <h2>Thank you for your order</h2>
          <p>Your lab order has been received.</p>

          <p><strong>Next Step:</strong></p>
          <a href="https://appointment.questdiagnostics.com/as-home">
            Schedule your lab appointment
          </a>

          <p>Please bring your ID. No payment is required at the lab.</p>
        `
      });

      console.log("📧 Email sent to:", patientEmail);

    } catch (err) {
      console.error("❌ Email error:", err);
    }
  }

  res.json({ received: true });
});

// =========================
// 🚀 START SERVER
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
