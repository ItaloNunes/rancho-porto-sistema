"""Geração do recibo e do contrato completo preenchendo os modelos .docx
enviados pela imobiliária — nunca reescrevendo o texto jurídico à mão, pra
não arriscar errar uma cláusula ou uma condição legal. Só troca os valores
de exemplo do modelo (nome, CPF, valor, lote, data...) pelos dados reais da
proposta. Pedido em 28/09.
"""

import copy
import io
import re
from datetime import date
from pathlib import Path
from typing import Optional

import docx
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

# Reaproveita o mapa de rótulos e o parser de data "livre" (aceita
# 'AAAA-MM-DD' do input do navegador ou texto solto) já usados no PDF da
# proposta completa (gerar_proposta_pdf) -- mesma fonte de dados
# (dados_qualificacao), sem duplicar a lógica.
from .cadastro_proposta import tem_conjuge
from .pdf import ESTADO_CIVIL_LABEL, _fmt_data_livre
from .plano_pagamento import (  # noqa: F401 -- normalizar_valor_br reexportado
    MEIOS_PAGAMENTO,
    dividir_em_parcelas,
    fmt_data,
    ler_plano,
    valores_contrato,
    normalizar_valor_br,
)

from .texto_seguro import limpar_nome

_TEMPLATES_DIR = Path(__file__).parent / "templates" / "contratos"


def _nome_comprador(proponente: dict, cliente: dict) -> str:
    """Nome do comprador para o contrato: o da qualificação, limpo (letra
    estilizada, espaço invisível, espaços sobrando -- ver texto_seguro); se
    ficar vazio, o do cadastro do cliente. Nunca sai em branco (29/10)."""
    return limpar_nome((proponente or {}).get("nome")) or limpar_nome((cliente or {}).get("nome")) or "-"

_MESES = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]

_UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"]
_DEZ_A_DEZENOVE = [
    "dez", "onze", "doze", "treze", "quatorze", "quinze",
    "dezesseis", "dezessete", "dezoito", "dezenove",
]
_DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
_CENTENAS = [
    "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
    "seiscentos", "setecentos", "oitocentos", "novecentos",
]


def _grupo_extenso(n: int) -> str:
    """0-999 -> texto, sem nome de escala (mil/milhão/etc). n==0 -> ''."""
    if n == 0:
        return ""
    centena, resto = divmod(n, 100)
    partes = []
    if centena:
        partes.append("cem" if n == 100 else _CENTENAS[centena])
    if resto:
        if resto < 10:
            partes.append(_UNIDADES[resto])
        elif resto < 20:
            partes.append(_DEZ_A_DEZENOVE[resto - 10])
        else:
            dezena, unidade = divmod(resto, 10)
            partes.append(_DEZENAS[dezena] + (f" e {_UNIDADES[unidade]}" if unidade else ""))
    return " e ".join(partes)


def _numero_extenso(n: int) -> str:
    """Número inteiro (>=0) por extenso, sempre no masculino -- "real(is)" e
    "centavo(s)" nunca pedem forma feminina, então não precisa tratar gênero.
    Grupos de milhar unidos só por espaço (sem vírgula nem "e" entre grupos)
    -- é a mesma convenção já usada nos modelos de recibo/contrato da
    imobiliária (ex.: "sessenta e nove mil novecentos e noventa reais", sem
    vírgula antes de "novecentos" -- ver CONTRATO_PORTO_FRANCO.docx, item VI)."""
    if n == 0:
        return "zero"
    escalas = [(10**9, "bilhão", "bilhões"), (10**6, "milhão", "milhões"), (10**3, "mil", "mil")]
    partes = []
    resto = n
    for valor_escala, singular, plural in escalas:
        grupo, resto = divmod(resto, valor_escala)
        if not grupo:
            continue
        if valor_escala == 10**3 and grupo == 1:
            partes.append("mil")  # "mil", nunca "um mil"
        else:
            partes.append(f"{_grupo_extenso(grupo)} {singular if grupo == 1 else plural}")
    if resto:
        partes.append(_grupo_extenso(resto))
    return " ".join(p for p in partes if p)


def _numero_extenso_feminino(n: int) -> str:
    """Contagem de parcelas ("duas parcelas", "uma parcela", "duzentas
    parcelas") -- mesmo extenso, só que concordando com o substantivo
    feminino."""
    texto = _numero_extenso(n)
    for masc, fem in (("um", "uma"), ("dois", "duas"), ("duzentos", "duzentas"), ("trezentos", "trezentas"),
                      ("quatrocentos", "quatrocentas"), ("quinhentos", "quinhentas"), ("seiscentos", "seiscentas"),
                      ("setecentos", "setecentas"), ("oitocentos", "oitocentas"), ("novecentos", "novecentas")):
        texto = re.sub(rf"\b{masc}\b(?! (mil|milhão|milhões|bilhão|bilhões)\b)", fem, texto)
    return texto


def _talvez_de(n: int) -> str:
    """"um milhão DE reais", "dois milhões DE reais" -- mas "um milhão e
    trezentos mil reais" (sem "de") quando sobra algo abaixo do milhão. Regra
    do português formal: só entra "de" quando o número é um milhão/bilhão
    "redondo" (múltiplo exato de 10**6), sem resto nenhum abaixo dele."""
    return " de" if n >= 10**6 and n % 10**6 == 0 else ""


def valor_por_extenso(valor: float) -> str:
    """999.0 -> 'novecentos e noventa e nove reais'; 1999.9 -> 'mil
    novecentos e noventa e nove reais e noventa centavos'; 1000000.0 -> 'um
    milhão de reais'."""
    centavos_totais = round(valor * 100)
    reais, centavos = divmod(centavos_totais, 100)
    partes = []
    if reais > 0:
        partes.append(f"{_numero_extenso(reais)}{_talvez_de(reais)} {'real' if reais == 1 else 'reais'}")
    if centavos > 0:
        partes.append(f"{_numero_extenso(centavos)} {'centavo' if centavos == 1 else 'centavos'}")
    return " e ".join(partes) if partes else "zero reais"


def formatar_valor(valor: float) -> str:
    """1999.9 -> '1.999,90' (sem "R$" -- os modelos já têm o "R$" fixo no texto)."""
    s = f"{valor:,.2f}"
    return s.replace(",", "_").replace(".", ",").replace("_", ".")


def modelo_documentos(condominio_nome: str) -> Optional[str]:
    """Qual modelo de CONTRATO serve pro empreendimento. Porto Franco e
    Rancho Texas desde o início; Riviera e Veneza com os modelos enviados em
    29/10. Os outros empreendimentos novos (Boulevard, Praia Mar, Rota dos
    Ventos) ainda não têm: antes caíam no do Porto Franco por engano (o
    padrão era "se não é Rancho, é Porto Franco"), o que imprimiria a SPE
    errada."""
    nome = (condominio_nome or "").lower()
    if "rancho" in nome:
        return "rancho_texas"
    if "porto franco" in nome:
        return "porto_franco"
    if "riviera" in nome:
        return "riviera"
    if "veneza" in nome:
        return "veneza"
    return None


def modelo_recibo(condominio_nome: str) -> Optional[str]:
    """Modelo de RECIBO: só Porto Franco e Rancho Texas têm (Riviera e
    Veneza mandaram só o contrato)."""
    slug = modelo_documentos(condominio_nome)
    return slug if slug in ("rancho_texas", "porto_franco") else None


def _empreendimento_slug(condominio_nome: str) -> str:
    slug = modelo_recibo(condominio_nome)
    if slug is None:
        raise ValueError(f"Empreendimento sem modelo de recibo cadastrado: {condominio_nome!r}")
    return slug


def preencher_recibo(
    *,
    condominio_nome: str,
    cliente_nome: str,
    cliente_cpf: str,
    valor: float,
    lote_quadra: Optional[str],
    lote_numero: str,
    data: Optional[date] = None,
) -> tuple[bytes, str]:
    """Preenche o modelo de recibo (Porto Franco ou Rancho Texas, conforme o
    empreendimento do lote) com os dados reais e devolve (bytes do .docx
    pronto, slug do empreendimento usado). Mantém a redação exata do modelo
    -- só troca os valores de exemplo (nome, CPF, valor, lote, data) pelos
    reais. Os índices de run abaixo foram conferidos direto no XML dos dois
    modelos (ver conversa de 28/09) -- se algum dia o modelo for reeditado no
    Word, esses índices podem mudar e essa função precisa ser conferida de
    novo."""
    data = data or date.today()
    slug = _empreendimento_slug(condominio_nome)
    caminho = _TEMPLATES_DIR / f"recibo_{slug}.docx"
    doc = docx.Document(str(caminho))

    valor_fmt = formatar_valor(valor)
    extenso = valor_por_extenso(valor)
    dia = f"{data.day:02d}"
    mes = _MESES[data.month - 1]
    ano = str(data.year)

    paragrafos = doc.paragraphs

    if slug == "porto_franco":
        corpo = paragrafos[5].runs
        corpo[6].text = valor_fmt
        # run 8 é só "(" + por extenso (sem "reais" -- essa palavra já vem
        # fixa no run 9 "reais) do" no modelo original); só que o extenso já
        # inclui "reais"/"centavos" (pra poder valer sozinho em outros
        # lugares), então aqui o "reais)" fixo do modelo tem que sumir do
        # run 9, senão duplica "reais" quando o valor tem centavos.
        corpo[8].text = f"({extenso}"
        corpo[9].text = ") do"
        corpo[10].text = " Sr(a). "
        corpo[11].text = limpar_nome(cliente_nome) or "-"
        corpo[12].text = ", inscrito(a) no"
        # tab esquisito do modelo original antes de "CPF N°" -- vira espaço
        # normal, sem mudar o texto/sentido.
        corpo[13].text = " CPF N°"
        corpo[15].text = f"{formatar_cpf_cnpj(cliente_cpf)}, referente"
        corpo[18].text = f"{lote_numero} "
        corpo[21].text = f"{lote_quadra or '-'}."

        data_runs = paragrafos[11].runs
        data_runs[1].text = dia
        data_runs[5].text = mes.capitalize()
        data_runs[6].text = f" de {ano}"
    else:
        corpo = paragrafos[5].runs
        corpo[15].text = f"{valor_fmt} "
        corpo[17].text = extenso  # mesmo motivo do Porto Franco: sem espaço, o ")" do run 18 já vem colado
        corpo[19].text = " do(a) SR(A). "
        corpo[20].text = limpar_nome(cliente_nome) or "-"
        corpo[21].text = f", inscrito(a) no CPF N° {formatar_cpf_cnpj(cliente_cpf)}"
        corpo[24].text = lote_numero

        data_runs = paragrafos[11].runs
        data_runs[1].text = dia
        data_runs[5].text = mes
        data_runs[7].text = f"de {ano}"

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue(), slug


def _para_float(texto: Optional[str]) -> Optional[float]:
    """Mesma tolerância de formato do validador de FormaPagamentoDados
    (schemas.py::_parse_valor_monetario) -- "5000", "5000.00", "5000,00" ou
    "R$ 5.000,00" -- só que devolvendo o float de verdade (o validador
    devolve o texto original, só validado; aqui precisamos calcular e
    formatar o valor pro contrato)."""
    if not texto:
        return None
    try:
        return float(normalizar_valor_br(str(texto)))
    except ValueError:
        return None


def formatar_cpf_cnpj(valor: Optional[str]) -> str:
    """Só formata quando vier só dígitos com o tamanho certo (11 = CPF,
    14 = CNPJ); qualquer outra coisa volta como veio, sem inventar."""
    if not valor:
        return "-"
    digitos = re.sub(r"\D", "", str(valor))
    if len(digitos) == 11:
        return f"{digitos[:3]}.{digitos[3:6]}.{digitos[6:9]}-{digitos[9:]}"
    if len(digitos) == 14:
        return f"{digitos[:2]}.{digitos[2:5]}.{digitos[5:8]}/{digitos[8:12]}-{digitos[12:]}"
    return str(valor).strip()


def formatar_cep(valor: Optional[str]) -> str:
    if not valor:
        return "-"
    digitos = re.sub(r"\D", "", str(valor))
    return f"{digitos[:5]}-{digitos[5:]}" if len(digitos) == 8 else str(valor).strip()


def _identidade(proponente: dict) -> str:
    rg, orgao = proponente.get("rg"), proponente.get("orgao_expedidor")
    if rg and orgao:
        return f"{rg} {orgao}"
    return rg or "-"


def _endereco_completo(endereco: dict) -> str:
    """'Rua X, nº 123 - complemento' -- o `_endereco_linha1` do pdf.py não
    inclui o número (o modelo em papel tem outro campo pra isso; aqui, no
    contrato, é tudo uma linha só: "ENDEREÇO RESIDENCIAL")."""
    rua = endereco.get("rua")
    numero = endereco.get("numero")
    complemento = endereco.get("complemento")
    partes = [rua]
    if numero:
        partes.append(f"nº {numero}")
    linha = ", ".join(p for p in partes if p)
    if complemento:
        linha = f"{linha} - {complemento}" if linha else complemento
    return linha or "-"



def formatar_numero_contrato(numero) -> Optional[str]:
    """91 -> "0091". None quando a proposta ainda não teve contrato emitido."""
    try:
        n = int(numero)
    except (TypeError, ValueError):
        return None
    return f"{n:04d}" if n > 0 else None


def identificacao_contrato(proposta: dict, data_contrato: Optional[date] = None) -> tuple[Optional[str], int]:
    """Número e versão do contrato.

    - Número (09/10): sequência própria dos contratos, começando no 91 --
      dado na 1ª emissão (banco: atribuir_numero_contrato, migration 0027)
      e gravado em propostas.numero_contrato. Reemitir mantém o número.
      Formato "0091", sem ano.
    - Versão: a versão da proposta. Toda correção de dados (financeiro ou
      corretor) sobe a versão da proposta, então um contrato "Versão 2" é o
      emitido depois da 1ª correção -- dá pra saber, só de olhar o papel, se
      aquela via é a vigente."""
    return formatar_numero_contrato(proposta.get("numero_contrato")), int(proposta.get("versao") or 1)


def titulo_contrato(proposta: dict, data_contrato: Optional[date] = None) -> str:
    numero, versao = identificacao_contrato(proposta, data_contrato)
    if not numero:
        # nunca emitir contrato sem número -- o endpoint numera antes de preencher
        raise ValueError("Contrato sem número: a numeração tem que ser atribuída antes de preencher o modelo.")
    return f"CONTRATO Nº {numero} – VERSÃO {versao}"

def _demais_texto(fp: dict) -> str:
    """Quando a 1ª parcela foi paga numa data fora do dia de vencimento
    (30/10: 1ª em 29/10 e as demais todo dia 15 a partir de 15/12), o campo
    opcional `demais_a_partir` (AAAA-MM-DD) diz de onde seguem as demais.
    Sem ele, o texto de sempre."""
    v = (fp or {}).get("demais_a_partir")
    try:
        d = date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        d = None
    if not d:
        return "e as demais no mesmo dia dos meses subsequentes"
    return f"e as demais todo dia {d.day}, a partir de {d.strftime('%d/%m/%Y')}"


def _textos_pagamento(fp: dict, lote: dict, valor_total: float) -> dict:
    """Textos da forma de pagamento pros dois contratos, montados a partir
    do plano da proposta (app/plano_pagamento.py). Proposta antiga (sem o
    plano estruturado do formulário de 02/10) continua caindo pros valores
    de tabela do lote, como antes."""
    plano = ler_plano(fp)
    out: dict = {"a_vista": bool(plano.a_vista)}

    def brl(v: float) -> str:
        return f"R$ {formatar_valor(v)} ({valor_por_extenso(v)})"

    if plano.a_vista:
        meio = MEIOS_PAGAMENTO.get(plano.avista_meio or "")
        out["entrada"] = brl(valor_total)
        compl = ", correspondente ao pagamento à vista do preço"
        if meio:
            compl += f", via {meio}"
        if plano.avista_data:
            compl += f", em {fmt_data(plano.avista_data)}"
        out["entrada_compl_pf"] = out["entrada_compl_rt"] = compl
        out["parcelas"] = None
        out["chave_valor"] = 0.0
        return out

    v = valores_contrato(fp, lote)  # mesmos números que conferir_contrato confere
    entrada = v.entrada
    out["entrada"] = brl(entrada) if entrada else None
    compl_pf = compl_rt = ""
    if plano.estruturado and entrada:
        meio = MEIOS_PAGAMENTO.get(plano.entrada_meio or "", "")
        data_txt = fmt_data(plano.entrada_data)
        if plano.entrada_forma == "parcelada" and plano.entrada_parcelas > 1:
            n = plano.entrada_parcelas
            valores = dividir_em_parcelas(entrada, n)
            if len(set(valores)) == 1:
                parcelas_txt = f"{n} ({_numero_extenso_feminino(n)}) parcelas mensais de {brl(valores[0])} cada"
            else:
                k = valores.count(valores[0])
                parcelas_txt = (f"{n} ({_numero_extenso_feminino(n)}) parcelas mensais, {k} ({_numero_extenso_feminino(k)}) "
                                f"de {brl(valores[0])} e {n - k} ({_numero_extenso_feminino(n - k)}) de {brl(valores[-1])}")
            compl_pf = (f", paga em {parcelas_txt}, via {meio}, vencendo a primeira em {data_txt} "
                        f"{_demais_texto(fp)}")
            compl_rt = (f" sendo pago em {parcelas_txt}, via {meio}, a primeira para o dia {data_txt} "
                        f"{_demais_texto(fp)}")
        else:
            compl_pf = f", paga via {meio} em {data_txt}"
            compl_rt = f" sendo pago via {meio} para o dia {data_txt}"
    out["entrada_compl_pf"], out["entrada_compl_rt"] = compl_pf, compl_rt

    qtd = v.parcelas
    vparc = v.parcela_valor
    if qtd and vparc:
        primeira = fmt_data(v.primeira_parcela) if v.primeira_parcela else (v.primeira_parcela_texto or None)
        dia = plano.dia_vencimento
        out["parcelas"] = {"qtd": int(qtd), "valor": vparc, "primeira": primeira, "dia": dia,
                           "demais": _demais_texto(fp)}
    else:
        out["parcelas"] = None
    out["chave_valor"] = v.chave
    return out


def _substituir_texto(paragrafo, velho: str, novo: str) -> None:
    """Troca um trecho de texto dentro de um parágrafo, mesmo que o Word
    tenha fragmentado esse trecho em vários <w:r> -- muito comum em
    documento com correção ortográfica ligada, onde cada letra acentuada às
    vezes vira um run só dela (ver contrato do Porto Franco: "COMISSÃO" virou
    'COMISS' + 'Ã' + 'O...'). O jeito usado no recibo (mexer em runs[i].text
    direto, por índice) só funciona pra parágrafo curto e sem essa
    fragmentação -- não dava pra confiar nisso pra um contrato de 5-6
    páginas. Acha `velho` inteiro no texto concatenado do parágrafo, escreve
    `novo` no primeiro run que sobrepõe o trecho e esvazia o resto dos runs
    sobrepostos, preservando o texto de fora do trecho em cada ponta.
    Lança ValueError se não achar -- silêncio aqui seria pior: um campo do
    contrato ficando sem preencher sem ninguém notar."""
    runs = paragrafo.runs
    texto_completo = "".join(r.text for r in runs)
    inicio = texto_completo.find(velho)
    if inicio == -1:
        raise ValueError(f"Texto não encontrado no modelo do contrato: {velho!r}")
    fim = inicio + len(velho)

    pos = 0
    novo_aplicado = False
    for r in runs:
        r_inicio, r_fim = pos, pos + len(r.text)
        if r_fim <= inicio or r_inicio >= fim:
            pos = r_fim
            continue
        antes = r.text[: max(0, inicio - r_inicio)]
        depois = r.text[max(0, fim - r_inicio):] if r_fim > fim else ""
        r.text = (antes + novo + depois) if not novo_aplicado else (antes + depois)
        novo_aplicado = True
        pos = r_fim


def _todas_tabelas(container):
    """Todas as tabelas do documento, inclusive as que estão dentro de
    células (o QUADRO RESUMO é uma tabela grande com tabelas dentro)."""
    for t in container.tables:
        yield t
        for row in t.rows:
            for cell in row.cells:
                yield from _todas_tabelas(cell)


def _escrever_celula(celula, texto: str, rpr_modelo=None) -> None:
    """Escreve `texto` na célula com a formatação `rpr_modelo` (a do "100%"
    que o modelo já traz -- célula vazia do Word não tem fonte própria e o
    texto saía em outra fonte/negrito) e apaga o resto."""
    paragrafos = celula.paragraphs
    primeiro = paragrafos[0]
    runs = primeiro.runs
    if not runs:
        if not texto:
            return
        primeiro.add_run("")
        runs = primeiro.runs
    run = runs[0]
    run.text = texto
    if rpr_modelo is not None:
        if run._r.rPr is not None:
            run._r.remove(run._r.rPr)
        run._r.insert(0, copy.deepcopy(rpr_modelo))
    for r in runs[1:]:
        r.text = ""
    for p in paragrafos[1:]:
        for r in p.runs:
            r.text = ""


def _celulas_unicas(row) -> list:
    """Células de uma linha sem repetir as mescladas (python-docx devolve a
    mesma célula várias vezes quando ela ocupa mais de uma coluna)."""
    vistas, out = set(), []
    for c in row.cells:
        if id(c._tc) not in vistas:
            vistas.add(id(c._tc))
            out.append(c)
    return out


def preencher_proporcao(doc, compradores: list[tuple[str, str]], obrigatoria: bool = True) -> None:
    """IX. PROPORÇÃO DA AQUISIÇÃO IMOBILIÁRIA (pedido de 09/10): o modelo
    traz a tabela "Nome (s) | (%)" com "100%" e o nome em branco. Só o
    comprador -> ele com 100%; com cônjuge marcado no formulário -> 50% cada.
    Só escreve nas células da tabela, o texto do contrato não muda. Lança
    ValueError se não achar a tabela (melhor travar do que sair sem)."""
    alvo = None
    for t in _todas_tabelas(doc):
        if not t.rows:
            continue
        cab = [c.text.strip() for c in _celulas_unicas(t.rows[0])]
        if len(cab) >= 2 and cab[0].lower().startswith("nome") and "%" in cab[-1]:
            alvo = t
            break
    if alvo is None:
        if not obrigatoria:
            return
        raise ValueError("Tabela da proporção da aquisição (Nome (s) / (%)) não encontrada no modelo.")
    linhas = alvo.rows[1:]
    if len(linhas) < len(compradores):
        raise ValueError("A tabela da proporção da aquisição tem menos linhas que compradores.")
    # Formatação de referência: o primeiro texto já impresso nas linhas de
    # dados (o "100%" do modelo); sem ele, a do cabeçalho.
    rpr_modelo = None
    for row in [*linhas, alvo.rows[0]]:
        for c in _celulas_unicas(row):
            for par in c.paragraphs:
                for r in par.runs:
                    if r.text.strip() and r._r.rPr is not None:
                        rpr_modelo = r._r.rPr
                        break
                if rpr_modelo is not None:
                    break
            if rpr_modelo is not None:
                break
        if rpr_modelo is not None:
            break
    rpr_modelo = copy.deepcopy(rpr_modelo) if rpr_modelo is not None else None
    for i, row in enumerate(linhas):
        celulas = _celulas_unicas(row)
        nome, perc = compradores[i] if i < len(compradores) else ("", "")
        _escrever_celula(celulas[0], nome, rpr_modelo)
        _escrever_celula(celulas[-1], perc, rpr_modelo)


def compradores_proporcao(nome_comprador: str, dq: dict, so_resposta_direta: bool = True) -> list[tuple[str, str]]:
    """Quem entra no item IX: o comprador sozinho (100%) ou comprador e
    cônjuge/companheiro(a) (50% cada) -- cônjuge só conta se o corretor
    marcou "tem cônjuge" no formulário e informou o nome. Proposta antiga,
    sem essa resposta, fica 100% do comprador (`so_resposta_direta`); o
    Rancho Texas passa False pra seguir o mesmo critério da COMPRADORA."""
    dq = dq or {}
    conjuge = dq.get("conjuge") or {}
    nome_conjuge = limpar_nome(conjuge.get("nome"))
    marcou = dq.get("tem_conjuge") is True if so_resposta_direta else tem_conjuge(dq)
    if marcou and nome_conjuge:
        return [(nome_comprador, "50%"), (nome_conjuge, "50%")]
    return [(nome_comprador, "100%")]


def _escrever_confrontacoes(celula, p_referencia, linhas: list[str]) -> None:
    """Escreve as linhas do memorial descritivo (áreas + frente/fundo/
    laterais) nos parágrafos em branco logo abaixo do texto do item V do
    Porto Franco -- uma linha por parágrafo, na fonte normal do texto do
    item V. O modelo traz 2 parágrafos vazios ali; se precisar de mais,
    cria cópias do primeiro (mesmo espaçamento/recuo)."""
    paragrafos = celula.paragraphs
    idx = next(i for i, p in enumerate(paragrafos) if p._p is p_referencia._p)
    vazios = [p for p in paragrafos[idx + 1:] if not p.text.strip()]
    if not vazios:
        raise ValueError("Modelo do Porto Franco sem espaço para as confrontações no item V.")
    base = vazios[0]
    # fonte do texto corrido do item V (1º run, sem negrito)
    rpr = None
    for r in p_referencia.runs:
        if r._r.rPr is not None and not r.bold:
            rpr = r._r.rPr
            break
    alvo = base
    for i, texto in enumerate(linhas):
        if i > 0:
            novo = copy.deepcopy(base._p)
            for r in novo.findall(qn("w:r")):
                novo.remove(r)
            alvo._p.addnext(novo)
            alvo = Paragraph(novo, base._parent)
        for r in list(alvo.runs):
            r._r.getparent().remove(r._r)
        run = alvo.add_run(texto)
        if rpr is not None:
            run._r.insert(0, copy.deepcopy(rpr))
            run.bold = False


def preencher_contrato_porto_franco(
    *,
    proposta: dict,
    lote: dict,
    cliente: dict,
    corretor: Optional[dict],
    valor_comissao: float,
    data_contrato: Optional[date] = None,
    memorial: Optional[dict] = None,
) -> bytes:
    """Preenche o modelo real do contrato do Porto Franco (alienação
    fiduciária) com os dados da proposta, do lote e da qualificação do
    comprador -- mantendo a redação jurídica exata do modelo, só trocando os
    campos em branco do QUADRO RESUMO e a cláusula de comissão. Os dados de
    qualificação (nome completo, RG, nacionalidade, profissão, estado civil,
    endereço) vêm de `proposta['dados_qualificacao']` -- o mesmo formulário
    já usado no PDF da "Proposta de Compra/Venda" (ver pdf.py). Campo sem
    dado disponível em lugar nenhum do sistema (ex.: "LOCAL" de nascimento,
    que não existe na qualificação) fica em branco de propósito, pronto pra
    alguém completar à mão antes da assinatura. Pedido em 28/09."""
    data_contrato = data_contrato or date.today()
    dq = proposta.get("dados_qualificacao") or {}
    proponente = dq.get("proponente") or {}
    endereco = dq.get("endereco_residencial") or {}
    fp = dq.get("forma_pagamento") or {}
    estado_civil = dq.get("estado_civil")

    doc = docx.Document(str(_TEMPLATES_DIR / "contrato_porto_franco.docx"))
    t = doc.tables[0]

    # --- III. COMPRADOR (QUADRO RESUMO) ----------------------------------
    conjuge = dq.get("conjuge") or {}
    nome_c = limpar_nome(conjuge.get("nome"))
    com_conjuge = bool(tem_conjuge(dq) and nome_c)
    celula_iii = t.rows[4].cells[0]
    p = celula_iii.paragraphs
    if com_conjuge:
        # Cônjuge (pedido de 30/10): clona o bloco "A – COMPRADOR" (NOME..CEP)
        # logo abaixo dele, como bloco B. Só quando a proposta tem cônjuge --
        # sem cônjuge o contrato sai idêntico ao modelo.
        ref = p[14]._p
        for par in p[1:15]:
            novo = copy.deepcopy(par._p)
            ref.addnext(novo)
            ref = novo
    nome = _nome_comprador(proponente, cliente)
    cpf = formatar_cpf_cnpj(proponente.get("cpf_cnpj") or cliente.get("cpf"))
    _substituir_texto(p[2], "NOME: ", f"NOME: {nome}")
    _substituir_texto(p[3], "NACIONALIDADE: ", f"NACIONALIDADE: {proponente.get('nacionalidade') or '-'}")
    _substituir_texto(p[4], "PROFISSÃO: ", f"PROFISSÃO: {proponente.get('profissao') or '-'}")
    _substituir_texto(
        p[5], "DATA DE NASCIMENTO: ", f"DATA DE NASCIMENTO: {_fmt_data_livre(proponente.get('data_nascimento'))}"
    )
    # "LOCAL" = naturalidade (cidade/UF de nascimento) -- coletada no
    # formulário desde 03/10; proposta antiga sem ela deixa em branco.
    if (proponente.get("naturalidade") or "").strip():
        _substituir_texto(p[6], "LOCAL: ", f"LOCAL: {proponente['naturalidade'].strip()}")
    _substituir_texto(p[7], "CPF: ", f"CPF: {cpf}")
    _substituir_texto(p[8], "IDENTIDADE: ", f"IDENTIDADE: {_identidade(proponente)}")
    _substituir_texto(p[9], "ESTADO CIVIL: ", f"ESTADO CIVIL: {ESTADO_CIVIL_LABEL.get(estado_civil, '-')}")
    _substituir_texto(
        p[10], "ENDEREÇO RESIDENCIAL: ", f"ENDEREÇO RESIDENCIAL: {_endereco_completo(endereco)}"
    )
    _substituir_texto(p[11], "BAIRRO: ", f"BAIRRO: {endereco.get('bairro') or '-'}")
    _substituir_texto(p[12], " MUNICÍPIO: ", f" MUNICÍPIO: {endereco.get('cidade') or '-'}")
    _substituir_texto(p[13], " UF: ", f" UF: {endereco.get('estado') or '-'}")
    _substituir_texto(p[14], "CEP: ", f"CEP: {formatar_cep(endereco.get('cep'))}")

    if com_conjuge:
        q = celula_iii.paragraphs[15:29]
        cpf_c = formatar_cpf_cnpj(conjuge.get("cpf_cnpj"))
        _substituir_texto(q[0], "A – COMPRADOR: ", "B – CÔNJUGE: ")
        _substituir_texto(q[1], "NOME: ", f"NOME: {nome_c}")
        _substituir_texto(q[2], "NACIONALIDADE: ", f"NACIONALIDADE: {conjuge.get('nacionalidade') or '-'}")
        _substituir_texto(q[3], "PROFISSÃO: ", f"PROFISSÃO: {conjuge.get('profissao') or '-'}")
        _substituir_texto(
            q[4], "DATA DE NASCIMENTO: ", f"DATA DE NASCIMENTO: {_fmt_data_livre(conjuge.get('data_nascimento'))}"
        )
        if (conjuge.get("naturalidade") or "").strip():
            _substituir_texto(q[5], "LOCAL: ", f"LOCAL: {conjuge['naturalidade'].strip()}")
        _substituir_texto(q[6], "CPF: ", f"CPF: {cpf_c}")
        _substituir_texto(q[7], "IDENTIDADE: ", f"IDENTIDADE: {_identidade(conjuge)}")
        _substituir_texto(q[8], "ESTADO CIVIL: ", f"ESTADO CIVIL: {ESTADO_CIVIL_LABEL.get(estado_civil, '-')}")
        _substituir_texto(
            q[9], "ENDEREÇO RESIDENCIAL: ", f"ENDEREÇO RESIDENCIAL: {_endereco_completo(endereco)}"
        )
        _substituir_texto(q[10], "BAIRRO: ", f"BAIRRO: {endereco.get('bairro') or '-'}")
        _substituir_texto(q[11], " MUNICÍPIO: ", f" MUNICÍPIO: {endereco.get('cidade') or '-'}")
        _substituir_texto(q[12], " UF: ", f" UF: {endereco.get('estado') or '-'}")
        _substituir_texto(q[13], "CEP: ", f"CEP: {formatar_cep(endereco.get('cep'))}")

    # --- V. OBJETIVO (lote, quadra, área + confrontações do memorial) ------
    # Pedido de 09/10: área e confrontações exatamente como no MEMORIAL
    # DESCRITIVO do condomínio (tabela lotes_memorial, migration 0028) --
    # a área total do contrato é a área privativa do memorial.
    p_objetivo = t.rows[7].cells[0].paragraphs[1]
    area_total = (memorial or {}).get("area_privativa") or lote.get("tamanho_m2") or 0
    area_fmt = formatar_valor(float(area_total))
    _substituir_texto(
        p_objetivo,
        "LOTE N°  QUADRA N° , com área total de 200,00 m²",
        f"LOTE N° {lote.get('lote_numero', '-')} QUADRA N° {lote.get('quadra', '-')}, "
        f"com área total de {area_fmt} m²",
    )
    if memorial:
        _escrever_confrontacoes(
            t.rows[7].cells[0], p_objetivo, [memorial["area_texto"], *memorial["confrontacoes"]]
        )

    # --- VI. PREÇO --------------------------------------------------------
    valor_total = proposta.get("valor_proposto") or lote.get("valor_total") or 0.0
    p_preco = t.rows[9].cells[0].paragraphs[1]
    _substituir_texto(
        p_preco,
        "R$ 69.990,00 (Sessenta e nove mil novecentos e noventa reais)",
        f"R$ {formatar_valor(valor_total)} ({valor_por_extenso(valor_total)})",
    )

    # --- VII. FORMA DE PAGAMENTO -------------------------------------------
    # Textos vêm do plano da proposta (entrada com forma/meio/data, parcelas
    # com a data da 1ª, chave) -- só preenchem os rótulos em branco do
    # modelo, o texto jurídico em volta não muda.
    pp = t.rows[11].cells[0].paragraphs
    tp = _textos_pagamento(fp, lote, valor_total)
    if tp["entrada"]:
        _substituir_texto(
            pp[3],
            "Entrada / Arras confirmatórias: ",
            f"Entrada / Arras confirmatórias: {tp['entrada']}{tp['entrada_compl_pf']}.",
        )
    if tp["a_vista"]:
        _substituir_texto(pp[5], "Parcelas mensais", "Parcelas mensais: não há (pagamento à vista).")
    elif tp["parcelas"]:
        pc = tp["parcelas"]
        texto_parcelas = (
            f"{pc['qtd']} ({_numero_extenso_feminino(pc['qtd'])}) parcelas mensais e sucessivas de "
            f"R$ {formatar_valor(pc['valor'])} ({valor_por_extenso(pc['valor'])}) cada"
        )
        if pc["primeira"] or pc["dia"]:
            texto_parcelas += (
                f", vencendo a primeira em {pc['primeira'] or '-'} "
                f"{pc['demais']}"
            )
        _substituir_texto(pp[5], "Parcelas mensais", f"Parcelas mensais: {texto_parcelas}.")

    if tp["a_vista"] or tp["chave_valor"] == 0:
        _substituir_texto(pp[7], "Chave: ", "Chave: não há" + (" (pagamento à vista)." if tp["a_vista"] else "."))
    elif tp["chave_valor"]:
        # Sem data (09/10): a entrega das chaves não tem dia certo -- uma
        # data impressa aqui ficava errada quando a obra mudava de prazo (ou
        # saía a data de hoje por engano). Data antiga gravada é ignorada.
        chave = tp["chave_valor"]
        _substituir_texto(
            pp[7],
            "Chave: ",
            f"Chave: R$ {formatar_valor(chave)} ({valor_por_extenso(chave)}), a ser paga na entrega das chaves.",
        )

    # --- IX. PROPORÇÃO DA AQUISIÇÃO -----------------------------------------
    preencher_proporcao(doc, compradores_proporcao(nome, dq))

    # DA COMISSÃO DE CORRETAGEM -- corretor responsável pela venda,
    # qualificado com os dados do próprio cadastro dele (ver
    # PainelCorretores.tsx: CRECI, CPF/CNPJ e dados bancários, adicionados
    # justamente pra preencher essa cláusula sozinhos).
    corretor = corretor or {}
    qualificacao_corretor = corretor.get("nome") or "-"
    if corretor.get("cpf_cnpj"):
        qualificacao_corretor += f", CPF/CNPJ {formatar_cpf_cnpj(corretor['cpf_cnpj'])}"
    if corretor.get("creci"):
        qualificacao_corretor += f", CRECI {corretor['creci']}"
    if corretor.get("banco") and corretor.get("agencia") and corretor.get("conta"):
        qualificacao_corretor += (
            f", dados bancários: {corretor['banco']}, Ag. {corretor['agencia']}, C/C {corretor['conta']}"
        )
    _substituir_texto(
        pp[17],
        "fixada em R$  (), a ser paga diretamente ao CORRETOR/IMOBILIÁRIA "
        "[QUALIFICAR: nome/razão social, CPF/CNPJ, CRECI e dados bancários], "
        "mediante transferência bancária ou PIX para conta por este indicada",
        f"fixada em R$ {formatar_valor(valor_comissao)} ({valor_por_extenso(valor_comissao)}), "
        f"a ser paga diretamente ao CORRETOR/IMOBILIÁRIA {qualificacao_corretor}, "
        "mediante transferência bancária ou PIX para conta por este indicada",
    )

    # --- XII. LOCAL E DATA DE CELEBRAÇÃO -----------------------------------
    p_data = t.rows[19].cells[0].paragraphs[1]
    _substituir_texto(
        p_data,
        "neste dia 11 de Abril de 2026.",
        f"neste dia {data_contrato.day} de {_MESES[data_contrato.month - 1].capitalize()} de {data_contrato.year}.",
    )

    # --- Título (número do contrato) ---------------------------------------
    _substituir_texto(
        doc.paragraphs[0],
        "CONTRATO Nº  0/2026",
        titulo_contrato(proposta, data_contrato),
    )

    # --- Assinatura: CPF do comprador ---------------------------------------
    # Único "CPF: " isolado fora da tabela do QUADRO RESUMO -- confirmado
    # direto no índice de parágrafos do modelo (ver conversa de 28/09); se o
    # modelo for reeditado no Word essa posição pode mudar.
    _substituir_texto(doc.paragraphs[314], "CPF: ", f"CPF: {cpf}")
    # Nome do comprador acima do CPF -- o modelo trazia só "CPF:" nesse
    # bloco (os da VENDEDORA têm nome), e o contrato saía sem dizer quem
    # assina (achado em 02/10). O parágrafo 313 é a linha vazia entre o traço
    # e o CPF; copia a formatação (negrito/fonte) do run do CPF.
    p_nome = doc.paragraphs[313]
    p_nome.alignment = doc.paragraphs[314].alignment
    run_nome = p_nome.add_run(nome)
    # mesma formatação (fonte do tema, negrito, tamanho) do "CPF:" logo
    # abaixo -- copia o rPr inteiro; copiar só font.name perdia a fonte de
    # tema (Calibri) e o nome saía em Arial.
    rpr_modelo = doc.paragraphs[314].runs[0]._r.rPr
    if rpr_modelo is not None:
        run_nome._r.insert(0, copy.deepcopy(rpr_modelo))

    # --- Assinatura do cônjuge (pedido de 30/10) ---------------------------
    # Duplica o bloco traço/nome/CPF/"COMPRADOR" (parágrafos 312-315) logo
    # abaixo. Por último, pois a inserção desloca os índices dos parágrafos.
    if com_conjuge:
        pars = doc.paragraphs
        ref = pars[315]._p
        for par in (pars[311], *pars[312:316]):
            novo = copy.deepcopy(par._p)
            ref.addnext(novo)
            ref = novo
        pars = doc.paragraphs
        # blocos: 311 (vazio) 312 traço, 313 nome, 314 CPF, 315 COMPRADOR,
        # depois a cópia: 316 vazio, 317 traço, 318 nome, 319 CPF, 320 COMPRADOR
        pars[318].runs[0].text = nome_c
        _substituir_texto(pars[319], f"CPF: {cpf}", f"CPF: {formatar_cpf_cnpj(conjuge.get('cpf_cnpj'))}")

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def preencher_contrato_rancho_texas(
    *,
    proposta: dict,
    lote: dict,
    cliente: dict,
    data_contrato: Optional[date] = None,
) -> bytes:
    """Preenche o modelo real do contrato do Rancho Texas (alienação
    fiduciária) com os dados da proposta, do lote e da qualificação do(s)
    comprador(es) -- mesma lógica do Porto Franco (preencher_contrato_
    porto_franco), com três diferenças de fato:

    1. Não tem cláusula de comissão de corretagem qualificando o corretor
       (o Rancho Texas trata isso só como desconto na devolução em caso de
       desistência, sem "R$ X, pago ao CORRETOR Y" pra preencher) -- por
       isso não pede corretor nem comissão.
    2. Tem estrutura de DOIS compradores (A - COMPRADOR / B - COMPRADORA,
       pensada pra casal) -- só preenche o bloco da COMPRADORA se
       estado_civil vier "casado" e a qualificação tiver dados do cônjuge;
       senão limpa os placeholders de exemplo do modelo ("XXXX") sem
       inventar nome/CPF.
    3. O item V (OBJETIVO) tem confrontação do lote (frente/fundo/laterais,
       área privativa/comum/real) que não existe em lugar nenhum do sistema
       -- fica com os valores de exemplo do modelo, pra alguém completar à
       mão. Só o número do lote e a área total (que o sistema tem) são
       preenchidos.

    Datas específicas de vencimento da entrada/chave que o modelo trouxe
    como exemplo (ex.: "para o dia 08/09/2026") são removidas em vez de
    mantidas erradas -- não existe, hoje, um campo de "data de vencimento
    da entrada" separado do vencimento das parcelas. Pedido em 28/09."""
    data_contrato = data_contrato or date.today()
    dq = proposta.get("dados_qualificacao") or {}
    proponente = dq.get("proponente") or {}
    conjuge = dq.get("conjuge") or {}
    endereco = dq.get("endereco_residencial") or {}
    fp = dq.get("forma_pagamento") or {}
    estado_civil = dq.get("estado_civil")
    tem_compradora = tem_conjuge(dq) and bool(limpar_nome(conjuge.get("nome")))

    doc = docx.Document(str(_TEMPLATES_DIR / "contrato_rancho_texas.docx"))
    t = doc.tables[0]

    # --- III. COMPRADOR / COMPRADORA (QUADRO RESUMO) ----------------------
    p = t.rows[4].cells[0].paragraphs
    nome = _nome_comprador(proponente, cliente)
    cpf = formatar_cpf_cnpj(proponente.get("cpf_cnpj") or cliente.get("cpf"))
    _substituir_texto(p[2], "NOME: ", f"NOME: {nome}")
    _substituir_texto(
        p[3], p[3].text, f"NACIONALIDADE: {proponente.get('nacionalidade') or '-'}   PROFISSÃO: {proponente.get('profissao') or '-'}"
    )
    _substituir_texto(
        p[4],
        p[4].text,
        f"DATA DE NASCIMENTO: {_fmt_data_livre(proponente.get('data_nascimento'))}   "
        f"LOCAL: {(proponente.get('naturalidade') or '').strip() or '-'}",
    )
    _substituir_texto(p[5], p[5].text, f"CPF: {cpf}   IDENTIDADE: {_identidade(proponente)}")
    _substituir_texto(p[6], "ESTADO CIVIL: ", f"ESTADO CIVIL: {ESTADO_CIVIL_LABEL.get(estado_civil, '-')}")

    if tem_compradora:
        nome_c = limpar_nome(conjuge.get("nome")) or "-"
        cpf_c = formatar_cpf_cnpj(conjuge.get("cpf_cnpj"))
        _substituir_texto(p[8], "NOME: ", f"NOME: {nome_c}")
        _substituir_texto(
            p[9],
            p[9].text,
            f"NACIONALIDADE: {conjuge.get('nacionalidade') or '-'}   PROFISSÃO: {conjuge.get('profissao') or '-'}",
        )
        _substituir_texto(
            p[10], p[10].text, f"DATA DE NASCIMENTO: {_fmt_data_livre(conjuge.get('data_nascimento'))}   "
            f"LOCAL: {(conjuge.get('naturalidade') or '').strip() or '-'}"
        )
        _substituir_texto(p[11], p[11].text, f"CPF: {cpf_c}   IDENTIDADE: {_identidade(conjuge)}")
        _substituir_texto(p[12], "ESTADO CIVIL: ", f"ESTADO CIVIL: {ESTADO_CIVIL_LABEL.get(estado_civil, '-')}")
    # Sem cônjuge na qualificação: o bloco "B – COMPRADORA" fica como o
    # modelo já traz (rótulos em branco, sem exemplo nenhum pra tirar) --
    # nada a fazer aqui.

    _substituir_texto(p[13], "ENDEREÇO RESIDENCIAL: ", f"ENDEREÇO RESIDENCIAL: {_endereco_completo(endereco)}")
    _substituir_texto(
        p[14],
        p[14].text,
        f"BAIRRO: {endereco.get('bairro') or '-'}   MUNICÍPIO: {endereco.get('cidade') or '-'}   "
        f"UF: {endereco.get('estado') or '-'}   CEP: {formatar_cep(endereco.get('cep'))}",
    )

    # --- V. OBJETIVO (só número do lote e área total -- confrontação do
    # lote não existe em lugar nenhum do sistema, fica de exemplo) --------
    p_objetivo = t.rows[7].cells[0].paragraphs[1]
    area_fmt = formatar_valor(lote.get("tamanho_m2") or 0)
    _substituir_texto(
        p_objetivo,
        "LOTE Nº XX , com área total de XX m²,",
        f"LOTE Nº {lote.get('lote_numero', '-')}, com área total de {area_fmt} m²,",
    )

    # Confrontações: o modelo traz as medidas de OUTRO lote como exemplo
    # (720,55m², Alameda Georgia, lote 82...). Com o contrato saindo em PDF
    # (02/10) ninguém mais edita o arquivo antes de assinar, então o exemplo
    # sairia impresso como se fosse deste lote. Troca só os NÚMEROS/nomes de
    # exemplo por linhas em branco pra preencher à mão -- a estrutura do
    # texto do modelo fica igual.
    confrontacoes = t.rows[7].cells[0].paragraphs
    linha = "__________"
    for idx, exemplo, em_branco in (
        (2, "Área privativa: 720,55m², Área comum: 556,16m² e Área real: 1.276,71m²",
         f"Área privativa: {linha}m², Área comum: {linha}m² e Área real: {linha}m²"),
        (3, "17,57m de frente com a Alameda Georgia", f"{linha}m de frente com {linha}{linha}"),
        (4, "16,25m de fundo com o lote 82 + 4,48m com o lote 81", f"{linha}m de fundo com {linha}{linha}"),
        (5, "37,14m de comprimento pelo lado direito com o lote 70",
         f"{linha}m de comprimento pelo lado direito com {linha}{linha}"),
        (6, "38,04m de comprimento pelo lado esquerdo com o lote 72",
         f"{linha}m de comprimento pelo lado esquerdo com {linha}{linha}"),
    ):
        _substituir_texto(confrontacoes[idx], exemplo, em_branco)

    # --- VI. PREÇO ----------------------------------------------------------
    valor_total = proposta.get("valor_proposto") or lote.get("valor_total") or 0.0
    p_preco = t.rows[9].cells[0].paragraphs[1]
    _substituir_texto(
        p_preco,
        "R$: XXX  (XX) (“Preço”)",
        f"R$: {formatar_valor(valor_total)} ({valor_por_extenso(valor_total)}) (“Preço”)",
    )

    # --- VII. FORMA DE PAGAMENTO ---------------------------------------------
    # As três linhas abaixo (Sinal, Parcelas, Chave) e a restauração das
    # arras no §-fixo NÃO são rótulos em branco no modelo -- o Rancho Texas
    # já vem com uma frase de exemplo pronta (valor "R$ XX (XXX)", data
    # "08/09/2026" etc.). Diferente do Porto Franco (rótulo realmente vazio
    # no modelo), aqui a substituição tem que ser SEMPRE feita, mesmo sem
    # dado disponível -- senão o exemplo fictício do modelo vaza pro
    # contrato de verdade sem ninguém notar (bug encontrado em revisão,
    # 28/09: um lote sem "entrada"/"entrega" configurados e uma proposta
    # sem qualificação completa geravam contrato com a data 08/09/2026 e o
    # valor de exemplo ainda dentro do texto).
    pp = t.rows[11].cells[0].paragraphs
    tp = _textos_pagamento(fp, lote, valor_total)
    sinal_modelo = "Sinal/Arras confirmatórias: R$ XX (XXX) sendo pago em boleto bancário para o dia 08/09/2026."
    arras_modelo = "R$ 20.175,40 (Vinte mil cento e setenta e cinco reais e quarenta centavos)"
    if tp["entrada"]:
        _substituir_texto(pp[3], sinal_modelo, f"Sinal/Arras confirmatórias: {tp['entrada']}{tp['entrada_compl_rt']}.")
        _substituir_texto(pp[11], arras_modelo, tp["entrada"])
    else:
        _substituir_texto(pp[3], sinal_modelo, "Sinal/Arras confirmatórias: -.")
        _substituir_texto(pp[11], arras_modelo, "-")

    parcelas_modelo = (
        "Parcelas: 100 parcelas mensais e sucessivas no valor de R$ XX (X X), vencendo a primeira em "
        "XX/XX/XXXX e as demais todo dia cinco dos meses subsequentes."
    )
    if tp["a_vista"]:
        _substituir_texto(pp[5], parcelas_modelo, "Parcelas: não há (pagamento à vista).")
    elif tp["parcelas"]:
        pc = tp["parcelas"]
        dia = pc["dia"] or "-"
        _substituir_texto(
            pp[5],
            parcelas_modelo,
            f"Parcelas: {pc['qtd']} ({_numero_extenso_feminino(pc['qtd'])}) parcelas mensais e sucessivas no valor "
            f"de R$ {formatar_valor(pc['valor'])} ({valor_por_extenso(pc['valor'])}), vencendo a primeira "
            f"em {pc['primeira'] or '-'} e as demais todo dia {dia} dos meses subsequentes.",
        )
    else:
        _substituir_texto(pp[5], parcelas_modelo, "Parcelas: -.")

    chave_modelo = "Chave: R$ XXX  (XXX) a ser pago até 30/09/2029."
    if tp["a_vista"] or tp["chave_valor"] == 0:
        _substituir_texto(pp[7], chave_modelo, "Chave: não há" + (" (pagamento à vista)." if tp["a_vista"] else "."))
    elif tp["chave_valor"]:
        # Mesma regra do Porto Franco (09/10): chave sem data no contrato.
        chave = tp["chave_valor"]
        texto_chave = f"Chave: R$ {formatar_valor(chave)} ({valor_por_extenso(chave)}), a ser paga na entrega das chaves."
        _substituir_texto(pp[7], chave_modelo, texto_chave)
    else:
        _substituir_texto(pp[7], chave_modelo, "Chave: -.")

    # --- IX. PROPORÇÃO DA AQUISIÇÃO (mesma regra do Porto Franco) -----------
    preencher_proporcao(doc, compradores_proporcao(nome, dq, so_resposta_direta=False), obrigatoria=False)

    # --- XII. LOCAL E DATA DE CELEBRAÇÃO --------------------------------------
    p_data = t.rows[19].cells[0].paragraphs[1]
    _substituir_texto(
        p_data,
        "neste dia XX de XXX de 2026.",
        f"neste dia {data_contrato.day} de {_MESES[data_contrato.month - 1].capitalize()} de {data_contrato.year}.",
    )

    # --- Título (número do contrato) -------------------------------------------
    _substituir_texto(
        doc.paragraphs[0], "CONTRATO Nº /2026", titulo_contrato(proposta, data_contrato)
    )

    # --- Assinaturas: nome e CPF do(s) comprador(es) ----------------------------
    # Índices conferidos direto no modelo (ver conversa de 28/09); se o
    # modelo for reeditado no Word essas posições podem mudar.
    _substituir_texto(doc.paragraphs[341], "XXXXX", nome)
    _substituir_texto(doc.paragraphs[342], "CPF: XXX", f"CPF: {cpf}")
    if tem_compradora:
        _substituir_texto(doc.paragraphs[348], "XXXX", limpar_nome(conjuge.get("nome")) or "-")
        _substituir_texto(doc.paragraphs[349], "CPF: XXXX", f"CPF: {formatar_cpf_cnpj(conjuge.get('cpf_cnpj'))}")
    else:
        # Sem cônjuge: limpa os placeholders de exemplo do modelo em vez de
        # deixar "XXXX" (texto de exemplo, nunca deveria ir pra um contrato
        # de verdade) -- fica como um campo em branco de fato, igual ao
        # resto do bloco "B – COMPRADORA" no QUADRO RESUMO.
        _substituir_texto(doc.paragraphs[348], "XXXX", "")
        _substituir_texto(doc.paragraphs[349], "CPF: XXXX", "CPF: ")

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Riviera e Veneza (modelos enviados em 29/10)
# ---------------------------------------------------------------------------

def _nome_na_assinatura(doc, idx_linha: int, idx_cpf: int, nome: str) -> None:
    """Nome do comprador entre o traço da assinatura e o "CPF:" -- mesmo
    critério do Porto Franco (o modelo só traz "CPF:" e o contrato saía sem
    dizer quem assina). Aqui não há linha vazia entre os dois, então cria
    um parágrafo logo abaixo do traço, com a formatação do "CPF:"."""
    linha, p_cpf = doc.paragraphs[idx_linha], doc.paragraphs[idx_cpf]
    if "____" not in linha.text or not p_cpf.text.strip().startswith("CPF"):
        raise ValueError("Bloco de assinatura do comprador não encontrado no modelo.")
    novo = copy.deepcopy(p_cpf._p)
    for r in novo.findall(qn("w:r")):
        novo.remove(r)
    linha._p.addnext(novo)
    par = Paragraph(novo, linha._parent)
    run = par.add_run(nome)
    rpr = p_cpf.runs[0]._r.rPr if p_cpf.runs else None
    if rpr is not None:
        run._r.insert(0, copy.deepcopy(rpr))


def _data_extenso(d: date) -> str:
    return f"{d.day:02d} de {_MESES[d.month - 1].capitalize()} de {d.year}"


def _percentual(parte: float, total: float) -> str:
    """12500 / 299000 -> '4,18%'; 5% exato -> '5%'."""
    if not total:
        return "0%"
    txt = f"{parte / total * 100:.2f}".rstrip("0").rstrip(".")
    return txt.replace(".", ",") + "%"


def problemas_modelo_contrato(slug: Optional[str], fp: dict, lote: dict) -> list[str]:
    """O que o plano tem e o modelo não tem onde imprimir -- melhor travar do
    que sair um contrato com parte do pagamento faltando."""
    plano = ler_plano(fp)
    if plano.a_vista:
        return []
    v = valores_contrato(fp, lote)
    problemas: list[str] = []
    if slug == "veneza" and v.chave:
        problemas.append("O contrato do Veneza não tem campo de chave: passe o valor da chave para o financiamento ou para os balões.")
    if slug not in ("veneza",) and (v.balao_qtd or v.financiamento):
        problemas.append("O modelo de contrato deste empreendimento não tem balões nem financiamento bancário: ajuste a forma de pagamento.")
    return problemas


def preencher_contrato_riviera(
    *,
    proposta: dict,
    lote: dict,
    cliente: dict,
    data_contrato: Optional[date] = None,
) -> bytes:
    """Contrato do Riviera Residence Beach (modelo de 29/10, EPF Construções):
    mesma estrutura do Porto Franco (QUADRO RESUMO em tabela), preenchendo
    só os campos em branco. O item V (confrontações) fica em branco -- o
    Riviera não tem memorial cadastrado. O quadro antigo de exemplo
    "VII. Forma de pagamento" (Entrada R$ 6.500,00 de 2015, parcelas de obra
    e pós-obra) sai do contrato: fica só o VII em branco, preenchido com o
    plano da proposta (combinado em 29/10)."""
    data_contrato = data_contrato or date.today()
    dq = proposta.get("dados_qualificacao") or {}
    proponente = dq.get("proponente") or {}
    endereco = dq.get("endereco_residencial") or {}
    fp = dq.get("forma_pagamento") or {}
    estado_civil = dq.get("estado_civil")

    doc = docx.Document(str(_TEMPLATES_DIR / "contrato_riviera.docx"))
    t = doc.tables[0]

    # --- III. COMPRADOR ------------------------------------------------------
    p = t.rows[4].cells[0].paragraphs
    nome = _nome_comprador(proponente, cliente)
    cpf = formatar_cpf_cnpj(proponente.get("cpf_cnpj") or cliente.get("cpf"))
    _substituir_texto(p[2], "NOME: ", f"NOME: {nome}")
    _substituir_texto(
        p[3], p[3].text, f"NACIONALIDADE: {proponente.get('nacionalidade') or '-'}   PROFISSÃO: {proponente.get('profissao') or '-'}"
    )
    _substituir_texto(
        p[4], p[4].text,
        f"DATA DE NASCIMENTO: {_fmt_data_livre(proponente.get('data_nascimento'))}   "
        f"LOCAL: {(proponente.get('naturalidade') or '').strip() or '-'}",
    )
    _substituir_texto(p[5], p[5].text, f"CPF: {cpf}   IDENTIDADE: {_identidade(proponente)}")
    _substituir_texto(p[6], p[6].text, f"ESTADO CIVIL: {ESTADO_CIVIL_LABEL.get(estado_civil, '-')}")
    _substituir_texto(p[7], "ENDEREÇO RESIDENCIAL: ", f"ENDEREÇO RESIDENCIAL: {_endereco_completo(endereco)}")
    _substituir_texto(
        p[8], p[8].text,
        f"BAIRRO: {endereco.get('bairro') or '-'}   MUNICÍPIO: {endereco.get('cidade') or '-'}   "
        f"UF: {endereco.get('estado') or '-'}   CEP: {formatar_cep(endereco.get('cep'))}",
    )

    # --- V. OBJETIVO (lote, quadra e área; confrontações à mão) ---------------
    area_fmt = formatar_valor(float(lote.get("tamanho_m2") or 0))
    _substituir_texto(
        t.rows[7].cells[0].paragraphs[1],
        "LOTE Nº  QUADRA Nº, com área total de 200,00 m²",
        f"LOTE Nº {lote.get('lote_numero', '-')} QUADRA Nº {lote.get('quadra', '-')}, com área total de {area_fmt} m²",
    )

    # --- VI. PREÇO -------------------------------------------------------------
    valor_total = proposta.get("valor_proposto") or lote.get("valor_total") or 0.0
    _substituir_texto(
        t.rows[9].cells[0].paragraphs[1],
        "R$ 170.000,00 (Cento e setenta mil reais)",
        f"R$ {formatar_valor(valor_total)} ({valor_por_extenso(valor_total)})",
    )

    # --- VII. FORMA DE PAGAMENTO (o quadro em branco) ---------------------------
    pp = t.rows[11].cells[0].paragraphs
    tp = _textos_pagamento(fp, lote, valor_total)
    _substituir_texto(pp[3], "Entrada:", f"Entrada: {tp['entrada'] or '-'}{tp['entrada_compl_pf']}.")
    if tp["a_vista"]:
        _substituir_texto(pp[4], "Parcelas: ", "Parcelas: não há (pagamento à vista).")
    elif tp["parcelas"]:
        pc = tp["parcelas"]
        texto = (
            f"{pc['qtd']} ({_numero_extenso_feminino(pc['qtd'])}) parcelas mensais e sucessivas de "
            f"R$ {formatar_valor(pc['valor'])} ({valor_por_extenso(pc['valor'])}) cada"
        )
        if pc["primeira"]:
            texto += f", vencendo a primeira em {pc['primeira']} {pc['demais']}"
        _substituir_texto(pp[4], "Parcelas: ", f"Parcelas: {texto}.")
    if not tp["a_vista"] and tp["chave_valor"]:
        # O modelo não tem linha de chave; a linha em branco logo abaixo das
        # parcelas recebe o valor (mesma redação dos outros contratos).
        chave = tp["chave_valor"]
        alvo = pp[5]
        if alvo.text.strip():
            raise ValueError("Modelo do Riviera sem a linha em branco abaixo das parcelas.")
        run = alvo.add_run(f"Chave: R$ {formatar_valor(chave)} ({valor_por_extenso(chave)}), a ser paga na entrega das chaves.")
        rpr = pp[4].runs[-1]._r.rPr if pp[4].runs else None
        if rpr is not None:
            run._r.insert(0, copy.deepcopy(rpr))

    # --- IX. PROPORÇÃO DA AQUISIÇÃO --------------------------------------------
    preencher_proporcao(doc, compradores_proporcao(nome, dq))

    # --- XII. LOCAL E DATA ------------------------------------------------------
    _substituir_texto(
        t.rows[20].cells[0].paragraphs[1],
        "neste dia 22 de Fevereiro de 2024.",
        f"neste dia {data_contrato.day} de {_MESES[data_contrato.month - 1].capitalize()} de {data_contrato.year}.",
    )

    # --- Título e assinatura -----------------------------------------------------
    _substituir_texto(doc.paragraphs[0], "CONTRATO Nº 00/2024", titulo_contrato(proposta, data_contrato))
    _substituir_texto(doc.paragraphs[316], "CPF: ", f"CPF: {cpf}")
    _nome_na_assinatura(doc, 315, 316, nome)

    # --- Quadro antigo de exemplo (2015) sai por último (muda os índices) -------
    exemplo = [r for r in t.rows if "30/08/2015" in r.cells[0].text]
    if len(exemplo) != 1:
        raise ValueError("Quadro de exemplo de 2015 do modelo do Riviera não encontrado.")
    t._tbl.remove(exemplo[0]._tr)

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def preencher_contrato_veneza(
    *,
    proposta: dict,
    lote: dict,
    cliente: dict,
    valor_comissao: float,
    data_contrato: Optional[date] = None,
) -> bytes:
    """Contrato do Veneza Residencial (modelo de 29/10, L R Construtora): o
    QUADRO RESUMO é texto corrido (sem tabela). Preenche só os campos:

    - 1.2 comprador (nome, nacionalidade, estado civil, CPF, RG, endereço).
      O modelo não tem lugar para cônjuge: fica só o comprador.
    - 2.1 casa/quadra, área privativa (área construída da casa) e terreno
      (área do lote). A "fração ideal" fica em branco para completar à mão.
    - 3.1 preço total = valor de tabela da proposta; A - bônus = desconto
      dado (tabela - proposto, ou zero); C - preço do imóvel = valor
      proposto; B entrada, D parcelas, E balões e 3.2.1 financiamento vêm do
      plano da proposta.
    - 3.2.2 e 4: comissão = valor informado pelo financeiro na emissão, com
      o percentual calculado sobre o preço total.
    - Data, número/versão do contrato (na linha em branco do topo) e o nome
      e CPF do comprador na assinatura."""
    data_contrato = data_contrato or date.today()
    dq = proposta.get("dados_qualificacao") or {}
    proponente = dq.get("proponente") or {}
    endereco = dq.get("endereco_residencial") or {}
    fp = dq.get("forma_pagamento") or {}
    estado_civil = dq.get("estado_civil")
    plano = ler_plano(fp)

    doc = docx.Document(str(_TEMPLATES_DIR / "contrato_veneza.docx"))
    ps = doc.paragraphs

    def brl(v: float) -> str:
        return f"R$ {formatar_valor(v)} ({valor_por_extenso(v)})"

    # --- 1.2 COMPRADOR ------------------------------------------------------------
    nome = _nome_comprador(proponente, cliente)
    cpf = formatar_cpf_cnpj(proponente.get("cpf_cnpj") or cliente.get("cpf"))
    nacionalidade = (proponente.get("nacionalidade") or "").strip() or "-"
    ec = ESTADO_CIVIL_LABEL.get(estado_civil, "-")
    _substituir_texto(ps[6], ": , Brasileiro, Divorciado", f": {nome}, {nacionalidade}, {ec}")
    _substituir_texto(ps[6], "inscrito no CPF sob nº, RG sob,", f"inscrito no CPF sob nº {cpf}, RG sob nº {_identidade(proponente)},")
    rua = _endereco_completo(endereco)
    bairro = endereco.get("bairro") or "-"
    cidade_uf = "/".join(x for x in [endereco.get("cidade"), endereco.get("estado")] if x) or "-"
    _substituir_texto(
        ps[6],
        "com endereço na Rua, nº  Centro, Mossoró/RN, CEP: doravante",
        f"com endereço na {rua}, {bairro}, {cidade_uf}, CEP: {formatar_cep(endereco.get('cep'))}, doravante",
    )

    # --- 2.1 IMÓVEL -----------------------------------------------------------------
    _substituir_texto(ps[9], "casa n.º XX da quadra XX", f"casa n.º {lote.get('lote_numero', '-')} da quadra {lote.get('quadra', '-')}")
    area_casa = lote.get("area_construida_m2")
    if area_casa:
        _substituir_texto(ps[9], "área privativa de 67,00", f"área privativa de {formatar_valor(float(area_casa))}")
    _substituir_texto(ps[9], "fração ideal de X", "fração ideal de ____________")
    if lote.get("tamanho_m2"):
        _substituir_texto(ps[9], "terreno de 200,00 m²", f"terreno de {formatar_valor(float(lote['tamanho_m2']))} m²")

    # --- 03. PREÇO --------------------------------------------------------------------
    proposto = float(proposta.get("valor_proposto") or lote.get("valor_total") or 0.0)
    tabela = float(fp.get("valor_tabela") or lote.get("valor_total") or proposto)
    bonus = max(0.0, round(tabela - proposto, 2))
    preco_total = round(proposto + bonus, 2)
    _substituir_texto(ps[12], "R$ 299.000,00 (Duzentos e noventa e nove mil reais)", brl(preco_total))
    _substituir_texto(ps[13], "R$ XX (XXX)", brl(bonus))
    v = valores_contrato(fp, lote)
    if plano.a_vista:
        _substituir_texto(ps[14], "R$ XXX (XXX)", f"{brl(proposto)}, pagamento à vista")
        _substituir_texto(ps[15], "R$ XXX (XXXX)", brl(proposto))
        _substituir_texto(ps[16], "36 (trinta e seis) parcelas de R$ XX (XXX)", "não há (pagamento à vista)")
        _substituir_texto(ps[17], "3 (três) parcelas de R$ XX (XXXX)", "não há (pagamento à vista)")
        _substituir_texto(ps[19], "R$ XXX  (XXX)", "não há (pagamento à vista)")
    else:
        _substituir_texto(ps[14], "R$ XXX (XXX)", brl(v.entrada or 0.0))
        _substituir_texto(ps[15], "R$ XXX (XXXX)", brl(proposto))
        if v.parcelas and v.parcela_valor:
            _substituir_texto(
                ps[16], "36 (trinta e seis) parcelas de R$ XX (XXX)",
                f"{v.parcelas} ({_numero_extenso_feminino(v.parcelas)}) parcelas de {brl(v.parcela_valor)}",
            )
        else:
            _substituir_texto(ps[16], "36 (trinta e seis) parcelas de R$ XX (XXX)", "não há")
        if v.balao_qtd and v.balao_valor:
            _substituir_texto(
                ps[17], "3 (três) parcelas de R$ XX (XXXX)",
                f"{v.balao_qtd} ({_numero_extenso_feminino(v.balao_qtd)}) parcelas de {brl(v.balao_valor)}",
            )
        else:
            _substituir_texto(ps[17], "3 (três) parcelas de R$ XX (XXXX)", "não há")
        _substituir_texto(ps[19], "R$ XXX  (XXX)", brl(v.financiamento) if v.financiamento else "não há")

    # --- 3.2.2 e 4. COMISSÃO ------------------------------------------------------------
    _substituir_texto(ps[23], "R$ 12.500,00 (doze mil e quinhentos reais)", brl(valor_comissao))
    _substituir_texto(ps[26], "R$ 12.500,00 (doze mil e quinhentos reais)", brl(valor_comissao))
    _substituir_texto(ps[26], "5% do valor total", f"{_percentual(valor_comissao, preco_total)} do valor total")

    # --- Data, título e assinatura -------------------------------------------------------
    _substituir_texto(ps[242], "05 de Dezembro de 2024", _data_extenso(data_contrato))
    _substituir_texto(ps[248], "CPF: ", f"CPF: {cpf}")
    _nome_na_assinatura(doc, 247, 248, nome)
    topo = ps[0]
    if topo.text.strip():
        raise ValueError("Modelo do Veneza sem a linha em branco do topo para o número do contrato.")
    run = topo.add_run(titulo_contrato(proposta, data_contrato))
    # mesma fonte do título "INSTRUMENTO PARTICULAR..." logo abaixo
    rpr_titulo = ps[1].runs[0]._r.rPr if ps[1].runs else None
    if rpr_titulo is not None:
        run._r.insert(0, copy.deepcopy(rpr_titulo))
    run.bold = True
    topo.alignment = ps[1].alignment

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()
