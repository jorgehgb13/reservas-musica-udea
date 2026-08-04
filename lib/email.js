// Envía correos reales usando la API de Brevo. Requiere la variable de
// entorno BREVO_API_KEY (configurada en Vercel, nunca en el código).
// Si el envío falla, no lanza error hacia arriba: solo lo registra en los
// logs, para que un problema de correo nunca tumbe una reserva o cancelación
// que sí se guardó bien en la base de datos.

const FROM_EMAIL = 'reservas@reservasmusicaudea.com';
const FROM_NAME = 'Reservas Música UdeA';

export async function sendEmail({ to, subject, html }) {
  if (!process.env.BREVO_API_KEY) {
    console.error('[email] Falta configurar BREVO_API_KEY en las variables de entorno.');
    return { ok: false };
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: FROM_EMAIL, name: FROM_NAME },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[email] Brevo respondió con error:', res.status, errText);
      return { ok: false };
    }

    return { ok: true };
  } catch (err) {
    console.error('[email] error inesperado enviando correo:', err);
    return { ok: false };
  }
}

function baseWrapper(bodyHtml) {
  return `
    <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #16241C;">
      <div style="width: 44px; height: 44px; border-radius: 50%; background: #0B6E4F; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px; margin-bottom: 20px;">
        UdeA
      </div>
      ${bodyHtml}
      <p style="font-size: 12px; color: #5B6B60; margin-top: 30px;">
        Departamento de Música — Universidad de Antioquia
      </p>
    </div>
  `;
}

export function verificationEmailHtml({ code, roomName, date, start, end }) {
  return baseWrapper(`
    <h2 style="font-size: 18px; margin: 0 0 12px;">Confirma tu reserva</h2>
    <p style="font-size: 14px; color: #5B6B60; margin: 0 0 16px;">
      Solicitaste reservar <strong>${roomName}</strong> el ${date}, de ${start} a ${end}.
      Usa este código para confirmarla:
    </p>
    <div style="font-size: 28px; letter-spacing: 4px; font-weight: 700; color: #0B6E4F; margin: 0 0 16px;">
      ${code}
    </div>
    <p style="font-size: 12px; color: #5B6B60; margin: 0;">
      Este código vence en 10 minutos. Si no fuiste tú, ignora este correo.
    </p>
  `);
}

export function cancelEmailHtml({ code, roomName, date, start, end }) {
  return baseWrapper(`
    <h2 style="font-size: 18px; margin: 0 0 12px;">Cancelar tu reserva</h2>
    <p style="font-size: 14px; color: #5B6B60; margin: 0 0 16px;">
      Solicitaste cancelar tu reserva de <strong>${roomName}</strong> el ${date}, de ${start} a ${end}.
      Usa este código para confirmar la cancelación:
    </p>
    <div style="font-size: 28px; letter-spacing: 4px; font-weight: 700; color: #A23E33; margin: 0 0 16px;">
      ${code}
    </div>
    <p style="font-size: 12px; color: #5B6B60; margin: 0;">
      Este código vence en 10 minutos. Si no fuiste tú, ignora este correo — tu reserva sigue activa.
    </p>
  `);
}

export function instrumentVerificationEmailHtml({ code, instrumentName, date, start, end }) {
  return baseWrapper(`
    <h2 style="font-size: 18px; margin: 0 0 12px;">Confirma tu préstamo de instrumento</h2>
    <p style="font-size: 14px; color: #5B6B60; margin: 0 0 16px;">
      Solicitaste llevar prestado <strong>${instrumentName}</strong> el ${date}, de ${start} a ${end}.
      Usa este código para confirmarlo:
    </p>
    <div style="font-size: 28px; letter-spacing: 4px; font-weight: 700; color: #0B6E4F; margin: 0 0 16px;">
      ${code}
    </div>
    <p style="font-size: 12px; color: #5B6B60; margin: 0;">
      Este código vence en 10 minutos. Si no fuiste tú, ignora este correo.
    </p>
  `);
}