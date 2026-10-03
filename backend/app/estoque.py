"""Quem "segura" um lote — regra única pra travar/liberar estoque (03/10).

Antes cada caminho (cancelar reserva, excluir reserva, cancelar proposta,
expirar reserva, reprovar qualificação) liberava o lote por conta própria,
sem olhar se OUTRA reserva/proposta viva ainda dependia dele. Resultado
possível: lote de venda aprovada voltando pro catálogo, ou dois clientes no
mesmo lote. Agora todo mundo passa por aqui:

- um lote está preso enquanto existir reserva viva OU proposta viva nele;
- liberar = só se ninguém mais segura E o lote ainda estiver 'reservado'
  (nunca destrava 'vendido').
"""

from __future__ import annotations

from typing import Optional

RESERVA_VIVAS = ("pendente", "em_atendimento", "aguardando_qualificacao", "em_analise_financeira", "confirmada")
PROPOSTA_VIVAS = ("rascunho", "aguardando_aprovacao", "aprovada", "enviada", "aceita")
# Proposta nestes status já saiu da mão do corretor (está com o financeiro,
# aprovada ou vendida): a reserva dela não expira sozinha.
PROPOSTA_SEGURA_LOTE = ("aguardando_aprovacao", "aprovada", "enviada", "aceita")


def detentores(sb, lote_id: str, exceto_reserva_id: Optional[str] = None,
               exceto_proposta_id: Optional[str] = None) -> list[str]:
    """Descrição das reservas/propostas vivas que seguram o lote (fora as
    exceções) — lista vazia = lote livre."""
    out: list[str] = []
    reservas = (
        sb.table("reservas").select("id, nome, proposta_id, status")
        .eq("lote_id", lote_id).in_("status", list(RESERVA_VIVAS)).execute().data
    ) or []
    for r in reservas:
        if r["id"] == exceto_reserva_id:
            continue
        if exceto_proposta_id and r.get("proposta_id") == exceto_proposta_id:
            continue  # reserva da própria proposta que está saindo
        out.append(f"reserva de {r.get('nome') or 'cliente'} ({r['status']})")
    propostas = (
        sb.table("propostas").select("id, numero, status")
        .eq("lote_id", lote_id).in_("status", list(PROPOSTA_VIVAS)).execute().data
    ) or []
    for p in propostas:
        if p["id"] == exceto_proposta_id:
            continue
        out.append(f"proposta Nº {int(p.get('numero') or 0):04d} ({p['status']})")
    return out


def liberar_lote_se_livre(sb, lote_id: str, exceto_reserva_id: Optional[str] = None,
                          exceto_proposta_id: Optional[str] = None) -> bool:
    """Volta o lote pra 'disponivel' só se ninguém mais segura ele e ele
    ainda estiver 'reservado'. Devolve True se liberou."""
    if detentores(sb, lote_id, exceto_reserva_id, exceto_proposta_id):
        return False
    feito = (
        sb.table("lotes").update({"status": "disponivel"})
        .eq("id", lote_id).eq("status", "reservado").execute().data
    )
    return bool(feito)


def proposta_viva_da_reserva(sb, reserva: dict) -> Optional[dict]:
    """Proposta ainda viva ligada a esta reserva (se houver)."""
    pid = reserva.get("proposta_id")
    if not pid:
        return None
    p = sb.table("propostas").select("id, numero, status").eq("id", pid).limit(1).execute().data
    if p and p[0]["status"] in PROPOSTA_VIVAS:
        return p[0]
    return None
