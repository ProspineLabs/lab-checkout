require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* =====================================
   RAW BODY FOR STRIPE WEBHOOK
===================================== */
app.use("/webhook", express.raw({ type: "application/json" }));

/* NORMAL MIDDLEWARE */
app.use(cors());
app.use(express.json());

/* =====================================
   CREATE CHECKOUT SESSION
===================================== */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { tests, name, dob, email, phone } = req.body;

    console.log("🧾 Creating checkout session...");
    console.log("Patient:", name);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,

      line_items: tests.map(t => ({
        price_data: {
          currency: "usd",
          product_data: { name: t.name },
          unit_amount: t.price * 100
        },
        quantity: 1
      })),

      metadata: {
        tests: JSON.stringify(tests),
        name,
        dob,
        phone
      },

      success_url: "https://www.prospineorlando.com/success",
      cancel_url: "https://www.prospineorlando.com/cancel"
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("❌ Checkout error:", err);
    res.status(500).send("Error creating checkout session");
  }
});

/* =====================================
   STRIPE WEBHOOK
===================================== */
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

app.post("/webhook", async (req, res) => {

  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log("✅ Webhook verified:", event.type);
  } catch (err) {
    console.error("❌ Webhook signature error:", err.message);
    return res.sendStatus(400);
  }

  /* ===================================== */
  if (event.type === "checkout.session.completed") {

    console.log("🔥 PAYMENT SUCCESS TRIGGERED");

    const session = event.data.object;
    const tests = JSON.parse(session.metadata.tests);

    console.log("Patient:", session.metadata.name);
    console.log("Tests:", tests);

    /* =====================================
       CREATE PDF
    ===================================== */
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    page.drawText("ProSpine Orlando - Lab Order", { x: 50, y: 750, size: 16, font });

    page.drawText(`Name: ${session.metadata.name}`, { x: 50, y: 700 });
    page.drawText(`DOB: ${session.metadata.dob}`, { x: 50, y: 680 });

    let y = 650;

    tests.forEach(t => {
      page.drawText(`${t.name} (Code: ${t.code})`, { x: 50, y });
      y -= 20;
    });

    const pdfBytes = await pdfDoc.save();

    /* =====================================
       EMAIL DEBUG START
    ===================================== */

    console.log("📨 Attempting to send email...");
    console.log("SMTP HOST:", process.env.SMTP_HOST);
    console.log("SMTP USER:", process.env.SMTP_USER);
    console.log("SMTP PASS exists:", !!process.env.SMTP_PASS);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const testList = tests.map(t => `${t.name} (${t.code})`).join("<br>");

    try {

      /* EMAIL TO PATIENT */
      await transporter.sendMail({
        to: session.customer_details.email,
        subject: "Your Lab Order is Ready",
        html: `
        <h2>ProSpine Orlando</h2>

        <p>Your lab order is ready.</p>

        <p><b>Name:</b> ${session.metadata.name}</p>
        <p><b>DOB:</b> ${session.metadata.dob}</p>

        <p><b>Tests Ordered:</b><br>${testList}</p>

        <p>Please bring ID to Quest Diagnostics.</p>
        `,
        attachments: [
          {
            filename: "lab-order.pdf",
            content: pdfBytes
          }
        ]
      });

      console.log("📧 Patient email sent");

      /* EMAIL TO CLINIC */
      await transporter.sendMail({
        to: process.env.SMTP_USER,
        subject: "New Lab Order",
        html: `
        <h3>New Order Received</h3>

        <p><b>Name:</b> ${session.metadata.name}</p>
        <p><b>DOB:</b> ${session.metadata.dob}</p>
        <p><b>Email:</b> ${session.customer_details.email}</p>
        <p><b>Phone:</b> ${session.metadata.phone}</p>

        <p><b>Tests:</b><br>${testList}</p>

        <p><b>Total Paid:</b> $${session.amount_total / 100}</p>
        `
      });

      console.log("📧 Clinic email sent");

    } catch (err) {
      console.error("❌ EMAIL ERROR FULL:");
      console.error(err);
      console.error("MESSAGE:", err.message);
      console.error("CODE:", err.code);
    }
  }

  res.sendStatus(200);
});

/* =====================================
   TEST EMAIL ROUTE
===================================== */
app.get("/test-email", async (req, res) => {

  console.log("🧪 Testing email system...");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  try {
    await transporter.sendMail({
      to: process.env.SMTP_USER,
      subject: "Test Email",
      text: "Email system is working"
    });

    console.log("✅ Test email sent");
    res.send("✅ Test email sent");

  } catch (err) {
    console.error("❌ TEST EMAIL ERROR:", err);
    res.send("❌ Email failed");
  }
});

/* =====================================
   START SERVER
===================================== */
app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
