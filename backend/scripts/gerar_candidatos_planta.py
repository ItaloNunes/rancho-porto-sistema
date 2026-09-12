"""Gera, a partir da imagem raster da planta técnica (JPG), um "mapa de
candidatos" de contorno de lote — usado pela ferramenta de marcação
automática do painel (PainelPlantas.tsx).

Por quê isso existe: a extração automática a partir do PDF vetorial da
planta não deu certo (a camada de contorno dos lotes é composta de milhares
de traços curtos e desconectados, não polilinhas fechadas — ver decisão do
produto). Mas a imagem RASTERIZADA da planta (o .jpg que já usamos pra
exibir a planta) tem essas linhas visualmente contínuas (a rasterização e o
anti-aliasing "fecham" os traços que no vetor original eram descontínuos).
Isso permite detectar o contorno de cada lote como uma região fechada de
verdade via visão computacional (Canny + operações morfológicas +
componentes conectados).

O que NÃO deu certo (testado e descartado): identificar automaticamente
QUAL número de lote cada contorno detectado corresponde, via OCR do texto
"LT NN" impresso dentro de cada lote — o texto é pequeno, rotacionado
(o leque de lotes é radial) e com compressão JPEG, e mesmo com correção de
rotação e upscale agressivo por recorte, o OCR acerta só uma fração dos
casos e frequentemente lê só um fragmento (ex.: "7" em vez de "87") —彼 não
dá pra confiar nisso pra escrever no banco de produção sem revisão humana
por lote, o que anularia o ganho de automatizar.

A solução adotada: a IA marca o CONTORNO (a forma geométrica), mas a
PESSOA continua escolhendo QUAL lote é aquele, com um clique só dentro da
forma (em vez de precisar clicar em cada canto manualmente). Ver
PainelPlantas.tsx (modo "Automático").

Saída (2 arquivos por planta, em frontend/public/brand/):
  <slug>-mapa.png         mesma resolução da imagem da planta; cada pixel
                          codifica, nos canais R+G, o índice (1-based) do
                          candidato de contorno que contém aquele pixel (0 =
                          nenhum candidato ali). id = R + G*256.
  <slug>-candidatos.json  lista de polígonos (um por candidato, na mesma
                          ordem/índice do mapa), já em coordenadas de pixel
                          da imagem == espaço de plan_w/plan_h (mapeamento
                          1:1 confirmado pros dois planos reais).

Uso:
  python backend/scripts/gerar_candidatos_planta.py rancho-texas \
      frontend/public/brand/rancho-texas-planta.jpg
  python backend/scripts/gerar_candidatos_planta.py porto-franco \
      frontend/public/brand/porto-franco-planta.jpg

Reprocessar é seguro: sobrescreve os dois arquivos de saída.
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np

AREA_MIN = 300
AREA_MAX = 6000
FILL_RATIO_MIN = 0.35
EPS_FRACOES = [0.01, 0.02, 0.03, 0.05, 0.08]


def gerar(caminho_imagem: Path):
    img = cv2.imread(str(caminho_imagem))
    if img is None:
        raise SystemExit(f"Não consegui abrir a imagem: {caminho_imagem}")
    h_img, w_img = img.shape[:2]

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blur, 40, 120)
    edges_d = cv2.dilate(edges, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=1)
    bg = cv2.bitwise_not(edges_d)
    bg_clean = cv2.morphologyEx(bg, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))

    n, labels, stats, _ = cv2.connectedComponentsWithStats(bg_clean, connectivity=4)

    mapa = np.zeros((h_img, w_img), dtype=np.int32)
    poligonos: list[list[list[float]]] = []

    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        x, y, w, h = (
            stats[i, cv2.CC_STAT_LEFT],
            stats[i, cv2.CC_STAT_TOP],
            stats[i, cv2.CC_STAT_WIDTH],
            stats[i, cv2.CC_STAT_HEIGHT],
        )
        if not (AREA_MIN <= area <= AREA_MAX):
            continue
        if x <= 1 or y <= 1 or x + w >= w_img - 1 or y + h >= h_img - 1:
            continue
        if area / (w * h) < FILL_RATIO_MIN:
            continue

        mask = (labels == i).astype(np.uint8) * 255
        contornos, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contornos:
            continue
        c = max(contornos, key=cv2.contourArea)
        peri = cv2.arcLength(c, True)

        approx = None
        for frac in EPS_FRACOES:
            a = cv2.approxPolyDP(c, frac * peri, True)
            if 4 <= len(a) <= 7:
                approx = a
                break
        if approx is None:
            approx = cv2.approxPolyDP(c, 0.03 * peri, True)
        if len(approx) < 3:
            continue

        idx = len(poligonos) + 1  # 1-based (0 = sem candidato)
        poligonos.append([[float(p[0][0]), float(p[0][1])] for p in approx])
        cv2.drawContours(mapa, [approx], -1, idx, thickness=-1)

    return mapa, poligonos


def salvar(slug: str, mapa: np.ndarray, poligonos: list, saida_dir: Path):
    h, w = mapa.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, 0] = mapa & 0xFF
    rgba[:, :, 1] = (mapa >> 8) & 0xFF
    rgba[:, :, 3] = 255
    saida_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(saida_dir / f"{slug}-mapa.png"), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    (saida_dir / f"{slug}-candidatos.json").write_text(json.dumps(poligonos), encoding="utf-8")
    print(f"[{slug}] {len(poligonos)} candidatos de contorno salvos em {saida_dir}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("uso: gerar_candidatos_planta.py <slug> <caminho-da-imagem.jpg>")
    slug, caminho = sys.argv[1], Path(sys.argv[2])
    mapa, poligonos = gerar(caminho)
    salvar(slug, mapa, poligonos, Path("frontend/public/brand"))
