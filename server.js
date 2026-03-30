const express = require("express");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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
         PATIENT EMAIL (FRONT-END STYLE)
      ============================== */
      const patientTestList = tests.map(t => `
        <li>${t.name} - $${t.price}</li>
      `).join("");

      const patientEmailHTML = `
        <div style="font-family:Arial; max-width:600px; margin:auto; padding:20px;">

          <div style="text-align:center;">
            <img src="https://www.prospineorlando.com/images/logo-5-stars.png" 
            style="width:220px; margin-bottom:10px;" />
          </div>

          <h2 style="text-align:center; color:#2c7be5;">Lab Order Confirmation</h2>

          <p>Thank you for your order. Your lab request has been successfully processed.</p>

          <p><strong>Patient:</strong> ${name}<br>
          <strong>Date of Birth:</strong> ${dob}</p>

          <hr>

          <h3>Selected Tests:</h3>
          <ul>${patientTestList}</ul>

          <h3>Total Paid: $${total}</h3>

          <hr>

          <h3 style="text-align:center;">Next Step</h3>

          <div style="text-align:center;">
            <a href="https://appointment.questdiagnostics.com/as-home" style="text-decoration:none;">
              <img src="https://www.prospineorlando.com/exams/quest.png" 
              style="width:140px; margin-bottom:10px;" />
              <div style="background:#2c7be5; color:#fff; padding:12px; border-radius:6px;">
                Schedule Your Appointment
              </div>
            </a>
          </div>

          <p style="margin-top:20px;">
          ✔ Bring a valid photo ID<br>
          ✔ No payment required at the lab<br>
          ✔ Follow fasting instructions if applicable
          </p>

          <hr>

          <p style="font-size:12px; color:#777;">
          All laboratory testing is performed by a third-party CLIA-certified laboratory (Quest Diagnostics).  
          ProSpine Orlando facilitates ordering and payment collection.
          </p>

        </div>
      `;

      /* ==============================
         CLINIC EMAIL (BACK-END STYLE)
      ============================== */
      const clinicTestList = tests.map(t => `
        <li>${t.name} (Quest Code: ${t.code}) - $${t.price}</li>
      `).join("");

      const clinicEmailHTML = `
        <div style="font-family:Arial; max-width:600px; margin:auto; padding:20px;">

          <h2>New Lab Order</h2>

          <p><strong>Patient Name:</strong> ${name}</p>
          <p><strong>DOB:</strong> ${dob}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Phone:</strong> ${phone}</p>

          <hr>

          <h3>Ordered Tests:</h3>
          <ul>${clinicTestList}</ul>

          <h3>Total: $${total}</h3>

        </div>
      `;

      try {
        console.log("📨 Sending emails...");

        // Patient email
        await transporter.sendMail({
          from: '"ProSpine Orlando" <contact@prospineorlando.com>',
          to: email,
          subject: "Your Lab Order - ProSpine Orlando",
          html: patientEmailHTML,
        });

        // Clinic email
        await transporter.sendMail({
          from: '"ProSpine Orlando" <contact@prospineorlando.com>',
          to: "contact@prospineorlando.com",
          subject: "New Lab Order - Patient: " + name,
          html: clinicEmailHTML,
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
   NORMAL MIDDLEWARE
============================== */
app.use(express.json());

app.use("/create-checkout-session", cors({
  origin: "https://www.prospineorlando.com"
}));

/* ==============================
   SMTP CONFIG
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
   CHECKOUT SESSION
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
