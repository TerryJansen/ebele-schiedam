const RESEND_ENDPOINT = "https://api.resend.com/emails";
import { isIP } from "node:net";

const SITE_URL = "https://ebele-schiedam-1j21.vercel.app";
const DESTINATION = "info@ebele-schiedam.nl";
const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_MAX_KEYS = 1000;
const rateLimit = new Map();
const ALLOWED_FORM_TYPES = new Set(["contact", "vacancy-alert"]);
const FIELD_LIMITS = {
  naam: 120,
  email: 254,
  telefoon: 40,
  bedrijf: 160,
  postcode: 20,
  woonplaats: 120,
  aanvraag: 5000,
  productgroepen: 1000,
};
const DYNAMIC_FIELD_PATTERN = /^(aantal|product_detail)_([1-9][0-9]*)$/;

function getFieldLimit(field) {
  if (Object.prototype.hasOwnProperty.call(FIELD_LIMITS, field)) return FIELD_LIMITS[field];
  const dynamicField = DYNAMIC_FIELD_PATTERN.exec(field);
  if (!dynamicField) return null;
  return dynamicField[1] === "aantal" ? 80 : 240;
}

function isAllowedField(field) {
  return getFieldLimit(field) !== null;
}

const FIELD_LABELS = {
  naam: "Naam",
  email: "E-mailadres",
  telefoon: "Telefoonnummer",
  bedrijf: "Bedrijf",
  postcode: "Postcode",
  woonplaats: "Woonplaats",
  aanvraag: "Uw aanvraag",
  productgroepen: "Productgroepen",
};

function getFieldLabel(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const dynamicField = DYNAMIC_FIELD_PATTERN.exec(field);
  if (!dynamicField) return field;
  return dynamicField[1] === "aantal"
    ? `Aantal productgroep ${dynamicField[2]}`
    : `Productgroep ${dynamicField[2]}`;
}

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
  return request.formData().then((form) => {
    const fields = Object.fromEntries(form.entries());
    const productGroups = form.getAll("productgroepen").map((value) => String(value).trim()).filter(Boolean);
    if (productGroups.length) fields.productgroepen = productGroups.join(", ");
    return fields;
  });
}

function getClientIp(request) {
  const raw = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "";
  const candidate = raw.split(",")[0].trim();
  return isIP(candidate) ? candidate : "unknown";
}

function isRateLimited(request) {
  const now = Date.now();
  for (const [key, timestamps] of rateLimit) {
    const active = timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
    if (active.length) rateLimit.set(key, active);
    else rateLimit.delete(key);
  }
  const key = getClientIp(request);
  const recent = rateLimit.get(key) || [];
  if (!rateLimit.has(key) && rateLimit.size >= RATE_LIMIT_MAX_KEYS) {
    rateLimit.delete(rateLimit.keys().next().value);
  }
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimit.set(key, recent);
    return true;
  }
  recent.push(now);
  rateLimit.set(key, recent);
  return false;
}

async function processRequest(request) {
  if (request.method !== "POST") {
    return new Response("Methode niet toegestaan", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return new Response("Aanvraag is te groot", { status: 413 });
  }

  if (!process.env.RESEND_API_KEY) {
    return new Response("E-mailservice is niet geconfigureerd", { status: 500 });
  }

  try {
    const body = await request.clone().arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return new Response("Aanvraag is te groot", { status: 413 });
    }

    const fields = await getFields(request);
    const email = String(fields.email || "").trim();
    const name = String(fields.naam || "").trim();
    const formType = String(fields.form_type || "contact").trim().toLowerCase();
    const isVacancyAlert = formType === "vacancy-alert";

    if (!ALLOWED_FORM_TYPES.has(formType)) {
      return new Response("Onbekend formuliertype", { status: 400 });
    }

    for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
      if (String(fields[field] || "").length > limit) {
        return new Response(`Veld ${field} is te lang`, { status: 400 });
      }
    }
    for (const [field, value] of Object.entries(fields)) {
      const limit = getFieldLimit(field);
      if (limit !== null && String(value || "").length > limit) {
        return new Response(`Veld ${field} is te lang`, { status: 400 });
      }
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response("Een geldig e-mailadres is verplicht", { status: 400 });
    }
    if (!isVacancyAlert && !name) {
      return new Response("Naam is verplicht", { status: 400 });
    }

    const rawSubject = String(fields._subject || "");
    if (/[\r\n]/.test(rawSubject) || rawSubject.length > 160) {
      return new Response("Ongeldig onderwerp", { status: 400 });
    }
    const subject = rawSubject.trim() || "Nieuwe aanvraag via Ebele Schiedam";

    if (isRateLimited(request)) {
      return new Response("Te veel aanvragen. Probeer het later opnieuw.", {
        status: 429,
        headers: { "Retry-After": "600" },
      });
    }

    const rows = Object.entries(fields)
      .filter(([key, value]) => value && isAllowedField(key))
      .map(([key, value]) => `<tr><th align="left">${escapeHtml(getFieldLabel(key))}</th><td>${escapeHtml(value)}</td></tr>`)
      .join("");
    const receivedAt = new Date();
    const receivedDate = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "long" }).format(receivedAt);
    const receivedTime = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", timeStyle: "short" }).format(receivedAt);
    const confirmationHtml = `<p>Beste ${escapeHtml(name || "klant")},</p>
      <p>Bedankt voor uw offerteaanvraag bij Ebele Schiedam. Wij hebben uw aanvraag goed ontvangen en nemen zo snel mogelijk contact met u op.</p>
      <table cellpadding="8" cellspacing="0" border="1">
        <tr><th align="left">Datum</th><td>${escapeHtml(receivedDate)}</td></tr>
        <tr><th align="left">Tijdstip</th><td>${escapeHtml(receivedTime)} uur</td></tr>
      </table>
      <h3>Uw aanvraag</h3>
      <table cellpadding="8" cellspacing="0" border="1">${rows}</table>
      <p>Heeft u nog aanvullende informatie? Beantwoord dan deze e-mail of neem contact met ons op.</p>
      <p>Met vriendelijke groet,<br>Ebele Schiedam</p>`;

    const messages = [{
      from: "Ebele website <website@ebele-schiedam.nl>",
      to: [DESTINATION],
      reply_to: email,
      subject,
      html: `<h2>${escapeHtml(subject)}</h2><table cellpadding="8" cellspacing="0" border="1">${rows}</table>`,
    }];
    if (!isVacancyAlert) {
      messages.push({
        from: "Ebele Schiedam <website@ebele-schiedam.nl>",
        to: [email],
        subject: "Offerteaanvraag ontvangen — Ebele Schiedam",
        html: confirmationHtml,
      });
    }

    const responses = [];
    const sendErrors = [];
    for (const [index, message] of messages.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 600));
      try {
        responses.push(await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
        }));
      } catch (error) {
        responses.push(null);
        sendErrors.push(error);
      }
    }

    if (sendErrors.length || responses.some((response) => !response || !response.ok)) {
      const responseErrors = await Promise.all(responses.map((response) => response ? (response.ok ? "ok" : response.text()) : "transport error"));
      console.error("Resend error", responseErrors, sendErrors.map((error) => error?.message || String(error)));
      return new Response("E-mail kon niet worden verzonden", { status: 502 });
    }

    return Response.redirect(`${SITE_URL}/${isVacancyAlert ? "vacature-bedankt.html" : "bedankt.html"}`, 303);
  } catch (error) {
    console.error("Form error", error);
    return new Response("Ongeldige aanvraag", { status: 400 });
  }
}

async function readNodeBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    chunks.push(buffer);
    if (size > MAX_BODY_BYTES) break;
  }
  return Buffer.concat(chunks);
}

export default async function handler(request, response) {
  if (!response || typeof response.setHeader !== "function") {
    return processRequest(request);
  }

  try {
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readNodeBody(request);
    const headers = Object.fromEntries(Object.entries(request.headers || {}).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value)]));
    const protocol = headers["x-forwarded-proto"] || "https";
    const host = headers.host || "localhost";
    const webRequest = new Request(`${protocol}://${host}${request.url || "/"}`, {
      method: request.method,
      headers,
      body,
      duplex: body ? "half" : undefined,
    });
    const webResponse = await processRequest(webRequest);
    response.statusCode = webResponse.status;
    webResponse.headers.forEach((value, key) => response.setHeader(key, value));
    response.end(await webResponse.text());
  } catch (error) {
    console.error("Node adapter error", error);
    response.statusCode = 500;
    response.end("Interne serverfout");
  }
}