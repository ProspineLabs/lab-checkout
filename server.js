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
   PREMIUM PDF
============================== */
function generatePDF(name, dob, gender, tests) {
  return new Promise(async (resolve) => {

    const doc = new PDFDocument({ margin: 40 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    const orderId = "PSO-" + Date.now().toString().slice(-6);

    try {
      const logo = await getImageBuffer("https://www.prospineorlando.com/images/logo-5-stars.png");
      doc.image(logo, 170, 20, { width: 240 });
    } catch {}

    doc.moveDown(3);

    doc.fontSize(18).fillColor("#2c7be5")
      .text("LAB ORDER SUMMARY", { align: "center" });

    doc.moveDown(0.5);

    doc.moveTo(40, doc.y)
      .lineTo(550, doc.y)
      .lineWidth(2)
      .strokeColor("#2c7be5")
      .stroke();

    doc.moveDown();

    doc.fontSize(10).fillColor("gray")
      .text(`Order ID: ${orderId}`, { align: "right" });

    doc.moveDown();

    doc.fontSize(12).fillColor("black")
      .text("Patient Information", { underline: true });

    doc.moveDown(0.5);

    doc.text(`Name: ${name}`);
    doc.text(`DOB: ${dob}`);
    doc.text(`Gender: ${gender}`);

    doc.moveDown();

    doc.text("Ordered Tests", { underline: true });
    doc.moveDown(0.5);

    tests.forEach(t => {
      doc.fontSize(11).fillColor("black")
        .text(`${t.name} (Code: ${t.code}) - $${t.price}`);

      const instr = TEST_INSTRUCTIONS[t.code];
      if (instr) {
        doc.fontSize(10)
          .fillColor(instr.type === "critical" ? "red" : "#2c7be5")
          .text(`   * ${instr.text}`);
      }

      doc.moveDown(0.3);
    });

    doc.moveDown();

    doc.fontSize(12).fillColor("black")
      .text("Ordering Provider", { underline: true });

    doc.moveDown(0.5);

    doc.fontSize(11)
      .text("Dr. Cleberton S. Bastos, DC")
      .text("NPI: 1013268028")
      .text("ProSpine Orlando Chiropractic")
      .text("Quest Account: 11845569");

    doc.moveDown();

    doc.fontSize(12).text("General Instructions", { underline: true });

    doc.moveDown(0.5);

    doc.fontSize(11)
      .text("• Bring a valid photo ID")
      .text("• No payment required at the lab")
      .text("• Follow test-specific instructions listed above");

    doc.moveDown();

    doc.fontSize(9).fillColor("gray")
      .text(
        "All laboratory testing is performed by Quest Diagnostics. ProSpine Orlando facilitates ordering and payment collection.",
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

      /* PATIENT EMAIL */
      const patientHTML = `
      <div style="font-family:Arial; max-width:600px; margin:auto;">
        <div style="text-align:center;">
          <img src="https://www.prospineorlando.com/images/logo-5-stars.png" style="width:220px;">
        </div>

        <h2 style="text-align:center;">Lab Order Confirmation</h2>

        <p><strong>${name}</strong><br>
        DOB: ${dob}<br>
        Gender: ${gender}</p>

        <ul>
        ${tests.map(t=>{
          const instr = TEST_INSTRUCTIONS[t.code];
          return `<li>${t.name} (${t.code}) - $${t.price}
          ${instr ? `<br><span style="color:red;">* ${instr.text}</span>` : ""}
          </li>`;
        }).join("")}
        </ul>

        <h3>Total: $${total}</h3>

        <div style="text-align:center;">
          <a href="https://appointment.questdiagnostics.com/as-home">
            Schedule Appointment
          </a>
        </div>
      </div>`;

      /* CLINIC EMAIL */
      const clinicHTML = `
      <div>
        <h2>New Lab Order</h2>
        <p>${name} | ${dob} | ${gender}</p>

        <ul>
        ${tests.map(t=>{
          const instr = TEST_INSTRUCTIONS[t.code];
          return `<li>${t.name} (${t.code})
          ${instr ? `<br>* ${instr.text}` : ""}
          </li>`;
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
        console.error("Email error:", err);
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
   CHECKOUT (FIXED)
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
      })), // ✅ FIXED HERE

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
    res.status(500).send("Error creating checkout session");
  }
});

app.listen(3000, () => {
  console.log("Server running");
});
