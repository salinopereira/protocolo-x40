require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { paymentMiddleware } = require("@x402/express");
const { x402ResourceServer, HTTPFacilitatorClient } = require("@x402/core/server");
const { ExactEvmScheme } = require("@x402/evm/exact/server");

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 10000;
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS || "0xb1DF24c41607d6cC8b34a47f8b4E4F4A3bCe4533";
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://facilitator.payai.network";
const PRICE_PER_QUERY = process.env.PRICE_PER_QUERY || "$0.05";
const BASE_NETWORK = "eip155:8453";

if (!/^0x[a-fA-F0-9]{40}$/.test(PAY_TO_ADDRESS)) {
  console.error("PAY_TO_ADDRESS inválido. Defina um endereço EVM válido (0x...).");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: true,
    exposedHeaders: ["payment-required", "payment-response", "PAYMENT-REQUIRED", "PAYMENT-RESPONSE"],
  })
);

// ---------------------------------------------------------------------------
// Configuração do x402 (paywall)
// ---------------------------------------------------------------------------

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  BASE_NETWORK,
  new ExactEvmScheme()
);

app.use(
  paymentMiddleware(
    {
      "GET /cnpj/:numero": {
        accepts: [
          {
            scheme: "exact",
            price: PRICE_PER_QUERY, 
            network: BASE_NETWORK,  
            payTo: PAY_TO_ADDRESS,
          },
        ],
        description: "Consulta de dados públicos de CNPJ via ReceitaWS",
        mimeType: "application/json",
      },
    },
    resourceServer
  )
);

// ---------------------------------------------------------------------------
// Endpoints Públicos
// ---------------------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    service: "cnpj-x402-server",
    status: "online",
    endpoint_pago: "GET /cnpj/:numero",
    preco: PRICE_PER_QUERY,
    rede: "Base (chain ID 8453)",
    pay_to: PAY_TO_ADDRESS,
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// DOCUMENTO OPENAPI PARA OS AGENTES DE IA (x402scan)
app.get("/openapi.json", (req, res) => {
  res.json({
    openapi: "3.1.0",
    info: {
      title: "API de Dados de CNPJ",
      description: "Consulta de dados públicos de CNPJ via ReceitaWS com proteção x402.",
      version: "1.0.0",
      // Adicionando o contato solicitado pelo scan
      contact: {
        email: "reabilitesi@gmail.com" // TROQUE PELO SEU E-MAIL REAL
      }
    },
    servers: [
      {
        url: "https://protocolo-x40.onrender.com"
      }
    ],
    // Dica: para o favicon, basta colocar um arquivo chamado 'favicon.ico' 
    // na pasta que o seu Express serve arquivos estáticos (geralmente uma pasta /public).
    // O x402scan irá buscar em https://protocolo-x40.onrender.com/favicon.ico
    components: {
      securitySchemes: {
        x402: {
          type: "http",
          scheme: "x402"
        }
      }
    },
    paths: {
      "/cnpj/{numero}": {
        "get": {
          "summary": "Obter dados da empresa",
          "security": [{ x402: [] }],
          "parameters": [
            {
              "name": "numero",
              "in": "path",
              "required": true,
              "description": "CNPJ com 14 dígitos.",
              "schema": { "type": "string" }
            }
          ],
          "responses": {
            "200": { "description": "Dados da empresa encontrados" },
            "402": { "description": "Pagamento Requerido (x402)" }
          }
        }
      }
    }
  });
});
// ---------------------------------------------------------------------------
// Endpoint pago: GET /cnpj/:numero
// ---------------------------------------------------------------------------

app.get("/cnpj/:numero", async (req, res) => {
  try {
    const cnpjLimpo = String(req.params.numero).replace(/\D/g, "");

    if (cnpjLimpo.length !== 14) {
      return res.status(400).json({
        erro: "CNPJ inválido. Envie apenas os 14 dígitos, com ou sem formatação.",
      });
    }

    const url = `https://www.receitaws.com.br/v1/cnpj/${cnpjLimpo}`;

    const respostaReceita = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const dados = await respostaReceita.json();

    if (!respostaReceita.ok) {
      return res.status(respostaReceita.status).json({
        erro: "Falha ao consultar a ReceitaWS.",
        detalhes: dados,
      });
    }

    if (dados.status === "ERROR") {
      return res.status(404).json({
        erro: dados.message || "CNPJ não encontrado.",
      });
    }

    return res.status(200).json({
      fonte: "ReceitaWS",
      consultado_em: new Date().toISOString(),
      dados,
    });
  } catch (err) {
    console.error("Erro ao consultar CNPJ:", err);
    return res.status(502).json({
      erro: "Erro ao consultar a ReceitaWS. Tente novamente em instantes.",
    });
  }
});

// ---------------------------------------------------------------------------
// 404 e erro genérico
// ---------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ erro: "Rota não encontrada." });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: "Erro interno do servidor." });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Endpoint pago: GET /cnpj/:numero (${PRICE_PER_QUERY} USDC, rede Base 8453)`);
  console.log(`Recebendo pagamentos em: ${PAY_TO_ADDRESS}`);
  console.log(`Facilitator: ${FACILITATOR_URL}`);
});

module.exports = app;
