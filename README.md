# Catálogo de Lotes — Rancho Texas & Porto Franco

Sistema (frontend + backend + banco) para o catálogo de lotes da Castel
Construções e Incorporações: uma tela inicial corporativa com os dois
empreendimentos, e para cada um a planta técnica navegável, lista de lotes
com filtros, ficha de cada lote (área, valores, condições) e pedido de
reserva.

## Arquitetura

- **Banco**: Supabase (Postgres + Auth + Storage). SQL em `supabase/migrations/`.
- **Backend**: FastAPI (`backend/`), fala com o Supabase pela service role key.
  Expõe o catálogo público (`/condominios`) e o painel interno (`/crm/*`,
  `/reservas`) protegido por login do Supabase Auth.
- **Frontend**: React + Vite + TypeScript + Tailwind (`frontend/`).

## Como rodar

### 1. Banco (Supabase)

1. Crie um projeto em supabase.com (grátis para começar).
2. No SQL Editor, rode nesta ordem: `supabase/migrations/0001_init.sql`,
   depois `supabase/migrations/0002_crm.sql`.
3. Em *Project Settings → API*, copie a **Project URL**, a **service_role
   key** e a **anon key**.

### 2. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # cole a URL e as chaves do Supabase
python -m seed.seed         # popula os dois condomínios com os lotes reais
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_URL=http://localhost:8000
npm run dev
```

Abra `http://localhost:5173`.

## O que já está com dados reais

- **Rancho Texas**: 222 lotes, com a planta técnica (polígonos, rio, lagoa,
  rotatórias) reconstruída a partir do projeto da Castel, e valores/status
  extraídos da tabela oficial (`TABELA_RANCHO_TEXAS_07_07_2026.pdf`).
- **Porto Franco Residencial**: 439 lotes em 16 quadras, com área, valor,
  entrada, parcela e status (disponível/reservado/vendido) extraídos
  diretamente da tabela oficial (`TABELA_DE_DISPONIBILIDADE_PORTO_FRANCO`) —
  inclusive a cor de cada linha (vermelho = vendido, amarelo = reservado),
  lida direto do PDF.

## O que ainda é provisório

- **Planta do Porto Franco**: ainda não veio um arquivo técnico
  (CAD/PDF do projeto aprovado) com as coordenadas reais de cada quadra —
  só os renders 3D do clube/portaria e a tabela de preços. O layout atual
  (`backend/seed/data/porto_franco_plan.json`) é um **esquema em grade**,
  gerado a partir da contagem de lotes por quadra, só para o catálogo já
  funcionar de ponta a ponta. Quando a planta real chegar, é só regenerar
  esse arquivo (ou eu regenero) e rodar o seed de novo — o resto do sistema
  não muda.
- **Marca**: logos da Rancho Texas e da Porto Franco Residencial já estão
  no frontend (`frontend/public/brand/`) e configurados no seed. Fotos reais
  por lote ainda não existem — o catálogo mostra um espaço reservado até
  vocês mandarem.
- **Painel gerencial (CRM)**: o banco já tem as tabelas de `clientes`,
  `corretores` e `propostas`, e a API já tem os endpoints para listar/criar
  clientes, listar corretores, criar proposta e mudar status de reserva/lote
  (`backend/app/routers/crm.py`, `reservas.py`). A **tela** do painel (login,
  fila de reservas, cadastro de cliente, emissão de proposta) ainda não foi
  construída — é o próximo passo.
- **Proposta de compra e venda (documento)**: falta o modelo/conteúdo do
  contrato (cláusulas padrão, dados da incorporadora, condições) — isso
  precisa vir de vocês (ou do jurídico) antes de eu gerar um PDF de verdade;
  por enquanto o sistema só guarda os dados da proposta (lote, cliente,
  valor, condições, status).

## Próximos passos sugeridos

1. Mandar a planta técnica real do Porto Franco (ou aprovar o layout
   esquemático atual como definitivo).
2. Mandar o texto/modelo da proposta de compra e venda.
3. Construir a tela do painel gerencial (login + CRM + emissão de proposta).
4. Subir logos/fotos reais por lote para o Supabase Storage e trocar as
   URLs em `condominios.logo_url` / `lotes.foto_url`.
5. Deploy: backend em qualquer serviço que rode FastAPI (Railway, Fly.io,
   etc.), frontend como site estático (Vercel, Netlify) apontando
   `VITE_API_URL` para o backend em produção.
