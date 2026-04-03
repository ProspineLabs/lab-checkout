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

    doc.fontSize(14).text("LAB ORDER SUMMARY", { align: "center" });
    doc.moveDown();

    doc.fontSize(10)
      .text(`Name: ${name}`)
      .text(`DOB: ${dob}`)
      .text(`Gender: ${gender}`);

    doc.moveDown();

    tests.forEach(t => {
      doc.text(`${t.name} (${t.code})`);
    });

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
      console.log("Webhook error:", err.message);
      return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {

      const s = event.data.object;

      const name = s.metadata.name;
      const dob = s.metadata.dob;
      const gender = s.metadata.gender;
      const email = s.metadata.email;

      /* 🔥 GET LINE ITEMS */
      const lineItems = await stripe.checkout.sessions.listLineItems(s.id);

      const tests = lineItems.data.map(item => ({
        name: item.description,
        price: item.amount_total / 100,
        code: "" // optional
      }));

      const total = tests.reduce((sum, t) => sum + t.price, 0);

      const pdf = await generatePDF(name, dob, gender, tests);

      /* =========================
         PATIENT EMAIL (RESTORED)
      ========================= */
      const patientHTML = `
<div style="font-family:Arial; max-width:600px; margin:auto; line-height:1.5;">
  
  <div style="text-align:center;">
    <img src="https://www.prospineorlando.com/images/logo-5-stars.png" style="width:220px;">
  </div>

  <h2 style="text-align:center;">Lab Order Confirmation</h2>

  <p>
    <strong>${name}</strong><br>
    DOB: ${dob}<br>
    Gender: ${gender}
  </p>

  <h3>Ordered Tests</h3>

  <ul>
  ${tests.map(t=>`
    <li>${t.name}</li>
  `).join("")}
  </ul>

  <h3>Instructions</h3>
  <ul>
    <li>Bring a valid photo ID</li>
    <li>No payment required at the lab</li>
    <li>Follow preparation instructions</li>
  </ul>

  <div style="text-align:center; margin-top:25px;">
    <a href="https://appointment.questdiagnostics.com/as-home">
      <img src="https://www.prospineorlando.com/exams/quest.png" style="width:140px;"><br><br>
      <span style="background:#2c7be5;color:white;padding:12px 18px;border-radius:6px;">
        Schedule Your Appointment
      </span>
    </a>
  </div>

</div>`;

      await transporter.sendMail({
        from: '"ProSpine Orlando" <contact@prospineorlando.com>',
        to: email,
        subject: "Your Lab Order",
        html: patientHTML,
        attachments: [{
          filename: "Lab_Order.pdf",
          content: pdf
        }]
      });

      /* =========================
         CLINIC EMAIL (FULL DETAILS)
      ========================= */
      await transporter.sendMail({
        from: '"Lab Orders" <contact@prospineorlando.com>',
        to: "contact@prospineorlando.com",
        subject: `NEW LAB ORDER - ${name}`,
        html: `
        <div style="font-family:Arial;">
          <h2>New Lab Order Submitted</h2>

          <p><strong>Name:</strong> ${name}</p>
          <p><strong>DOB:</strong> ${dob}</p>
          <p><strong>Gender:</strong> ${gender}</p>
          <p><strong>Email:</strong> ${email}</p>

          <p><strong>Total Paid:</strong> $${total.toFixed(2)}</p>

          <h3>Tests Ordered:</h3>
          <ul>
            ${tests.map(t => `
              <li>${t.name} - $${t.price}</li>
            `).join("")}
          </ul>
        </div>
        `,
        attachments: [{
          filename: "Lab_Order.pdf",
          content: pdf
        }]
      });
    }

    res.sendStatus(200);
  }
);

/* ==============================
   CHECKOUT
============================== */
app.use(express.json());

app.use("/create-checkout-session", cors({
  origin: "https://www.prospineorlando.com"
}));

app.post("/create-checkout-session", async (req, res) => {

  const { name, dob, email, phone, gender, tests } = req.body;

  const clean = tests.map(t => ({
    name: t.name,
    price: t.price
  }));

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",

    line_items: clean.map(t => ({
      price_data: {
        currency: "usd",
        product_data: { name: t.name },
        unit_amount: t.price * 100
      },
      quantity: 1
    })),

    success_url: "https://www.prospineorlando.com/success/index.html",
    cancel_url: "https://www.prospineorlando.com/cancel/index.html",

    metadata: {
      name,
      dob,
      gender,
      email,
      phone
    }
  });

  res.json({ url: session.url });
});

/* ==============================
   SERVER
============================== */
app.listen(3000, () => console.log("🚀 Server running on port 3000"));
