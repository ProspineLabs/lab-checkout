require("dotenv").config();
const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* IMPORTANT: RAW BODY FOR WEBHOOK */
app.use("/webhook", express.raw({ type: "application/json" }));

app.use(cors());
app.use(express.json());

/* =========================
   CREATE CHECKOUT SESSION
========================= */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { tests, name, dob, email, phone } = req.body;

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
    console.error(err);
    res.status(500).send("Error creating session");
  }
});

/* =========================
   WEBHOOK
========================= */
app.post("/webhook", async (req, res) => {

  const event = req.body;

  if (event.type === "checkout.session.completed") {

    const session = event.data.object;
    const tests = JSON.parse(session.metadata.tests);

    /* =========================
       CREATE PDF
    ========================= */
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

    /* =========================
       EMAIL SETUP
    ========================= */
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: 587,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const testList = tests.map(t => `${t.name} (${t.code})`).join("<br>");

    /* =========================
       EMAIL TO PATIENT
    ========================= */
    await transporter.sendMail({
      to: session.customer_details.email,
      subject: "Your Lab Order is Ready",
      html: `
      <h2>ProSpine Orlando</h2>
      <p>Your lab order is ready.</p>

      <p><b>Name:</b> ${session.metadata.name}</p>
      <p><b>DOB:</b> ${session.metadata.dob}</p>

      <p><b>Tests Ordered:</b><br>${testList}</p>

      <p>Please bring ID to Quest Diagnostics. No payment needed at the lab.</p>

      <p>
        <a href="https://www.questdiagnostics.com/locations/search">
        Find a Quest Location
        </a>
      </p>
      `,
      attachments: [
        {
          filename: "lab-order.pdf",
          content: pdfBytes
        }
      ]
    });

    /* =========================
       EMAIL TO CLINIC
    ========================= */
    await transporter.sendMail({
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
  }

  res.sendStatus(200);
});

/* =========================
   START SERVER
========================= */
app.listen(3000, () => console.log("Server running on port 3000"));
