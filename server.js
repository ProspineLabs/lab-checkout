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
   PDF GENERATOR (STYLED)
============================== */
function generatePDF(name, dob, gender, tests) {
  return new Promise((resolve) => {

    const doc = new PDFDocument({ margin: 40 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    let currentY = 25;

    // LOGO
    if (fs.existsSync(LOGO_PATH)) {
      const image = doc.openImage(LOGO_PATH);
      const maxWidth = 140;
      const scale = maxWidth / image.width;

      const displayHeight = image.height * scale;
      const centerX = (doc.page.width - maxWidth) / 2;

      doc.image(LOGO_PATH, centerX, currentY, { width: maxWidth });

      currentY += displayHeight + 20; // spacing FIX
    }

    doc.y = currentY;

    doc.fontSize(16)
      .fillColor("#2c7be5")
      .text("LAB ORDER SUMMARY", { align: "center" });

    doc.moveDown(2);

    const startY = doc.y;

    // PATIENT BOX
    doc.roundedRect(45, startY - 5, 500, 80, 6)
      .strokeColor("#dfe3e8")
      .stroke();

    doc.fontSize(11).fillColor("black")
      .text("Patient Information", 50, startY);

    doc.fontSize(10)
      .text(`Name: ${name}`, 50, startY + 15)
      .text(`DOB: ${dob}`, 50, startY + 30)
      .text(`Gender: ${gender}`, 50, startY + 45);

    doc.text("Ordering Provider", 300, startY)
      .text("Dr. Cleberton S. Bastos, DC", 300, startY + 15)
      .text("ProSpine Orlando Chiropractic", 300, startY + 30)
      .text("Quest Account: 11845569", 300, startY + 45);

    doc.y = startY + 100;

    doc.fontSize(12).text("Ordered Tests", 50);

    let rowY = doc.y + 10;

    tests.forEach((t, i) => {

      const isEven = i % 2 === 0;

      doc.rect(50, rowY - 2, 500, 20)
        .fill(isEven ? "#f4f8fb" : "#ffffff")
        .fillColor("black");

      doc.fontSize(10)
        .text(t.name, 55, rowY)
        .text(t.code || "-", 350, rowY)
        .text(TEST_INSTRUCTIONS[t.code] || "-", 420, rowY, { width: 120 });

      rowY += 20;
    });

    doc.moveDown(2);

    doc.roundedRect(45, rowY + 10, 500, 60, 6)
      .strokeColor("#dfe3e8")
      .stroke();

    doc.fontSize(11)
      .text("Instructions", 50, rowY + 15);

    doc.fontSize(10)
      .text("• Bring a valid photo ID", 50, rowY + 30)
      .text("• No payment required at the lab", 50, rowY + 45)
      .text("• Follow preparation instructions above", 50, rowY + 60);

    doc.end();
  });
}

/* ==============================
   WEBHOOK (STYLED EMAIL)
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

      const { name, dob, gender, email } = s.metadata;

      const lineItems = await stripe.checkout.sessions.listLineItems(s.id);

      const tests = lineItems.data.map(item => ({
        name: item.description,
        price: item.amount_total / 100,
        code: item.description.match(/\((\d+)\)/)?.[1] || ""
      }));

      const pdf = await generatePDF(name, dob, gender, tests);

      /* ===============================
         PATIENT EMAIL (STYLED)
      =============================== */
      await transporter.sendMail({
        from: `"ProSpine Orlando" <${process.env.SMTP_USER}>`,
        to: email,
        subject: "Your Lab Order – ProSpine Orlando",
        html: `
        <div style="font-family: Arial; max-width:600px; margin:auto;">
          <div style="text-align:center; padding:20px;">
            <img src="https://www.prospineorlando.com/exams/logo.png" width="180"/>
          </div>

          <h2 style="color:#2c7be5;">Your Order is Confirmed</h2>

          <p>Thank you for your order. Your lab request has been successfully processed.</p>

          <div style="background:#f4f8fb; padding:15px; border-radius:8px;">
            <strong>Important:</strong><br/>
            • Bring a valid photo ID<br/>
            • No payment required at Quest<br/>
            • Follow test preparation instructions
          </div>

          <div style="text-align:center; margin:30px;">
            <a href="https://appointment.questdiagnostics.com/as-home"
              style="background:#2c7be5; color:white; padding:12px 25px; text-decoration:none; border-radius:6px;">
              Schedule Your Appointment
            </a>
          </div>

          <p style="font-size:12px; color:#666;">
            Your lab order is attached as a PDF.
          </p>
        </div>
        `,
        attachments: [{
          filename: "Lab_Order.pdf",
          content: pdf
        }]
      });

      /* ===============================
         CLINIC EMAIL
      =============================== */
      await transporter.sendMail({
        from: `"ProSpine Orlando" <${process.env.SMTP_USER}>`,
        to: process.env.SMTP_USER,
        subject: "New Lab Order",
        html: `
          <strong>New Order Received</strong><br/>
          Name: ${name}<br/>
          Email: ${email}<br/>
          Tests: ${tests.map(t => t.name).join(", ")}
        `
      });

      console.log("✅ Emails sent");
    }

    res.sendStatus(200);
  }
);

/* ==============================
   CORS (UNCHANGED)
============================== */
app.use(cors({
  origin: "https://www.prospineorlando.com",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.options("*", cors());

app.use(express.json());

/* ==============================
   CHECKOUT (UNCHANGED)
============================== */
app.post("/create-checkout-session", async (req, res) => {
  try {

    const { name, dob, email, phone, gender, tests } = req.body;

    const clean = tests
      .filter(t => t && t.name && t.price !== undefined)
      .map(t => ({
        name: String(t.name),
        price: Number(t.price),
        code: t.code || ""
      }))
      .filter(t => !isNaN(t.price) && t.price > 0);

    if (clean.length === 0) {
      return res.status(400).json({ error: "Invalid test data" });
    }

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

/* ==============================
   SERVER
============================== */
app.listen(3000, () => console.log("🚀 Server running on port 3000"));
