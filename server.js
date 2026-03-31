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
   DRAW BOX
============================== */
function drawBox(doc, y, height) {
  doc.roundedRect(50, y, 500, height, 8)
    .strokeColor("#e0e0e0")
    .lineWidth(1)
    .stroke();
}

/* ==============================
   PDF GENERATOR (FINAL - NO OVERLAP EVER)
============================== */


 function generatePDF(name, dob, gender, tests) {
  return new Promise((resolve) => {

    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    let currentY = 40;

    /* ===== LOGO (DYNAMIC CENTER + HEIGHT SAFE) ===== */
    if (fs.existsSync(LOGO_PATH)) {

      const image = doc.openImage(LOGO_PATH);

      const maxWidth = 200;
      const scale = maxWidth / image.width;

      const displayWidth = maxWidth;
      const displayHeight = image.height * scale;

      const centerX = (doc.page.width - displayWidth) / 2;

      doc.image(LOGO_PATH, centerX, currentY, {
        width: displayWidth
      });

      // 🔥 TRUE bottom of logo
      currentY += displayHeight + 25;
    }

    /* ===== FORCE FLOW START ===== */
    doc.y = currentY;

    /* ===== TITLE ===== */
    doc.fontSize(18)
      .fillColor("#2c7be5")
      .text("LAB ORDER SUMMARY", { align: "center" });

    doc.moveDown(2);

    /* ===== PATIENT BOX ===== */
    let yStart = doc.y;
    drawBox(doc, yStart - 5, 100);

    doc.fontSize(13).fillColor("black")
      .text("Patient Information", 60, yStart);

    doc.moveDown(1);

    doc.fontSize(11)
      .text(`Name: ${name}`)
      .text(`DOB: ${dob}`)
      .text(`Gender: ${gender}`);

    doc.moveDown(3);

    /* ===== TEST BOX ===== */
    yStart = doc.y;

    const testBoxHeight = tests.length * 30 + 60;
    drawBox(doc, yStart - 5, testBoxHeight);

    doc.fontSize(13)
      .text("Ordered Tests", 60, yStart);

    doc.moveDown(1);

    tests.forEach(t => {
      doc.fontSize(11)
        .text(`• ${t.name} (Code: ${t.code})`);

      if (TEST_INSTRUCTIONS[t.code]) {
        doc.fillColor("#2c7be5")
          .text(`   ${TEST_INSTRUCTIONS[t.code]}`);
        doc.fillColor("black");
      }

      doc.moveDown(1);
    });

    doc.moveDown(3);

    /* ===== PROVIDER BOX ===== */
    yStart = doc.y;
    drawBox(doc, yStart - 5, 110);

    doc.fontSize(13)
      .text("Ordering Provider", 60, yStart);

    doc.moveDown(1);

    doc.fontSize(11)
      .text("Dr. Cleberton S. Bastos, DC")
      .text("NPI: 1013268028")
      .text("ProSpine Orlando Chiropractic")
      .text("Quest Account: 11845569");

    doc.moveDown(3);

    /* ===== INSTRUCTIONS BOX ===== */
    yStart = doc.y;
    drawBox(doc, yStart - 5, 100);

    doc.fontSize(13)
      .text("Instructions", 60, yStart);

    doc.moveDown(1);

    doc.fontSize(11)
      .text("• Bring a valid photo ID")
      .text("• No payment required at the lab")
      .text("• Follow test-specific instructions above");

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
      const tests = JSON.parse(s.metadata.tests || "[]");

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
          <li>${t.name} (${t.code})
          ${TEST_INSTRUCTIONS[t.code] ? `<br>* ${TEST_INSTRUCTIONS[t.code]}` : ""}
          </li>
        `).join("")}
        </ul>

        <div style="text-align:center; margin-top:20px;">
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

/* ==============================
   SERVER
============================== */
app.listen(3000, () => console.log("🚀 Server running on port 3000"));
