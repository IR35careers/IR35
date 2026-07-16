import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import sgMail from "@sendgrid/mail";

type Data = {
    success: boolean;
    message?: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "IR35Careers";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // We'll still export the handler but it will return 500 when called.
    console.warn("Supabase service role not configured for /api/waitlist");
}

if (!SENDGRID_API_KEY) {
    console.warn("SendGrid API key not configured for /api/waitlist");
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<Data>
) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }

    const { name, email } = req.body as { name?: string; email?: string };

    if (!email || typeof email !== "string") {
        return res.status(400).json({ success: false, message: "Email is required" });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name ? String(name).trim() : null;

    // Initialize Supabase server client
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return res
            .status(500)
            .json({ success: false, message: "Supabase not configured on server." });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        const { error } = await supabase.from("waitlist").insert([
            { email: trimmedEmail, name: trimmedName },
        ]);

        if (error) {
            // unique violation
            if (error.code === "23505") {
                // already exists
                return res
                    .status(200)
                    .json({ success: true, message: "Already on the waitlist" });
            }
            console.error("Supabase insert error", error);
            return res
                .status(500)
                .json({ success: false, message: "Failed to add to waitlist" });
        }

        // Send confirmation email using SendGrid if configured
        if (SENDGRID_API_KEY) {
            try {
                sgMail.setApiKey(SENDGRID_API_KEY);

                const msg = {
                    to: trimmedEmail,
                    from: process.env.SENDGRID_FROM_EMAIL || `no-reply@${SITE_URL.replace(/^https?:\/\//, "")}`,
                    subject: `${SITE_NAME} — You're on the waitlist!`,
                    text: `Thanks for joining the ${SITE_NAME} waitlist.${trimmedName ? `\n\nName: ${trimmedName}` : ""
                        }\n\nWe will notify you when we launch.`,
                    html: `<p>Hi ${trimmedName ? trimmedName : "there"},</p>
                 <p>Thanks for joining the <strong>${SITE_NAME}</strong> waitlist.</p>
                 <p>We will notify you when we launch. Meanwhile you can visit <a href="${SITE_URL}">${SITE_URL}</a>.</p>
                 <p>— The ${SITE_NAME} team</p>`,
                };

                await sgMail.send(msg as any);
            } catch (sendErr) {
                console.error("SendGrid error:", sendErr);
                // don't fail the request if email sending did not work
            }
        }

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
}
