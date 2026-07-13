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
const FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const PRICE_PER_QUERY = process.env.PRICE_PER_QUERY || "$0.05";
const PRICE_COPA = process.env.PRICE_COPA || "$0.50";
const BASE_NETWORK = "eip155:8453";

// Chave gratuita da football-data.org (defina em variável de ambiente no Render)
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_API_KEY || "b91eb436975b483e81ca65be18d70463";
const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";

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

const facilitatorClient = new HTTPFacilitatorClient({ 
  url: FACILITATOR_URL,
  headers: {
    "Authorization": `Bearer ${process.env.CDP_API_KEY}` 
  }
});

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
      "GET /copa/jogos/hoje": {
        accepts: [
          {
            scheme: "exact",
            price: PRICE_COPA,
            network: BASE_NETWORK,
            payTo: PAY_TO_ADDRESS,
          },
        ],
        description: "Jogos da Copa do Mundo 2026 no dia atual, com times, horário e placar",
        mimeType: "application/json",
      },
      "GET /copa/artilheiros": {
        accepts: [
          {
            scheme: "exact",
            price: PRICE_COPA,
            network: BASE_NETWORK,
            payTo: PAY_TO_ADDRESS,
          },
        ],
        description: "Top 10 artilheiros da Copa do Mundo 2026",
        mimeType: "application/json",
      },
      "GET /copa/bracket": {
        accepts: [
          {
            scheme: "exact",
            price: PRICE_COPA,
            network: BASE_NETWORK,
            payTo: PAY_TO_ADDRESS,
          },
        ],
        description: "Fase atual, confrontos e classificados da Copa do Mundo 2026",
        mimeType: "application/json",
      },
    },
    resourceServer
  )
);

// ---------------------------------------------------------------------------
// Cache simples em memória para football-data.org (limite: 10 req/min no free)
// ---------------------------------------------------------------------------

const cache = new Map();
const CACHE_TTL_MS = {
  jogos: 60 * 1000,             // 1 min
  artilheiros: 30 * 60 * 1000,  // 30 min
  bracket: 5 * 60 * 1000,       // 5 min
};

async function fetchFootballData(path, cacheKey, ttlMs) {
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.data;
  }

  const resp = await fetch(`${FOOTBALL_DATA_BASE}${path}`, {
    headers: { "X-Auth-Token": FOOTBALL_DATA_KEY },
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    const err = new Error(`football-data.org retornou ${resp.status}`);
    err.status = resp.status;
    err.body = errBody;
    throw err;
  }

  const data = await resp.json();
  cache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

// ---------------------------------------------------------------------------
// Endpoints Públicos
// ---------------------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    service: "cnpj-x402-server",
    status: "online",
    endpoints_pagos: [
      "GET /cnpj/:numero",
      "GET /copa/jogos/hoje",
      "GET /copa/artilheiros",
      "GET /copa/bracket",
    ],
    preco_cnpj: PRICE_PER_QUERY,
    preco_copa: PRICE_COPA,
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
      title: "API de Dados de CNPJ e Copa do Mundo 2026",
      description: "Consulta de dados públicos de CNPJ (ReceitaWS) e da Copa do Mundo 2026 (football-data.org) com proteção x402.",
      version: "1.1.0",
      contact: {
        email: "reabilitesi@gmail.com"
      }
    },
    servers: [
      {
        url: "https://protocolo-x40.onrender.com"
      }
    ],
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
      },
      "/copa/jogos/hoje": {
        "get": {
          "summary": "Jogos da Copa do Mundo 2026 de hoje",
          "security": [{ x402: [] }],
          "responses": {
            "200": { "description": "Lista de jogos do dia com placar e horário" },
            "402": { "description": "Pagamento Requerido (x402)" }
          }
        }
      },
      "/copa/artilheiros": {
        "get": {
          "summary": "Top 10 artilheiros da Copa do Mundo 2026",
          "security": [{ x402: [] }],
          "responses": {
            "200": { "description": "Lista dos 10 maiores artilheiros" },
            "402": { "description": "Pagamento Requerido (x402)" }
          }
        }
      },
      "/copa/bracket": {
        "get": {
          "summary": "Fase atual e confrontos da Copa do Mundo 2026",
          "security": [{ x402: [] }],
          "responses": {
            "200": { "description": "Fase atual, confrontos e classificados" },
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
// Endpoint pago: GET /copa/jogos/hoje
// ---------------------------------------------------------------------------

app.get("/copa/jogos/hoje", async (req, res) => {
  try {
    const hoje = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    const dados = await fetchFootballData(
      `/competitions/WC/matches?dateFrom=${hoje}&dateTo=${hoje}`,
      "jogos_hoje",
      CACHE_TTL_MS.jogos
    );

    const jogos = (dados.matches || []).map((m) => ({
      timeCasa: m.homeTeam?.name,
      timeFora: m.awayTeam?.name,
      horario: m.utcDate,
      status: m.status,
      placarCasa: m.score?.fullTime?.home,
      placarFora: m.score?.fullTime?.away,
      fase: m.stage,
    }));

    return res.status(200).json({
      fonte: "football-data.org",
      consultado_em: new Date().toISOString(),
      data: hoje,
      total_jogos: jogos.length,
      jogos,
    });
  } catch (err) {
    console.error("Erro ao consultar jogos de hoje:", err);
    return res.status(err.status === 429 ? 429 : 502).json({
      erro: "Erro ao consultar football-data.org. Tente novamente em instantes.",
    });
  }
});

// ---------------------------------------------------------------------------
// Endpoint pago: GET /copa/artilheiros
// ---------------------------------------------------------------------------

app.get("/copa/artilheiros", async (req, res) => {
  try {
    const dados = await fetchFootballData(
      `/competitions/WC/scorers?limit=10`,
      "artilheiros",
      CACHE_TTL_MS.artilheiros
    );

    const artilheiros = (dados.scorers || []).map((s, i) => ({
      posicao: i + 1,
      jogador: s.player?.name,
      selecao: s.team?.name,
      gols: s.goals,
      assistencias: s.assists,
      penaltis: s.penalties,
    }));

    return res.status(200).json({
      fonte: "football-data.org",
      consultado_em: new Date().toISOString(),
      artilheiros,
    });
  } catch (err) {
    console.error("Erro ao consultar artilheiros:", err);
    return res.status(err.status === 429 ? 429 : 502).json({
      erro: "Erro ao consultar football-data.org. Tente novamente em instantes.",
    });
  }
});

// ---------------------------------------------------------------------------
// Endpoint pago: GET /copa/bracket
// ---------------------------------------------------------------------------

app.get("/copa/bracket", async (req, res) => {
  try {
    const dados = await fetchFootballData(
      `/competitions/WC/matches`,
      "bracket",
      CACHE_TTL_MS.bracket
    );

    const todos = dados.matches || [];

    // Descobre a fase mais avançada presente nos dados
    const fases = [...new Set(todos.map((m) => m.stage))];
    const faseAtual = fases[fases.length - 1] || "GROUP_STAGE";

    const confrontos = todos
      .filter((m) => m.stage === faseAtual)
      .map((m) => ({
        timeCasa: m.homeTeam?.name,
        timeFora: m.awayTeam?.name,
        horario: m.utcDate,
        status: m.status,
        placarCasa: m.score?.fullTime?.home,
        placarFora: m.score?.fullTime?.away,
        vencedor:
          m.score?.winner === "HOME_TEAM"
            ? m.homeTeam?.name
            : m.score?.winner === "AWAY_TEAM"
            ? m.awayTeam?.name
            : null,
      }));

    const classificados = confrontos
      .filter((c) => c.vencedor)
      .map((c) => c.vencedor);

    return res.status(200).json({
      fonte: "football-data.org",
      consultado_em: new Date().toISOString(),
      fase_atual: faseAtual,
      confrontos,
      classificados,
    });
  } catch (err) {
    console.error("Erro ao consultar bracket:", err);
    return res.status(err.status === 429 ? 429 : 502).json({
      erro: "Erro ao consultar football-data.org. Tente novamente em instantes.",
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
  console.log(`Endpoints Copa: /copa/jogos/hoje, /copa/artilheiros, /copa/bracket (${PRICE_COPA} USDC cada)`);
  console.log(`Recebendo pagamentos em: ${PAY_TO_ADDRESS}`);
  console.log(`Facilitator: ${FACILITATOR_URL}`);
});

module.exports = app;
