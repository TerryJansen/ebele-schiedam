const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SITE_URL = "https://ebele-schiedam-1j21.vercel.app";
const DESTINATION = "info@ebele-schiedam.nl";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getFields(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return request.json();
  return request.formData().then((form) => Object.fromEntries(form.entries()));
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return new Response("Methode niet toegestaan", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  if (!process.env.RESEND_API_KEY) {
    return new Response("E-mailservice is niet geconfigureerd", { status: 500 });
  }

  try {
    const fields = await getFields(request);
    const email = String(fields.email || "").trim();
    const name = String(fields.naam || "").trim();

    if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response("Naam en een geldig e-mailadres zijn verplicht", { status: 400 });
    }

    const subject = String(fields._subject || "Nieuwe aanvraag via Ebele Schiedam");
    const rows = Object.entries(fields)
      .filter(([key, value]) => value && !key.startsWith("_"))
      .map(([key, value]) => `<tr><th align="left">${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
      .join("");

    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Ebele website <website@ebele-schiedam.nl>",
        to: [DESTINATION],
        reply_to: email,
        subject,
        html: `<h2>${escapeHtml(subject)}</h2><table cellpadding="8" cellspacing="0" border="1">${rows}</table>`,
      }),
    });

    if (!response.ok) {
      console.error("Resend error", await response.text());
      return new Response("E-mail kon niet worden verzonden", { status: 502 });
    }

    return Response.redirect(`${SITE_URL}/bedankt.html`, 303);
  } catch (error) {
    console.error("Form error", error);
    return new Response("Ongeldige aanvraag", { status: 400 });
  }
}
