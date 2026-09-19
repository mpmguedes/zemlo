-- Mapa de colunas da Camada 2 (CSV), guardado por utilizador e por forma de
-- ficheiro (§10.2 passo 9, §11.3 «Não pedir duas vezes»).
--
-- O que isto resolve: a segunda importação do mesmo fornecedor deixa de passar
-- pelo ecrã de mapeamento. Sem isto, o mesmo trabalho é repetido em cada
-- importação, que é o que a §10.2 diz distinguir «uma funcionalidade usada de uma
-- abandonada».
--
-- A chave única é (userId, kind, shapeKey). O `userId` faz parte dela pelo mesmo
-- motivo que no livro de idempotência: **não existe mapa global**, e o mapa de um
-- utilizador nunca pode ser visto por outro, nem como sugestão.
--
-- `decisions` e `headers` são JSON porque são listas de forma variável, e o
-- Prisma não tem arrays em SQLite. Não são indexados: são lidos sempre pela
-- chave composta, nunca pesquisados por dentro.
--
-- `timesUsed`/`lastUsedAt` existem para o relatório (§10.2 passo 9) poder dizer
-- «guardei este mapa» com um número, em vez de uma promessa.

-- CreateTable
CREATE TABLE "ColumnMap" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shapeKey" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "kind" TEXT NOT NULL,
    "decisions" JSONB NOT NULL,
    "delimiter" TEXT NOT NULL,
    "encoding" TEXT NOT NULL,
    "dateOrder" TEXT,
    "decimalStyle" TEXT,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ColumnMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ColumnMap_userId_kind_idx" ON "ColumnMap"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ColumnMap_userId_kind_shapeKey_key" ON "ColumnMap"("userId", "kind", "shapeKey");

-- AddForeignKey
ALTER TABLE "ColumnMap" ADD CONSTRAINT "ColumnMap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
