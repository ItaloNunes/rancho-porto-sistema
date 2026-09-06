"""Popula o Supabase com os dois condomínios e seus lotes reais.

Rode uma vez depois de aplicar as migrations (supabase/migrations/*.sql):

    cd backend
    pip install -r requirements.txt
    cp .env.example .env   # preencha SUPABASE_URL / SUPABASE_SERVICE_KEY
    python -m seed.seed

É seguro rodar de novo: usa upsert por slug/quadra/lote_numero, não duplica.
"""

import json
from pathlib import Path

from app.database import get_supabase

DATA = Path(__file__).parent / "data"


def load(name: str):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def seed_condominio(slug: str, nome: str, incorporadora: str, cidade: str, segmento: str,
                     descricao: str, base_precos_em: str, plan: dict, lotes: list[dict],
                     logo_url: str | None = None, hero_image_url: str | None = None):
    sb = get_supabase()
    condo_row = {
        "slug": slug,
        "nome": nome,
        "incorporadora": incorporadora,
        "cidade": cidade,
        "segmento": segmento,
        "descricao": descricao,
        "ativo": True,
        "logo_url": logo_url,
        "hero_image_url": hero_image_url,
        "plan_w": plan["plan_w"],
        "plan_h": plan["plan_h"],
        "plan_minx": plan["plan_minx"],
        "plan_miny": plan["plan_miny"],
        "plan_decor": plan["decor"],
        "base_precos_em": base_precos_em,
    }
    existing = sb.table("condominios").select("id").eq("slug", slug).limit(1).execute().data
    if existing:
        condo_id = existing[0]["id"]
        sb.table("condominios").update(condo_row).eq("id", condo_id).execute()
        print(f"[{slug}] condomínio atualizado ({condo_id})")
    else:
        condo_id = sb.table("condominios").insert(condo_row).execute().data[0]["id"]
        print(f"[{slug}] condomínio criado ({condo_id})")

    inserted = 0
    for lote in lotes:
        row = {**lote, "condominio_id": condo_id}
        existing_lote = (
            sb.table("lotes")
            .select("id")
            .eq("condominio_id", condo_id)
            .eq("quadra", lote["quadra"])
            .eq("lote_numero", lote["lote_numero"])
            .limit(1)
            .execute()
            .data
        )
        if existing_lote:
            sb.table("lotes").update(row).eq("id", existing_lote[0]["id"]).execute()
        else:
            sb.table("lotes").insert(row).execute()
        inserted += 1
    print(f"[{slug}] {inserted} lotes sincronizados")


def main():
    rt_plan = load("rancho_texas_plan.json")
    rt_lotes = load("rancho_texas_lotes.json")
    seed_condominio(
        slug="rancho-texas",
        nome="Rancho Texas",
        incorporadora="Castel Construções e Incorporações",
        cidade="Mossoró/RN",
        segmento="Lotes residenciais (condomínio rural)",
        descricao="Lotes à beira do Rio Mossoró, com lagoa, clube e leque de quadras em arco.",
        base_precos_em="2026-07-07",
        plan=rt_plan,
        lotes=rt_lotes,
        # Caminhos locais (servidos pelo `npm run dev` a partir de frontend/public/brand)
        # -- troque pela URL pública do Supabase Storage quando publicar o site.
        logo_url="/brand/rancho-texas-logo.png",
        hero_image_url="/brand/rancho-texas-portaria.jpg",
    )

    pf_plan = load("porto_franco_plan.json")
    pf_lotes = load("porto_franco_lotes.json")
    seed_condominio(
        slug="porto-franco",
        nome="Porto Franco Residencial",
        incorporadora="Castel Construções e Incorporações",
        cidade="Mossoró/RN",
        segmento="Lotes residenciais",
        descricao="Condomínio residencial com clube, piscina, playground e área pet.",
        base_precos_em="2026-08-28",
        plan=pf_plan,
        lotes=pf_lotes,
        logo_url="/brand/porto-franco-logo.png",
        hero_image_url="/brand/porto-franco-aerial.png",
    )


if __name__ == "__main__":
    main()