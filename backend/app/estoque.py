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

# Propostas que já são VENDA: desde 13/11 o lote conta como vendido assim que
# o financeiro aprova a proposta (antes só virava 'vendido' ao gerar o
# contrato ou marcar 'aceita', e lote já pago ficava "reservado").
PROPOSTA_VENDA = ("aprovada", "enviada", "aceita")


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


def lote_em_empreendimento_ativo(sb, lote_id: str) -> bool:
    """O empreendimento do lote está visível (condominios.ativo)? Os
    empreendimentos novos entram ocultos (10/10) até o financeiro conferir:
    corretor não reserva nem faz proposta neles antes disso. Lote sem
    empreendimento achado conta como ativo (não trava nada por engano)."""
    lote = sb.table("lotes").select("condominio_id").eq("id", lote_id).limit(1).execute().data
    if not lote or not lote[0].get("condominio_id"):
        return True
    condo = sb.table("condominios").select("ativo").eq("id", lote[0]["condominio_id"]).limit(1).execute().data
    return not condo or condo[0].get("ativo") is not False


def vender_lote(sb, lote_id: str, proposta_id: str) -> bool:
    """Marca o lote como 'vendido' para esta proposta. Devolve False se ele já
    está vendido por OUTRA proposta (venda dupla). Lote que já está
    'vendido' por esta mesma proposta (ex.: aprovada -> aceita) conta como
    sucesso. O UPDATE é condicional (neq 'vendido'): quem resolve a corrida
    entre duas propostas é o Postgres, não uma leitura em Python."""
    vendeu = sb.table("lotes").update({"status": "vendido"}).eq("id", lote_id).neq("status", "vendido").execute().data
    if vendeu:
        return True
    outras = (
        sb.table("propostas").select("id").eq("lote_id", lote_id)
        .in_("status", list(PROPOSTA_VENDA)).neq("id", proposta_id).execute().data
    ) or []
    return not outras


MSG_CONEXAO_FALHOU = (
    "A conexão com o banco de dados falhou no meio da operação. O lote foi conferido e liberado se ficou "
    "sem dono. Atualize a página e confira em Reservas/Propostas antes de tentar de novo."
)


def desfazer_trava_orfa(sb, lote_id: str, tentativas: int = 3) -> bool:
    """Depois de uma falha no meio de "travar lote + gravar reserva/proposta"
    (ex.: conexão com o banco caiu), confere o lote e devolve para
    'disponivel' se ele ficou 'reservado' sem nenhuma reserva/proposta viva
    por trás. Se a gravação chegou a acontecer (há detentor), não mexe.
    Repete algumas vezes porque a mesma queda de conexão costuma derrubar a
    primeira tentativa de desfazer (foi assim que o Lote 01 da Quadra 15 do
    Porto Franco ficou preso em 12/11/2026). Devolve True se liberou."""
    import time

    for tentativa in range(1, tentativas + 1):
        try:
            return liberar_lote_se_livre(sb, lote_id)
        except Exception:
            if tentativa == tentativas:
                return False
            time.sleep(0.3 * tentativa)
    return False
