-- Livro de idempotência da importação nativa (§9.5, decisão A26).
--
-- Registo de cada registo criado por uma importação, sob a chave
-- (userId, bundleId, localId). É o que faz uma reimportação do mesmo bundle não
-- criar nada e o que torna seguro retomar uma importação por lotes interrompida.
--
-- `createdRecordId` é TEXT e não uma chave estrangeira: aponta para sete tabelas
-- diferentes (Vehicle, Expense, …) e o Prisma não tem FK polimórfica. A
-- integridade é garantida pelo ON DELETE CASCADE do utilizador — o livro de um
-- utilizador desaparece com ele.

-- CreateTable
CREATE TABLE "ImportBookEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "recordKind" TEXT NOT NULL,
    "createdRecordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBookEntry_userId_bundleId_idx" ON "ImportBookEntry"("userId", "bundleId");

-- CreateIndex
CREATE INDEX "ImportBookEntry_expiresAt_idx" ON "ImportBookEntry"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBookEntry_userId_bundleId_localId_key" ON "ImportBookEntry"("userId", "bundleId", "localId");

-- AddForeignKey
ALTER TABLE "ImportBookEntry" ADD CONSTRAINT "ImportBookEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
