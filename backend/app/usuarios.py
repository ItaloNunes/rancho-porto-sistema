"""Geração do login "usuário" dos corretores (ex.: italo.nunes), da senha
inicial (o telefone da pessoa, só dígitos) e o hash/verificação de senha.

Login próprio, sem Supabase Auth: a senha nunca é guardada em texto puro —
só o hash (bcrypt) na coluna `corretores.senha_hash`. O token de sessão (JWT)
é emitido e validado pelo próprio backend (ver app/security.py), sem
depender de e-mail em nenhuma etapa — nem pra criar login, nem pra recuperar
senha (isso é feito pelo admin, ver PainelCorretores.tsx > "Resetar senha").

O admin cadastra todo mundo a partir da planilha de contatos (ver
app/data/corretores_iniciais.py), e cada um recebe usuário = nome.sobrenome
e senha = telefone (sem DDD/traço). A pessoa pode trocar a senha depois
(opcional, não é obrigatório no primeiro acesso) — ver POST /crm/me/senha.
"""

import re
import unicodedata

import bcrypt


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


def hash_senha(senha: str) -> str:
    """Hash bcrypt da senha em texto puro — é isso (nunca a senha em si) que
    vai pra coluna `corretores.senha_hash`."""
    return bcrypt.hashpw(senha.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verificar_senha(senha: str, senha_hash: str | None) -> bool:
    """Confere a senha em texto puro (digitada no login) contra o hash
    guardado. `senha_hash` pode vir None (corretor antigo migrado sem senha
    definida ainda) — nesse caso nunca autentica, só retorna False."""
    if not senha_hash:
        return False
    try:
        return bcrypt.checkpw(senha.encode("utf-8"), senha_hash.encode("utf-8"))
    except ValueError:
        # hash corrompido/formato inesperado — trata como senha errada, não
        # como erro 500.
        return False


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
