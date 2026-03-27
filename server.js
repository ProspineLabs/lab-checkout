const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();

// 🔐 Stripe setup
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ⚠️ Webhook needs raw body
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(cors());

// 📧 SMTP2GO email setup
const transporter = nodemailer.createTransport({
    host: "mail.smtp2go.com",
    port: 2525,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// ✅ CREATE CHECKOUT SESSION
app.post("/create-checkout-session", async (req, res) => {
    try {
        const { name, total, tests } = req.body;

        console.log("Incoming order:", name, total, tests);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "payment",

            customer_creation: "always", // 🔥 ensures email is captured

            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: "Lab Order - " + name,
                            description: tests.join(", ")
                        },
                        unit_amount: Math.round(total * 100),
                    },
                    quantity: 1,
                },
            ],

            success_url: "https://www.prospineorlando.com/success",
            cancel_url: "https://www.prospineorlando.com/cancel",
        });

        res.json({ url: session.url });

    } catch (error) {
        console.error("Checkout error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ STRIPE WEBHOOK (EMAIL AUTOMATION)
app.post("/webhook", async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error("Webhook signature error:", err.message);
        return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {

        console.log("🔥 WEBHOOK HIT");

        const session = event.data.object;
        const email = session.customer_details?.email;

        console.log("Payment completed for:", email);

        if (email) {
            try {
                await transporter.sendMail({
                    from: '"ProSpine Orlando" <contact@prospineorlando.com>',
                    to: email,
                    subject: "Your Lab Order is Ready",
                    html: `
                        <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">

                            <img src="https://www.prospineorlando.com/images/logo-5-stars.png" 
                                 alt="ProSpine Orlando" 
                                 style="max-width:180px; margin-bottom:20px;" />

                            <h2>Your Lab Order is Ready</h2>

                            <p>Thank you for your order — we’ve received everything on our end.</p>

                            <p><strong>Next step:</strong> please schedule your lab appointment for your blood collection.</p>

                            <p>
                            <a href="https://appointment.questdiagnostics.com" target="_blank"
                               style="display:inline-block; padding:12px 18px; background:#0a7cff; color:white; text-decoration:none; border-radius:8px;">
                            Schedule Your Appointment
                            </a>
                            </p>

                            <p>
                            You can choose the most convenient location near you and select a time that works best.
                            </p>

                            <br>

                            <p><strong>Important:</strong></p>

                            <p>
                            ✔ Bring a valid photo ID<br>
                            ✔ No payment is required at the lab — your testing has already been arranged through our office
                            </p>

                            <br>

                            <p>
                            If you have any questions or need assistance, feel free to contact our office.
                            </p>

                            <p>— ProSpine Orlando</p>

                        </div>
                    `
                });

                console.log("Email sent to:", email);

            } catch (emailError) {
                console.error("Email error:", emailError);
            }
        } else {
            console.log("No email provided.");
        }
    }

    res.sendStatus(200);
});

// ✅ TEST ROUTE
app.get("/", (req, res) => {
    res.send("Server is running ✅");
});

// ✅ START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
