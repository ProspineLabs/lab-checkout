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

/* SAFE NAME */
function safeName(name, code) {
  let full = code ? `${name} (${code})` : name;
  if (full.length > 100) full = full.substring(0, 97) + "...";
  return full;
}

/* EMAIL */
const transporter = nodemailer.createTransport({
  host: "mail.smtp2go.com",
  port: 2525,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/* TEST INSTRUCTIONS */
const TEST_INSTRUCTIONS = {
  "7600": "Fasting 9–12 hours required"
};

/* ==============================
   PDF (FULLY FIXED)
============================== */
function generatePDF(name, dob, gender, tests) {
  return new Promise((resolve) => {

    const doc = new PDFDocument({ margin: 40 });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    let y = 25;

    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, (doc.page.width - 130) / 2, y, { width: 130 });
      y += 70;
    }

    doc.y = y;
doc.moveDown(3);
    doc.fontSize(14).fillColor("#2c7be5")
      .text("LAB ORDER SUMMARY", { align: "center" });

    doc.moveDown(2);

    const startY = doc.y;

    /* TWO COLUMN BOX */
    doc.roundedRect(45, startY - 5, 500, 80, 6).stroke("#e0e0e0");

    doc.fontSize(11).text("Patient Information", 50, startY);
    doc.fontSize(10)
      .text(`Name: ${name}`, 50, startY + 15)
      .text(`DOB: ${dob}`, 50, startY + 30)
      .text(`Gender: ${gender}`, 50, startY + 45);

    doc.fontSize(11).text("Ordering Provider", 300, startY);
    doc.fontSize(10)
      .text("Dr. Cleberton S. Bastos, DC", 300, startY + 15)
      .text("ProSpine Orlando Chiropractic", 300, startY + 30)
      .text("Quest Account: 11845569", 300, startY + 45);

    doc.y = startY + 100;

    /* TABLE HEADER */
    doc.fontSize(11).text("Ordered Tests", 50);

    const col1 = 50;
    const col2 = 330;
    const col3 = 400;

    let rowY = doc.y + 15;

    doc.fontSize(10)
      .text("Test Name", col1, rowY)
      .text("Code", col2, rowY)
      .text("Instructions", col3, rowY);

    rowY += 15;

    tests.forEach((t, i) => {

      const height = doc.heightOfString(t.name, { width: 260 }) + 8;

      if (i % 2 === 0) {
        doc.rect(45, rowY - 2, 500, height).fill("#f5f7fa").fillColor("black");
      }

      doc.text(t.name, col1, rowY, { width: 260 });
      doc.text(t.code || "-", col2, rowY);
      doc.text(TEST_INSTRUCTIONS[t.code] || "-", col3, rowY, { width: 120 });

      rowY += height;
    });

    /* INSTRUCTIONS BOX (FIXED SIZE) */
    doc.y = rowY + 10;

    const instY = doc.y;
    const instHeight = 70;

    doc.roundedRect(45, instY, 500, instHeight, 6).stroke("#e0e0e0");

    doc.fontSize(11).text("Instructions", 50, instY + 10);

    doc.fontSize(10)
      .text("• Bring a valid photo ID", 50, instY + 25)
      .text("• No payment required at the lab", 50, instY + 40)
      .text("• Follow preparation instructions above", 50, instY + 55);

    /* DISCLAIMER */
    const discY = instY + instHeight + 10;

    doc.roundedRect(45, discY, 500, 90, 6).stroke("#e0e0e0");

    doc.fontSize(9)
      .text(
        "IMPORTANT:\nProSpine Orlando facilitates laboratory testing services for your convenience. All laboratory testing is performed by a third-party CLIA-certified laboratory (Quest Diagnostics). ProSpine Orlando is not a laboratory and does not perform or analyze lab tests. Payment collected is for coordination and administrative services.",
        50,
        discY + 10,
        { width: 480 }
      );

    doc.end();
  });
}

/* ==============================
   WEBHOOK
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
      return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {

      const s = event.data.object;
      const { name, dob, gender, email } = s.metadata;

      const items = await stripe.checkout.sessions.listLineItems(s.id);

      const tests = items.data.map(i => ({
        name: i.description,
        price: i.amount_total / 100,
        code: i.description.match(/\((\d+)\)/)?.[1] || ""
      }));

      const total = items.data.reduce((sum, i) => sum + i.amount_total, 0) / 100;

      const pdf = await generatePDF(name, dob, gender, tests);

      /* CLIENT EMAIL (NO PRICE) */
      await transporter.sendMail({
        from: `"ProSpine Orlando" <${process.env.SMTP_USER}>`,
        to: email,
        subject: "Lab Order Confirmation",
        html: `
        <div style="font-family:Arial;max-width:600px;margin:auto;">
          <div style="text-align:center;">
            <img src="https://www.prospineorlando.com/images/logo-5-stars.png" width="180"/>
          </div>

          <h2 style="text-align:center;">Lab Order Confirmed</h2>

          <ul>
            ${tests.map(t => `<li>${t.name}</li>`).join("")}
          </ul>

          <div style="text-align:center;">
            <img src="https://www.prospineorlando.com/exams/quest.png" width="120"/>
          </div>

          <div style="text-align:center;margin:20px;">
            <a href="https://appointment.questdiagnostics.com/as-home"
              style="background:#2c7be5;color:white;padding:12px 20px;text-decoration:none;border-radius:5px;">
              Schedule Appointment
            </a>
          </div>

          <p style="font-size:12px;">
          IMPORTANT: ProSpine Orlando facilitates laboratory testing services...
          </p>
        </div>
        `,
        attachments: [{ filename: "Lab_Order.pdf", content: pdf }]
      });

      /* CLINIC EMAIL (WITH PRICE) */
      await transporter.sendMail({
        from: `"ProSpine Orlando" <${process.env.SMTP_USER}>`,
        to: process.env.SMTP_USER,
        subject: "New Lab Order",
        html: `
        <div style="font-family:Arial;">
          <h3>New Lab Order</h3>
          <strong>${name}</strong><br/>
          ${email}<br/><br/>

          <ul>
            ${tests.map(t => `<li>${t.name} — $${t.price.toFixed(2)}</li>`).join("")}
          </ul>

          <h3>Total: $${total.toFixed(2)}</h3>
        </div>
        `
      });
    }

    res.sendStatus(200);
  }
);

/* CORS */
app.use(cors({ origin: "https://www.prospineorlando.com" }));
app.use(express.json());

/* CHECKOUT */
app.post("/create-checkout-session", async (req, res) => {

  const { name, dob, email, phone, gender, tests } = req.body;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: tests.map(t => ({
      price_data: {
        currency: "usd",
        product_data: { name: safeName(t.name, t.code) },
        unit_amount: Math.round(t.price * 100)
      },
      quantity: 1
    })),
    success_url: "https://www.prospineorlando.com/success/index.html",
    cancel_url: "https://www.prospineorlando.com/cancel/index.html",
    metadata: { name, dob, gender, email, phone }
  });

  res.json({ url: session.url });
});

app.listen(3000);
