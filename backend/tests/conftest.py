import os
import sys
from pathlib import Path

# roda os testes sem precisar de .env de verdade (nada aqui toca o Supabase)
os.environ.setdefault("SUPABASE_URL", "http://teste.invalid")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "teste")
os.environ.setdefault("JWT_SECRET", "teste")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
