-- GAB-43: perfil e conta — foto, esqueci a senha, sessões ativas.

-- Sessões: dispositivo (user-agent) e último uso.
ALTER TABLE "sessao" ADD COLUMN "user_agent" TEXT,
ADD COLUMN "ultimo_uso_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Esqueci a senha: pedido + link gerado pelo gestor (só o hash do token).
ALTER TABLE "usuario" ADD COLUMN "redefinicao_pedida_em" TIMESTAMP(3),
ADD COLUMN "redefinicao_token_hash" TEXT,
ADD COLUMN "redefinicao_expira_em" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_redefinicao_token_hash_key" ON "usuario"("redefinicao_token_hash");

-- Foto de perfil 1:1. Os CHECKs são a última barreira (o serviço valida antes).
CREATE TABLE "usuario_foto" (
    "usuario_id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_foto_pkey" PRIMARY KEY ("usuario_id"),
    CONSTRAINT "usuario_foto_mime_check" CHECK ("mime" IN ('image/webp', 'image/jpeg')),
    CONSTRAINT "usuario_foto_tamanho_check" CHECK (octet_length("bytes") <= 153600)
);

-- AddForeignKey
ALTER TABLE "usuario_foto" ADD CONSTRAINT "usuario_foto_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
