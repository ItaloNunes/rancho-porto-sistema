import type { CondominioDetalhe, CondominioResumo } from "../types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Erro ${res.status} ao chamar a API`);
  }
  return res.json();
}

export const api = {
  listarCondominios: () => request<CondominioResumo[]>("/condominios"),
  obterCondominio: (slug: string) => request<CondominioDetalhe>(`/condominios/${slug}`),
  reservarLote: (loteId: string, payload: { nome?: string; contato?: string; observacao?: string }) =>
    request(`/lotes/${loteId}/reservar`, { method: "POST", body: JSON.stringify(payload) }),
};

export function formatMoney(v?: number | null): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatArea(v: number): string {
  return `${v.toLocaleString("pt-BR")} m²`;
}
