const express = require("express");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const fetch = require("node-fetch");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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
   LOAD IMAGE (FIXED)
============================== */
async function getImageBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Image failed");
  return await res.arrayBuffer().then(buf => Buffer.from(buf));
}

/* ==============================
   PREMIUM PDF (FIXED LOGO)
============================== */
async function generatePDF(name, dob, gender, tests) {

  const doc = new PDFDocument({ margin: 40 });
  const buffers = [];

  doc.on("data", buffers.push.bind(buffers));

  const logo = await getImageBuffer(
    "https://www.prospineorlando.com/images/logo-5-stars.png"
  ).catch(()=>null);

  if (logo) {
    doc.image(logo, 170, 20, { width: 240 });
  }

  doc.moveDown(3);

  doc.fontSize(18).fillColor("#2c7be5")
    .text("LAB ORDER SUMMARY", { align: "center" });

  doc.moveDown(0.5);

  doc.moveTo(40, doc.y)
    .lineTo(550, doc.y)
    .strokeColor("#2c7be5")
    .lineWidth(2)
    .stroke();

  doc.moveDown();

  doc.fontSize(11).fillColor("black")
    .text(`Patient: ${name}`)
    .text(`DOB: ${dob}`)
    .text(`Gender: ${gender}`);

  doc.moveDown();

  doc.text("Ordered Tests:", { underline: true });

  tests.forEach(t => {
    doc.moveDown(0.3);
    doc.text(`${t.name} (${t.code}) - $${t.price}`);

    if (TEST_INSTRUCTIONS[t.code]) {
      doc.fillColor("#2c7be5")
        .text(`   * ${TEST_INSTRUCTIONS[t.code]}`);
      doc.fillColor("black");
    }
  });

  doc.moveDown();

  doc.text("Provider:", { underline: true });
  doc.text("Dr. Cleberton S. Bastos, DC");
  doc.text("NPI: 1013268028");
  doc.text("Quest Account: 11845569");

  doc.moveDown();

  doc.text("Instructions:", { underline: true });
  doc.text("• Bring a valid ID");
  doc.text("• No payment required at the lab");
  doc.text("• Follow instructions above");

  doc.end();

  return new Promise(resolve => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
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
    } catch {
      return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {

      const s = event.data.object;

      const name = s.metadata.name;
      const dob = s.metadata.dob;
      const gender = s.metadata.gender;
      const email = s.metadata.email;
      const phone = s.metadata.phone;
      const tests = JSON.parse(s.metadata.tests || "[]");

      const total = tests.reduce((sum, t) => sum + t.price, 0);

      const pdf = await generatePDF(name, dob, gender, tests);

      /* ================= PATIENT EMAIL (RESTORED) ================= */
      const patientHTML = `
      <div style="font-family:Arial; max-width:600px; margin:auto; padding:20px;">

        <div style="text-align:center;">
          <img src="https://www.prospineorlando.com/images/logo-5-stars.png" style="width:220px;">
        </div>

        <h2 style="text-align:center;">Lab Order Confirmation</h2>

        <p><strong>Patient:</strong> ${name}<br>
        <strong>DOB:</strong> ${dob}<br>
        <strong>Gender:</strong> ${gender}</p>

        <h3>Selected Tests:</h3>
        <ul>
          ${tests.map(t=>{
            return `
            <li>
              ${t.name} (${t.code}) - $${t.price}
              ${TEST_INSTRUCTIONS[t.code] ? `<br><span style="color:#2c7be5;">* ${TEST_INSTRUCTIONS[t.code]}</span>` : ""}
            </li>`;
          }).join("")}
        </ul>

        <h3>Total Paid: $${total}</h3>

        <div style="text-align:center; margin-top:20px;">
          <a href="https://appointment.questdiagnostics.com/as-home">
            <img src="https://www.prospineorlando.com/exams/quest.png" style="width:140px;"><br>
            <span style="background:#2c7be5;color:#fff;padding:12px;border-radius:6px;">
              Schedule Your Appointment
            </span>
          </a>
        </div>

        <p style="margin-top:20px;">
        • Bring a valid photo ID<br>
        • No payment required at the lab<br>
        • Follow instructions listed above
        </p>

      </div>`;

      /* ================= CLINIC EMAIL ================= */
      const clinicHTML = `
      <div style="font-family:Arial;">
        <h2>New Lab Order</h2>

        <p>
        Name: ${name}<br>
        DOB: ${dob}<br>
        Gender: ${gender}<br>
        Email: ${email}<br>
        Phone: ${phone}
        </p>

        <ul>
        ${tests.map(t=>{
          return `<li>${t.name} (${t.code})</li>`;
        }).join("")}
        </ul>

        <h3>Total: $${total}</h3>
      </div>`;

      try {
        await transporter.sendMail({
          from: '"ProSpine Orlando" <contact@prospineorlando.com>',
          to: email,
          subject: "Your Lab Order",
          html: patientHTML,
          attachments: [{ filename: "Lab_Order.pdf", content: pdf }]
        });

        await transporter.sendMail({
          from: '"ProSpine Orlando" <contact@prospineorlando.com>',
          to: "contact@prospineorlando.com",
          subject: "New Lab Order",
          html: clinicHTML
        });

      } catch (err) {
        console.error("EMAIL ERROR:", err);
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
    pass: process.env.SMTP_PASS
  }
});

/* ==============================
   CHECKOUT
============================== */
app.post("/create-checkout-session", async (req, res) => {

  try {
    const { name, dob, email, phone, gender, tests } = req.body;

    const clean = tests.map(t => ({
      name: t.name,
      code: t.code,
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
        phone,
        tests: JSON.stringify(clean)
      }
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).send("Error");
  }
});

app.listen(3000, () => console.log("Server running"));
