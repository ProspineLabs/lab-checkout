require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* RAW BODY FOR WEBHOOK */
app.use("/webhook", express.raw({ type: "application/json" }));

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

  if (event.type === "checkout.session.completed") {

    console.log("🔥 PAYMENT SUCCESS TRIGGERED");

    const session = event.data.object;
    const tests = JSON.parse(session.metadata.tests);

    const testList = tests.map(t => `• ${t.name} (${t.code})`).join("<br>");

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
      page.drawText(`${t.name} (${t.code})`, { x: 50, y });
      y -= 20;
    });

    const pdfBytes = await pdfDoc.save();

    /* =====================================
       SMTP2GO CONFIG
    ===================================== */
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: 2525,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    try {

      /* =====================================
         EMAIL TO PATIENT (UPGRADED)
      ===================================== */
      await transporter.sendMail({
        from: "ProSpine Orlando <contact@prospineorlando.com>",
        to: session.customer_details.email,
        subject: "Your Lab Order is Ready",
        html: `
        <div style="font-family:Arial; max-width:600px; margin:auto;">

          <div style="text-align:center; padding:20px;">
            <img src="https://www.prospineorlando.com/images/logo-5-stars.png" style="height:80px;">
          </div>

          <h2 style="color:#2c7be5;">Your Lab Order is Ready</h2>

          <p>Hello ${session.metadata.name},</p>

          <p>Your lab order has been successfully processed.</p>

          <div style="background:#f5f7fb; padding:15px; border-radius:10px;">
            <b>Patient:</b> ${session.metadata.name}<br>
            <b>Date of Birth:</b> ${session.metadata.dob}
          </div>

          <h3 style="margin-top:20px;">Tests Ordered</h3>

          <div style="line-height:1.6;">
            ${testList}
          </div>

          <div style="margin:25px 0; text-align:center;">
            <a href="https://www.questdiagnostics.com/locations/search"
               style="display:inline-block; background:#2c7be5; color:white; padding:12px 20px; border-radius:8px; text-decoration:none;">
               
               <img src="https://www.prospineorlando.com/exams/quest.png" 
                    style="height:18px; vertical-align:middle; margin-right:8px;">
               
               Schedule Your Appointment
            </a>
          </div>

          <p><b>Important:</b></p>
          <ul>
            <li>Bring a valid ID</li>
            <li>No payment required at the lab</li>
          </ul>

          <p style="margin-top:20px;">
          Thank you,<br>
          <b>ProSpine Orlando</b>
          </p>

        </div>
        `,
        attachments: [
          {
            filename: "lab-order.pdf",
            content: pdfBytes
          }
        ]
      });

      console.log("📧 Patient email sent");

      /* =====================================
         EMAIL TO CLINIC
      ===================================== */
      await transporter.sendMail({
        from: "ProSpine Orlando <contact@prospineorlando.com>",
        to: "contact@prospineorlando.com",
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
      console.error("❌ EMAIL ERROR:", err);
    }
  }

  res.sendStatus(200);
});

/* =====================================
   START SERVER
===================================== */
app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
