import { getToken } from "./token";
import type {
  Cliente,
  CondominioDetalhe,
  CondominioResumo,
  Corretor,
  CorretorCriado,
  CorretorImportadoItem,
  DocumentoProposta,
  DocumentoQualificacao,
  DocumentoTipo,
  ImportacaoConfirmarResultado,
  ImportacaoPreview,
  Lote,
  LoteComCondominio,
  LoteStatus,
  LoginResposta,
  Papel,
  Proposta,
  PropostaDetalhe,
  PropostaStatus,
  Qualificacao,
  QualificacaoComRelacoes,
  QualificacaoDados,
  QualificacaoPublica,
  Reserva,
  ReservaComLote,
  ReservaStatus,
  VisaoGeralCondominio,
} from "../types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** A API (FastAPI) devolve erro de validação como `detail: [{msg, ...}]`
 * (não uma string) — sem isso a mensagem vira "[object Object]" pro usuário.
 * `body.detail` string simples (erros "de negócio", ex: HTTPException) continua
 * funcionando igual. */
function extrairErro(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) {
    return String(detail[0].msg).replace(/^Value error,\s*/, "");
  }
  return fallback;
}

// O backend (Render, plano free) "dorme" depois de ficar um tempo sem
// requisição e demora até ~50s pra acordar na próxima — sem isso, a
// primeira chamada do dia falha com "Failed to fetch" (erro de rede puro,
// o fetch nem chega a ter resposta) e aparece cru pro usuário. As três
// camadas que evitam isso: 1) keep-alive (.github/workflows/keep-alive.yml)
// pinga /health de 10 em 10 min pra reduzir a chance de dormir; 2)
// prewarmBackend() abaixo, chamado assim que uma tela com formulário longo
// abre, pra acordar o backend em paralelo enquanto a pessoa ainda tá
// preenchendo; 3) o retry abaixo, que refaz a chamada em vez de estourar
// erro na primeira falha. 502/503/504 (gateway/serviço acordando) entram no
// mesmo retry; qualquer outro status HTTP (400, 401, 404...) é erro de
// verdade e não deve ser tentado de novo.
//
// O total aqui (~55s) tem que ficar ACIMA do pior caso documentado de cold
// start (~50s) com alguma folga — um total menor que isso short-circuita a
// espera bem no meio de um cold start normal e devolve "não foi possível
// conectar" pra quem só precisava esperar mais um pouco (foi exatamente o
// bug daqui: a soma antiga dava só ~23s). Ainda assim, um deploy novo no
// Render pode demorar mais que isso pra terminar de subir — se acontecer de
// alguém tentar salvar bem no meio de um deploy, a mensagem de erro ainda
// pode aparecer uma vez; tentar de novo depois de mais um minuto resolve.
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000]; // ~55s de espera total

// Teto de segurança pra chamada inteira (todas as tentativas somadas): se uma
// única tentativa de fetch ficar pendurada sem nunca resolver nem rejeitar —
// por exemplo, a conexão fica "presa" no meio de um cold start em vez de
// falhar rápido com 502/503/504 — o `await fetch(...)` abaixo esperaria pra
// sempre e a tela ficaria travada (aba de PDF em branco pra sempre, sem
// nenhum erro aparecendo), pois o retry só reage a uma Promise que já
// terminou. O AbortController garante que, no pior caso, a chamada sempre
// desiste e lança um erro dentro desse prazo — nunca fica pendurada. Deixa
// uma folga de ~15s sobre a soma de RETRY_DELAYS_MS + tempo de resposta.
const TEMPO_MAXIMO_TOTAL_MS = 75_000;

function respostaTemporariamenteIndisponivel(res: Response): boolean {
  return [502, 503, 504].includes(res.status);
}

async function fetchComRetry(url: string, init: RequestInit): Promise<Response> {
  const prazoFinal = Date.now() + TEMPO_MAXIMO_TOTAL_MS;
  for (let tentativa = 0; ; tentativa++) {
    let res: Response | null = null;
    let erroDeRede: unknown = null;
    let estourouPrazo = false;
    const controlador = new AbortController();
    const tempoRestante = Math.max(prazoFinal - Date.now(), 1000);
    const cronometro = setTimeout(() => {
      estourouPrazo = true;
      controlador.abort();
    }, tempoRestante);
    try {
      res = await fetch(url, { ...init, signal: controlador.signal });
    } catch (e) {
      erroDeRede = e;
    } finally {
      clearTimeout(cronometro);
    }
    const aindaDaTempo = Date.now() < prazoFinal;
    const podeTentarDeNovo = tentativa < RETRY_DELAYS_MS.length && aindaDaTempo;
    const falhouPorRede = erroDeRede !== null;
    const falhouPorIndisponibilidade = res !== null && respostaTemporariamenteIndisponivel(res);
    if ((falhouPorRede || falhouPorIndisponibilidade) && podeTentarDeNovo) {
      const espera = Math.min(RETRY_DELAYS_MS[tentativa], Math.max(prazoFinal - Date.now(), 0));
      await new Promise((r) => setTimeout(r, espera));
      continue;
    }
    if (falhouPorRede) {
      const mensagem = estourouPrazo
        ? "O servidor demorou demais pra responder. Tente novamente em instantes."
        : "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente em instantes.";
      throw new Error(mensagem);
    }
    return res as Response;
  }
}

/** `auth=true` anexa o token de sessão do painel (login próprio, ver
 * lib/token.ts) — sem isso, os endpoints do painel (/crm/*, /reservas,
 * PATCH de status) respondem 401. O catálogo público nunca precisa disso. */
async function request<T>(path: string, init?: RequestInit, auth = false): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetchComRetry(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extrairErro(body, `Erro ${res.status} ao chamar a API`));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Como `request`, mas pra respostas binárias (PDF) — sempre autenticado. */
async function requestBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetchComRetry(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extrairErro(body, `Erro ${res.status} ao gerar o PDF`));
  }
  return res.blob();
}

/** Dispara um ping em /health sem aguardar nem tratar erro — chamado assim
 * que uma tela com formulário longo abre (ex.: Nova proposta, 8 etapas),
 * pra aproveitar o tempo de preenchimento acordando o backend em paralelo
 * em vez de só na hora crítica de salvar (ver comentário de
 * RETRY_DELAYS_MS acima). Sem retry de propósito: se falhar, o próprio
 * `request`/`fetchComRetry` da ação real (salvar) ainda cobre o caso. */
export function prewarmBackend(): void {
  fetch(`${API_URL}/health`).catch(() => {});
}

/** Abre uma aba em branco já com uma mensagem de carregamento, em vez de
 * deixar "about:blank" parado enquanto o PDF é gerado no backend — sem isso,
 * se o servidor estiver "dormindo" (Render free-tier, ver RETRY_DELAYS_MS
 * acima) a aba fica em branco por até ~1 minuto e parece travada/quebrada,
 * mesmo estando tudo funcionando (só lento). Reaproveitada por toda tela que
 * gera PDF: PainelPropostas, PainelQualificacoes, PainelDisponibilidade e
 * PainelVisaoGeral. */
export function abrirAbaComCarregamento(mensagem: string): Window | null {
  const aba = window.open("", "_blank");
  if (aba) {
    aba.document.write(`<!doctype html>
<meta charset="utf-8">
<title>${mensagem}</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, "Segoe UI", Arial, sans-serif;
    background: #EEF1F5; color: #54607A;
  }
  .caixa { display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; padding: 24px; }
  .spinner {
    width: 28px; height: 28px; border: 3px solid #E2E6EC; border-top-color: #0B3D5C;
    border-radius: 50%; animation: girar .8s linear infinite;
  }
  @keyframes girar { to { transform: rotate(360deg); } }
  p { font-size: 14px; margin: 0; }
  .aviso { font-size: 12px; color: #8791A6; }
  .marca { font-size: 10px; color: #B7BECC; font-family: monospace; }
</style>
<div class="caixa">
  <div class="spinner"></div>
  <p>${mensagem}</p>
  <p class="aviso">Pode levar até 75 segundos se o sistema estiver inativo há um tempo — nunca mais que isso.</p>
  <p class="marca">build pdf-fix-2</p>
</div>`);
    aba.document.close();
  }
  return aba;
}

/** Escreve o erro real DENTRO da aba que já estava aberta (em vez de só um
 * alert(), que em alguns navegadores/extensões de privacidade pode ser
 * suprimido ou passar despercebido se a aba perdeu o foco) — assim, se algo
 * der errado, sempre existe alguma coisa visível na própria aba, nunca fica
 * "about:blank" indefinidamente sem explicação nenhuma. Usada nos mesmos 4
 * lugares que abrem aba com abrirAbaComCarregamento(). */
export function mostrarErroNaAba(aba: Window | null, mensagem: string): void {
  if (!aba || aba.closed) return;
  try {
    aba.document.open();
    aba.document.write(`<!doctype html>
<meta charset="utf-8">
<title>Não foi possível gerar o arquivo</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, "Segoe UI", Arial, sans-serif;
    background: #FBEAEA; color: #7A2323;
  }
  .caixa { max-width: 440px; text-align: center; padding: 28px; display: flex; flex-direction: column; gap: 12px; }
  h1 { font-size: 16px; margin: 0; }
  p { font-size: 14px; margin: 0; line-height: 1.5; }
  button {
    margin-top: 6px; align-self: center; border: 1px solid #7A2323; background: transparent;
    color: #7A2323; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer;
  }
  button:hover { background: #F3D6D6; }
</style>
<div class="caixa">
  <h1>Não foi possível gerar o arquivo</h1>
  <p>${mensagem.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
  <button onclick="window.close()">Fechar esta aba</button>
</div>`);
    aba.document.close();
  } catch {
    // Se nem escrever na aba funcionar, não sobra mais nada que dê pra fazer
    // por ela — o alert() no catch de cada tela continua como último recurso.
  }
}

function _escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Mostra um PDF já pronto na aba que abrirAbaComCarregamento() deixou
 * aberta, com um botão de Compartilhar (usa o share nativo do celular —
 * WhatsApp, e-mail, Drive etc. — quando o navegador suporta; no desktop, ou
 * em navegadores sem suporte, cai pra um link de abrir/baixar).
 *
 * Por que existe: o fluxo antigo navegava a aba direto pro PDF
 * (`aba.location.href = blobUrl`), o que TROCA de página dentro da aba e
 * empilha uma entrada nova no histórico dela. No celular, apertar "Voltar"
 * então caía na entrada anterior — a tela de "Gerando PDF..." parada do
 * jeito que ficou, sem nenhuma atualização depois disso — parecendo uma
 * tela quebrada/travada. Aqui a aba nunca navega pra outra URL: só troca o
 * próprio conteúdo (document.write, mesma entrada de histórico o tempo
 * todo), então não sobra nada "morto" pra apertar Voltar cair em cima. */
export function mostrarPdfNaAba(aba: Window | null, blob: Blob, nomeArquivo: string, titulo: string): void {
  if (!aba || aba.closed) return;
  (aba as unknown as { __pdfBlob?: Blob }).__pdfBlob = blob;
  try {
    aba.document.open();
    aba.document.write(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${_escaparHtml(titulo)}</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; flex-direction: column;
    font-family: -apple-system, "Segoe UI", Arial, sans-serif;
    background: #EEF1F5;
  }
  header {
    flex: none; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: center;
    padding: 10px 12px; background: #fff; border-bottom: 1px solid #DCE1E8;
  }
  header p { margin: 0; width: 100%; text-align: center; font-size: 13px; color: #54607A; }
  .botoes { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  button, a.botao {
    font: inherit; font-size: 14px; font-weight: 600; border-radius: 8px; padding: 10px 18px;
    border: none; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
  }
  #btn-compartilhar { background: #0B3D5C; color: #fff; }
  #btn-compartilhar:disabled { opacity: .5; cursor: default; }
  #btn-voltar { background: #fff; color: #54607A; border: 1px solid #C7CEDA; }
  a.botao { background: #fff; color: #0B3D5C; border: 1px solid #0B3D5C; }
  main { flex: 1; min-height: 0; }
  iframe { width: 100%; height: 100%; border: 0; background: #fff; }
  .aviso { font-size: 12px; color: #8791A6; text-align: center; padding: 8px; margin: 0; }
</style>
<header>
  <p>${_escaparHtml(titulo)}</p>
  <div class="botoes">
    <button id="btn-voltar" type="button">&larr; Voltar</button>
    <button id="btn-compartilhar" type="button">Compartilhar</button>
    <a id="link-abrir" class="botao" target="_blank" rel="noopener">Abrir / baixar</a>
  </div>
</header>
<main><iframe id="preview" title="Pré-visualização do PDF"></iframe></main>
<p class="aviso" id="aviso-preview" hidden>Não deu pra mostrar o PDF aqui — use "Abrir / baixar" acima.</p>
<script>
(function () {
  var blob = window.__pdfBlob;
  var nome = ${JSON.stringify(nomeArquivo)};
  var url = URL.createObjectURL(blob);
  var preview = document.getElementById("preview");
  preview.src = url;
  preview.addEventListener("error", function () {
    document.getElementById("aviso-preview").hidden = false;
  });
  var linkAbrir = document.getElementById("link-abrir");
  linkAbrir.href = url;
  linkAbrir.download = nome;
  var btnVoltar = document.getElementById("btn-voltar");
  btnVoltar.addEventListener("click", function () {
    try { window.close(); } catch (e) { /* nada mais a fazer aqui */ }
  });
  var btn = document.getElementById("btn-compartilhar");
  btn.addEventListener("click", async function () {
    try {
      var file = new File([blob], nome, { type: "application/pdf" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: nome });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return; // usuário cancelou o share — não é erro
    }
    linkAbrir.click();
  });
})();
</script>`);
    aba.document.close();
  } catch {
    // Se nem escrever na aba funcionar, não sobra mais nada que dê pra fazer
    // por ela — o alert() no catch de cada tela continua como último recurso.
  }
}

export const api = {
  // Catálogo público
  listarCondominios: () => request<CondominioResumo[]>("/condominios"),
  obterCondominio: (slug: string) => request<CondominioDetalhe>(`/condominios/${slug}`),
  // reservarLote foi removido: reserva agora só é criada pelo corretor, pelo
  // painel (api.criarReserva, abaixo) — ver backend/app/routers/reservas.py.

  // Qualificação — link público que o cliente final preenche (sem login, só
  // pela posse do token). Ver backend/app/routers/qualificacao.py.
  abrirQualificacao: (token: string) => request<QualificacaoPublica>(`/qualificacao/${token}`),
  salvarQualificacao: (token: string, dados: QualificacaoDados) =>
    request<QualificacaoPublica>(`/qualificacao/${token}`, { method: "PATCH", body: JSON.stringify(dados) }),
  enviarDocumentoQualificacao: async (token: string, tipo: DocumentoTipo, arquivo: File): Promise<DocumentoQualificacao> => {
    const form = new FormData();
    form.append("arquivo", arquivo);
    const res = await fetch(`${API_URL}/qualificacao/${token}/documentos?tipo=${tipo}`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(extrairErro(body, `Erro ${res.status} ao enviar o documento`));
    }
    return res.json();
  },
  enviarQualificacaoParaAnalise: (token: string) =>
    request<QualificacaoPublica>(`/qualificacao/${token}/enviar`, { method: "POST" }),

  // Painel — login próprio (usuário + senha), sem Supabase Auth. Ver lib/auth.tsx.
  login: (usuario: string, senha: string) =>
    request<LoginResposta>("/crm/login", { method: "POST", body: JSON.stringify({ usuario, senha }) }),
  // Painel — perfil de quem está logado
  meuPerfil: () => request<Corretor>("/crm/me", undefined, true),
  // Painel — o próprio corretor logado troca a senha (precisa confirmar a atual)
  trocarMinhaSenha: (senhaAtual: string, senhaNova: string) =>
    request<Corretor>(
      "/crm/me/senha",
      { method: "POST", body: JSON.stringify({ senha_atual: senhaAtual, senha_nova: senhaNova }) },
      true,
    ),

  // Painel — lotes (gestão rápida de status, unificada pros dois condomínios)
  listarTodosLotes: () => request<LoteComCondominio[]>("/crm/lotes", undefined, true),
  atualizarStatusLote: (loteId: string, status: LoteStatus) =>
    request(`/condominios/lotes/${loteId}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, true),
  // Painel — ferramenta de marcação manual dos lotes na planta real (só admin)
  atualizarPoligonoLote: (loteId: string, poligono: number[][]) =>
    request<Lote>(`/condominios/lotes/${loteId}/poligono`, { method: "PATCH", body: JSON.stringify({ poligono }) }, true),
  // Painel — importação de planilha de lotes (só admin): cobre venda/reserva
  // feita fora do sistema. Preview sobe o arquivo e só mostra o que mudaria;
  // confirmar manda de volta os itens marcados na tela, sem reenviar o arquivo.
  importarLotesPreview: async (condominioId: string, arquivo: File): Promise<ImportacaoPreview> => {
    const form = new FormData();
    form.append("condominio_id", condominioId);
    form.append("arquivo", arquivo);
    const token = getToken();
    const res = await fetchComRetry(`${API_URL}/condominios/lotes/importar/preview`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(extrairErro(body, `Erro ${res.status} ao analisar a planilha`));
    }
    return res.json();
  },
  importarLotesConfirmar: (itens: { lote_id: string; status: LoteStatus; status_atual: LoteStatus }[]) =>
    request<ImportacaoConfirmarResultado>(
      "/condominios/lotes/importar/confirmar",
      { method: "POST", body: JSON.stringify({ itens }) },
      true,
    ),

  // Painel — corretores (logins); CRUD restrito a admin no backend
  listarCorretores: () => request<Corretor[]>("/crm/corretores", undefined, true),
  criarCorretor: (payload: { nome: string; telefone: string; usuario?: string | null; papel: Papel }) =>
    request<CorretorCriado>("/crm/corretores", { method: "POST", body: JSON.stringify(payload) }, true),
  atualizarCorretor: (
    id: string,
    payload: Partial<{
      nome: string;
      telefone: string | null;
      papel: Papel;
      ativo: boolean;
      /** Força a senha de volta pro telefone atual mesmo se o corretor já
       * tiver customizado a própria (ver Corretor.senha_customizada). */
      resetar_senha: boolean;
    }>,
  ) => request<Corretor>(`/crm/corretores/${id}`, { method: "PATCH", body: JSON.stringify(payload) }, true),
  // Cadastra de uma vez todos os corretores da planilha inicial (ver
  // backend/app/data/corretores_iniciais.py) — idempotente, dá pra clicar
  // de novo sem duplicar ninguém.
  importarCorretores: () =>
    request<CorretorImportadoItem[]>("/crm/corretores/importar", { method: "POST" }, true),

  // Painel — clientes/leads
  listarClientes: () => request<Cliente[]>("/crm/clientes", undefined, true),
  criarCliente: (payload: Partial<Cliente>) =>
    request<Cliente>("/crm/clientes", { method: "POST", body: JSON.stringify(payload) }, true),
  atualizarCliente: (id: string, payload: Partial<Cliente>) =>
    request<Cliente>(`/crm/clientes/${id}`, { method: "PATCH", body: JSON.stringify(payload) }, true),
  excluirCliente: (id: string) => request<void>(`/crm/clientes/${id}`, { method: "DELETE" }, true),

  // Painel — propostas de compra e venda
  listarPropostas: () => request<PropostaDetalhe[]>("/crm/propostas", undefined, true),
  criarProposta: (payload: {
    lote_id: string;
    cliente_id: string;
    valor_proposto: number;
    condicoes_pagamento?: string | null;
    observacoes?: string | null;
    // Formulário completo (RG, endereços, cônjuge, forma de pagamento
    // detalhada etc.) — preenchido quando a proposta nasce direto do
    // formulário completo do painel (ver PropostaFormularioCompleto.tsx),
    // sem passar pelo link de qualificação do cliente final. Sem isso, o
    // PDF cai de volta pro resumo simples (nome/CPF/telefone do cliente).
    dados_qualificacao?: QualificacaoDados | null;
  }) => request<Proposta>("/crm/propostas", { method: "POST", body: JSON.stringify(payload) }, true),
  atualizarStatusProposta: (id: string, status: PropostaStatus) =>
    request<Proposta>(`/crm/propostas/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, true),
  // Rota sem "pdf" na URL de propósito — ver comentário em
  // backend/app/routers/crm.py::gerar_pdf_proposta (bloqueador de
  // anúncio/rastreador barrando a URL só por conter "pdf" no caminho).
  gerarPdfProposta: (id: string) => requestBlob(`/crm/propostas/${id}/documento`),
  // Igual a gerarPdfProposta, mas num PDF só: a proposta seguida de todos os
  // documentos anexados (RG, CPF, comprovantes...) — ver
  // backend/app/routers/crm.py::gerar_relatorio_completo. Mesma ausência de
  // "pdf" na URL, pelo mesmo motivo (bloqueador de anúncio/rastreador).
  gerarRelatorioCompletoProposta: (id: string) => requestBlob(`/crm/propostas/${id}/documento-completo`),
  // Anexos da proposta (RG, CPF, comprovante de renda etc.) — diferente do
  // fluxo de qualificação por link, aqui o corretor pode anexar/remover a
  // qualquer momento, mesmo com a proposta já criada há tempos. A lista já
  // vem embutida em cada PropostaDetalhe (ver listarPropostas), então só
  // recarregar a lista de propostas após enviar/excluir já atualiza a tela.
  enviarDocumentoProposta: async (propostaId: string, tipo: DocumentoTipo, arquivo: File): Promise<DocumentoProposta> => {
    const form = new FormData();
    form.append("arquivo", arquivo);
    const token = getToken();
    const res = await fetchComRetry(`${API_URL}/crm/propostas/${propostaId}/documentos?tipo=${tipo}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(extrairErro(body, `Erro ${res.status} ao enviar o documento`));
    }
    return res.json();
  },
  baixarDocumentoProposta: (propostaId: string, documentoId: string) =>
    request<{ url: string }>(`/crm/propostas/${propostaId}/documentos/${documentoId}/arquivo`, undefined, true),
  excluirDocumentoProposta: (propostaId: string, documentoId: string) =>
    request<void>(`/crm/propostas/${propostaId}/documentos/${documentoId}`, { method: "DELETE" }, true),

  // Painel — fila de pedidos de reserva vindos do catálogo público (+ os criados manualmente)
  listarReservas: () => request<ReservaComLote[]>("/reservas", undefined, true),
  criarReserva: (payload: {
    lote_id: string;
    nome?: string | null;
    contato?: string | null;
    cpf?: string | null;
    observacao?: string | null;
  }) => request<Reserva>("/reservas", { method: "POST", body: JSON.stringify(payload) }, true),
  atualizarReserva: (
    id: string,
    payload: Partial<{ nome: string | null; contato: string | null; cpf: string | null; observacao: string | null }>,
  ) => request<Reserva>(`/reservas/${id}`, { method: "PATCH", body: JSON.stringify(payload) }, true),
  excluirReserva: (id: string) => request<void>(`/reservas/${id}`, { method: "DELETE" }, true),
  atualizarStatusReserva: (id: string, status: ReservaStatus) =>
    request<Reserva>(`/reservas/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, true),

  // Painel — qualificação do cliente final (link gerado a partir de uma reserva)
  gerarLinkQualificacao: (
    reservaId: string,
    payload: { cliente_id?: string; cliente_novo?: Partial<Cliente> & { nome: string } },
  ) => request<Qualificacao>(`/crm/qualificacoes/gerar/${reservaId}`, { method: "POST", body: JSON.stringify(payload) }, true),
  listarQualificacoes: () => request<QualificacaoComRelacoes[]>("/crm/qualificacoes", undefined, true),
  detalheQualificacao: (id: string) => request<QualificacaoComRelacoes>(`/crm/qualificacoes/${id}`, undefined, true),
  baixarDocumentoQualificacao: (qualificacaoId: string, documentoId: string) =>
    request<{ url: string }>(`/crm/qualificacoes/${qualificacaoId}/documentos/${documentoId}/arquivo`, undefined, true),
  decidirQualificacao: (id: string, payload: { aprovado: boolean; motivo_reprovacao?: string | null }) =>
    request<Qualificacao>(`/crm/qualificacoes/${id}/decisao`, { method: "PATCH", body: JSON.stringify(payload) }, true),

  // Painel — visão geral (só admin): números por empreendimento + relatório em PDF
  visaoGeral: () => request<VisaoGeralCondominio[]>("/crm/visao-geral", undefined, true),
  // `status`/`busca` (opcionais) recortam a tabela de lotes do PDF pelos
  // mesmos filtros da tela de Disponibilidade — sem eles, exporta o
  // empreendimento inteiro (comportamento usado pela Visão Geral).
  exportarVisaoGeralPdf: (opts?: { condominioId?: string; status?: LoteStatus; busca?: string }) => {
    const params = new URLSearchParams();
    if (opts?.condominioId) params.set("condominio_id", opts.condominioId);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.busca) params.set("busca", opts.busca);
    const query = params.toString();
    return requestBlob(`/crm/visao-geral/relatorio${query ? `?${query}` : ""}`);
  },

  // Botão de suporte do painel (corretor e admin) — vira um e-mail com os
  // anexos como link (ver backend/app/routers/suporte.py). Multipart igual
  // ao de importarLotesPreview acima: não passa por `request()` porque esse
  // helper sempre manda Content-Type: application/json.
  abrirChamadoSuporte: async (assunto: string, descricao: string, arquivos: File[]): Promise<void> => {
    const form = new FormData();
    form.append("assunto", assunto);
    form.append("descricao", descricao);
    arquivos.forEach((a) => form.append("arquivos", a));
    const token = getToken();
    const res = await fetchComRetry(`${API_URL}/suporte/chamados`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(extrairErro(body, `Erro ${res.status} ao abrir o chamado`));
    }
  },
};

export function formatMoney(v?: number | null): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatArea(v: number): string {
  return `${v.toLocaleString("pt-BR")} m²`;
}

export function formatDateTime(v?: string | null): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Horas restantes (pode ser negativo — prazo vencido) até um prazo ISO. */
export function horasRestantes(prazoIso?: string | null): number | null {
  if (!prazoIso) return null;
  return (new Date(prazoIso).getTime() - Date.now()) / 3_600_000;
}
