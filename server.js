const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Stripe secret key from Render environment variable
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.post("/create-checkout-session", async (req, res) => {
    try {
        const { name, total, tests } = req.body;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "payment",

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
        console.error(error);
        res.status(500).json({ error: "Something went wrong" });
    }
});

// ✅ IMPORTANT for Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));// JavaScript Document