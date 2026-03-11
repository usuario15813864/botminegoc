import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { fileURLToPath } from "url";
import path from "path";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: "silent" });

// Estado por chat
const userStates = new Map();

// Productos actualizados
const productos = {
    "1": { 
        nombre: "Lavadora portátil usb", 
        precio: 8,
        descripcion: "Compacta, bajo consumo, ideal para apartamentos pequeños"
    },
    "2": { 
        nombre: "Selladora al vacío portátil", 
        precio: 28,
        descripcion: "Conserva alimentos frescos mucho más tiempo, fácil de usar"
    },
    "3": { 
        nombre: "Faja modeladora reductora", 
        precio: 8,
        descripcion: "Compresión cómoda, ayuda a estilizar la figura rápidamente"
    },
    "4": { 
        nombre: "Masajeador eléctrico corporal", 
        precio: 15,
        descripcion: "Alivio muscular, varias velocidades, cabezales intercambiables"
    }
};

// Número del asesor (en formato JID de WhatsApp)
const ASESOR_JID = "593979108339@s.whatsapp.net";

async function startBot(reconnectDelay = 2000) {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: true,
        browser: ["Chrome", "Windows", "10"],
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    sock.ev.on("connection.update", async (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log("\nEscanea el QR arriba ↑\n");
        }

        if (connection === "open") {
            console.log("✅ BOT CONECTADO - Listo para vender 🚀");
            reconnectDelay = 2000;
        }

        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`Conexión cerrada (${statusCode || 'desconocido'}) → ${shouldReconnect ? 'reconectando...' : 'sesión cerrada'}`);

            if (shouldReconnect) {
                console.log(`Reintentando en ${reconnectDelay/1000} segundos...`);
                setTimeout(() => startBot(Math.min(reconnectDelay * 2, 30000)), reconnectDelay);
            }
        }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        let text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const mensaje = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        console.log(`[${from}] → ${mensaje}`);

        let state = userStates.get(from) || { step: "menu" };

        // Volver al menú
        if (["hola","buenas","inicio","menu","menú","hey","volver"].some(w => mensaje.includes(w))) {
            state = { step: "menu" };
            userStates.set(from, state);
            await sock.sendMessage(from, { text: 
`👋 ¡Hola! Bienvenid@ a *Minegoc8*

Productos disponibles:

1️⃣ Lavadora portátil 8 kg     → $8
2️⃣ Selladora al vacío         → $28
3️⃣ Faja modeladora reductora  → $8
4️⃣ Masajeador eléctrico       → $15

Responde con el *número* del producto que te interesa 😊

Escribe *menú* cuando quieras volver aquí`
            });
            return;
        }

        // Selección de producto
        if (/^[1-4]$/.test(mensaje)) {
            const prod = productos[mensaje];
            if (!prod) return;

            state.step = "producto";
            state.selectedProduct = mensaje;
            userStates.set(from, state);

            await sock.sendMessage(from, { text: 
`✨ *${prod.nombre}*

💲 Precio: $${prod.precio}

${prod.descripcion}

🚚 Envío con pago contra entrega (sujeto a disponibilidad por zona)

Escribe *comprar*, *pedir* o *quiero* para continuar con el pedido`
            });
            return;
        }

        // Iniciar compra → pedir datos
        if (["comprar","pedir","quiero","orden","carrito","adquirir"].some(w => mensaje.includes(w))) {
            if (state.step !== "producto" || !state.selectedProduct) {
                await sock.sendMessage(from, { text: "Primero elige un producto escribiendo su número (1-4) 😊" });
                return;
            }

            state.step = "comprando";
            userStates.set(from, state);

            const prod = productos[state.selectedProduct];

            await sock.sendMessage(from, { text: 
`¡Perfecto! Vas a pedir: *${prod.nombre}* → $${prod.precio}

Por favor envíame los siguientes datos para coordinar:

👤 Nombre completo
📍 Dirección exacta (calle principal, número, barrio, ciudad)
📱 Teléfono / WhatsApp de contacto (si es diferente)
🛵 Referencia o indicaciones extra (opcional)

Una vez que me los envíes, un asesor te contactará inmediatamente para confirmar stock y entrega. ¡Gracias! 🚚`
            });
            return;
        }

        // Datos del cliente
        if (state.step === "comprando" && mensaje.length > 10) {
            const prod = productos[state.selectedProduct];
            const clienteNumero = from.split("@")[0];
            const datosCliente = text;

            const mensajeAsesor = 
`¡Nuevo pedido entrante! 🚨

Producto: *${prod.nombre}*
Precio: $${prod.precio}

Cliente: +${clienteNumero}
Datos enviados:
${datosCliente}

Contacta al cliente lo antes posible para confirmar y coordinar entrega.`;

            try {
                await sock.sendMessage(ASESOR_JID, { text: mensajeAsesor });
                console.log(`✅ Pedido enviado al asesor desde ${from}`);
            } catch (err) {
                console.error("Error al enviar al asesor:", err);
            }

            await sock.sendMessage(from, { text: 
`¡Listo! Tu pedido de *${prod.nombre}* fue recibido correctamente.

Un asesor te contactará en breve por este mismo WhatsApp para confirmar stock, costo de envío (si aplica) y coordinar la entrega. Gracias por comprar con *Minegoc8* 😊`
            });

            state = { step: "menu" };
            userStates.set(from, state);
            return;
        }

        if (mensaje.length > 2) {
            await sock.sendMessage(from, { text: "Escribe *menú* para ver los productos disponibles 😄" });
        }
    });
}

// Mantener Railway activo con Express
const app = express();
app.get("/", (req, res) => res.send("Bot WhatsApp activo 🚀"));
app.listen(process.env.PORT || 3000, () => console.log("Servidor Express activo"));

startBot().catch(err => {
    console.error("Error crítico al iniciar bot:", err);
    process.exit(1);
});