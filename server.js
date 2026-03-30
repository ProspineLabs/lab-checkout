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
  "5363": { text: "Avoid ejaculation and intense exercise for 48 hours before test", type: "critical" },
  "7600": { text: "Fasting 9–12 hours required", type: "fasting" },
  "623": { text: "Avoid supplements 5–7 days prior", type: "normal" },
  "561": { text: "Fasting recommended", type: "fasting" },
  "90839": { text: "Fasting recommended", type: "fasting" }
};

/* ==============================
   LOAD IMAGE
============================== */
async function getImageBuffer(url) {
  const res = await fetch(url);
  return await res.buffer();
}

/* ==============================
   GROUP FASTING TESTS
============================== */
function getFastingTests(tests) {
  return tests.filter(t => TEST_INSTRUCTIONS[t.code]?.type === "fasting");
}

/* ==============================
   PDF GENERATOR
============================== */
function generatePDF(name, dob, tests) {
  return new Promise(async (resolve) => {

    const doc = new PDFDocument({ margin: 40 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    const orderId = "PSO-" + Date.now().toString().slice(-6);

    try {
      const logo = await getImageBuffer("https://www.prospineorlando.com/images/logo-5-stars.png");
      doc.image(logo, 180, 20, { width: 200 });
    } catch {}

    doc.moveDown(3);

    doc.fontSize(16).fillColor("#2c7be5")
      .text("LAB ORDER SUMMARY", { align: "center" });

    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke();

    doc.moveDown();
    doc.fontSize(10).fillColor("gray")
      .text(`Order ID: ${orderId}`, { align: "right" });

    doc.moveDown();

    doc.text("Patient Information", { underline: true });
    doc.text(`Name: ${name}`);
    doc.text(`DOB: ${dob}`);

    doc.moveDown();

    doc.text("Ordered Tests", { underline: true });
    doc.moveDown(0.5);

    tests.forEach(t => {
      doc.text(`- ${t.name} (Code: ${t.code})`);

      const instr = TEST_INSTRUCTIONS[t.code];
      if (instr) {
        const color = instr.type === "critical" ? "red" : "#2c7be5";
        doc.fontSize(10).fillColor(color)
          .text(`   * ${instr.text}`);
        doc.fillColor("black").fontSize(12);
      }
    });

    const fastingTests = getFastingTests(tests);

    if (fastingTests.length > 0) {
      doc.moveDown();
      doc.fillColor("red").text("Fasting required for:");
      fastingTests.forEach(t => doc.text(`- ${t.name}`));
      doc.fillColor("black");
    }

    doc.moveDown();
    doc.text("Ordering Provider", { underline: true });
    doc.text("Dr. Cleberton S. Bastos, DC");
    doc.text("NPI: 1013268028");
    doc.text("ProSpine Orlando Chiropractic");

    doc.moveDown();
    doc.text("General Instructions", { underline: true });
    doc.text("- Bring a valid photo ID");
    doc.text("- No payment required at the lab");

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
    } catch {
      return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {

      const s = event.data.object;

      const name = s.metadata.name;
      const dob = s.metadata.dob;
      const email = s.metadata.email;
      const phone = s.metadata.phone;
      const tests = JSON.parse(s.metadata.tests || "[]");

      const total = tests.reduce((sum, t) => sum + t.price, 0);
      const pdf = await generatePDF(name, dob, tests);

      const fastingTests = getFastingTests(tests);

      /* ================= PATIENT EMAIL ================= */
      const patientHTML = `
      <div style="font-family:Arial; max-width:600px; margin:auto; padding:20px;">

        <div style="text-align:center;">
          <img src="https://www.prospineorlando.com/images/logo-5-stars.png" style="width:220px;">
        </div>

        <h2 style="text-align:center;">Lab Order Confirmation</h2>

        <p><strong>Patient:</strong> ${name}<br>
        <strong>DOB:</strong> ${dob}</p>

        <h3>Tests:</h3>
        <ul>
        ${tests.map(t=>{
          const instr = TEST_INSTRUCTIONS[t.code];
          const color = instr?.type === "critical" ? "red" : "#2c7be5";
          return `
          <li>
            ${t.name} (${t.code}) - $${t.price}
            ${instr ? `<br><span style="color:${color};font-size:13px;">* ${instr.text}</span>` : ""}
          </li>`;
        }).join("")}
        </ul>

        ${fastingTests.length ? `
        <p style="color:red;"><strong>Fasting required for:</strong><br>
        ${fastingTests.map(t=>t.name).join("<br>")}
        </p>` : ""}

        <h3>Total Paid: $${total}</h3>

        <div style="text-align:center; margin-top:20px;">
          <a href="https://appointment.questdiagnostics.com/as-home">
            <img src="https://www.prospineorlando.com/exams/quest.png" style="width:140px;"><br>
            <span style="background:#2c7be5;color:white;padding:12px;border-radius:6px;">
              Schedule Appointment
            </span>
          </a>
        </div>

        <p>
        - Bring ID<br>
        - No payment at lab
        </p>

      </div>`;

      /* ================= CLINIC EMAIL ================= */
      const clinicHTML = `
      <div style="font-family:Arial;">
        <h2>New Lab Order</h2>
        <p>${name} | ${dob}</p>

        <ul>
        ${tests.map(t=>{
          const instr = TEST_INSTRUCTIONS[t.code];
          return `<li>${t.name} (${t.code}) ${instr ? `<br>* ${instr.text}` : ""}</li>`;
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
app.use("/create-checkout-session", cors({ origin: "https://www.prospineorlando.com" }));

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
        email,
        phone,
        tests: JSON.stringify(clean)
      }
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

app.listen(3000, () => console.log("Server running"));
