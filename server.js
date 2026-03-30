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
   TEST INSTRUCTIONS (FULL)
============================== */
const TEST_INSTRUCTIONS = {
  "5363": "Avoid ejaculation and intense exercise for 48 hours before test",
  "7600": "Fasting 9–12 hours required",
  "623": "Avoid supplements 5–7 days prior",
  "561": "Fasting recommended",
  "90839": "Fasting recommended"
};

/* ==============================
   LOAD IMAGE FROM URL
============================== */
async function getImageBuffer(url) {
  const res = await fetch(url);
  return await res.buffer();
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

    /* LOGO */
    try {
      const logoBuffer = await getImageBuffer(
        "https://www.prospineorlando.com/images/logo-5-stars.png"
      );
      doc.image(logoBuffer, 180, 20, { width: 200 });
    } catch (err) {}

    doc.moveDown(3);

    /* HEADER */
    doc.fontSize(16).fillColor("#2c7be5")
      .text("LAB ORDER SUMMARY", { align: "center" });

    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    doc.fontSize(10).fillColor("gray")
      .text(`Order ID: ${orderId}`, { align: "right" });

    doc.moveDown();

    /* PATIENT */
    doc.fontSize(12).fillColor("black")
      .text("Patient Information", { underline: true });

    doc.moveDown(0.5);
    doc.text(`Name: ${name}`);
    doc.text(`DOB: ${dob}`);

    doc.moveDown();

    /* TESTS */
    doc.text("Ordered Tests", { underline: true });
    doc.moveDown(0.5);

    tests.forEach(t => {
      doc.text(`- ${t.name} (Code: ${t.code})`);

      const instr = TEST_INSTRUCTIONS[t.code];
      if (instr) {
        doc.fontSize(10).fillColor("#2c7be5")
          .text(`   * ${instr}`);
        doc.fillColor("black").fontSize(12);
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

    /* GENERAL INSTRUCTIONS */
    doc.text("General Instructions", { underline: true });
    doc.moveDown(0.5);

    doc.text("- Bring a valid photo ID");
    doc.text("- No payment required at the lab");
    doc.text("- Follow any test-specific instructions listed above");

    doc.moveDown();

    /* FOOTER */
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

    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {

      const session = event.data.object;

      const name = session.metadata.name;
      const dob = session.metadata.dob;
      const email = session.metadata.email;
      const phone = session.metadata.phone;

      let tests = [];
      try {
        tests = JSON.parse(session.metadata.tests || "[]");
      } catch (e) {}

      const total = tests.reduce((sum, t) => sum + t.price, 0);

      const pdfBuffer = await generatePDF(name, dob, tests);

      /* PATIENT EMAIL */
      const patientHTML = `
      <div style="font-family:Arial; max-width:600px; margin:auto; padding:20px;">

        <div style="text-align:center;">
          <img src="https://www.prospineorlando.com/images/logo-5-stars.png" style="width:220px;">
        </div>

        <h2 style="text-align:center;">Lab Order Confirmation</h2>

        <p>Thank you for your order.</p>

        <p><strong>Patient:</strong> ${name}<br>
        <strong>DOB:</strong> ${dob}</p>

        <h3>Selected Tests:</h3>
        <ul>
          ${tests.map(t => {
            const instr = TEST_INSTRUCTIONS[t.code];
            return `
              <li>
                ${t.name} (${t.code}) - $${t.price}
                ${instr ? `<br><span style="color:#2c7be5;font-size:13px;">* ${instr}</span>` : ""}
              </li>
            `;
          }).join("")}
        </ul>

        <h3>Total Paid: $${total}</h3>

        <div style="text-align:center; margin-top:20px;">
          <a href="https://appointment.questdiagnostics.com/as-home">
            <img src="https://www.prospineorlando.com/exams/quest.png" style="width:140px;"><br>
            <span style="background:#2c7be5;color:white;padding:12px;border-radius:6px;">
              Schedule Your Appointment
            </span>
          </a>
        </div>

        <p style="margin-top:20px;">
        - Bring a valid ID<br>
        - No payment needed at the lab<br>
        - Follow any test-specific instructions listed above
        </p>

      </div>
      `;

      /* CLINIC EMAIL */
      const clinicHTML = `
      <div style="font-family:Arial;">
        <h2>New Lab Order</h2>

        <p><strong>Name:</strong> ${name}</p>
        <p><strong>DOB:</strong> ${dob}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>

        <h3>Tests:</h3>
        <ul>
          ${tests.map(t => {
            const instr = TEST_INSTRUCTIONS[t.code];
            return `
              <li>
                ${t.name} (Code: ${t.code})
                ${instr ? `<br>* ${instr}` : ""}
              </li>
            `;
          }).join("")}
        </ul>

        <h3>Total: $${total}</h3>
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

    const cleanTests = tests.map(t => ({
      name: t.name,
      code: t.code,
      price: t.price
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      line_items: cleanTests.map(t => ({
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
        name,
        dob,
        email,
        phone,
        tests: JSON.stringify(cleanTests)
      }
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating checkout session");
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
