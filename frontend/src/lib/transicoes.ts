/** Para onde cada status pode ir — espelho das regras do servidor (03/10):
 * backend/app/routers/crm.py::_TRANSICOES_PROPOSTA e
 * routers/reservas.py::_TRANSICOES_RESERVA. A tela só oferece o que o
 * servidor aceita (o servidor confere de novo de qualquer jeito). */
import type { PropostaStatus, ReservaStatus } from "../types";

const PROPOSTA: Record<PropostaStatus, PropostaStatus[]> = {
  rascunho: ["aguardando_aprovacao", "cancelada", "aprovada", "recusada"],
  aguardando_aprovacao: ["rascunho", "cancelada", "aprovada", "recusada"],
  aprovada: ["enviada", "aceita", "cancelada", "recusada"],
  enviada: ["aceita", "cancelada", "recusada"],
  aceita: ["cancelada"],
  recusada: [],
  cancelada: [],
};

export function proximosStatusProposta(atual: PropostaStatus, admin: boolean): PropostaStatus[] {
  return PROPOSTA[atual].filter((s) => {
    if (admin) return true;
    if (s === "aprovada" || s === "recusada") return false;
    if (s === "cancelada" && (atual === "aprovada" || atual === "enviada" || atual === "aceita")) return false;
    return true;
  });
}

const RESERVA: Record<ReservaStatus, ReservaStatus[]> = {
  pendente: ["em_atendimento", "aguardando_qualificacao", "cancelada", "confirmada"],
  em_atendimento: ["pendente", "aguardando_qualificacao", "cancelada", "confirmada"],
  aguardando_qualificacao: ["pendente", "em_atendimento", "cancelada", "confirmada"],
  em_analise_financeira: ["cancelada", "confirmada"],
  confirmada: ["cancelada"],
  cancelada: [],
};

export function proximosStatusReserva(atual: ReservaStatus, admin: boolean): ReservaStatus[] {
  return RESERVA[atual].filter((s) => admin || (s !== "confirmada" && s !== "em_analise_financeira"));
}
