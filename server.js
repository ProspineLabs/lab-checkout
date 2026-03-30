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
   LOAD IMAGE (SYNC SAFE)
============================== */
async function loadLogo() {
  try {
    const res = await fetch("https://www.prospineorlando.com/images/logo-5-stars.png");
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

/* ==============================
   DRAW BOX
============================== */
function drawBox(doc, y, height) {
  doc.roundedRect(40, y, 520, height, 8)
    .strokeColor("#d9d9d9")
    .lineWidth(1)
    .stroke();
}

/* ==============================
   PREMIUM PDF (BOXED)
============================== */
async function generatePDF(name, dob, gender, tests) {

  const doc = new PDFDocument({ margin: 40 });
  const buffers = [];

  doc.on("data", buffers.push.bind(buffers));

  const logo = await loadLogo();

  /* LOGO */
  if (logo) {
    doc.image(logo, 160, 20, { width: 260 });
  }

  doc.moveDown(3);

  /* TITLE */
  doc.fontSize(18).fillColor("#2c7be5")
    .text("LAB ORDER SUMMARY", { align: "center" });

  doc.moveDown(1);

  let yStart;

  /* ================= PATIENT BOX ================= */
  yStart = doc.y;
  drawBox(doc, yStart - 5, 80);

  doc.fontSize(12).fillColor("black")
    .text("Patient Information", 50, yStart);

  doc.moveDown(0.5);

  doc.fontSize(11)
    .text(`Name: ${name}`)
    .text(`DOB: ${dob}`)
    .text(`Gender: ${gender}`);

  doc.moveDown(2);

  /* ================= TEST BOX ================= */
  yStart = doc.y;
  const testBoxHeight = tests.length * 22 + 40;

  drawBox(doc, yStart - 5, testBoxHeight);

  doc.fontSize(12)
    .text("Ordered Tests", 50, yStart);

  doc.moveDown(0.5);

  tests.forEach(t => {
    doc.fontSize(11).fillColor("black")
      .text(`${t.name} (Code: ${t.code}) - $${t.price}`);

    if (TEST_INSTRUCTIONS[t.code]) {
      doc.fontSize(10).fillColor("#2c7be5")
        .text(`   * ${TEST_INSTRUCTIONS[t.code]}`);
    }

    doc.moveDown(0.5);
  });

  doc.moveDown(1);

  /* ================= PROVIDER BOX ================= */
  yStart = doc.y;
  drawBox(doc, yStart - 5, 90);

  doc.fontSize(12).fillColor("black")
    .text("Ordering Provider", 50, yStart);

  doc.moveDown(0.5);

  doc.fontSize(11)
    .text("Dr. Cleberton S. Bastos, DC")
    .text("NPI: 1013268028")
    .text("ProSpine Orlando Chiropractic")
    .text("Quest Account: 11845569");

  doc.moveDown(2);

  /* ================= INSTRUCTIONS BOX ================= */
  yStart = doc.y;
  drawBox(doc, yStart - 5, 80);

  doc.fontSize(12)
    .text("Instructions", 50, yStart);

  doc.moveDown(0.5);

  doc.fontSize(11)
    .text("• Bring a valid photo ID")
    .text("• No payment required at the lab")
    .text("• Follow test-specific instructions above");

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

      const patientHTML = `
      <div style="font-family:Arial; max-width:600px; margin:auto;">
        <div style="text-align:center;">
          <img src="https://www.prospineorlando.com/images/logo-5-stars.png" style="width:220px;">
        </div>

        <h2 style="text-align:center;">Lab Order Confirmation</h2>

        <p><strong>${name}</strong><br>DOB: ${dob}<br>Gender: ${gender}</p>

        <ul>
        ${tests.map(t=>`
          <li>${t.name} (${t.code}) - $${t.price}
          ${TEST_INSTRUCTIONS[t.code] ? `<br>* ${TEST_INSTRUCTIONS[t.code]}` : ""}
          </li>
        `).join("")}
        </ul>

        <h3>Total: $${total}</h3>

        <div style="text-align:center;">
          <a href="https://appointment.questdiagnostics.com/as-home">
            <img src="https://www.prospineorlando.com/exams/quest.png" style="width:140px;"><br>
            <span style="background:#2c7be5;color:white;padding:12px;border-radius:6px;">
              Schedule Appointment
            </span>
          </a>
        </div>

        <p>
        • Bring ID<br>
        • No payment required at lab<br>
        • Follow instructions above
        </p>
      </div>`;

      await transporter.sendMail({
        from: '"ProSpine Orlando" <contact@prospineorlando.com>',
        to: email,
        subject: "Your Lab Order",
        html: patientHTML,
        attachments: [{ filename: "Lab_Order.pdf", content: pdf }]
      });
    }

    res.sendStatus(200);
  }
);

/* ==============================
   SERVER
============================== */
app.use(express.json());

app.use("/create-checkout-session", cors({
  origin: "https://www.prospineorlando.com"
}));

const transporter = nodemailer.createTransport({
  host: "mail.smtp2go.com",
  port: 2525,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

app.post("/create-checkout-session", async (req, res) => {

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
      name, dob, gender, email, phone,
      tests: JSON.stringify(clean)
    }
  });

  res.json({ url: session.url });
});

app.listen(3000, () => console.log("Server running"));
