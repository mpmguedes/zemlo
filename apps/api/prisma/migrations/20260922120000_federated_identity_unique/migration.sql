-- Identificador federado: de índice a garantia (§29, `AUTH-002`, decisão D4).
--
-- O que isto resolve: o par (`authProvider`, `authProviderId`) identifica uma
-- identidade externa — a conta Google de alguém. A regra do produto é que duas
-- contas Zemlo **nunca** partilham o mesmo par, e essa regra estava entregue a
-- uma consulta-antes-de-gravar sobre um índice **não único**.
--
-- Porque é que isso não chegava: dois pedidos simultâneos do mesmo utilizador
-- (duplo clique no botão, ou o callback do browser disparado duas vezes) podiam
-- passar ambos a verificação antes de qualquer escrita, e criar duas contas
-- ligadas à mesma identidade. Uma verificação aplicacional não fecha essa janela
-- — só a base de dados fecha.
--
-- Porque é que a construção do índice não pode falhar nem exigir backfill:
-- nenhum ficheiro do projeto escrevia estes campos até aqui (verificado por
-- `grep` em `apps/api/src`, `apps/api/test`, `apps/api/scripts`,
-- `packages/shared/src`, `apps/web/src` e `prisma/seed.ts` — zero resultados),
-- pelo que todas as linhas existentes têm `NULL` nos dois campos.
--
-- E `NULL` continua a não colidir: em PostgreSQL e em SQLite, `NULL` é distinto
-- de `NULL` num índice único, pela definição de `UNIQUE`. As contas de
-- email/password — que têm ambos os campos a `NULL` — continuam a coexistir sem
-- limite. É isso que torna esta alteração segura de aplicar sobre a tabela
-- `User` inteira, e não apenas sobre as contas federadas.
--
-- A variante SQLite **não** leva migration própria: é derivada do canónico e
-- aplicada por `db push` (`db:sync-schema`). Ver §7.1.

-- DropIndex
DROP INDEX "User_authProvider_authProviderId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "User_authProvider_authProviderId_key" ON "User"("authProvider", "authProviderId");
