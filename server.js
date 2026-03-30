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

    const qrData = `https://www.prospineorlando.com/order/${orderId}`;
    const qrImage = await QRCode.toDataURL(qrData);

    /* HEADER */
    doc.fontSize(20).fillColor("#2c7be5").text("ProSpine Orlando", { align: "center" });
    doc.fontSize(14).fillColor("black").text("Lab Order Summary", { align: "center" });

    doc.moveDown();
    doc.fontSize(10).fillColor("gray").text(`Order ID: ${orderId}`, { align: "center" });

    doc.moveDown(1.5);

    /* PATIENT */
    doc.fontSize(12).fillColor("black").text("Patient Information", { underline: true });
    doc.moveDown(0.5);

    doc.text(`Name: ${name}`);
    doc.text(`Date of Birth: ${dob}`);

    doc.moveDown();

    /* TESTS */
    doc.text("Ordered Tests", { underline: true });
    doc.moveDown(0.5);

    tests.forEach(t => {
      doc.text(`• ${t.name} (Code: ${t.code})`);

      if (t.instructions) {
        doc.fontSize(10).fillColor("#2c7be5")
          .text(`   ⚠ ${t.instructions}`);
        doc.fontSize(12).fillColor("black");
      }
    });

    doc.moveDown();

    /* PROVIDER */
    doc.text("Ordering Provider", { underline: true });
    doc.moveDown(0.5);

    doc.text("Dr. Cleberton S. Bastos, DC");
    doc.text("NPI: 1013268028");
    doc.text("ProSpine Orlando Chiropractic");
    doc.text("Quest Account: 11845569");

    doc.moveDown();

    /* INSTRUCTIONS */
    doc.text("Instructions", { underline: true });
    doc.moveDown(0.5);

    doc.text("• Bring a valid photo ID");
    doc.text("• No payment required at the lab");
    doc.text("• Follow fasting instructions if applicable");

    doc.moveDown();

    /* MOBILE TIP */
    doc.fontSize(10).fillColor("#2c7be5")
      .text("Tip: You can show this document on your phone at the lab.");

    doc.moveDown();

    /* QR CODE */
    doc.image(qrImage, doc.page.width - 140, doc.y - 50, { width: 100 });

    doc.moveDown(2);

    /* FOOTER */
    doc.fontSize(9).fillColor("gray")
      .text("All laboratory testing is performed by Quest Diagnostics, a third-party CLIA-certified laboratory. ProSpine Orlando facilitates ordering and payment collection.");

    doc.end();
  });
}

/* ==============================
   WEBHOOK FIRST
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

      /* ==============================
         GENERATE PDF
      ============================== */
      const pdfBuffer = await generatePDF(name, dob, tests);

      /* ==============================
         PATIENT EMAIL
      ============================== */
      const patientHTML = `
      <div style="font-family:Arial; max-width:600px; margin:auto; padding:20px;">
        <div style="text-align:center;">
          <img src="https://www.prospineorlando.com/images/logo-5-stars.png" style="width:220px;">
        </div>

        <h2 style="text-align:center;">Lab Order Confirmation</h2>

        <p>Thank you for your order.</p>

        <p><strong>Patient:</strong> ${name}<br>
        <strong>DOB:</strong> ${dob}</p>

        <h3>Total Paid: $${total}</h3>

        <div style="text-align:center; margin-top:20px;">
          <a href="https://appointment.questdiagnostics.com/as-home">
            <img src="https://www.prospineorlando.com/exams/quest.png" style="width:140px;"><br>
            <span style="background:#2c7be5; color:white; padding:12px; display:inline-block; border-radius:6px;">
              Schedule Your Appointment
            </span>
          </a>
        </div>

        <p style="margin-top:20px;">
        ✔ Bring ID<br>
        ✔ No payment at lab<br>
        ✔ Follow fasting if required
        </p>
      </div>
      `;

      /* ==============================
         CLINIC EMAIL
      ============================== */
      const clinicTests = tests.map(t =>
        `<li>${t.name} (Code: ${t.code})</li>`
      ).join("");

      const clinicHTML = `
      <div style="font-family:Arial;">
        <h2>New Lab Order</h2>

        <p><strong>Name:</strong> ${name}</p>
        <p><strong>DOB:</strong> ${dob}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>

        <h3>Tests:</h3>
        <ul>${clinicTests}</ul>

        <h3>Total: $${total}</h3>
      </div>
      `;

      try {
        console.log("📨 Sending emails...");

        /* PATIENT (WITH PDF) */
        await transporter.sendMail({
          from: '"ProSpine Orlando" <contact@prospineorlando.com>',
          to: email,
          subject: "Your Lab Order - ProSpine Orlando",
          html: patientHTML,
          attachments: [
            {
              filename: "ProSpine_Lab_Order.pdf",
              content: pdfBuffer
            }
          ]
        });

        /* CLINIC (NO PDF) */
        await transporter.sendMail({
          from: '"ProSpine Orlando" <contact@prospineorlando.com>',
          to: "contact@prospineorlando.com",
          subject: "New Lab Order - " + name,
          html: clinicHTML
        });

        console.log("✅ EMAILS SENT");

      } catch (err) {
        console.error("❌ EMAIL ERROR:", err);
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

    const line_items = tests.map((t) => ({
      price_data: {
        currency: "usd",
        product_data: { name: t.name },
        unit_amount: t.price * 100,
      },
      quantity: 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",

      success_url: "https://www.prospineorlando.com/success/index.html",
      cancel_url: "https://www.prospineorlando.com/cancel/index.html",

      metadata: {
        name,
        dob,
        email,
        phone,
        tests: JSON.stringify(tests),
      },
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
