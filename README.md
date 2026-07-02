# CNPJ x402 Server

API paga por consulta (pay-per-call) que retorna dados públicos de empresas
brasileiras a partir do CNPJ, usando a **ReceitaWS** como fonte de dados e o
protocolo **x402** para cobrar **US$ 0,05 em USDC** por requisição, liquidado
on-chain na rede **Base (chain ID 8453)**.

## Como funciona

1. O cliente faz `GET /cnpj/12345678000195` sem pagamento.
2. O servidor responde `402 Payment Required` com os detalhes do pagamento
   (valor, endereço de destino, rede, ativo).
3. O cliente assina um pagamento USDC (via carteira/agente compatível com
   x402) e reenvia a requisição com o header de pagamento.
4. O middleware `@x402/express` valida e liquida o pagamento através do
   *facilitator* configurado.
5. Só então o handler da rota executa, consulta a ReceitaWS e retorna o JSON
   com os dados da empresa.

Todo o fluxo de cobrança fica isolado no middleware — o handler da rota
(`server.js`) só é executado após o pagamento ser confirmado.

## Estrutura do projeto

```
.
├── server.js         # Servidor Express + endpoint /cnpj/:numero + middleware x402
├── package.json       # Dependências
├── .env.example       # Variáveis de ambiente de exemplo
└── .gitignore
```

## Pré-requisitos

- Node.js 20 ou superior
- Uma carteira EVM (Base) para receber os pagamentos — já configurada como
  `0xb1DF24c41607d6cC8b34a47f8b4E4F4A3bCe4533`
- Uma URL de *facilitator* x402 que suporte a rede Base mainnet
  (`eip155:8453`)

## Instalação local

```bash
git clone <seu-repositorio>
cd cnpj-x402-server
npm install
cp .env.example .env
```

Edite o `.env` conforme necessário (endereço de recebimento, facilitator,
preço). Depois rode:

```bash
npm start
```

O servidor sobe em `http://localhost:3000`.

### Testando

```bash
# Primeira chamada: deve retornar 402 Payment Required com os detalhes da cobrança
curl -i http://localhost:3000/cnpj/33000167000101

# Com um cliente x402 (ex: @x402/fetch ou @x402/axios) o pagamento é
# assinado e reenviado automaticamente, retornando 200 com os dados.
```

## Variáveis de ambiente

| Variável                | Descrição                                                                 | Padrão                              |
|--------------------------|----------------------------------------------------------------------------|--------------------------------------|
| `PORT`                   | Porta em que o servidor escuta                                             | `3000` (Railway define automaticamente) |
| `PAY_TO_ADDRESS`         | Carteira Base que recebe os pagamentos                                     | `0xb1DF24c41607d6cC8b34a47f8b4E4F4A3bCe4533` |
| `X402_FACILITATOR_URL`   | URL do facilitator x402 (verifica/liquida pagamentos on-chain)             | `https://x402.org/facilitator`      |
| `PRICE_PER_QUERY`        | Preço cobrado por consulta                                                 | `$0.05`                             |

> **Importante sobre o facilitator:** `https://x402.org/facilitator` é um
> endpoint de testes/desenvolvimento. Para produção recebendo USDC de
> verdade na Base mainnet, use um facilitator que suporte `eip155:8453`
> oficialmente — por exemplo o facilitator da Coinbase Developer Platform
> (`https://api.cdp.coinbase.com/platform/v2/x402`), que exige uma conta CDP
> configurada, ou outro facilitator compatível com x402 v2 na Base. Confirme
> a URL correta e os requisitos de autenticação na documentação do provedor
> escolhido antes de ir para produção.

## Deploy no Railway

### Opção 1 — via GitHub (recomendado)

1. Suba este projeto para um repositório no GitHub.
2. Acesse [railway.app](https://railway.app) e faça login.
3. Clique em **New Project → Deploy from GitHub repo** e selecione o
   repositório.
4. O Railway detecta automaticamente o `package.json` e usa `npm install` +
   `npm start`.
5. Vá em **Variables** e adicione:
   - `PAY_TO_ADDRESS` = `0xb1DF24c41607d6cC8b34a47f8b4E4F4A3bCe4533`
   - `X402_FACILITATOR_URL` = URL do facilitator escolhido para produção
   - `PRICE_PER_QUERY` = `$0.05`
   - (não é necessário definir `PORT` — o Railway injeta automaticamente)
6. Clique em **Deploy**. Ao final, o Railway fornece uma URL pública
   (`https://seu-projeto.up.railway.app`).

### Opção 2 — via Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Depois configure as variáveis de ambiente:

```bash
railway variables set PAY_TO_ADDRESS=0xb1DF24c41607d6cC8b34a47f8b4E4F4A3bCe4533
railway variables set X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
railway variables set PRICE_PER_QUERY=$0.05
railway up
```

### Verificando o deploy

```bash
curl https://seu-projeto.up.railway.app/health
# {"ok": true}

curl -i https://seu-projeto.up.railway.app/cnpj/33000167000101
# 402 Payment Required, com os detalhes da cobrança em USDC na Base
```

## Endpoints

| Método | Rota            | Pago? | Descrição                                       |
|--------|-----------------|-------|--------------------------------------------------|
| GET    | `/`             | Não   | Status do serviço                                |
| GET    | `/health`       | Não   | Healthcheck                                      |
| GET    | `/cnpj/:numero` | Sim (US$ 0,05 USDC, Base) | Consulta dados de uma empresa por CNPJ |

O parâmetro `:numero` aceita o CNPJ com ou sem máscara (pontos, barra,
hífen são removidos automaticamente).

## Notas sobre a ReceitaWS

A API pública gratuita da ReceitaWS tem limite de requisições por minuto
(historicamente 3 consultas/minuto por IP). Se você espera volume alto de
tráfego, considere um plano pago da ReceitaWS ou um cache de curto prazo
para CNPJs consultados recentemente.

## Segurança

- Nunca versione o `.env` com endereços de carteira ou chaves privadas
  reais além do necessário (o `.gitignore` já exclui `.env`).
- Este servidor **não** guarda chave privada nenhuma — ele só recebe
  pagamentos no endereço público configurado em `PAY_TO_ADDRESS`. Quem
  assina e paga é o cliente que consome a API.
