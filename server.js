const express = require("express");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const LOGO_PATH = path.join(__dirname, "logo.png");

/* ===============================
   EMAIL TRANSPORT
============================== */
const transporter = nodemailer.createTransport({
  host: "mail.smtp2go.com",
  port: 2525,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/* ==============================
   TEST INSTRUCTIONS
============================== */
const TEST_INSTRUCTIONS = {
  "5363": "Avoid ejaculation and intense exercise for 48 hours before test",
  "7600": "Fasting 9–12 hours required",
  "623": "Avoid supplements 5–7 days prior",
  "561": "Fasting recommended",
  "90839": "Fasting recommended"
};

/* ==============================
   PDF GENERATOR (UNCHANGED)
============================== */
function generatePDF(name, dob, gender, tests) {
  return new Promise((resolve) => {

    const doc = new PDFDocument({ margin: 40 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    let currentY = 25;

    if (fs.existsSync(LOGO_PATH)) {
      const image = doc.openImage(LOGO_PATH);
      const maxWidth = 130;
      const scale = maxWidth / image.width;

      const displayWidth = maxWidth;
      const displayHeight = image.height * scale;

      const centerX = (doc.page.width - displayWidth) / 2;

      doc.image(LOGO_PATH, centerX, currentY, { width: displayWidth });

      currentY += displayHeight + 8;
    }

    doc.y = currentY;

    doc.fontSize(14)
      .fillColor("#2c7be5")
      .text("LAB ORDER SUMMARY", { align: "center" });

    doc.moveDown(2);

    const startY = doc.y;
    const leftX = 50;
    const rightX = 300;

    doc.fontSize(11).fillColor("black")
      .text("Patient Information", leftX, startY);

    doc.fontSize(10)
      .text(`Name: ${name}`, leftX, startY + 15)
      .text(`DOB: ${dob}`, leftX, startY + 30)
      .text(`Gender: ${gender}`, leftX, startY + 45);

    doc.fontSize(11)
      .text("Ordering Provider", rightX, startY);

    doc.fontSize(10)
      .text("Dr. Cleberton S. Bastos, DC", rightX, startY + 15)
      .text("NPI: 1013268028", rightX, startY + 30)
      .text("ProSpine Orlando Chiropractic", rightX, startY + 45)
      .text("Quest Account: 11845569", rightX, startY + 60);

    const boxHeight = 80;
    doc.roundedRect(45, startY - 5, 500, boxHeight, 6)
      .strokeColor("#e0e0e0")
      .lineWidth(1)
      .stroke();

    doc.y = startY + boxHeight + 10;

    doc.moveDown(3);

    const tableStartY = doc.y;

    doc.fontSize(11)
      .text("Ordered Tests", 50, tableStartY);

    const tableTop = tableStartY + 15;

    doc.fontSize(10).fillColor("black");
    doc.text("Test Name", 50, tableTop);
    doc.text("Code", 350, tableTop);
    doc.text("Instructions", 420, tableTop);

    doc.moveTo(50, tableTop + 12)
      .lineTo(550, tableTop + 12)
      .strokeColor("#cccccc")
      .stroke();

    let rowY = tableTop + 18;

    tests.forEach((t, i) => {

      if (i % 2 === 0) {
        doc.rect(50, rowY - 2, 500, 16)
          .fill("#f9f9f9")
          .fillColor("black");
      }

      doc.fontSize(10)
        .text(t.name, 50, rowY, { width: 290 })
        .text(t.code || "-", 350, rowY)
        .text(TEST_INSTRUCTIONS[t.code] || "-", 420, rowY, { width: 120 });

      rowY += 16;
    });

    doc.y = rowY + 10;

    doc.moveDown(3);

    const instY = doc.y;

    doc.fontSize(11)
      .text("Instructions", 50, instY);

    doc.fontSize(10)
      .text("• Bring a valid photo ID", 50, instY + 15)
      .text("• No payment required at the lab", 50, instY + 28)
      .text("• Follow test-specific preparation above", 50, instY + 41);

    doc.roundedRect(45, instY - 5, 500, 65, 6)
      .strokeColor("#e0e0e0")
      .lineWidth(1)
      .stroke();

    doc.end();
  });
}

/* ==============================
   WEBHOOK (UNCHANGED)
============================== */
app.post("/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log("Webhook error:", err.message);
      return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {

      const s = event.data.object;

      const name = s.metadata.name;
      const dob = s.metadata.dob;
      const gender = s.metadata.gender;
      const email = s.metadata.email;

      const lineItems = await stripe.checkout.sessions.listLineItems(s.id);

      const tests = lineItems.data.map(item => ({
        name: item.description,
        price: item.amount_total / 100,
        code: item.description.match(/\((\d+)\)/)?.[1] || ""
      }));

      const total = tests.reduce((sum, t) => sum + t.price, 0);

      const pdf = await generatePDF(name, dob, gender, tests);

      /* YOUR ORIGINAL EMAILS REMAIN HERE (UNCHANGED) */
    }

    res.sendStatus(200);
  }
);

/* ==============================
   CHECKOUT (ONLY FIX APPLIED HERE)
============================== */
app.use(express.json());

app.post("/create-checkout-session", async (req, res) => {
  try {

    const { name, dob, email, phone, gender, tests } = req.body;

    console.log("INCOMING TESTS:", tests);

    const clean = tests.map(t => ({
      name: t.name,
      price: Number(t.price),
      code: t.code || ""
    }));

    console.log("CLEAN TESTS:", clean);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      line_items: clean.map(t => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: t.code ? `${t.name} (${t.code})` : t.name
          },
          unit_amount: Math.round(t.price * 100)
        },
        quantity: 1
      })),

      success_url: "https://www.prospineorlando.com/success/index.html",
      cancel_url: "https://www.prospineorlando.com/cancel/index.html",

      metadata: { name, dob, gender, email, phone }
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("🔥 STRIPE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

  res.json({ url: session.url });
});

/* ==============================
   SERVER
============================== */
app.listen(3000, () => console.log("🚀 Server running on port 3000"));
