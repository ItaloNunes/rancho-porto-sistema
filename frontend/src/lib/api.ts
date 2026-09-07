import { supabase } from "./supabase";
import type {
  Cliente,
  CondominioDetalhe,
  CondominioResumo,
  Corretor,
  LoteComCondominio,
  LoteStatus,
  Papel,
  Proposta,
  PropostaDetalhe,
  PropostaStatus,
  Reserva,
  ReservaComLote,
  ReservaStatus,
} from "../types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

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
    throw new Error(body.detail ?? `Erro ${res.status} ao chamar a API`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Catálogo público
  listarCondominios: () => request<CondominioResumo[]>("/condominios"),
  obterCondominio: (slug: string) => request<CondominioDetalhe>(`/condominios/${slug}`),
  reservarLote: (loteId: string, payload: { nome?: string; contato?: string; observacao?: string }) =>
    request(`/lotes/${loteId}/reservar`, { method: "POST", body: JSON.stringify(payload) }),

  // Painel — perfil de quem está logado
  meuPerfil: () => request<Corretor>("/crm/me", undefined, true),

  // Painel — lotes (gestão rápida de status, unificada pros dois condomínios)
  listarTodosLotes: () => request<LoteComCondominio[]>("/crm/lotes", undefined, true),
  atualizarStatusLote: (loteId: string, status: LoteStatus) =>
    request(`/condominios/lotes/${loteId}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, true),

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

  // Painel — fila de pedidos de reserva vindos do catálogo público
  listarReservas: () => request<ReservaComLote[]>("/reservas", undefined, true),
  atualizarStatusReserva: (id: string, status: ReservaStatus) =>
    request<Reserva>(`/reservas/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, true),
};

export function formatMoney(v?: number | null): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatArea(v: number): string {
  return `${v.toLocaleString("pt-BR")} m²`;
}
