"""Preço "congelado" de um lote — a foto do valor vigente num instante,
salva dentro da reserva pra não sentir reajustes de preço feitos depois que
a negociação já começou (ver migração 0025_historico_precos_lotes.sql e o
histórico automático em lotes_precos_historico).

Pedido do Italo (28/09), depois do caso da planilha da Sheyla: "a qualquer
hora pode-se mudar os valores de empreendimento, então tem que se
estabelecer uma data corte" — o congelamento na criação da reserva É essa
data corte, por negociação."""

CAMPOS_PRECO = ("valor_total", "entrada", "entrega", "parcela_mensal", "qtd_parcelas", "prazo_entrega_meses")


def congelar_preco_lote(lote: dict) -> dict:
    """A partir de um dict de lote que tenha os CAMPOS_PRECO acima (ex.: um
    select("valor_total, entrada, entrega, parcela_mensal, qtd_parcelas,
    prazo_entrega_meses")), devolve o dict pronto pra gravar direto nas
    colunas *_congelado/*_congelada de uma reserva."""
    return {
        "valor_total_congelado": lote.get("valor_total"),
        "entrada_congelado": lote.get("entrada"),
        "entrega_congelado": lote.get("entrega"),
        "parcela_mensal_congelada": lote.get("parcela_mensal"),
        "qtd_parcelas_congelada": lote.get("qtd_parcelas"),
        "prazo_entrega_meses_congelado": lote.get("prazo_entrega_meses"),
    }
