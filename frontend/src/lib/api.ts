import { supabase } from "./supabase";
import type {
  Cliente,
  CondominioDetalhe,
  CondominioResumo,
  Corretor,
  DocumentoQualificacao,
  DocumentoTipo,
  Lote,
  LoteComCondominio,
  LoteStatus,
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

/** `auth=true` anexa o token da sessão Supabase Auth atual (login do painel);
 * sem isso, os endpoints do painel (/crm/*, /reservas, PATCH de status)
 * respondem 401. O catálogo público nunca precisa disso. */
async function request<T>(path: string, init?: RequestInit, auth = false): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (auth) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      headers["Authorization"] = `Bearer ${data.session.access_token}`;
    }
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
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
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) {
    headers["Authorization"] = `Bearer ${data.session.access_token}`;
  }
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extrairErro(body, `Erro ${res.status} ao gerar o PDF`));
  }
  return res.blob();
}

export const api = {
  // Catálogo público
  listarCondominios: () => request<CondominioResumo[]>("/condominios"),
  obterCondominio: (slug: string) => request<CondominioDetalhe>(`/condominios/${slug}`),
  reservarLote: (
    loteId: string,
    payload: { nome?: string; contato: string; observacao?: string; website?: string; carregado_em?: number },
  ) => request(`/lotes/${loteId}/reservar`, { method: "POST", body: JSON.stringify(payload) }),

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

  // Painel — perfil de quem está logado
  meuPerfil: () => request<Corretor>("/crm/me", undefined, true),

  // Painel — lotes (gestão rápida de status, unificada pros dois condomínios)
  listarTodosLotes: () => request<LoteComCondominio[]>("/crm/lotes", undefined, true),
  atualizarStatusLote: (loteId: string, status: LoteStatus) =>
    request(`/condominios/lotes/${loteId}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, true),
  // Painel — ferramenta de marcação manual dos lotes na planta real (só admin)
  atualizarPoligonoLote: (loteId: string, poligono: number[][]) =>
    request<Lote>(`/condominios/lotes/${loteId}/poligono`, { method: "PATCH", body: JSON.stringify({ poligono }) }, true),

  // Painel — corretores (logins); CRUD restrito a admin no backend
  listarCorretores: () => request<Corretor[]>("/crm/corretores", undefined, true),
  criarCorretor: (payload: { nome: string; email: string; telefone?: string | null; papel: Papel }) =>
    request<Corretor>("/crm/corretores", { method: "POST", body: JSON.stringify(payload) }, true),
  atualizarCorretor: (
    id: string,
    payload: Partial<{ nome: string; telefone: string | null; papel: Papel; ativo: boolean }>,
  ) => request<Corretor>(`/crm/corretores/${id}`, { method: "PATCH", body: JSON.stringify(payload) }, true),

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
  }) => request<Proposta>("/crm/propostas", { method: "POST", body: JSON.stringify(payload) }, true),
  atualizarStatusProposta: (id: string, status: PropostaStatus) =>
    request<Proposta>(`/crm/propostas/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, true),
  gerarPdfProposta: (id: string) => requestBlob(`/crm/propostas/${id}/pdf`),

  // Painel — fila de pedidos de reserva vindos do catálogo público (+ os criados manualmente)
  listarReservas: () => request<ReservaComLote[]>("/reservas", undefined, true),
  criarReserva: (payload: { lote_id: string; nome?: string | null; contato?: string | null; observacao?: string | null }) =>
    request<Reserva>("/reservas", { method: "POST", body: JSON.stringify(payload) }, true),
  atualizarReserva: (
    id: string,
    payload: Partial<{ nome: string | null; contato: string | null; observacao: string | null }>,
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
  exportarVisaoGeralPdf: (condominioId?: string) =>
    requestBlob(`/crm/visao-geral/pdf${condominioId ? `?condominio_id=${condominioId}` : ""}`),
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
