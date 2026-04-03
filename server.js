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
   SAFE NAME (STRIPE LIMIT FIX)
============================== */
function safeName(name, code) {
  let full = code ? `${name} (${code})` : name;

  if (full.length > 100) {
    full = full.substring(0, 97) + "...";
  }

  return full;
}

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
   PDF GENERATOR
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
      const maxWidth = 140;
      const scale = maxWidth / image.width;

      const displayHeight = image.height * scale;
      const centerX = (doc.page.width - maxWidth) / 2;

      doc.image(LOGO_PATH, centerX, currentY, { width: maxWidth });
      currentY += displayHeight + 20;
    }

    doc.y = currentY;

    doc.fontSize(16)
      .fillColor("#2c7be5")
      .text("LAB ORDER SUMMARY", { align: "center" });

    doc.moveDown(2);

    const startY = doc.y;

    doc.roundedRect(45, startY - 5, 500, 80, 6)
      .strokeColor("#dfe3e8")
      .stroke();

    doc.fontSize(11).text("Patient Information", 50, startY);

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

    doc.end();
  });
}

/* ==============================
   WEBHOOK (EMAILS)
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

      const totalAmount = lineItems.data.reduce((sum, item) => {
        return sum + item.amount_total;
      }, 0) / 100;

      const pdf = await generatePDF(name, dob, gender, tests);

      const testRows = tests.map(t => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #eee;">${t.name}</td>
          <td style="padding:10px;border-bottom:1px solid #eee;">${t.code || "-"}</td>
        </tr>
      `).join("");

      /* PATIENT EMAIL */
      await transporter.sendMail({
        from: `"ProSpine Orlando" <${process.env.SMTP_USER}>`,
        to: email,
        subject: "Your Lab Order Confirmation",
        html: `
        <div style="font-family:Arial;max-width:600px;margin:auto;">
          <div style="text-align:center;padding:20px;">
            <img src="https://www.prospineorlando.com/exams/logo.png" width="200"/>
          </div>

          <h2 style="color:#2c7be5;text-align:center;">Lab Order Confirmed</h2>

          <p>Hello ${name},</p>

          <table style="width:100%;border-collapse:collapse;margin-top:15px;">
            <thead style="background:#f4f8fb;">
              <tr>
                <th style="padding:10px;text-align:left;">Test</th>
                <th style="padding:10px;text-align:left;">Code</th>
              </tr>
            </thead>
            <tbody>${testRows}</tbody>
          </table>

          <div style="margin-top:20px;padding:15px;background:#f4f8fb;border-radius:8px;">
            • Bring ID<br/>
            • No payment needed at lab<br/>
            • Follow prep instructions
          </div>

          <div style="text-align:center;margin:30px;">
            <a href="https://appointment.questdiagnostics.com/as-home"
              style="background:#2c7be5;color:white;padding:14px 25px;text-decoration:none;border-radius:6px;">
              Schedule Appointment
            </a>
          </div>
        </div>
        `,
        attachments: [{ filename: "Lab_Order.pdf", content: pdf }]
      });

      /* CLINIC EMAIL */
      await transporter.sendMail({
        from: `"ProSpine Orlando" <${process.env.SMTP_USER}>`,
        to: process.env.SMTP_USER,
        subject: "New Lab Order",
        html: `
          <strong>New Lab Order</strong><br/><br/>
          Name: ${name}<br/>
          Email: ${email}<br/><br/>
          ${tests.map(t => `• ${t.name} — $${t.price.toFixed(2)}`).join("<br/>")}
          <br/><br/>
          <strong>Total Paid: $${totalAmount.toFixed(2)}</strong>
        `
      });

      console.log("✅ Emails sent with total");
    }

    res.sendStatus(200);
  }
);

/* ==============================
   CORS
============================== */
app.use(cors({
  origin: "https://www.prospineorlando.com",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.options("*", cors());

app.use(express.json());

/* ==============================
   CHECKOUT
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
            name: safeName(t.name, t.code)
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
