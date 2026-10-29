#!/usr/bin/env python3
"""Valida o Compose do Coolify sem iniciar containers nem acessar o banco."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = sys.argv[1:] or ["docker", "compose"]
SOURCE = (ROOT / "compose.coolify.yml").read_text(encoding="utf-8")
# O Coolify remove esta extensão antes de enviar o YAML ao Docker Compose.
EXTENSION = "    exclude_from_hc: true\n"
assert SOURCE.count(EXTENSION) == 1

env = dict(os.environ)
env.update({
    "DATABASE_URL": "postgresql://crm:p%40ss%3Aword@postgres-existente:5432/crm?schema=public&connection_limit=7",
    "APP_URL": "https://crm.exemplo.com.br",
    "EVOLUTION_API_KEY": "a" * 64,
    "EVOLUTION_WEBHOOK_SECRET": "b" * 64,
    "EVOLUTION_DB_PASSWORD": "c" * 64,
    "EVOLUTION_REDIS_PASSWORD": "d" * 64,
    "CRON_SECRET": "e" * 64,
    "NOTIFICATIONS_ENABLED": "false",
    "OPENAI_API_KEY": "chave-ficticia",
})
for key in ("COMPOSE_FILE", "COMPOSE_PROFILES", "COOLIFY_DATABASE_NETWORK", "EVOLUTION_API_URL"):
    env.pop(key, None)

with tempfile.TemporaryDirectory() as temporary:
    path = Path(temporary) / "compose.yml"
    path.write_text(SOURCE.replace(EXTENSION, ""), encoding="utf-8")
    blank_env = Path(temporary) / ".env"
    blank_env.touch()
    command = COMPOSE + ["--project-directory", str(ROOT), "--env-file", str(blank_env), "-f", str(path), "--profile", "ops", "config", "--format", "json"]

    def config(values):
        result = subprocess.run(command, env=values, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return json.loads(result.stdout)

    result = config(env)
    services = result["services"]
    assert set(services) == {"app", "migrate", "llm-smoke", "evolution", "evolution-db", "evolution-redis"}
    assert all(not service.get("ports") for service in services.values()), "Portas da VPS não devem ser publicadas"
    assert services["app"]["build"]["target"] == "runtime"
    assert services["migrate"]["build"]["target"] == "ops"
    assert services["app"]["depends_on"]["migrate"]["condition"] == "service_completed_successfully"
    assert services["app"]["depends_on"]["migrate"].get("required", True)
    assert services["migrate"]["command"] == ["./node_modules/.bin/prisma", "migrate", "deploy"]
    assert services["migrate"]["restart"] == "no"
    assert not services["migrate"].get("profiles"), "Migrations precisam rodar no deploy normal"
    for name in ("app", "migrate"):
        assert services[name]["environment"]["DATABASE_URL"] == env["DATABASE_URL"]
        assert services[name]["environment"]["APP_URL"] == env["APP_URL"]
        assert services[name]["environment"]["OPENAI_API_KEY"] == env["OPENAI_API_KEY"]
        assert "coolify" in services[name]["networks"]
    assert services["app"]["environment"]["EVOLUTION_API_URL"] == "http://evolution:8080"
    assert result["networks"]["coolify"]["external"]
    assert result["networks"]["coolify"]["name"] == "coolify"
    assert result["networks"]["rede-whatsapp"]["internal"]
    assert result["networks"]["rede-evolution"]["internal"]
    assert set(result["volumes"]) == {"evolution_instances", "evolution_db_data", "evolution_redis_data"}
    assert services["evolution"]["depends_on"]["evolution-db"]["condition"] == "service_healthy"
    assert services["evolution"]["depends_on"]["evolution-redis"]["condition"] == "service_healthy"

    custom = dict(env, COOLIFY_DATABASE_NETWORK="rede-existente", EVOLUTION_API_URL="http://evolution-existente:8080", NOTIFICATIONS_ENABLED="true")
    custom_result = config(custom)
    assert custom_result["networks"]["coolify"]["name"] == "rede-existente"
    assert custom_result["services"]["app"]["environment"]["EVOLUTION_API_URL"] == custom["EVOLUTION_API_URL"]
    assert custom_result["services"]["app"]["environment"]["NOTIFICATIONS_ENABLED"] == "true"

    for key in ("DATABASE_URL", "APP_URL"):
        for value in (None, ""):
            invalid = dict(env)
            if value is None:
                invalid.pop(key)
            else:
                invalid[key] = value
            failure = subprocess.run(command, env=invalid, capture_output=True, text=True)
            assert failure.returncode != 0 and key in failure.stderr, f"{key} ausente/vazia deve impedir o deploy"

print("OK: Compose válido; sem portas publicadas; banco externo e variáveis preservados; migrations antes do app.")
