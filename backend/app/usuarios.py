"""Geração do login "usuário" dos corretores (ex.: italo.nunes) e da senha
inicial (o telefone da pessoa, só dígitos).

Por que existe: a partir da mudança radical de setembro/2026, corretor não
loga mais com e-mail — o admin cadastra todo mundo de uma vez a partir da
planilha de contatos (ver app/data/corretores_iniciais.py), e cada um recebe
usuário = nome.sobrenome e senha = telefone (sem DDD/traço). A pessoa pode
trocar a senha depois (opcional, não é obrigatório no primeiro acesso).

O Supabase Auth continua exigindo um e-mail por baixo de cada usuário — a
gente fabrica um com DOMINIO_LOGIN, que o corretor nunca vê. Esse domínio
tem que ser IDÊNTICO ao usado no frontend (frontend/src/lib/usuarios.ts) —
mudou aqui, muda lá também, senão o login para de bater.
"""

import re
import unicodedata

DOMINIO_LOGIN = "corretor.login"


def slug(texto: str) -> str:
    """"Adryele Arruda" -> "adryele.arruda"; "S. S Imóveis" -> "s.s.imoveis"."""
    sem_acento = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode("ascii")
    partes = re.split(r"\s+", sem_acento.strip())
    limpos = [re.sub(r"[^a-zA-Z0-9]", "", p).lower() for p in partes]
    limpos = [p for p in limpos if p]
    resultado = ".".join(limpos)
    resultado = re.sub(r"\.{2,}", ".", resultado).strip(".")
    return resultado or "corretor"


def senha_de_telefone(telefone: str) -> str:
    """Só os dígitos do telefone (sem DDD/traço, exatamente como já vem na
    planilha) — vira a senha inicial do login."""
    return re.sub(r"\D", "", telefone or "")


def email_interno(usuario: str) -> str:
    """E-mail fabricado que satisfaz o Supabase Auth por baixo do login por
    usuário. Nunca é mostrado nem usado pelo corretor."""
    return f"{usuario}@{DOMINIO_LOGIN}"


def gerar_usuario_unico(nome: str, ja_usados: set[str]) -> str:
    """Gera o slug a partir do nome e resolve colisão (duas pessoas com o
    mesmo nome, ex. "João Barbosa" x2 na planilha) acrescentando um número:
    joao.barbosa, joao.barbosa2, joao.barbosa3... Muda `ja_usados` in-place
    (registra o resultado), pra poder chamar em sequência num loop."""
    base = slug(nome)
    usuario = base
    n = 2
    while usuario in ja_usados:
        usuario = f"{base}{n}"
        n += 1
    ja_usados.add(usuario)
    return usuario
