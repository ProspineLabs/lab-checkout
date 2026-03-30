const express = require("express");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* ==============================
   PDF GENERATOR (PREMIUM)
============================== */
function generatePDF(name, dob, tests) {
  return new Promise(async (resolve) => {

    const doc = new PDFDocument({ margin: 40 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    const orderId = "PSO-" + Date.now().toString().slice(-6);

    // QR (no 404)
    const qrData = "https://www.prospineorlando.com/exams/exams.html";
    const qrImage = await QRCode.toDataURL(qrData);

    /* LOGO */
    try {
      doc.image("https://www.prospineorlando.com/images/logo-5-stars.png", 200, 20, { width: 180 });
    } catch (e) {}

    doc.moveDown(3);

    /* HEADER */
    doc.fontSize(16).fillColor("#2c7be5")
      .text("LAB ORDER SUMMARY", { align: "center" });

    doc.moveDown(0.5);

    doc.strokeColor("#2c7be5")
      .lineWidth(1)
      .moveTo(40, doc.y)
      .lineTo(550, doc.y)
      .stroke();

    doc.moveDown();

    doc.fontSize(10).fillColor("gray")
      .text(`Order ID: ${orderId}`, { align: "right" });

    doc.moveDown();

    /* PATIENT BOX */
    doc.rect(40, doc.y, 515, 60).stroke();

    doc.fontSize(12).fillColor("black")
      .text("Patient Information", 50, doc.y + 5);

    doc.fontSize(11)
      .text(`Name: ${name}`, 50, doc.y + 20)
      .text(`DOB: ${dob}`, 50, doc.y + 35);

    doc.moveDown(3);

    /* TESTS BOX */
    const startY = doc.y;

    doc.rect(40, startY, 515, tests.length * 18 + 40).stroke();

    doc.fontSize(12).text("Ordered Tests", 50, startY + 5);

    let y = startY + 20;

    tests.forEach(t => {
      doc.fontSize(11).text(`• ${t.name} (Code: ${t.code})`, 50, y);
      y += 15;

      if (t.instructions) {
        doc.fontSize(10).fillColor("#2c7be5")
          .text(`⚠ ${t.instructions}`, 65, y);
        doc.fillColor("black");
        y += 12;
      }
    });

    doc.moveDown(3);

    /* PROVIDER BOX */
    const providerY = doc.y;

    doc.rect(40, providerY, 515, 80).stroke();

    doc.fontSize(12).text("Ordering Provider", 50, providerY + 5);

    doc.fontSize(11)
      .text("Dr. Cleberton S. Bastos, DC", 50, providerY + 20)
      .text("NPI: 1013268028", 50, providerY + 35)
      .text("ProSpine Orlando Chiropractic", 50, providerY + 50)
      .text("Quest Account: 11845569", 50, providerY + 65);

    doc.moveDown(4);

    /* INSTRUCTIONS BOX */
    const instrY = doc.y;

    doc.rect(40, instrY, 515, 80).stroke();

    doc.fontSize(12).text("Instructions", 50, instrY + 5);

    doc.fontSize(11)
      .text("• Bring a valid photo ID", 50, instrY + 20)
      .text("• No payment required at the lab", 50, instrY + 35)
      .text("• Follow fasting instructions if applicable", 50, instrY + 50)
      .text("• You may show this document on your phone", 50, instrY + 65);

    /* QR */
    doc.image(qrImage, 420, instrY + 10, { width: 100 });

    doc.moveDown(2);

    /* FOOTER */
    doc.fontSize(9).fillColor("gray")
      .text(
        "All laboratory testing is performed by Quest Diagnostics, a third-party CLIA-certified laboratory. ProSpine Orlando facilitates ordering and payment collection.",
        { align: "center" }
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

    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      console.log("✅ Webhook verified:", event.type);
    } catch (err) {
      console.log("❌ Webhook signature failed:", err.message);
      return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {

      console.log("🔥 PAYMENT SUCCESS TRIGGERED");

      const session = event.data.object;

      const name = session.metadata.name;
      const dob = session.metadata.dob;
      const email = session.metadata.email;
      const phone = session.metadata.phone;
      const tests = JSON.parse(session.metadata.tests);

      const total = tests.reduce((sum, t) => sum + t.price, 0);

      const pdfBuffer = await generatePDF(name, dob, tests);

      /* PATIENT EMAIL */
      const patientHTML = `
      <div style="font-family:Arial; max-width:600px; margin:auto;">
        <h2>Lab Order Confirmation</h2>
        <p>Patient: ${name}</p>
        <p>DOB: ${dob}</p>
        <p>Total: $${total}</p>

        <a href="https://appointment.questdiagnostics.com/as-home">
          <img src="https://www.prospineorlando.com/exams/quest.png" style="width:140px;"><br>
          Schedule Appointment
        </a>
      </div>
      `;

      /* CLINIC EMAIL */
      const clinicHTML = `
      <div>
        <h2>New Lab Order</h2>
        <p>Name: ${name}</p>
        <p>DOB: ${dob}</p>
        <p>Email: ${email}</p>
        <p>Phone: ${phone}</p>
        <ul>
        ${tests.map(t => `<li>${t.name} (${t.code})</li>`).join("")}
        </ul>
      </div>
      `;

      try {
        await transporter.sendMail({
          from: '"ProSpine Orlando" <contact@prospineorlando.com>',
          to: email,
          subject: "Your Lab Order",
          html: patientHTML,
          attachments: [{
            filename: "Lab_Order.pdf",
            content: pdfBuffer
          }]
        });

        await transporter.sendMail({
          from: '"ProSpine Orlando" <contact@prospineorlando.com>',
          to: "contact@prospineorlando.com",
          subject: "New Lab Order",
          html: clinicHTML
        });

        console.log("✅ EMAILS SENT");

      } catch (err) {
        console.error(err);
      }
    }

    res.sendStatus(200);
  }
);

/* ==============================
   MIDDLEWARE
============================== */
app.use(express.json());

app.use("/create-checkout-session", cors({
  origin: "https://www.prospineorlando.com"
}));

/* ==============================
   EMAIL CONFIG
============================== */
const transporter = nodemailer.createTransport({
  host: "mail.smtp2go.com",
  port: 2525,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/* ==============================
   CHECKOUT
============================== */
app.post("/create-checkout-session", async (req, res) => {

  try {
    const { name, dob, email, phone, tests } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: tests.map(t => ({
        price_data: {
          currency: "usd",
          product_data: { name: t.name },
          unit_amount: t.price * 100,
        },
        quantity: 1
      })),
      success_url: "https://www.prospineorlando.com/success/index.html",
      cancel_url: "https://www.prospineorlando.com/cancel/index.html",
      metadata: {
        name, dob, email, phone,
        tests: JSON.stringify(tests)
      }
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
