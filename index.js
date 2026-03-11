import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} from "@whiskeysockets/baileys"

import pino from "pino"
import qrcode from "qrcode-terminal"
import express from "express"

const logger = pino({ level: "silent" })

// servidor para Railway
const app = express()
app.get("/", (req, res) => {
    res.send("Bot de WhatsApp Minegoc8 activo")
})

app.listen(3000, () => {
    console.log("Servidor Express activo")
})

// estado de usuarios
const userStates = new Map()

// productos
const productos = {
    "1": { nombre: "Lavadora portátil usb", precio: 8 },
    "2": { nombre: "Selladora al vacío portátil", precio: 28 },
    "3": { nombre: "Faja modeladora reductora", precio: 8 },
    "4": { nombre: "Masajeador eléctrico corporal", precio: 15 }
}

// asesor
const ASESOR_JID = "593979108339@s.whatsapp.net"

async function startBot() {

    const { state, saveCreds } = await useMultiFileAuthState("auth_info")
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: true,
        browser: ["Chrome", "Windows", "10"]
    })

    sock.ev.on("connection.update", (update) => {

        const { connection, qr, lastDisconnect } = update

        if (qr) {
            qrcode.generate(qr, { small: true })
            console.log("Escanea el QR")
        }

        if (connection === "open") {
            console.log("✅ BOT CONECTADO")
        }

        if (connection === "close") {

            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

            if (shouldReconnect) {
                startBot()
            }
        }
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("messages.upsert", async ({ messages }) => {

        const msg = messages[0]
        if (!msg.message) return
        if (msg.key.fromMe) return

        const from = msg.key.remoteJid

        let text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            ""

        const mensaje = text.toLowerCase().trim()

        let state = userStates.get(from) || { step: "menu" }

        // menu
        if (mensaje.includes("hola") || mensaje.includes("menu")) {

            state = { step: "menu" }
            userStates.set(from, state)

            await sock.sendMessage(from, {
                text: `👋 Bienvenido a *Minegoc8*

1️⃣ Lavadora portátil → $8
2️⃣ Selladora al vacío → $28
3️⃣ Faja modeladora → $8
4️⃣ Masajeador eléctrico → $15

Escribe el número del producto`
            })

            return
        }

        // seleccionar producto
        if (/^[1-4]$/.test(mensaje)) {

            const prod = productos[mensaje]

            state.step = "producto"
            state.product = mensaje

            userStates.set(from, state)

            await sock.sendMessage(from, {
                text: `Producto: *${prod.nombre}*

Precio: $${prod.precio}

Escribe *comprar* para pedirlo`
            })

            return
        }

        // comprar
        if (mensaje.includes("comprar")) {

            if (!state.product) {

                await sock.sendMessage(from, {
                    text: "Primero elige un producto (1-4)"
                })

                return
            }

            state.step = "datos"
            userStates.set(from, state)

            await sock.sendMessage(from, {
                text: `Envíame:

Nombre
Dirección
Teléfono

Para coordinar tu pedido`
            })

            return
        }

        // datos cliente
        if (state.step === "datos") {

            const prod = productos[state.product]

            const clienteNumero = from.split("@")[0]

            const mensajeAsesor = `
Nuevo pedido 🚨

Producto: ${prod.nombre}
Precio: $${prod.precio}

Cliente: +${clienteNumero}

Datos:
${text}
`

            await sock.sendMessage(ASESOR_JID, {
                text: mensajeAsesor
            })

            await sock.sendMessage(from, {
                text: `✅ Pedido recibido

Un asesor te escribirá pronto`
            })

            userStates.set(from, { step: "menu" })

            return
        }

    })
}

startBot()